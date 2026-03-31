// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;
            let mut db_path = "sqlite:chatmemo.db".to_string();
            
            if let Ok(data_dir) = app.path().app_data_dir() {
                let config_path = data_dir.join("config.json");
                if let Ok(config_str) = std::fs::read_to_string(&config_path) {
                    if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config_str) {
                        if let Some(custom_dir) = config.get("customDataDir").and_then(|v| v.as_str()) {
                            db_path = format!("sqlite:{}/chatmemo.db", custom_dir);
                        }
                    }
                }
            }

            let migrations = vec![
                tauri_plugin_sql::Migration {
                    version: 1,
                    description: "create_initial_tables",
                    sql: include_str!("../migrations/1_init.sql"),
                    kind: tauri_plugin_sql::MigrationKind::Up,
                },
                tauri_plugin_sql::Migration {
                    version: 2,
                    description: "create_media_table",
                    sql: include_str!("../migrations/2_media.sql"),
                    kind: tauri_plugin_sql::MigrationKind::Up,
                },
            ];

            app.handle().plugin(
                tauri_plugin_sql::Builder::default()
                    .add_migrations(&db_path, migrations)
                    .build(),
            )?;
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
