//! Notificaciones nativas del sistema según el modo configurado por perfil.
//!
//! El módulo se llama `notifications` (no `notify`) para no chocar con la crate
//! `notify` que usa el watcher.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::config::{NotifyMode, Profile};

/// Tope de notificaciones individuales por lote en modo `All` (anti-spam).
pub const ALL_MODE_CAP: usize = 3;

/// Contadores de un lote de acciones del watcher o de una sincronización completa.
#[derive(Default)]
pub struct BatchStats {
    pub uploaded: usize,
    pub deleted: usize,
    pub errors: usize,
    /// Primeros nombres con error, para el cuerpo de la notificación.
    pub first_errors: Vec<String>,
}

/// Envía, si procede según el modo del perfil, una notificación de resumen/errores.
/// Se llama al cerrar un lote del watcher o al terminar una sincronización.
pub fn maybe_notify(app: &AppHandle, profile: &Profile, b: &BatchStats) {
    let body = match profile.notify {
        NotifyMode::Off => return,
        // En modo `All` las notificaciones se emiten por acción (ver `notify_action`).
        NotifyMode::All => return,
        NotifyMode::Errors => {
            if b.errors == 0 {
                return;
            }
            let detail = if b.first_errors.is_empty() {
                String::new()
            } else {
                format!(": {}", b.first_errors.join(", "))
            };
            format!("✗ {} error(es){detail}", b.errors)
        }
        NotifyMode::Summary => {
            if b.uploaded + b.deleted + b.errors == 0 {
                return;
            }
            let mut s = format!("↑ {} subidos · 🗑 {} borrados", b.uploaded, b.deleted);
            if b.errors > 0 {
                s.push_str(&format!(" · ✗ {}", b.errors));
            }
            s
        }
    };
    send(app, profile, &body);
}

/// Notificación al terminar una **sincronización completa**. A diferencia del
/// watcher, en modo `All` se resume igualmente (no tiene sentido una notificación
/// por fichero en una sync masiva).
pub fn notify_sync(app: &AppHandle, profile: &Profile, b: &BatchStats) {
    let body = match profile.notify {
        NotifyMode::Off => return,
        NotifyMode::Errors => {
            if b.errors == 0 {
                return;
            }
            format!("✗ {} error(es) en la sincronización", b.errors)
        }
        NotifyMode::Summary | NotifyMode::All => {
            if b.uploaded + b.deleted + b.errors == 0 {
                return;
            }
            let mut s = format!("Sincronización: ↑ {} subidos · 🗑 {} borrados", b.uploaded, b.deleted);
            if b.errors > 0 {
                s.push_str(&format!(" · ✗ {}", b.errors));
            }
            s
        }
    };
    send(app, profile, &body);
}

/// Notificación de una acción individual (solo en modo `All`).
pub fn notify_action(app: &AppHandle, profile: &Profile, msg: &str) {
    if profile.notify == NotifyMode::All {
        send(app, profile, msg);
    }
}

/// Notificación de "y N más" cuando se supera el tope en modo `All`.
pub fn notify_all_overflow(app: &AppHandle, profile: &Profile, extra: usize) {
    if profile.notify == NotifyMode::All && extra > 0 {
        send(app, profile, &format!("…y {extra} acción(es) más"));
    }
}

fn send(app: &AppHandle, profile: &Profile, body: &str) {
    // `show()` no falla aunque el permiso esté denegado: simplemente no aparece.
    let _ = app
        .notification()
        .builder()
        .title(format!("SFTP Sync · {}", profile.name))
        .body(body)
        .show();
}
