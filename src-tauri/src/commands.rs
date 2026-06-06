//! Comandos invocables desde el frontend (`invoke(...)`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager, State};

use crate::config::{Config, Profile};
use crate::events;
use crate::settings::Settings;
use crate::sftp::{ConnectError, HostKeyMode, SftpConnection};
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
pub(crate) fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no se pudo resolver el directorio de configuración: {e}"))?;
    Ok(dir.join("profiles.json"))
}

/// Ruta del fichero de ajustes (`app_config_dir/settings.json`).
pub(crate) fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no se pudo resolver el directorio de configuración: {e}"))?;
    Ok(dir.join("settings.json"))
}

/// Ruta del store de claves de servidor (`app_config_dir/known_hosts`).
fn known_hosts_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no se pudo resolver el directorio de configuración: {e}"))?;
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }
    Ok(dir.join("known_hosts"))
}

/// Modo de verificación de host key según los ajustes.
pub(crate) fn host_key_mode(app: &AppHandle) -> HostKeyMode {
    let verify = settings_path(app)
        .ok()
        .and_then(|p| Settings::load(&p).ok())
        .map(|s| s.verify_host_key)
        .unwrap_or(true);
    if verify {
        match known_hosts_path(app) {
            Ok(p) => HostKeyMode::Verify(p),
            Err(_) => HostKeyMode::AcceptAll,
        }
    } else {
        HostKeyMode::AcceptAll
    }
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
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Profile,
) -> Result<TestResult, String> {
    let mode = host_key_mode(&app);
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut cancels = state.test_cancels.lock().map_err(|e| e.to_string())?;
        // Si había una prueba previa para este perfil, su sender se descarta (la cancela).
        cancels.insert(profile.id.clone(), tx);
    }

    let result = tokio::select! {
        res = do_test(&profile, mode) => res,
        _ = rx => Err("Prueba de conexión cancelada".to_string()),
    };

    if let Ok(mut cancels) = state.test_cancels.lock() {
        cancels.remove(&profile.id);
    }
    result
}

/// Resultado de una prueba de conexión: éxito, o que la clave del servidor
/// requiere confirmación del usuario (TOFU).
#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TestResult {
    Ok { message: String },
    HostKey { fingerprint: String, changed: bool },
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

/// Una entrada del explorador de ficheros remoto.
#[derive(serde::Serialize)]
pub struct RemoteEntry {
    pub name: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub size: u64,
    /// Fecha de modificación (segundos Unix), si el servidor la informa.
    pub mtime: Option<i64>,
    /// Permisos estilo `drwxr-xr-x`.
    pub perms: String,
}

