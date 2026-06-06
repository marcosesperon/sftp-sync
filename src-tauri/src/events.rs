//! Eventos emitidos al frontend (log de actividad y estado de conexión).

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Una línea del log de actividad mostrada en la UI.
#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    #[serde(rename = "profileId")]
    pub profile_id: String,
    /// "info" | "ok" | "error"
    pub level: String,
    pub message: String,
}

/// Emite una línea de log para un perfil concreto (evento `sftp-log`).
pub fn log(app: &AppHandle, profile_id: &str, level: &str, message: impl Into<String>) {
    let _ = app.emit(
        "sftp-log",
        LogEntry {
            profile_id: profile_id.to_string(),
            level: level.to_string(),
            message: message.into(),
        },
    );
}

/// Estado del watcher de un perfil (evento `sftp-watch-state`).
#[derive(Debug, Clone, Serialize)]
pub struct WatchState {
    #[serde(rename = "profileId")]
    pub profile_id: String,
    pub watching: bool,
}

pub fn watch_state(app: &AppHandle, profile_id: &str, watching: bool) {
    let _ = app.emit(
        "sftp-watch-state",
        WatchState {
            profile_id: profile_id.to_string(),
            watching,
        },
    );
}
