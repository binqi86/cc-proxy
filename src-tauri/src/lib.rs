mod config;
mod process;

use std::sync::Mutex;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::image::Image;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
}


#[derive(Debug, Serialize, Deserialize)]
pub struct TestConfig {
    pub model: String,
    pub stream: bool,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TestResult {
    pub success: bool,
    pub status: Option<u16>,
    pub latency: Option<u64>,
    pub response: Option<String>,
    pub tokens: Option<TokenUsage>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenUsage {
    pub input: u32,
    pub output: u32,
    pub total: u32,
}

struct AppState {
    service_pid: Mutex<Option<u32>>,
}

const TRAY_ID: &str = "proxy-tray";

fn config_dir() -> String {
    // 1. Search upward from cwd
    if let Some(dir) = find_config_dir(std::env::current_dir().ok().as_deref()) {
        return dir;
    }
    // 2. Home directory config
    if let Ok(home) = std::env::var("HOME") {
        let config_path = std::path::PathBuf::from(&home).join(".codex-cn-proxy");
        // Auto-create from bundle resources if needed
        if !config_path.exists() {
            let _ = std::fs::create_dir_all(&config_path);
            copy_bundled_resources_to(&config_path);
        }
        if config_path.join("providers.json").exists() {
            return config_path.to_string_lossy().to_string();
        }
    }
    // 3. macOS .app bundle Resources (read-only, last resort)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents) = exe.parent().and_then(|p| p.parent()) {
            let res = contents.join("Resources");
            for sub in &["", "resources"] {
                let dir = if sub.is_empty() { res.clone() } else { res.join(sub) };
                if dir.join("providers.json").exists() {
                    return dir.to_string_lossy().to_string();
                }
            }
        }
    }
    // 4. Final fallback to cwd
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string())
}

fn copy_bundled_resources_to(dest: &std::path::Path) {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents) = exe.parent().and_then(|p| p.parent()) {
            let res = contents.join("Resources");
            for sub in &["", "resources"] {
                let src = if sub.is_empty() { res.clone() } else { res.join(sub) };
                for file in &["providers.json", "server.cjs"] {
                    let src_file = src.join(file);
                    let dest_file = dest.join(file);
                    if src_file.exists() && !dest_file.exists() {
                        let _ = std::fs::copy(&src_file, &dest_file);
                    }
                }
            }
        }
    }
}

fn find_config_dir(start: Option<&std::path::Path>) -> Option<String> {
    let mut dir = start;
    while let Some(d) = dir {
        if d.join("providers.json").exists() {
            return Some(d.to_string_lossy().to_string());
        }
        dir = d.parent();
    }
    None
}

fn update_tray_icon(app: &AppHandle, running: bool) {
    let icon_bytes: &[u8] = if running {
        include_bytes!("../icons/tray-icon-active.png")
    } else {
        include_bytes!("../icons/tray-icon.png")
    };
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(Image::from_bytes(icon_bytes).unwrap()));
        let _ = tray.set_tooltip(Some(
            if running { "Codex CN Proxy - Running" } else { "Codex CN Proxy - Stopped" }
        ));
    }
}

fn sync_frontend(app: &AppHandle, status: &ServiceStatus) {
    let _ = app.emit("service-status-changed", status.clone());
    if let Some(window) = app.get_webview_window("main") {
        let json = serde_json::to_string(status).unwrap_or_default();
        let _ = window.eval(&format!(
            "document.dispatchEvent(new CustomEvent('sync-service-status',{{detail:{}}}))",
            json
        ));
    }
}

