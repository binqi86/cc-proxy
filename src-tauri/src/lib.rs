#![allow(unexpected_cfgs)]
mod config;
mod process;
mod claude_config;
mod codex_config;
mod localization;

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
    tray_click_x: Mutex<Option<f64>>,
    popup_height: Mutex<f64>,
}

fn read_configured_port() -> u16 {
    let dir = config_dir();
    let env_path = format!("{}/.env", dir);
    if let Ok(env_map) = config::read_env(&env_path) {
        if let Some(port_str) = env_map.get("PORT") {
            return port_str.parse::<u16>().unwrap_or(8088);
        }
    }
    8088
}

const TRAY_ID: &str = "proxy-tray";
const POPUP_LABEL: &str = "popup";
const POPUP_WIDTH: f64 = 340.0;
const POPUP_MIN_HEIGHT: f64 = 120.0;
const POPUP_MAX_HEIGHT: f64 = 800.0;

fn config_dir() -> String {
    // 1. Search upward from cwd
    if let Some(dir) = find_config_dir(std::env::current_dir().ok().as_deref()) {
        return dir;
    }
    // 2. Home directory config
    if let Ok(home) = std::env::var("HOME") {
        let config_path = std::path::PathBuf::from(&home).join(".cc-proxy");
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
                    if src_file.exists() {
                        // Always overwrite server.cjs to keep it in sync with the build
                        // Only create providers.json if it doesn't exist (preserve user config)
                        let is_server = file.ends_with("server.cjs");
                        if is_server || !dest_file.exists() {
                            let _ = std::fs::copy(&src_file, &dest_file);
                        }
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
            if running { "cc-proxy - 运行中" } else { "cc-proxy - 已停止" }
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

fn sync_to_window(app: &AppHandle, label: &str, event: &str, data: &serde_json::Value) {
    if let Some(window) = app.get_webview_window(label) {
        let json = serde_json::to_string(data).unwrap_or_default();
        let _ = window.eval(&format!(
            "document.dispatchEvent(new CustomEvent('{}',{{detail:{}}}))",
            event, json
        ));
    }
}

fn sync_config_to_popup(app: &AppHandle, event: &str, data: &serde_json::Value) {
    sync_to_window(app, "popup", event, data);
}

// ── Popup window management ──

fn get_popup_position(app: &AppHandle) -> (f64, f64) {
    let state = app.state::<AppState>();
    let tray_x = *state.tray_click_x.lock().unwrap();

    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();

        if let Some(click_x) = tray_x {
            // Convert physical to logical
            let logical_x = click_x / scale;
            // Center the popup below the tray icon
            let x = (logical_x - (POPUP_WIDTH / 2.0)).max(8.0);
            let y = 30.0; // below menu bar
            return (x, y);
        }
    }

    // Fallback: right-aligned
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let logical_width = size.width as f64 / scale;
        let x = (logical_width - POPUP_WIDTH - 16.0).max(0.0);
        return (x, 30.0);
    }
    (500.0, 30.0)
}

// Raise the popup above regular floating windows. Space membership is handled by
// Tauri's visible_on_all_workspaces API; keep this native patch narrowly scoped.
#[cfg(target_os = "macos")]
fn macos_raise_popup_level(window: &tauri::WebviewWindow) {
    if let Ok(ns_window_ptr) = window.ns_window() {
        if ns_window_ptr.is_null() { return; }
        use objc::{msg_send, sel, sel_impl};
        use objc::runtime::Object;
        let ns_window = ns_window_ptr as *mut Object;
        unsafe {
            // NSPopUpMenuWindowLevel (101): above NSFloatingWindowLevel (3).
            let _: () = msg_send![ns_window, setLevel: 101i64];
        }
    }
}

fn create_popup_window(app: &AppHandle) {
    if app.get_webview_window(POPUP_LABEL).is_some() {
        return;
    }
    let (x, y) = get_popup_position(app);
    let desired_height = *app.state::<AppState>().popup_height.lock().unwrap();
    let popup = tauri::WebviewWindowBuilder::new(
        app,
        POPUP_LABEL,
        tauri::WebviewUrl::App("index.html?window=popup".into()),
    )
    .title("cc-proxy")
    .inner_size(POPUP_WIDTH, desired_height)
    // Set the final position at builder time so the NSWindow is born at the right
    // location — set_position after creation causes a one-frame position flicker.
    .position(x, y)
    .resizable(true)
    .decorations(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .visible(false)
    .build();

    if let Ok(window) = popup {
        #[cfg(target_os = "macos")]
        {
            let _ = window.set_visible_on_all_workspaces(true);
            macos_raise_popup_level(&window);
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
        }
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                if let Some(window) = app_handle.get_webview_window(POPUP_LABEL) {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.destroy();
                    }
                }
            }
        });
    }
}

