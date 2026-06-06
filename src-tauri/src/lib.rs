mod commands;
mod config;
mod events;
mod ignore;
mod sftp;
mod sync;
mod watcher;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            Ok(())
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_config,
            commands::save_config,
            commands::test_connection,
            commands::cancel_test,
            commands::sync_now,
            commands::cancel_sync,
            commands::start_watch,
            commands::stop_watch,
            commands::list_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