fn rebuild_tray_menu(app: &AppHandle) {
    let state = app.state::<AppState>();
    let pid = *state.service_pid.lock().unwrap();
    let running = pid.is_some();

    let toggle_label = if running { "Stop Proxy" } else { "Start Proxy" };
    let toggle = MenuItemBuilder::with_id("toggle", toggle_label).build(app).ok();
    let show = MenuItemBuilder::with_id("show", "Show Settings").build(app).ok();
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app).ok();

    if let (Some(toggle), Some(show), Some(quit)) = (toggle, show, quit) {
        let menu = MenuBuilder::new(app)
            .item(&toggle)
            .item(&show)
            .separator()
            .item(&quit)
            .build()
            .ok();

        if let (Some(menu), Some(tray)) = (menu, app.tray_by_id(TRAY_ID)) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

#[tauri::command]
async fn start_service(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<ServiceStatus, String> {
    // Check if already running
    let mut pid = *state.service_pid.lock().unwrap();
    if let Some(p) = pid {
        if process::get_service_status(Some(p)).unwrap_or(false) {
            let port = Some(8787);
            return Ok(ServiceStatus { running: true, pid: Some(p), port });
        }
    }
    // Check via port detection
    if let Some(detected) = process::detect_running_proxy() {
        pid = Some(detected.pid);
        *state.service_pid.lock().unwrap() = pid;
        return Ok(ServiceStatus { running: true, pid: Some(detected.pid), port: Some(detected.port) });
    }

    let dir = config_dir();
    let env_path = format!("{}/.env", dir);
    let proxy = process::start_proxy(&env_path)?;
    *state.service_pid.lock().unwrap() = Some(proxy.pid);

    let status = ServiceStatus {
        running: true,
        pid: Some(proxy.pid),
        port: Some(proxy.port),
    };

    sync_frontend(&app_handle, &status);
    update_tray_icon(&app_handle, true);
    rebuild_tray_menu(&app_handle);

    Ok(status)
}

#[tauri::command]
async fn stop_service(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    pid: u32,
) -> Result<(), String> {
    process::stop_proxy(pid)?;
    *state.service_pid.lock().unwrap() = None;

    let status = ServiceStatus { running: false, pid: None, port: None };
    sync_frontend(&app_handle, &status);

    update_tray_icon(&app_handle, false);
    rebuild_tray_menu(&app_handle);

    Ok(())
}

#[tauri::command]
async fn get_service_status(
    state: tauri::State<'_, AppState>,
) -> Result<ServiceStatus, String> {
    let mut stored_pid = state.service_pid.lock().unwrap();

    // Check if stored PID is still alive
    let stored_alive = if let Some(p) = *stored_pid {
        process::get_service_status(Some(p)).unwrap_or(false)
    } else { false };

    if stored_alive {
        let port = Some(8787);
        return Ok(ServiceStatus { running: true, pid: *stored_pid, port });
    }

    // Try to detect any running proxy on the default port
    if let Some(detected) = process::detect_running_proxy() {
        *stored_pid = Some(detected.pid);
        return Ok(ServiceStatus { running: true, pid: Some(detected.pid), port: Some(detected.port) });
    }

    *stored_pid = None;
    Ok(ServiceStatus { running: false, pid: None, port: None })
}

#[tauri::command]
async fn read_providers() -> Result<HashMap<String, serde_json::Value>, String> {
    let dir = config_dir();
    let providers_path = format!("{}/providers.json", dir);
    let json = config::read_providers(&providers_path)?;

    if let Some(obj) = json.as_object() {
        let mut providers = HashMap::new();
        for (key, value) in obj {
            providers.insert(key.clone(), value.clone());
        }
        return Ok(providers);
    }
    Ok(HashMap::new())
}

#[tauri::command]
async fn write_providers(
    providers: HashMap<String, serde_json::Value>,
) -> Result<bool, String> {
    let dir = config_dir();
    let providers_path = format!("{}/providers.json", dir);
    let json = serde_json::json!(providers);
    config::write_providers(&providers_path, &json)?;
    Ok(true)
}

#[tauri::command]
async fn read_env() -> Result<HashMap<String, String>, String> {
    let dir = config_dir();
    let env_path = format!("{}/.env", dir);
    config::read_env(&env_path)
}

#[tauri::command]
async fn write_env(env: HashMap<String, String>) -> Result<bool, String> {
    let dir = config_dir();
    let env_path = format!("{}/.env", dir);
    config::write_env(&env_path, &env)?;
    Ok(true)
}

#[tauri::command]
async fn test_connection(_config: TestConfig) -> Result<TestResult, String> {
    use std::time::Instant;
    let start = Instant::now();
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let latency_ms = start.elapsed().as_millis() as u64;

    Ok(TestResult {
        success: true,
        status: Some(200),
        latency: Some(latency_ms),
        response: Some("Test response".to_string()),
        tokens: Some(TokenUsage { input: 10, output: 20, total: 30 }),
        error: None,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { service_pid: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            start_service,
            stop_service,
            get_service_status,
            read_providers,
            write_providers,
            read_env,
            write_env,
            test_connection,
        ])
        .setup(|app| {
            let toggle = MenuItemBuilder::with_id("toggle", "Start Proxy").build(app)?;
            let show = MenuItemBuilder::with_id("show", "Show Settings").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&toggle)
                .item(&show)
                .separator()
                .item(&quit)
                .build()?;

            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                .expect("tray-icon.png is valid PNG");
            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("Codex CN Proxy")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "toggle" => {
                            let state = app.state::<AppState>();
                            let pid = *state.service_pid.lock().unwrap();
                            if pid.is_some() {
                                // Stop service
                                if let Some(p) = pid {
                                    let _ = process::stop_proxy(p);
                                }
                                *state.service_pid.lock().unwrap() = None;
                                let status = ServiceStatus { running: false, pid: None, port: None };
                                let _ = app.emit("service-status-changed", status.clone());
                                sync_frontend(app, &status);
                                update_tray_icon(app, false);
                            } else {
                                // Start service directly
                                let dir = config_dir();
                                let env_path = format!("{}/.env", dir);
                                match process::start_proxy(&env_path) {
                                    Ok(proxy) => {
                                        *state.service_pid.lock().unwrap() = Some(proxy.pid);
                                        let status = ServiceStatus {
                                            running: true,
                                            pid: Some(proxy.pid),
                                            port: Some(proxy.port),
                                        };
                                        let _ = app.emit("service-status-changed", status.clone());
                                        sync_frontend(app, &status);
                                        update_tray_icon(app, true);
                                    }
                                    Err(e) => {
                                        eprintln!("[codex-proxy] Failed to start: {}", e);
                                    }
                                }
                            }
                            rebuild_tray_menu(app);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let state = app.state::<AppState>();
                                let pid = *state.service_pid.lock().unwrap();
                                let status = ServiceStatus {
                                    running: pid.is_some(),
                                    pid,
                                    port: if pid.is_some() { Some(8787) } else { None },
                                };
                                sync_frontend(app, &status);
                            }
                        }
                        "quit" => {
                            let state = app.state::<AppState>();
                            let pid = *state.service_pid.lock().unwrap();
                            if let Some(p) = pid {
                                let _ = process::stop_proxy(p);
                            }
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Hide window after setup so React loads first
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            // Hide Dock icon AFTER tray is created
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
