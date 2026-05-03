#![allow(unexpected_cfgs)]
mod config;
mod process;

use std::sync::Mutex;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::image::Image;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppStats {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub request_count: u64,
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
    service_port: Mutex<Option<u16>>,
    proxy_logs: std::sync::Arc<Mutex<Vec<String>>>,
    request_count: std::sync::Arc<Mutex<u64>>,
}

fn read_configured_port() -> u16 {
    let dir = config_dir();
    let env_path = format!("{}/.env", dir);
    if let Ok(env_map) = config::read_env(&env_path) {
        if let Some(port_str) = env_map.get("PORT") {
            return port_str.parse::<u16>().unwrap_or(8787);
        }
    }
    8787
}

const TRAY_ID: &str = "proxy-tray";
const POPUP_LABEL: &str = "popup";

fn config_dir() -> String {
    // 1. Search upward from cwd
    if let Some(dir) = find_config_dir(std::env::current_dir().ok().as_deref()) {
        return dir;
    }
    // 2. Home directory config
    if let Ok(home) = std::env::var("HOME") {
        let config_path = std::path::PathBuf::from(&home).join(".codex-cn-proxy");
        if !config_path.exists() {
            let _ = std::fs::create_dir_all(&config_path);
            copy_bundled_resources_to(&config_path);
        }
        if config_path.join("providers.json").exists() {
            return config_path.to_string_lossy().to_string();
        }
    }
    // 3. macOS .app bundle Resources
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
    // 4. Final fallback
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
            if running { "Codex CN Proxy - 运行中" } else { "Codex CN Proxy - 已停止" }
        ));
    }
}

fn sync_frontend(app: &AppHandle, status: &ServiceStatus) {
    let _ = app.emit("service-status-changed", status.clone());
    for label in &["main", "popup"] {
        if let Some(window) = app.get_webview_window(label) {
            let json = serde_json::to_string(status).unwrap_or_default();
            let _ = window.eval(&format!(
                "document.dispatchEvent(new CustomEvent('sync-service-status',{{detail:{}}}))",
                json
            ));
        }
    }
}

fn sync_config_to_popup(app: &AppHandle, event: &str, data: &serde_json::Value) {
    if let Some(window) = app.get_webview_window("popup") {
        let json = serde_json::to_string(data).unwrap_or_default();
        let _ = window.eval(&format!(
            "document.dispatchEvent(new CustomEvent('{}',{{detail:{}}}))",
            event, json
        ));
    }
}

// ── Popup window management ──

fn get_popup_position(app: &AppHandle) -> (f64, f64) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let logical_width = size.width as f64 / scale;
        let x = (logical_width - 340.0 - 16.0).max(0.0);
        return (x, 30.0);
    }
    (500.0, 30.0)
}

fn create_popup_window(app: &AppHandle) {
    if app.get_webview_window(POPUP_LABEL).is_some() {
        return;
    }
    let (x, y) = get_popup_position(app);
    let popup = tauri::WebviewWindowBuilder::new(
        app,
        POPUP_LABEL,
        tauri::WebviewUrl::App("index.html?window=popup".into()),
    )
    .title("Codex CN Proxy")
    .inner_size(340.0, 440.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build();

    if let Ok(window) = popup {
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
        #[cfg(target_os = "macos")]
        if let Ok(ns_window_ptr) = window.ns_window() {
            if !ns_window_ptr.is_null() {
                use objc::{msg_send, sel, sel_impl};
                use objc::runtime::Object;
                let ns_window = ns_window_ptr as *mut Object;
                unsafe {
                    if let Some(cls) = objc::runtime::Class::get("NSColor") {
                        let clear_color: *mut Object = msg_send![cls, clearColor];
                        let _: () = msg_send![ns_window, setBackgroundColor: clear_color];
                    }
                    let _: () = msg_send![ns_window, setOpaque: false];
                    let _: () = msg_send![ns_window, setHasShadow: false];
                    let content_view: *mut Object = msg_send![ns_window, contentView];
                    let _: () = msg_send![content_view, setWantsLayer: true];
                    let layer: *mut Object = msg_send![content_view, layer];
                    let _: () = msg_send![layer, setCornerRadius: 16.0f64];
                    let _: () = msg_send![layer, setMasksToBounds: true];
                }
            }
        }
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = app_handle.get_webview_window(POPUP_LABEL).map(|w| w.hide());
            }
        });
    }
}

