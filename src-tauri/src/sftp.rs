//! Conexión SFTP sobre `russh` (SSH puro en Rust) y operaciones de fichero.
//!
//! Una [`SftpConnection`] mantiene viva la sesión SSH y el subsistema SFTP, de
//! modo que las subidas sucesivas (al guardar) no paguen el coste del handshake.

use anyhow::{anyhow, Context, Result};
use russh::client::{self, AuthResult, Handle};
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg};
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;

use crate::config::{Auth, Profile};

/// Handler de cliente SSH. Para el MVP aceptamos cualquier clave de servidor.
///
/// NOTA DE SEGURIDAD: esto omite la verificación del host key (equivalente a
/// `StrictHostKeyChecking no`). Es aceptable para una herramienta de despliegue
/// en red controlada, pero debería sustituirse por un known_hosts real.
struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub struct SftpConnection {
    /// Se conserva para mantener viva la sesión SSH mientras exista el SFTP.
    _session: Handle<ClientHandler>,
    sftp: SftpSession,
}

impl SftpConnection {
    /// Abre una conexión SSH, autentica y arranca el subsistema SFTP.
    pub async fn connect(profile: &Profile) -> Result<Self> {
        let config = Arc::new(client::Config::default());
        let mut session = client::connect(config, (profile.host.as_str(), profile.port), ClientHandler)
            .await
            .with_context(|| format!("no se pudo conectar a {}:{}", profile.host, profile.port))?;

        let auth: AuthResult = match &profile.auth {
            Auth::Key {
                private_key_path,
                passphrase,
            } => {
                let key = load_secret_key(private_key_path, passphrase.as_deref())
                    .with_context(|| format!("no se pudo cargar la clave {private_key_path}"))?;
                let key = Arc::new(key);

                // Para claves RSA, los servidores OpenSSH modernos rechazan la
                // firma ssh-rsa (SHA-1) y exigen rsa-sha2-512/256. Probamos esas
                // variantes antes de caer a SHA-1 (None). Para otros tipos de
                // clave (ed25519, ecdsa) el algoritmo de hash es implícito (None).
                let is_rsa = key.algorithm().as_str().starts_with("ssh-rsa");
                let hash_algs: Vec<Option<HashAlg>> = if is_rsa {
                    vec![Some(HashAlg::Sha512), Some(HashAlg::Sha256), None]
                } else {
                    vec![None]
                };

                let mut last = None;
                for alg in hash_algs {
                    let r = session
                        .authenticate_publickey(
                            &profile.username,
                            PrivateKeyWithHashAlg::new(key.clone(), alg),
                        )
                        .await?;
                    let ok = matches!(r, AuthResult::Success);
                    last = Some(r);
                    if ok {
                        break;
                    }
                }
                last.expect("al menos un intento de autenticación")
            }
            Auth::Password { password } => {
                session
                    .authenticate_password(&profile.username, password)
                    .await?
            }
        };

        match auth {
            AuthResult::Success => {}
            AuthResult::Failure {
                remaining_methods, ..
            } => {
                return Err(anyhow!(
                    "autenticación rechazada para '{}'. Métodos que acepta el servidor: {:?}",
                    profile.username,
                    remaining_methods
                ));
            }
        }

        let channel = session.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let sftp = SftpSession::new(channel.into_stream()).await?;

        Ok(SftpConnection {
            _session: session,
            sftp,
        })
    }

    /// Sube `data` al `remote` indicado, creando los directorios intermedios.
    pub async fn upload(&self, remote: &str, data: &[u8]) -> Result<()> {
        if let Some(parent) = remote.rsplit_once('/').map(|(p, _)| p) {
            if !parent.is_empty() {
                self.mkdir_p(parent).await?;
            }
        }
        let mut file = self
            .sftp
            .create(remote)
            .await
            .with_context(|| format!("no se pudo crear el remoto {remote}"))?;
        file.write_all(data).await?;
        file.flush().await?;
        file.shutdown().await?;
        Ok(())
    }

    /// Borra un fichero remoto. No falla si ya no existe.
    pub async fn remove_file(&self, remote: &str) -> Result<()> {
        match self.sftp.remove_file(remote).await {
            Ok(_) => Ok(()),
            // Si ya no está, lo damos por bueno (idempotente).
            Err(_) => Ok(()),
        }
    }

    /// Crea un directorio remoto (incluyendo los intermedios).
    pub async fn ensure_dir(&self, remote: &str) -> Result<()> {
        self.mkdir_p(remote).await
    }

