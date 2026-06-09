//! Modelo de configuración propio de la app y su persistencia en disco.
//!
//! Se guarda como JSON en el directorio de configuración de la app
//! (`app_config_dir()/profiles.json`). El formato es propio (no el de la
//! extensión de VS Code) pero cubre los mismos campos relevantes.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Método de autenticación. Se serializa con un campo `type` discriminador:
/// `{ "type": "key", ... }` o `{ "type": "password", ... }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Auth {
    Key {
        #[serde(rename = "privateKeyPath")]
        private_key_path: String,
        #[serde(default)]
        passphrase: Option<String>,
    },
    Password {
        password: String,
    },
}

/// Modo de notificaciones nativas del sistema para un perfil.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotifyMode {
    /// Sin notificaciones.
    #[default]
    Off,
    /// Solo cuando falla una operación.
    Errors,
    /// Una notificación de resumen por lote / sincronización.
    Summary,
    /// Una notificación por acción (con tope anti-spam).
    All,
}

/// Un perfil de sincronización = un destino remoto + sus reglas.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Identificador estable (generado en el frontend con crypto.randomUUID()).
    pub id: String,
    /// Nombre legible mostrado en la UI.
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    pub auth: Auth,
    /// Raíz local a sincronizar (equivalente a `context` en la extensión).
    pub local_root: String,
    /// Raíz remota destino (equivalente a `remotePath`).
    pub remote_path: String,
    /// Patrones a ignorar (estilo glob, como el array `ignore`).
    #[serde(default)]
    pub ignore: Vec<String>,
    /// Patrones de inclusión: qué ficheros sincronizar. Vacío o `**/*` = todo.
    #[serde(default)]
    pub include: Vec<String>,
    /// Subir automáticamente al detectar cambios (uploadOnSave / watcher.autoUpload).
    #[serde(default)]
    pub upload_on_save: bool,
    /// Propagar borrados locales al remoto, incluidas carpetas (watcher.autoDelete).
    #[serde(default)]
    pub auto_delete: bool,
    /// Crear también los directorios (incluidos los vacíos) en el remoto.
    #[serde(default)]
    pub sync_empty_dirs: bool,
    /// Modo espejo: en la sincronización completa, borrar del remoto los ficheros
    /// que ya no existen en local (o que están ignorados).
    #[serde(default)]
    pub mirror_delete: bool,
    /// Modo de notificaciones nativas del sistema.
    #[serde(default)]
    pub notify: NotifyMode,
    /// Reproducir el sonido de error del sistema si falla una subida del watcher.
    #[serde(default)]
    pub error_sound: bool,
}

fn default_port() -> u16 {
    22
}

/// Contenedor raíz de la configuración persistida.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub profiles: Vec<Profile>,
}

impl Config {
    /// Carga la configuración desde `path`. Si el fichero no existe, devuelve
    /// una configuración vacía (primer arranque).
    pub fn load(path: &PathBuf) -> anyhow::Result<Config> {
        if !path.exists() {
            return Ok(Config::default());
        }
        let raw = std::fs::read_to_string(path)?;
        if raw.trim().is_empty() {
            return Ok(Config::default());
        }
        Ok(serde_json::from_str(&raw)?)
    }

    /// Guarda la configuración en `path`, creando el directorio padre si hace falta.
    pub fn save(&self, path: &PathBuf) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(self)?;
        std::fs::write(path, raw)?;
        Ok(())
    }
}
