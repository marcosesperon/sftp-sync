//! Ajustes globales de la aplicación (distintos de los perfiles).
//! Se persisten en `app_config_dir/settings.json`.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Idioma de la UI: `"es"` | `"en"`. `None` = según el sistema operativo.
    pub language: Option<String>,
    /// Tema visual: `"system"` | `"light"` | `"dark"`.
    pub theme: String,
    /// Mostrar el icono en el Dock (solo macOS).
    pub show_in_dock: bool,
    /// Mostrar el icono en la bandeja del sistema.
    pub show_tray: bool,
    /// Al abrir la app, iniciar el watcher de los perfiles con "Subir al guardar".
    pub autostart_watchers: bool,
    /// Abrir la app al iniciar el ordenador.
    pub launch_at_login: bool,
    /// Verificar la clave del servidor contra known_hosts (TOFU).
    pub verify_host_key: bool,
    /// Buscar versiones nuevas en GitHub al iniciar.
    pub check_updates: bool,
    /// Modo de conexión SSH: `"integrated"` (terminal en la app),
    /// `"system"` (terminal del sistema) o `"putty"` (solo Windows).
    pub ssh_mode: String,
    /// Ruta a `putty.exe`. `None` = autodetectar.
    pub putty_path: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: None,
            theme: "system".to_string(),
            show_in_dock: true,
            show_tray: true,
            autostart_watchers: false,
            launch_at_login: false,
            verify_host_key: true,
            check_updates: true,
            ssh_mode: "integrated".to_string(),
            putty_path: None,
        }
    }
}

impl Settings {
    pub fn load(path: &PathBuf) -> anyhow::Result<Settings> {
        if !path.exists() {
            return Ok(Settings::default());
        }
        let raw = std::fs::read_to_string(path)?;
        if raw.trim().is_empty() {
            return Ok(Settings::default());
        }
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save(&self, path: &PathBuf) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}