    /// Borra un fichero o, si resulta ser un directorio, todo su contenido.
    /// Idempotente: no falla si la ruta ya no existe.
    pub async fn remove_any(&self, remote: &str) -> Result<()> {
        if self.sftp.remove_file(remote).await.is_ok() {
            return Ok(());
        }
        // No era un fichero (o falló): probamos a borrarlo como directorio.
        self.remove_dir_all(remote).await
    }

    /// Borra recursivamente un directorio remoto y todo su contenido.
    pub async fn remove_dir_all(&self, remote: &str) -> Result<()> {
        let entries = match self.sftp.read_dir(remote).await {
            Ok(e) => e,
            Err(_) => return Ok(()), // ya no existe
        };
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child = format!("{}/{}", remote.trim_end_matches('/'), name);
            if entry.file_type().is_dir() {
                Box::pin(self.remove_dir_all(&child)).await?;
            } else {
                let _ = self.sftp.remove_file(&child).await;
            }
        }
        let _ = self.sftp.remove_dir(remote).await;
        Ok(())
    }

    /// Lista recursivamente las rutas relativas (POSIX) de los ficheros remotos
    /// bajo `root`. Útil para el modo espejo (detectar huérfanos).
    pub async fn list_files_recursive(&self, root: &str) -> Result<Vec<String>> {
        let mut out = Vec::new();
        self.walk(root, "", &mut out).await?;
        Ok(out)
    }

    async fn walk(&self, abs: &str, rel: &str, out: &mut Vec<String>) -> Result<()> {
        let entries = match self.sftp.read_dir(abs).await {
            Ok(e) => e,
            Err(_) => return Ok(()),
        };
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child_abs = format!("{}/{}", abs.trim_end_matches('/'), name);
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            if entry.file_type().is_dir() {
                Box::pin(self.walk(&child_abs, &child_rel, out)).await?;
            } else {
                out.push(child_rel);
            }
        }
        Ok(())
    }

    /// Lista las entradas de un directorio remoto (nombres). Útil para test.
    pub async fn list_dir(&self, remote: &str) -> Result<Vec<String>> {
        let entries = self
            .sftp
            .read_dir(remote)
            .await
            .with_context(|| format!("no se pudo listar {remote}"))?;
        Ok(entries.map(|e| e.file_name()).collect())
    }

    /// Lista un directorio remoto para el explorador.
    /// Devuelve `(nombre, es_directorio, tamaño_bytes, mtime_unix, permisos)`.
    pub async fn list_dir_entries(
        &self,
        remote: &str,
    ) -> Result<Vec<(String, bool, u64, Option<i64>, String)>> {
        let entries = self
            .sftp
            .read_dir(remote)
            .await
            .with_context(|| format!("no se pudo listar {remote}"))?;
        let mut out = Vec::new();
        for e in entries {
            let name = e.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let md = e.metadata();
            let is_dir = e.file_type().is_dir();
            let size = md.size.unwrap_or(0);
            let mtime = md.mtime.map(|t| t as i64);
            let perms = format_permissions(md.permissions, is_dir);
            out.push((name, is_dir, size, mtime, perms));
        }
        Ok(out)
    }

    /// `mkdir -p` remoto: crea cada componente ignorando los que ya existen.
    async fn mkdir_p(&self, dir: &str) -> Result<()> {
        let mut acc = String::new();
        // Preserva la barra inicial de rutas absolutas.
        if dir.starts_with('/') {
            acc.push('/');
        }
        for (i, part) in dir.trim_matches('/').split('/').enumerate() {
            if part.is_empty() {
                continue;
            }
            if i > 0 || acc == "/" {
                if !acc.ends_with('/') {
                    acc.push('/');
                }
            }
            acc.push_str(part);
            // Ignoramos el error: lo normal es "ya existe".
            let _ = self.sftp.create_dir(&acc).await;
        }
        Ok(())
    }
}

/// Formatea los bits de permiso (modo Unix) como `drwxr-xr-x`.
fn format_permissions(mode: Option<u32>, is_dir: bool) -> String {
    let m = match mode {
        Some(m) => m,
        None => return String::new(),
    };
    let bit = |mask: u32, ch: char| if m & mask != 0 { ch } else { '-' };
    format!(
        "{}{}{}{}{}{}{}{}{}{}",
        if is_dir { 'd' } else { '-' },
        bit(0o400, 'r'),
        bit(0o200, 'w'),
        bit(0o100, 'x'),
        bit(0o040, 'r'),
        bit(0o020, 'w'),
        bit(0o010, 'x'),
        bit(0o004, 'r'),
        bit(0o002, 'w'),
        bit(0o001, 'x'),
    )
}
