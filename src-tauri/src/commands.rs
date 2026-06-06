//! Comandos invocables desde el frontend (`invoke(...)`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager, State};

use crate::config::{Config, Profile};
use crate::events;
use crate::sftp::SftpConnection;
use crate::sync::{self, SyncStats};
use crate::watcher;

/// Estado compartido de la app.
#[derive(Default)]
pub struct AppState {
    /// Watchers activos por id de perfil.
    pub watchers: Mutex<HashMap<String, JoinHandle<()>>>,
    /// Señales de cancelación de pruebas de conexión en curso, por id de perfil.
    pub test_cancels: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    /// Señales de cancelación de sincronizaciones en curso, por id de perfil.
    pub sync_cancels: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

/// Ruta del fichero de configuración (`app_config_dir/profiles.json`).
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no se pudo resolver el directorio de configuración: {e}"))?;
    Ok(dir.join("profiles.json"))
}

#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<Config, String> {
    let path = config_path(&app)?;
    Config::load(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: Config) -> Result<(), String> {
    let path = config_path(&app)?;
    config.save(&path).map_err(|e| e.to_string())
}

/// Prueba la conexión: autentica y lista la raíz remota.
///
/// La operación es **cancelable**: registra una señal `oneshot` bajo el id del
/// perfil y compite (`select!`) contra ella, de modo que `cancel_test` aborta de
/// verdad el intento en curso (no solo descarta el resultado).
#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    profile: Profile,
) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut cancels = state.test_cancels.lock().map_err(|e| e.to_string())?;
        // Si había una prueba previa para este perfil, su sender se descarta (la cancela).
        cancels.insert(profile.id.clone(), tx);
    }

    let result = tokio::select! {
        res = do_test(&profile) => res.map_err(|e| e.to_string()),
        _ = rx => Err("Prueba de conexión cancelada".to_string()),
    };

    if let Ok(mut cancels) = state.test_cancels.lock() {
        cancels.remove(&profile.id);
    }
    result
}

/// Cancela una prueba de conexión en curso para el perfil indicado.
#[tauri::command]
pub fn cancel_test(state: State<AppState>, profile_id: String) -> Result<(), String> {
    let mut cancels = state.test_cancels.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = cancels.remove(&profile_id) {
        let _ = tx.send(()); // dispara la rama de cancelación del select!
    }
    Ok(())
}

async fn do_test(profile: &Profile) -> anyhow::Result<String> {
    let conn = SftpConnection::connect(profile).await?;
    let entries = conn.list_dir(&profile.remote_path).await?;
    Ok(format!(
        "Conexión correcta. {} entradas en {}",
        entries.len(),
        profile.remote_path
    ))
}

/// Sincronización completa (sube todo lo no ignorado). Es **cancelable**: al
/// cancelar, el futuro de subida se aborta y los ficheros pendientes no se suben
/// (los ya subidos permanecen).
#[tauri::command]
pub async fn sync_now(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Profile,
) -> Result<SyncStats, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut cancels = state.sync_cancels.lock().map_err(|e| e.to_string())?;
        cancels.insert(profile.id.clone(), tx);
    }

    events::log(&app, &profile.id, "info", "Iniciando sincronización completa…");

    let result = tokio::select! {
        res = run_sync(&app, &profile) => res.map_err(|e| e.to_string()),
        _ = rx => {
            events::log(&app, &profile.id, "info", "Sincronización cancelada");
            Err("Sincronización cancelada".to_string())
        }
    };

    if let Ok(mut cancels) = state.sync_cancels.lock() {
        cancels.remove(&profile.id);
    }
    result
}

/// Cancela una sincronización en curso para el perfil indicado.
#[tauri::command]
pub fn cancel_sync(state: State<AppState>, profile_id: String) -> Result<(), String> {
    let mut cancels = state.sync_cancels.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = cancels.remove(&profile_id) {
        let _ = tx.send(());
    }
    Ok(())
}

async fn run_sync(app: &AppHandle, profile: &Profile) -> anyhow::Result<SyncStats> {
    let conn = SftpConnection::connect(profile).await?;
    let pid = profile.id.clone();
    let app2 = app.clone();
    let stats = sync::sync_all(&conn, profile, |msg| {
        events::log(&app2, &pid, "ok", msg);
    })
    .await?;
    events::log(
        app,
        &profile.id,
        "info",
        format!(
            "Hecho: {} subidos, {} ignorados, {} errores",
            stats.uploaded, stats.skipped, stats.errors
        ),
    );
    Ok(stats)
}

#[tauri::command]
pub fn start_watch(app: AppHandle, state: State<AppState>, profile: Profile) -> Result<(), String> {
    let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;
    if watchers.contains_key(&profile.id) {
        return Ok(()); // ya está vigilando
    }
    let handle = tauri::async_runtime::spawn(watcher::run(app.clone(), profile.clone()));
    watchers.insert(profile.id, handle);
    Ok(())
}

#[tauri::command]
pub fn stop_watch(app: AppHandle, state: State<AppState>, profile_id: String) -> Result<(), String> {
    let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = watchers.remove(&profile_id) {
        handle.abort();
    }
    events::watch_state(&app, &profile_id, false);
    Ok(())
}

#[tauri::command]
pub fn list_watching(state: State<AppState>) -> Result<Vec<String>, String> {
    let watchers = state.watchers.lock().map_err(|e| e.to_string())?;
    Ok(watchers.keys().cloned().collect())
}
