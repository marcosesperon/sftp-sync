//! Lógica de sincronización: mapeo de rutas local→remoto y subida completa.

use anyhow::{anyhow, Result};
use globset::GlobSet;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::config::Profile;
use crate::ignore;
use crate::sftp::SftpConnection;

/// Resultado de una operación de sincronización completa.
#[derive(Debug, Default, serde::Serialize, Clone)]
pub struct SyncStats {
    pub uploaded: usize,
    pub skipped: usize,
    pub deleted: usize,
    pub errors: usize,
}

/// Convierte una ruta local absoluta en su ruta relativa POSIX respecto a la raíz.
/// Devuelve `None` si la ruta queda fuera de la raíz local.
pub fn rel_posix(local_root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(local_root).ok()?;
    let s = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Une la raíz remota con una ruta relativa POSIX, normalizando barras.
pub fn remote_join(remote_root: &str, rel_posix: &str) -> String {
    let root = remote_root.trim_end_matches('/');
    format!("{root}/{rel_posix}")
}

/// Sube todos los ficheros de la raíz local que no estén ignorados.
///
/// `log` recibe mensajes de progreso para reenviarlos a la UI.
pub async fn sync_all<F: Fn(&str)>(
    conn: &SftpConnection,
    profile: &Profile,
    log: F,
) -> Result<SyncStats> {
    let local_root = PathBuf::from(&profile.local_root);
    if !local_root.is_dir() {
        return Err(anyhow!("la raíz local no existe: {}", profile.local_root));
    }
    let set: GlobSet = ignore::build(&profile.ignore)?;
    let mut stats = SyncStats::default();
    // Conjunto de rutas relativas subidas, para el modo espejo.
    let mut local_files: HashSet<String> = HashSet::new();

    for entry in WalkDir::new(&local_root).follow_links(false) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                stats.errors += 1;
                continue;
            }
        };
        let rel = match rel_posix(&local_root, entry.path()) {
            Some(r) => r,
            None => continue, // la propia raíz
        };
        if ignore::is_ignored(&set, &rel) {
            if entry.file_type().is_file() {
                stats.skipped += 1;
            }
            continue;
        }

        // Directorios: solo se crean si la opción está activa.
        if entry.file_type().is_dir() {
            if profile.sync_empty_dirs {
                let remote = remote_join(&profile.remote_path, &rel);
                let _ = conn.ensure_dir(&remote).await;
            }
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }

        local_files.insert(rel.clone());
        let remote = remote_join(&profile.remote_path, &rel);
        match std::fs::read(entry.path()) {
            Ok(data) => match conn.upload(&remote, &data).await {
                Ok(_) => {
                    stats.uploaded += 1;
                    log(&format!("↑ {rel}"));
                }
                Err(e) => {
                    stats.errors += 1;
                    log(&format!("✗ {rel}: {e}"));
                }
            },
            Err(e) => {
                stats.errors += 1;
                log(&format!("✗ {rel} (lectura local): {e}"));
            }
        }
    }

    // Modo espejo: borrar del remoto los ficheros que no están en local.
    if profile.mirror_delete {
        match conn.list_files_recursive(&profile.remote_path).await {
            Ok(remote_files) => {
                for rf in remote_files {
                    if local_files.contains(&rf) {
                        continue;
                    }
                    let remote = remote_join(&profile.remote_path, &rf);
                    match conn.remove_file(&remote).await {
                        Ok(_) => {
                            stats.deleted += 1;
                            log(&format!("🗑 {rf}"));
                        }
                        Err(e) => {
                            stats.errors += 1;
                            log(&format!("✗ borrado {rf}: {e}"));
                        }
                    }
                }
            }
            Err(e) => {
                log(&format!("no se pudo listar el remoto para el espejo: {e}"));
            }
        }
    }

    Ok(stats)
}