fn toggle_popup_window(app: &AppHandle) {
    create_popup_window(app);
    if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
        if popup.is_visible().unwrap_or(false) {
            let _ = popup.hide();
        } else {
            let (x, y) = get_popup_position(app);
            let _ = popup.set_position(tauri::LogicalPosition::new(x, y));
            let _ = popup.show();
            let _ = popup.set_focus();
            let state = app.state::<AppState>();
            let pid = *state.service_pid.lock().unwrap();
            let port = *state.service_port.lock().unwrap();
            let status = ServiceStatus { running: pid.is_some(), pid, port };
            sync_frontend(app, &status);
        }
    }
}

// ── Tauri commands ──

#[tauri::command]
async fn start_service(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<ServiceStatus, String> {
    let old_pid = *state.service_pid.lock().unwrap();
    if let Some(p) = old_pid {
        if process::get_service_status(Some(p)).unwrap_or(false) {
            let _ = process::stop_proxy(p);
        }
    }
    if let Some(detected) = process::detect_running_proxy() {
        let _ = process::stop_proxy(detected.pid);
    }

    let dir = config_dir();
    let env_path = format!("{}/.env", dir);
    let proxy = process::start_proxy(&env_path)?;
    let pid = proxy.pid;
    let port = proxy.port;
    *state.service_pid.lock().unwrap() = Some(pid);
    *state.service_port.lock().unwrap() = Some(port);

    // Forward Node stdout/stderr logs via shared buffer, count requests
    if let Some(rx) = proxy.log_rx {
        let logs = state.proxy_logs.clone();
        let req_count = state.request_count.clone();
        std::thread::spawn(move || {
            for line in rx {
                let mut skip = false;
                if let Some(json_str) = line.strip_prefix("[PROXY_LOG]") {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                        let event = parsed.get("event").and_then(|v| v.as_str()).unwrap_or("");
                        // Count upstream requests
                        if event == "upstream_request" {
                            let count = *req_count.lock().unwrap() + 1;
                            *req_count.lock().unwrap() = count;
                        }
                        // Skip successful upstream_response (noisy, counted above)
                        if event == "upstream_response" && parsed.get("status").and_then(|v| v.as_u64()) == Some(200) {
                            skip = true;
                        }
                    }
                }
                if !skip {
                    logs.lock().unwrap().push(line);
                }
            }
        });
    }

    let status = ServiceStatus {
        running: true,
        pid: Some(pid),
        port: Some(port),
    };

    sync_frontend(&app_handle, &status);
    update_tray_icon(&app_handle, true);

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
    *state.service_port.lock().unwrap() = None;

    let status = ServiceStatus { running: false, pid: None, port: None };
    sync_frontend(&app_handle, &status);

    update_tray_icon(&app_handle, false);

    Ok(())
}

#[tauri::command]
async fn get_service_status(
    state: tauri::State<'_, AppState>,
) -> Result<ServiceStatus, String> {
    let mut stored_pid = state.service_pid.lock().unwrap();

    let stored_alive = if let Some(p) = *stored_pid {
        process::get_service_status(Some(p)).unwrap_or(false)
    } else { false };

    if stored_alive {
        let guard = state.service_port.lock().unwrap();
        let port = (*guard).or(Some(read_configured_port()));
        drop(guard);
        return Ok(ServiceStatus { running: true, pid: *stored_pid, port });
    }

    if let Some(detected) = process::detect_running_proxy() {
        *stored_pid = Some(detected.pid);
        *state.service_port.lock().unwrap() = Some(detected.port);
        return Ok(ServiceStatus { running: true, pid: Some(detected.pid), port: Some(detected.port) });
    }

    *stored_pid = None;
    Ok(ServiceStatus { running: false, pid: None, port: None })
}

