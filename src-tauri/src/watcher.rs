//! Watcher de ficheros: vigila la raíz local y sube/borra al detectar cambios.
//!
//! Usa `notify-debouncer-full` para agrupar la ráfaga de eventos que generan los
//! editores al guardar (escribir temporal + renombrar) en una sola acción.

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;

use crate::commands;
use crate::config::{NotifyMode, Profile};
use crate::events;
use crate::ignore;
use crate::notifications;
use crate::sftp::SftpConnection;
use crate::sync;

/// Ventana de debounce: agrupa eventos que llegan en este intervalo.
const DEBOUNCE_MS: u64 = 600;

/// Bucle de vigilancia para un perfil. Pensado para ejecutarse en una tarea
/// que se cancela (`abort`) al parar el watcher.
pub async fn run(app: AppHandle, profile: Profile) {
    let local_root = PathBuf::from(&profile.local_root);
    if !local_root.is_dir() {
        events::log(&app, &profile.id, "error", format!("la raíz local no existe: {}", profile.local_root));
        events::watch_state(&app, &profile.id, false);
        return;
    }

    let set = match ignore::build(&profile.ignore) {
        Ok(s) => s,
        Err(e) => {
            events::log(&app, &profile.id, "error", format!("patrones ignore inválidos: {e}"));
            events::watch_state(&app, &profile.id, false);
            return;
        }
    };
    let include = match ignore::build_include(&profile.include) {
        Ok(s) => s,
        Err(e) => {
            events::log(&app, &profile.id, "error", format!("patrones de inclusión inválidos: {e}"));
            events::watch_state(&app, &profile.id, false);
            return;
        }
    };

    // Canal puente: el handler del debouncer corre en su propio hilo (sync) y
    // reenvía los eventos a este bucle async sin bloquear.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<DebounceEventResult>();
    let mut debouncer = match new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |res: DebounceEventResult| {
            let _ = tx.send(res);
        },
    ) {
        Ok(d) => d,
        Err(e) => {
            events::log(&app, &profile.id, "error", format!("no se pudo iniciar el watcher: {e}"));
            events::watch_state(&app, &profile.id, false);
            return;
        }
    };

    if let Err(e) = debouncer.watch(&local_root, RecursiveMode::Recursive) {
        events::log(&app, &profile.id, "error", format!("no se pudo vigilar la carpeta: {e}"));
        events::watch_state(&app, &profile.id, false);
        return;
    }

    events::log(&app, &profile.id, "info", format!("Vigilando {}", profile.local_root));
    events::watch_state(&app, &profile.id, true);

    // Conexión perezosa y reutilizada entre eventos.
    let mut conn: Option<SftpConnection> = None;
    // Hash del contenido de cada fichero ya subido en esta sesión de vigilancia.
    // Permite omitir guardados que no cambian el contenido (evita resubir lo mismo).
    let mut hashes: HashMap<PathBuf, u64> = HashMap::new();

    while let Some(res) = rx.recv().await {
        let events_batch = match res {
            Ok(evs) => evs,
            Err(errs) => {
                for e in errs {
                    events::log(&app, &profile.id, "error", format!("error de watcher: {e}"));
                }
                continue;
            }
        };

        // Deduplica rutas dentro de la ráfaga.
        let mut paths: HashSet<PathBuf> = HashSet::new();
        for ev in events_batch {
            for p in ev.event.paths {
                paths.insert(p);
            }
        }

        // Contadores del lote para las notificaciones de resumen/errores.
        let mut batch = notifications::BatchStats::default();
        let mut all_sent = 0usize;
        let mut all_overflow = 0usize;

        for path in paths {
            let rel = match sync::rel_posix(&local_root, &path) {
                Some(r) => r,
                None => continue,
            };
            if ignore::is_ignored(&set, &rel) {
                continue;
            }
            // Filtro de inclusión (qué ficheros sincronizar).
            if !ignore::is_included(&include, &rel) {
                continue;
            }

            let is_file = path.is_file();
            let is_dir = path.is_dir();
            let removed = !path.exists();

            // ¿Hay algo que hacer para esta ruta?
            let needs_action = is_file
                || (is_dir && profile.sync_empty_dirs)
                || (removed && profile.auto_delete);
            if !needs_action {
                continue;
            }

            // Para ficheros: lee el contenido y compara su hash. Si no ha cambiado
            // respecto a la última subida de esta sesión, se omite por completo
            // (sin conectar, sin subir y sin registrarlo en la actividad).
            let file_data: Option<(Vec<u8>, u64)> = if is_file {
                match std::fs::read(&path) {
                    Ok(data) => {
                        let h = hash_bytes(&data);
                        if hashes.get(&path) == Some(&h) {
                            continue; // contenido idéntico → omitir
                        }
                        Some((data, h))
                    }
                    Err(e) => {
                        batch.errors += 1;
                        if batch.first_errors.len() < 3 {
                            batch.first_errors.push(rel.clone());
                        }
                        events::log(
                            &app,
                            &profile.id,
                            "error",
                            format!("✗ {rel} (lectura local): {e}"),
                        );
                        continue;
                    }
                }
            } else {
                None
            };

            // Garantiza una conexión viva antes de operar.
            if conn.is_none() {
                match SftpConnection::connect(&profile, commands::host_key_mode(&app)).await {
                    Ok(c) => conn = Some(c),
                    Err(e) => {
                        events::log(&app, &profile.id, "error", format!("conexión: {e}"));
                        continue;
                    }
                }
            }
            let c = conn.as_ref().unwrap();
            let remote = sync::remote_join(&profile.remote_path, &rel);

            let result = if is_file {
                let (data, _) = file_data.as_ref().unwrap();
                c.upload(&remote, data)
                    .await
                    .map(|_| format!("↑ {rel}  ({})", sync::human_size(data.len() as u64)))
            } else if is_dir {
                // Directorio creado/modificado y la opción de carpetas está activa.
                c.ensure_dir(&remote).await.map(|_| format!("📁 {rel}"))
            } else {
                // Borrado local con autoDelete: borra fichero o carpeta recursivamente.
                c.remove_any(&remote).await.map(|_| format!("🗑 {rel}"))
            };

            match result {
                Ok(msg) => {
                    // Contadores para el resumen + registro del hash subido.
                    if is_file {
                        batch.uploaded += 1;
                        if let Some((_, h)) = &file_data {
                            hashes.insert(path.clone(), *h);
                        }
                    } else if removed {
                        batch.deleted += 1;
                        hashes.remove(&path);
                    }
                    // Modo "Todas": una notificación por acción, con tope anti-spam.
                    if profile.notify == NotifyMode::All {
                        if all_sent < notifications::ALL_MODE_CAP {
                            notifications::notify_action(&app, &profile, &msg);
                            all_sent += 1;
                        } else {
                            all_overflow += 1;
                        }
                    }
                    events::log(&app, &profile.id, "ok", msg);
                }
                Err(e) => {
                    batch.errors += 1;
                    if batch.first_errors.len() < 3 {
                        batch.first_errors.push(rel.clone());
                    }
                    events::log(&app, &profile.id, "error", format!("✗ {rel}: {e}"));
                    // Posible sesión caída: forzar reconexión en el próximo evento.
                    conn = None;
                }
            }
        }

        // Cierre del lote: notificaciones de resumen/errores (y "y N más" en modo Todas).
        notifications::notify_all_overflow(&app, &profile, all_overflow);
        notifications::maybe_notify(&app, &profile, &batch);
        // Sonido de error del sistema si falló alguna subida y la opción está activa.
        if profile.error_sound && batch.errors > 0 {
            notifications::play_error_sound();
        }
    }

    events::watch_state(&app, &profile.id, false);
}

/// Hash rápido del contenido de un fichero (para detectar cambios reales).
fn hash_bytes(data: &[u8]) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    data.hash(&mut h);
    h.finish()
}