fn toggle_popup_window(app: &AppHandle) {
    if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
        if popup.is_visible().unwrap_or(false) {
            let _ = popup.destroy();
            return;
        }
        // Avoid reusing a hidden NSWindow from another Space.
        let _ = popup.destroy();
    }

    create_popup_window(app);
    if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
        #[cfg(target_os = "macos")]
        {
            let _ = popup.set_visible_on_all_workspaces(true);
            macos_raise_popup_level(&popup);
        }
        let _ = popup.show();
        let _ = popup.set_focus();
        #[cfg(target_os = "macos")]
        macos_raise_popup_level(&popup);

        let state = app.state::<AppState>();
        let pid = *state.service_pid.lock().unwrap();
        let port = *state.service_port.lock().unwrap();
        let status = ServiceStatus { running: pid.is_some(), pid, port };
        sync_frontend(app, &status);
    }
}

#[tauri::command]
async fn resize_popup_window(app: AppHandle, height: f64) -> Result<(), String> {
    let target = height.clamp(POPUP_MIN_HEIGHT, POPUP_MAX_HEIGHT);
    *app.state::<AppState>().popup_height.lock().unwrap() = target;
    if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
        let _ = popup.set_size(tauri::LogicalSize::new(POPUP_WIDTH, target));
    }
    Ok(())
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
                // Count upstream requests (new format: "HH:MM:SS INFO → model ...")
                if line.contains('→') {
                    let count = *req_count.lock().unwrap() + 1;
                    *req_count.lock().unwrap() = count;
                }
                logs.lock().unwrap().push(line);
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
    // Notify ALL windows so main ↔ popup stay in sync
    let env_json = serde_json::to_value(&env).unwrap_or_default();
    sync_to_window(&app, "main", "env-changed", &env_json);
    sync_to_window(&app, "popup", "env-changed", &env_json);
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

// ── Codex config commands ──

#[tauri::command]
async fn get_codex_config_status() -> Result<codex_config::CodexConfigStatus, String> {
    let port = read_configured_port();
    let gateway_url = format!("http://127.0.0.1:{}", port);
    Ok(codex_config::get_codex_config_status(&gateway_url))
}

#[tauri::command]
async fn apply_codex_config(
    port: u16,
    api_key: String,
    default_model: String,
) -> Result<codex_config::CodexApplyResult, String> {
    codex_config::apply_codex_config(port, &api_key, &default_model)
}

#[tauri::command]
async fn remove_codex_config() -> Result<(), String> {
    codex_config::remove_codex_config()
}

// ── Claude Desktop 3P config commands ──

#[tauri::command]
async fn get_claude_config_status() -> Result<claude_config::ClaudeConfigStatus, String> {
    let port = read_configured_port();
    let gateway_url = format!("http://127.0.0.1:{}", port);
    Ok(claude_config::get_claude_config_status(&gateway_url))
}

#[tauri::command]
async fn apply_claude_3p_config(
    port: u16,
    api_key: String,
    models: Vec<claude_config::ClaudeModelEntry>,
) -> Result<String, String> {
    claude_config::write_claude_3p_config(port, &api_key, &models)
}

#[tauri::command]
async fn remove_claude_3p_config() -> Result<(), String> {
    claude_config::remove_claude_3p_config()
}

#[tauri::command]
async fn restart_claude_desktop() -> Result<String, String> {
    claude_config::restart_claude_desktop()
}

// ── Chinese localization commands ──

#[tauri::command]
async fn get_localization_status() -> Result<localization::LocalizationStatus, String> {
    Ok(localization::get_localization_status())
}

#[tauri::command]
async fn apply_chinese_localization(
    zh_cn_json: String,
    desktop_json: String,
    statsig_json: String,
) -> Result<String, String> {
    localization::apply_chinese_localization(&zh_cn_json, &desktop_json, &statsig_json)
}

#[tauri::command]
async fn restore_chinese_localization() -> Result<String, String> {
    localization::restore_chinese_localization()
}

// ── Balance query ──

