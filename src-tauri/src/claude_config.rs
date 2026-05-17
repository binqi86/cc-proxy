use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const CLAUDE_3P_DIR: &str = "Library/Application Support/Claude-3p";
const LEGACY_CONFIG_LIBRARY_UUID: &str = "a0a0a0a0-b1b1-4c2c-9d3d-e4e4e4e4e4e4";
const DEFAULT_CONFIG_NAME: &str = "Default";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClaudeModelEntry {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_1m: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClaudeConfigStatus {
    pub applied: bool,
    pub config_file_exists: bool,
    pub deployment_mode: String,
    pub gateway_url: String,
    pub model_count: usize,
    pub claude_app_exists: bool,
    pub claude_version: Option<String>,
}

#[derive(Debug, Clone)]
struct ConfigLibraryEntry {
    id: String,
    name: String,
}

#[derive(Debug, Clone)]
struct ConfigLibraryMeta {
    version: u64,
    applied_id: Option<String>,
    entries: Vec<ConfigLibraryEntry>,
}

fn is_valid_config_id(id: &str) -> bool {
    !id.is_empty() && !id.contains('/') && !id.contains('\\')
}

fn config_library_dir(dir_3p: &Path) -> PathBuf {
    dir_3p.join("configLibrary")
}

fn config_library_meta_path(dir_3p: &Path) -> PathBuf {
    config_library_dir(dir_3p).join("_meta.json")
}

fn config_library_entry_path(dir_3p: &Path, id: &str) -> PathBuf {
    config_library_dir(dir_3p).join(format!("{}.json", id))
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str::<Value>(&content)
        .map_err(|e| format!("Invalid JSON in {}: {}", path.display(), e))
}

fn read_json_object(path: &Path) -> Result<Map<String, Value>, String> {
    let value = read_json_file(path)?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| format!("Expected JSON object in {}", path.display()))
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(value)
            .map_err(|e| format!("Failed to serialize {}: {}", path.display(), e))?,
    )
    .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn normalize_meta(value: Value) -> ConfigLibraryMeta {
    let mut meta = ConfigLibraryMeta {
        version: 1,
        applied_id: None,
        entries: vec![],
    };
    let Some(obj) = value.as_object() else {
        return meta;
    };

    if let Some(v) = obj.get("version").and_then(|v| v.as_u64()) {
        meta.version = v.max(1);
    }

    if let Some(applied_id) = obj.get("appliedId").and_then(|v| v.as_str()) {
        let applied_id = applied_id.trim();
        if is_valid_config_id(applied_id) {
            meta.applied_id = Some(applied_id.to_string());
        }
    }

    if let Some(entries) = obj.get("entries").and_then(|v| v.as_array()) {
        for item in entries {
            match item {
                Value::String(id) => {
                    let id = id.trim();
                    if is_valid_config_id(id) {
                        meta.entries.push(ConfigLibraryEntry {
                            id: id.to_string(),
                            name: DEFAULT_CONFIG_NAME.to_string(),
                        });
                    }
                }
                Value::Object(entry) => {
                    let id = entry
                        .get("id")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .unwrap_or("");
                    if !is_valid_config_id(id) {
                        continue;
                    }
                    let name = entry
                        .get("name")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .unwrap_or(DEFAULT_CONFIG_NAME);
                    meta.entries.push(ConfigLibraryEntry {
                        id: id.to_string(),
                        name: name.to_string(),
                    });
                }
                _ => {}
            }
        }
    }

    if meta.applied_id.is_none() {
        meta.applied_id = meta.entries.first().map(|e| e.id.clone());
    }
    meta
}

fn read_config_library_meta(dir_3p: &Path) -> Result<Option<ConfigLibraryMeta>, String> {
    let meta_path = config_library_meta_path(dir_3p);
    if !meta_path.exists() {
        return Ok(None);
    }
    let value = read_json_file(&meta_path)?;
    Ok(Some(normalize_meta(value)))
}

