mod commands;
mod config;
mod events;
mod ignore;
mod notifications;
mod settings;
mod sftp;
mod sync;
mod watcher;

use commands::AppState;
use tauri::Manager;

/// Identificador de la bandeja, usado para actualizar su tooltip desde los comandos.
pub const TRAY_ID: &str = "sftp-tray";

/// Muestra y enfoca la ventana principal (desde bandeja, Dock o segunda instancia).
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance debe registrarse el PRIMERO: si ya hay una instancia,
        // la segunda solo enfoca la ventana existente y termina.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .setup(|app| {
            // En macOS, personaliza el panel nativo "Acerca de" con la metadata
            // del autor. Reconstruimos el menú de la app (con About) y un menú
            // de Edición para conservar los atajos de copiar/pegar.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{AboutMetadataBuilder, MenuBuilder, SubmenuBuilder};

                let metadata = AboutMetadataBuilder::new()
                    .name(Some("SFTP Sync".to_string()))
                    .version(Some(env!("CARGO_PKG_VERSION").to_string()))
                    .authors(Some(vec!["Marcos Esperón".to_string()]))
                    .website(Some("https://github.com/marcosesperon/sftp-sync".to_string()))
                    .website_label(Some("github.com/marcosesperon/sftp-sync".to_string()))
                    .build();

                let app_menu = SubmenuBuilder::new(app, "SFTP Sync")
                    .about(Some(metadata))
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let edit_menu = SubmenuBuilder::new(app, "Edición")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .items(&[&app_menu, &edit_menu])
                    .build()?;
                app.set_menu(menu)?;
            }

            // --- Icono en la bandeja del sistema ---
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
                use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

                let show_i =
                    MenuItem::with_id(app, "tray_show", "Mostrar ventana", true, None::<&str>)?;
                let sep = PredefinedMenuItem::separator(app)?;
                let quit_i = MenuItem::with_id(app, "tray_quit", "Salir", true, None::<&str>)?;
                let tray_menu = Menu::with_items(app, &[&show_i, &sep, &quit_i])?;

                let mut builder = TrayIconBuilder::with_id(TRAY_ID)
                    .tooltip("SFTP Sync")
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "tray_show" => show_main(app),
                        "tray_quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            ..
                        } = event
                        {
                            show_main(tray.app_handle());
                        }
                    });

                // Icono a color de la app. (No usamos `icon_as_template`: sin un
                // icono monocromo dedicado, el modo template lo pintaría como una
                // silueta negra en la barra de menús de macOS.)
                if let Some(icon) = app.default_window_icon().cloned() {
                    builder = builder.icon(icon);
                }
                builder.build(app)?;
            }

            // --- Cerrar la ventana = ocultarla (no salir) ---
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            // --- Aplicar ajustes guardados y auto-iniciar watchers ---
            let handle = app.handle().clone();
            if let Ok(sp) = commands::settings_path(&handle) {
                let settings = settings::Settings::load(&sp).unwrap_or_default();
                commands::apply_settings(&handle, &settings);

                if settings.autostart_watchers {
                    if let Ok(cp) = commands::config_path(&handle) {
                        let config = config::Config::load(&cp).unwrap_or_default();
                        let state = handle.state::<AppState>();
                        let mut n = 0usize;
                        if let Ok(mut watchers) = state.watchers.lock() {
                            for p in config.profiles.into_iter().filter(|p| p.upload_on_save) {
                                let h = tauri::async_runtime::spawn(watcher::run(
                                    handle.clone(),
                                    p.clone(),
                                ));
                                watchers.insert(p.id.clone(), h);
                            }
                            n = watchers.len();
                        }
                        commands::update_tray(&handle, n);
                    }
                }
            }

            Ok(())
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_config,
            commands::save_config,
            commands::test_connection,
            commands::cancel_test,
            commands::list_remote_dir,
            commands::sync_now,
            commands::cancel_sync,
            commands::start_watch,
            commands::stop_watch,
            commands::list_watching,
            commands::load_settings,
            commands::save_settings,
            commands::export_config,
            commands::import_config,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Cerrar la última ventana no debe terminar el proceso: así el watcher
            // sigue vigilando en segundo plano. La salida real (menú "Salir" →
            // app.exit(0)) lleva código y sí termina.
            tauri::RunEvent::ExitRequested { code, api, .. } => {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            // macOS: clic en el icono del Dock con la ventana oculta → mostrarla.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show_main(app),
            _ => {
                let _ = app;
            }
        });
}