/// Lista un directorio remoto para el explorador de la UI.
#[tauri::command]
pub async fn list_remote_dir(
    app: AppHandle,
    profile: Profile,
    path: String,
) -> Result<Vec<RemoteEntry>, String> {
    let conn = SftpConnection::connect(&profile, host_key_mode(&app))
        .await
        .map_err(|e| e.to_string())?;
    let entries = conn
        .list_dir_entries(&path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(entries
        .into_iter()
        .map(|(name, is_dir, size, mtime, perms)| RemoteEntry {
            name,
            is_dir,
            size,
            mtime,
            perms,
        })
        .collect())
}

async fn do_test(profile: &Profile, mode: HostKeyMode) -> Result<TestResult, String> {
    match SftpConnection::connect(profile, mode).await {
        Ok(conn) => {
            let entries = conn
                .list_dir(&profile.remote_path)
                .await
                .map_err(|e| e.to_string())?;
            Ok(TestResult::Ok {
                message: format!(
                    "Conexión correcta. {} entradas en {}",
                    entries.len(),
                    profile.remote_path
                ),
            })
        }
        Err(ConnectError::HostKeyUnknown(fp)) => Ok(TestResult::HostKey {
            fingerprint: fp,
            changed: false,
        }),
        Err(ConnectError::HostKeyChanged(fp)) => Ok(TestResult::HostKey {
            fingerprint: fp,
            changed: true,
        }),
        Err(ConnectError::Other(e)) => Err(e),
    }
}

/// Confía y guarda la clave del servidor del perfil en `known_hosts`.
#[tauri::command]
pub async fn trust_host_key(app: AppHandle, profile: Profile) -> Result<(), String> {
    let path = known_hosts_path(&app)?;
    SftpConnection::learn_host_key(&profile, path)
        .await
        .map_err(|e| e.to_string())
}

/// Borra del remoto las rutas indicadas (ficheros o carpetas recursivamente).
#[tauri::command]
pub async fn delete_remote(
    app: AppHandle,
    profile: Profile,
    paths: Vec<String>,
) -> Result<(), String> {
    let conn = SftpConnection::connect(&profile, host_key_mode(&app))
        .await
        .map_err(|e| e.to_string())?;
    for p in &paths {
        conn.remove_any(p).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Renombra/mueve un elemento remoto.
#[tauri::command]
pub async fn rename_remote(
    app: AppHandle,
    profile: Profile,
    from: String,
    to: String,
) -> Result<(), String> {
    let conn = SftpConnection::connect(&profile, host_key_mode(&app))
        .await
        .map_err(|e| e.to_string())?;
    conn.rename(&from, &to).await.map_err(|e| e.to_string())
}

/// Sube ficheros locales (arrastrados) a un directorio remoto. Devuelve cuántos subió.
#[tauri::command]
pub async fn upload_files(
    app: AppHandle,
    profile: Profile,
    local_paths: Vec<String>,
    remote_dir: String,
) -> Result<usize, String> {
    let conn = SftpConnection::connect(&profile, host_key_mode(&app))
        .await
        .map_err(|e| e.to_string())?;
    let base = remote_dir.trim_end_matches('/');
    let mut n = 0;
    for lp in &local_paths {
        let path = std::path::Path::new(lp);
        // Solo ficheros (las carpetas arrastradas se omiten en esta versión).
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(name) => name,
            None => continue,
        };
        let data = std::fs::read(path).map_err(|e| e.to_string())?;
        conn.upload(&format!("{base}/{name}"), &data)
            .await
            .map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
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
    let conn = SftpConnection::connect(profile, host_key_mode(app))
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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
    crate::notifications::notify_sync(
        app,
        profile,
        &crate::notifications::BatchStats {
            uploaded: stats.uploaded,
            deleted: stats.deleted,
            errors: stats.errors,
            first_errors: Vec::new(),
        },
    );
    Ok(stats)
}

#[tauri::command]
pub fn start_watch(app: AppHandle, state: State<AppState>, profile: Profile) -> Result<(), String> {
    // Validación temprana: si la raíz local no es una carpeta, devolvemos error
    // (la UI lo muestra) en vez de lanzar un watcher que moriría en silencio.
    if profile.local_root.trim().is_empty()
        || !std::path::Path::new(&profile.local_root).is_dir()
    {
        return Err(format!(
            "la raíz local no existe o no es una carpeta: {}",
            profile.local_root
        ));
    }

    let count = {
        let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;
        if watchers.contains_key(&profile.id) {
            return Ok(()); // ya está vigilando
        }
        let key = profile.id.clone();
        let id = profile.id.clone();
        let app2 = app.clone();
        let handle = tauri::async_runtime::spawn(async move {
            watcher::run(app2.clone(), profile).await;
            // Si el watcher termina por sí mismo (no por "Detener"), libera su
            // entrada para poder reintentar sin reiniciar la app.
            let mut n = 0;
            if let Some(state) = app2.try_state::<AppState>() {
                if let Ok(mut w) = state.watchers.lock() {
                    w.remove(&id);
                    n = w.len();
                }
            }
            update_tray(&app2, n);
        });
        watchers.insert(key, handle);
        watchers.len()
    };
    update_tray(&app, count);
    Ok(())
}

#[tauri::command]
pub fn stop_watch(app: AppHandle, state: State<AppState>, profile_id: String) -> Result<(), String> {
    let count = {
        let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = watchers.remove(&profile_id) {
            handle.abort();
        }
        watchers.len()
    };
    update_tray(&app, count);
    events::watch_state(&app, &profile_id, false);
    Ok(())
}

/// Actualiza el tooltip de la bandeja con el número de perfiles en vigilancia.
pub(crate) fn update_tray(app: &AppHandle, count: usize) {
    if let Some(tray) = app.tray_by_id(crate::TRAY_ID) {
        let txt = if count == 0 {
            "SFTP Sync".to_string()
        } else {
            format!("SFTP Sync — {count} vigilando")
        };
        let _ = tray.set_tooltip(Some(txt));
    }
}

#[tauri::command]
pub fn list_watching(state: State<AppState>) -> Result<Vec<String>, String> {
    let watchers = state.watchers.lock().map_err(|e| e.to_string())?;
    Ok(watchers.keys().cloned().collect())
}

// ---------------------------------------------------------------------------
// Ajustes globales
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    Settings::load(&settings_path(&app)?).map_err(|e| e.to_string())
}

/// Guarda los ajustes y los aplica (Dock, bandeja, arranque con el sistema).
#[tauri::command]
pub fn save_settings(app: AppHandle, mut settings: Settings) -> Result<Settings, String> {
    // Salvaguarda: no permitir ocultar Dock y bandeja a la vez (quedaría inaccesible).
    if !settings.show_in_dock && !settings.show_tray {
        settings.show_tray = true;
    }
    settings
        .save(&settings_path(&app)?)
        .map_err(|e| e.to_string())?;
    apply_settings(&app, &settings);
    Ok(settings)
}

/// Aplica los ajustes que afectan al sistema (Dock, bandeja, arranque).
pub(crate) fn apply_settings(app: &AppHandle, settings: &Settings) {
    // Visibilidad en la bandeja.
    if let Some(tray) = app.tray_by_id(crate::TRAY_ID) {
        let _ = tray.set_visible(settings.show_tray);
    }

    // Visibilidad en el Dock (solo macOS).
    #[cfg(target_os = "macos")]
    {
        let policy = if settings.show_in_dock {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        let _ = app.set_activation_policy(policy);
    }

    // Arranque con el sistema.
    {
        use tauri_plugin_autostart::ManagerExt;
        let mgr = app.autolaunch();
        if settings.launch_at_login {
            let _ = mgr.enable();
        } else {
            let _ = mgr.disable();
        }
    }
}

// ---------------------------------------------------------------------------
// Importar / exportar perfiles
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn export_config(app: AppHandle, path: String) -> Result<(), String> {
    let cfg = Config::load(&config_path(&app)?).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_config(app: AppHandle, path: String) -> Result<Config, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let cfg: Config = serde_json::from_str(&raw).map_err(|e| format!("JSON inválido: {e}"))?;
    cfg.save(&config_path(&app)?).map_err(|e| e.to_string())?;
    Ok(cfg)
}