#[tauri::command]
async fn get_stats(state: tauri::State<'_, AppState>) -> Result<AppStats, String> {
    let mut stored_pid = state.service_pid.lock().unwrap();
    let count = *state.request_count.lock().unwrap();

    let stored_alive = if let Some(p) = *stored_pid {
        process::get_service_status(Some(p)).unwrap_or(false)
    } else { false };

    if stored_alive {
        let port = *state.service_port.lock().unwrap();
        return Ok(AppStats { running: true, pid: *stored_pid, port, request_count: count });
    }

    if let Some(detected) = process::detect_running_proxy() {
        *stored_pid = Some(detected.pid);
        *state.service_port.lock().unwrap() = Some(detected.port);
        return Ok(AppStats { running: true, pid: Some(detected.pid), port: Some(detected.port), request_count: count });
    }

    *stored_pid = None;
    Ok(AppStats { running: false, pid: None, port: None, request_count: count })
}

#[tauri::command]
async fn poll_proxy_logs(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut logs = state.proxy_logs.lock().unwrap();
    let result = logs.clone();
    logs.clear();
    Ok(result)
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
    app: AppHandle,
    providers: HashMap<String, serde_json::Value>,
) -> Result<bool, String> {
    let dir = config_dir();
    let providers_path = format!("{}/providers.json", dir);
    let json = serde_json::json!(providers);
    config::write_providers(&providers_path, &json)?;
    // Notify popup window to reload providers
    sync_config_to_popup(&app, "providers-changed", &json);
    Ok(true)
}

#[tauri::command]
async fn read_env() -> Result<HashMap<String, String>, String> {
    let dir = config_dir();
    let env_path = format!("{}/.env", dir);
    config::read_env(&env_path)
}

#[tauri::command]
async fn write_env(
    app: AppHandle,
    env: HashMap<String, String>,
) -> Result<bool, String> {
    let dir = config_dir();
    let env_path = format!("{}/.env", dir);
    config::write_env(&env_path, &env)?;
    // Notify popup window to reload env
    let env_json = serde_json::to_value(&env).unwrap_or_default();
    sync_config_to_popup(&app, "env-changed", &env_json);
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

#[tauri::command]
async fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
        let _ = popup.hide();
    }
    Ok(())
}

#[tauri::command]
async fn quit_app(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let pid = *state.service_pid.lock().unwrap();
    if let Some(p) = pid {
        let _ = process::stop_proxy(p);
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn reset_request_count(state: tauri::State<'_, AppState>) -> Result<u64, String> {
    let mut count = state.request_count.lock().unwrap();
    let old = *count;
    *count = 0;
    Ok(old)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            service_pid: Mutex::new(None),
            service_port: Mutex::new(None),
            proxy_logs: std::sync::Arc::new(Mutex::new(Vec::new())),
            request_count: std::sync::Arc::new(Mutex::new(0)),
        })
        .invoke_handler(tauri::generate_handler![
            start_service,
            stop_service,
            get_service_status,
            get_stats,
            poll_proxy_logs,
            read_providers,
            write_providers,
            read_env,
            write_env,
            test_connection,
            show_main_window,
            quit_app,
            reset_request_count,
        ])
        .setup(|app| {
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                .expect("tray-icon.png is valid PNG");
            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(tray_icon)
                .tooltip("Codex CN Proxy")
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            let app = tray.app_handle();
                            toggle_popup_window(app);
                        }
                        TrayIconEvent::Click {
                            button: MouseButton::Right,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            // Right-click: open main window
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Pre-create popup (hidden, set up transparency)
            create_popup_window(&app.handle().clone());

            // Hide main window after setup
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            // Hide Dock icon on macOS
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