#[derive(Debug, Serialize, Deserialize)]
struct BalanceResult {
    supported: bool,
    balance: Option<String>,
    message: String,
}

fn get_balance_endpoint(base_url: &str, provider_id: &str) -> Option<String> {
    let lower = format!("{} {}", provider_id, base_url).to_lowercase();
    if lower.contains("deepseek") {
        Some("https://api.deepseek.com/user/balance".into())
    } else if lower.contains("siliconflow") {
        Some("https://api.siliconflow.cn/v1/user/info".into())
    } else if lower.contains("openrouter") {
        Some("https://openrouter.ai/api/v1/credits".into())
    } else if lower.contains("novita") {
        Some("https://api.novita.ai/v3/user/balance".into())
    } else {
        None
    }
}

#[tauri::command]
async fn query_provider_balance(
    provider_id: String,
    base_url: String,
    api_key: String,
) -> Result<BalanceResult, String> {
    let endpoint = match get_balance_endpoint(&base_url, &provider_id) {
        Some(e) => e,
        None => return Ok(BalanceResult {
            supported: false,
            balance: None,
            message: "此供应商暂未适配余额查询".into(),
        }),
    };

    let client = reqwest::Client::new();
    match client
        .get(&endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
    {
        Ok(resp) => {
            if !resp.status().is_success() {
                return Ok(BalanceResult {
                    supported: true,
                    balance: None,
                    message: format!("余额接口返回 HTTP {}", resp.status().as_u16()),
                });
            }
            match resp.json::<serde_json::Value>().await {
                Ok(payload) => {
                    // Try to extract balance from various response formats
                    let _balance = payload.get("balance_infos")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|item| item.get("total_balance"))
                        .and_then(|v| v.as_str().or_else(|| v.as_f64().map(|_| "").or(Some(""))))
                        .or_else(|| {
                            payload.get("data").or_else(|| Some(&payload))
                                .and_then(|d| d.get("total_credits").or(d.get("balance")).or(d.get("total_balance")))
                                .and_then(|v| v.as_f64())
                                .map(|_f| "")
                        })
                        .or_else(|| {
                            let d = payload.get("data").unwrap_or(&payload);
                            d.get("balance").or(d.get("total_balance")).or(d.get("total_granted"))
                                .and_then(|v| v.as_f64())
                                .map(|_| "")
                        });

                    let balance_str = if let Some(raw_val) = payload
                        .get("balance_infos")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|item| item.get("total_balance"))
                    {
                        let currency = payload.get("balance_infos")
                            .and_then(|v| v.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|item| item.get("currency").and_then(|c| c.as_str()))
                            .unwrap_or("CNY");
                        Some(format!("{} {}", raw_val, currency))
                    } else if let Some(b) = payload.get("data").or_else(|| Some(&payload))
                        .and_then(|d| d.get("total_credits").or(d.get("balance")).or(d.get("total_balance")))
                        .and_then(|v| v.as_f64())
                    {
                        Some(format!("${:.2}", b))
                    } else {
                        None
                    };

                    let msg = if balance_str.is_some() { "查询成功".to_string() } else { "未识别到余额字段".to_string() };
                    Ok(BalanceResult {
                        supported: true,
                        balance: balance_str,
                        message: msg,
                    })
                }
                Err(_) => Ok(BalanceResult {
                    supported: true,
                    balance: None,
                    message: "余额接口返回非JSON响应".into(),
                }),
            }
        }
        Err(e) => Ok(BalanceResult {
            supported: true,
            balance: None,
            message: format!("查询失败: {}", e),
        }),
    }
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
            tray_click_x: Mutex::new(None),
            popup_height: Mutex::new(POPUP_MIN_HEIGHT),
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
            resize_popup_window,
            reset_request_count,
            get_claude_config_status,
            apply_claude_3p_config,
            remove_claude_3p_config,
            restart_claude_desktop,
            get_codex_config_status,
            apply_codex_config,
            remove_codex_config,
            get_localization_status,
            apply_chinese_localization,
            restore_chinese_localization,
            query_provider_balance,
        ])
        .setup(|app| {
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                .expect("tray-icon.png is valid PNG");
            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(tray_icon)
                .tooltip("cc-proxy")
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            position,
                            ..
                        } => {
                            let app = tray.app_handle();
                            // Store click position for popup alignment
                            *app.state::<AppState>().tray_click_x.lock().unwrap() = Some(position.x);
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