fn write_config_library_meta(dir_3p: &Path, meta: &ConfigLibraryMeta) -> Result<(), String> {
    let mut entries: Vec<Value> = vec![];
    for entry in &meta.entries {
        if !is_valid_config_id(&entry.id) {
            continue;
        }
        entries.push(serde_json::json!({
            "id": entry.id,
            "name": if entry.name.is_empty() { DEFAULT_CONFIG_NAME } else { &entry.name },
        }));
    }

    let mut out = Map::new();
    out.insert("version".to_string(), Value::from(meta.version.max(1)));
    if let Some(applied_id) = &meta.applied_id {
        if is_valid_config_id(applied_id) {
            out.insert("appliedId".to_string(), Value::from(applied_id.clone()));
        }
    }
    out.insert("entries".to_string(), Value::Array(entries));
    write_json_file(&config_library_meta_path(dir_3p), &Value::Object(out))
}

fn list_config_library_entry_ids(dir_3p: &Path) -> Vec<String> {
    let dir = config_library_dir(dir_3p);
    let mut ids = vec![];
    let Ok(read_dir) = fs::read_dir(dir) else {
        return ids;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.ends_with(".json") || name == "_meta.json" {
            continue;
        }
        let stem = &name[..name.len() - 5];
        if is_valid_config_id(stem) {
            ids.push(stem.to_string());
        }
    }
    ids.sort();
    ids
}

fn get_config_library_entry_paths(dir_3p: &Path, include_missing_active: bool) -> Result<Vec<PathBuf>, String> {
    let mut paths = vec![];
    if let Some(meta) = read_config_library_meta(dir_3p)? {
        if let Some(applied_id) = meta.applied_id {
            let active_path = config_library_entry_path(dir_3p, &applied_id);
            if include_missing_active || active_path.exists() {
                paths.push(active_path);
            }
        }
        if paths.is_empty() {
            for entry in meta.entries {
                let path = config_library_entry_path(dir_3p, &entry.id);
                if include_missing_active || path.exists() {
                    paths.push(path);
                }
            }
        }
    }

    if paths.is_empty() {
        for id in list_config_library_entry_ids(dir_3p) {
            paths.push(config_library_entry_path(dir_3p, &id));
        }
    }
    Ok(paths)
}

fn ensure_active_entry_id(dir_3p: &Path) -> Result<String, String> {
    if let Some(meta) = read_config_library_meta(dir_3p)? {
        if let Some(applied_id) = meta.applied_id {
            return Ok(applied_id);
        }
        if let Some(first) = meta.entries.first() {
            return Ok(first.id.clone());
        }
    }
    if let Some(existing) = list_config_library_entry_ids(dir_3p).into_iter().next() {
        return Ok(existing);
    }
    Ok(Uuid::new_v4().to_string())
}

fn build_gateway_config(gateway_url: &str, api_key: &str, models: &[ClaudeModelEntry]) -> Map<String, Value> {
    let mut expected = Map::new();
    expected.insert("inferenceProvider".to_string(), Value::from("gateway"));
    expected.insert(
        "inferenceGatewayBaseUrl".to_string(),
        Value::from(gateway_url.to_string()),
    );
    expected.insert(
        "inferenceGatewayApiKey".to_string(),
        Value::from(api_key.to_string()),
    );
    expected.insert("inferenceGatewayAuthScheme".to_string(), Value::from("bearer"));
    expected.insert("inferenceGatewayHeaders".to_string(), Value::Array(vec![]));
    expected.insert(
        "coworkEgressAllowedHosts".to_string(),
        Value::Array(vec![Value::from("*")]),
    );
    expected.insert(
        "isClaudeCodeForDesktopEnabled".to_string(),
        Value::from(true),
    );

    let inference_models = models
        .iter()
        .map(|m| {
            let mut entry = Map::new();
            entry.insert("name".to_string(), Value::from(m.name.clone()));
            if m.supports_1m.unwrap_or(false) {
                entry.insert("supports1m".to_string(), Value::from(true));
            }
            if let Some(display_name) = &m.display_name {
                entry.insert("displayName".to_string(), Value::from(display_name.clone()));
            }
            Value::Object(entry)
        })
        .collect::<Vec<_>>();
    expected.insert("inferenceModels".to_string(), Value::Array(inference_models));
    expected
}

pub fn get_claude_3p_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(CLAUDE_3P_DIR))
}

pub fn get_claude_app_path() -> PathBuf {
    PathBuf::from("/Applications/Claude.app")
}

pub fn get_claude_version() -> Option<String> {
    let info_plist = get_claude_app_path().join("Contents/Info.plist");
    let content = fs::read_to_string(&info_plist).ok()?;
    for line in content.lines() {
        if line.contains("<key>CFBundleShortVersionString</key>") {
            if let Some(start) = line.find("<string>") {
                if let Some(end) = line.find("</string>") {
                    return Some(line[start + 8..end].to_string());
                }
            }
        }
    }
    // Try parsing via defaults command
    std::process::Command::new("defaults")
        .args(["read", "/Applications/Claude.app/Contents/Info.plist", "CFBundleShortVersionString"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
}

pub fn get_claude_config_status(gateway_url: &str) -> ClaudeConfigStatus {
    let claude_app_exists = get_claude_app_path().exists();
    let claude_version = get_claude_version();

    let Some(dir_3p) = get_claude_3p_dir() else {
        return ClaudeConfigStatus {
            applied: false,
            config_file_exists: false,
            deployment_mode: String::new(),
            gateway_url: gateway_url.to_string(),
            model_count: 0,
            claude_app_exists,
            claude_version,
        };
    };

    let deployment_mode = dir_3p
        .join("claude_desktop_config.json")
        .exists()
        .then(|| {
            fs::read_to_string(dir_3p.join("claude_desktop_config.json"))
                .ok()
                .and_then(|c| {
                    serde_json::from_str::<serde_json::Value>(&c).ok()
                        .and_then(|v| v.get("deploymentMode")?.as_str().map(String::from))
                })
                .unwrap_or_default()
        })
        .unwrap_or_default();

    let entry_paths = get_config_library_entry_paths(&dir_3p, false).unwrap_or_default();
    let mut config_file_exists = !entry_paths.is_empty();
    let mut model_count = 0usize;
    let mut detected_gateway_url: Option<String> = None;
    let mut provider_is_gateway = false;
    for path in &entry_paths {
        if !path.exists() {
            continue;
        }
        config_file_exists = true;
        let Ok(cfg) = read_json_object(path) else {
            continue;
        };
        if model_count == 0 {
            model_count = cfg
                .get("inferenceModels")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
        }
        if detected_gateway_url.is_none() {
            detected_gateway_url = cfg
                .get("inferenceGatewayBaseUrl")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
        provider_is_gateway = cfg
            .get("inferenceProvider")
            .and_then(|v| v.as_str())
            .map(|s| s == "gateway")
            .unwrap_or(false);
        break;
    }

    let url_matches = detected_gateway_url
        .as_ref()
        .map(|u| u == gateway_url)
        .unwrap_or(false);

    ClaudeConfigStatus {
        applied: config_file_exists && deployment_mode == "3p" && provider_is_gateway && url_matches,
        config_file_exists,
        deployment_mode,
        gateway_url: detected_gateway_url.unwrap_or_else(|| gateway_url.to_string()),
        model_count,
        claude_app_exists,
        claude_version,
    }
}

pub fn write_claude_3p_config(
    port: u16,
    api_key: &str,
    models: &[ClaudeModelEntry],
) -> Result<String, String> {
    let dir_3p = get_claude_3p_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    let config_library_dir = config_library_dir(&dir_3p);
    fs::create_dir_all(&config_library_dir)
        .map_err(|e| format!("Failed to create configLibrary dir: {}", e))?;

    let gateway_url = format!("http://127.0.0.1:{}", port);
    let expected = build_gateway_config(&gateway_url, api_key, models);

    let active_id = ensure_active_entry_id(&dir_3p)?;
    let active_path = config_library_entry_path(&dir_3p, &active_id);

    let mut entry_cfg = if active_path.exists() {
        read_json_object(&active_path)?
    } else {
        Map::new()
    };
    for (key, value) in &expected {
        entry_cfg.insert(key.clone(), value.clone());
    }
    write_json_file(&active_path, &Value::Object(entry_cfg))?;

    let mut meta = read_config_library_meta(&dir_3p)?.unwrap_or(ConfigLibraryMeta {
        version: 1,
        applied_id: None,
        entries: vec![],
    });
    meta.version = meta.version.max(1);
    meta.applied_id = Some(active_id.clone());
    if !meta.entries.iter().any(|e| e.id == active_id) {
        meta.entries.push(ConfigLibraryEntry {
            id: active_id,
            name: DEFAULT_CONFIG_NAME.to_string(),
        });
    }
    write_config_library_meta(&dir_3p, &meta)?;

    let desktop_config_path = dir_3p.join("claude_desktop_config.json");
    let mut desktop_cfg = if desktop_config_path.exists() {
        read_json_object(&desktop_config_path)?
    } else {
        Map::new()
    };
    desktop_cfg.insert("deploymentMode".to_string(), Value::from("3p"));
    let mut enterprise_cfg = desktop_cfg
        .get("enterpriseConfig")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    for (key, value) in expected {
        enterprise_cfg.insert(key, value);
    }
    desktop_cfg.insert("enterpriseConfig".to_string(), Value::Object(enterprise_cfg));
    write_json_file(&desktop_config_path, &Value::Object(desktop_cfg))?;

    Ok(gateway_url)
}

pub fn remove_claude_3p_config() -> Result<(), String> {
    let dir_3p = get_claude_3p_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    let mut entry_paths = get_config_library_entry_paths(&dir_3p, false)?;
    let legacy_path = config_library_entry_path(&dir_3p, LEGACY_CONFIG_LIBRARY_UUID);
    if legacy_path.exists() && !entry_paths.iter().any(|p| p == &legacy_path) {
        entry_paths.push(legacy_path);
    }

    let managed_keys = [
        "inferenceProvider",
        "inferenceGatewayBaseUrl",
        "inferenceGatewayApiKey",
        "inferenceGatewayAuthScheme",
        "inferenceGatewayHeaders",
        "inferenceModels",
        "isClaudeCodeForDesktopEnabled",
        "coworkEgressAllowedHosts",
    ];

    for path in entry_paths {
        if !path.exists() {
            continue;
        }
        let mut cfg = read_json_object(&path)?;
        let mut changed = false;
        for key in managed_keys {
            if cfg.remove(key).is_some() {
                changed = true;
            }
        }
        if changed {
            write_json_file(&path, &Value::Object(cfg))?;
        }
    }

    if let Some(mut meta) = read_config_library_meta(&dir_3p)? {
        if meta.applied_id.is_none() {
            meta.applied_id = meta.entries.first().map(|e| e.id.clone());
        }
        write_config_library_meta(&dir_3p, &meta)?;
    }

    // Reset claude_desktop_config.json deployment mode
    let desktop_config_path = dir_3p.join("claude_desktop_config.json");
    if desktop_config_path.exists() {
        let mut desktop_cfg = read_json_object(&desktop_config_path)?;
        desktop_cfg.insert("deploymentMode".to_string(), Value::from(""));
        desktop_cfg.remove("enterpriseConfig");
        write_json_file(&desktop_config_path, &Value::Object(desktop_cfg))?;
    }

    Ok(())
}

pub fn restart_claude_desktop() -> Result<String, String> {
    // Quit Claude Desktop
    let quit_script = r#"tell application "Claude" to quit"#;
    let output = std::process::Command::new("osascript")
        .args(["-e", quit_script])
        .output()
        .map_err(|e| format!("Failed to quit Claude: {}", e))?;

    if !output.status.success() {
        // Claude might not be running, that's ok
    }

    // Wait for Claude to fully quit
    for _ in 0..10 {
        let check = std::process::Command::new("pgrep")
            .args(["-x", "Claude"])
            .output()
            .ok();
        if check.and_then(|o| if o.stdout.is_empty() { None } else { Some(()) }).is_none() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    // Re-launch Claude Desktop
    let launch_output = std::process::Command::new("open")
        .args(["/Applications/Claude.app"])
        .output()
        .map_err(|e| format!("Failed to launch Claude: {}", e))?;

    if !launch_output.status.success() {
        let stderr = String::from_utf8_lossy(&launch_output.stderr);
        return Err(format!("Failed to launch Claude: {}", stderr));
    }

    Ok("Claude Desktop restarted".to_string())
}
