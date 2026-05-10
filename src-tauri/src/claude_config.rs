use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const CLAUDE_3P_DIR: &str = "Library/Application Support/Claude-3p";
const CONFIG_LIBRARY_UUID: &str = "a0a0a0a0-b1b1-4c2c-9d3d-e4e4e4e4e4e4";

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

    let config_file = dir_3p
        .join("configLibrary")
        .join(format!("{}.json", CONFIG_LIBRARY_UUID));
    let config_file_exists = config_file.exists();

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

    let model_count = if config_file_exists {
        fs::read_to_string(&config_file)
            .ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .and_then(|v| v.get("inferenceModels")?.as_array().map(|a| a.len()))
            .unwrap_or(0)
    } else {
        0
    };

    ClaudeConfigStatus {
        applied: config_file_exists && deployment_mode == "3p",
        config_file_exists,
        deployment_mode,
        gateway_url: gateway_url.to_string(),
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

    let config_library_dir = dir_3p.join("configLibrary");
    fs::create_dir_all(&config_library_dir)
        .map_err(|e| format!("Failed to create configLibrary dir: {}", e))?;

    let gateway_url = format!("http://127.0.0.1:{}", port);

    // Build the inference gateway config
    let config = serde_json::json!({
        "inferenceProvider": "gateway",
        "inferenceGatewayBaseUrl": gateway_url,
        "inferenceGatewayApiKey": api_key,
        "inferenceGatewayAuthScheme": "bearer",
        "coworkEgressAllowedHosts": ["*"],
        "inferenceModels": models.iter().map(|m| {
            let mut entry = serde_json::json!({ "name": m.name });
            if m.supports_1m.unwrap_or(false) {
                entry["supports1m"] = serde_json::Value::Bool(true);
            }
            if let Some(ref dn) = m.display_name {
                entry["displayName"] = serde_json::json!(dn);
            }
            entry
        }).collect::<Vec<_>>(),
    });

    let config_path = config_library_dir.join(format!("{}.json", CONFIG_LIBRARY_UUID));
    fs::write(
        &config_path,
        serde_json::to_string_pretty(&config).map_err(|e| format!("Failed to serialize: {}", e))?,
    )
    .map_err(|e| format!("Failed to write config: {}", e))?;

    // Write _meta.json
    let meta = serde_json::json!({
        "version": 1,
        "entries": [CONFIG_LIBRARY_UUID],
    });
    fs::write(
        config_library_dir.join("_meta.json"),
        serde_json::to_string_pretty(&meta).map_err(|e| format!("Failed to serialize _meta: {}", e))?,
    )
    .map_err(|e| format!("Failed to write _meta.json: {}", e))?;

    // Write claude_desktop_config.json for deployment mode
    let desktop_config = serde_json::json!({
        "deploymentMode": "3p",
        "locale": "zh-CN",
    });
    fs::write(
        dir_3p.join("claude_desktop_config.json"),
        serde_json::to_string_pretty(&desktop_config)
            .map_err(|e| format!("Failed to serialize desktop config: {}", e))?,
    )
    .map_err(|e| format!("Failed to write claude_desktop_config.json: {}", e))?;

    Ok(gateway_url)
}

pub fn remove_claude_3p_config() -> Result<(), String> {
    let dir_3p = get_claude_3p_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    // Remove our specific config file
    let config_path = dir_3p
        .join("configLibrary")
        .join(format!("{}.json", CONFIG_LIBRARY_UUID));
    if config_path.exists() {
        fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove config: {}", e))?;
    }

    // Update _meta.json
    let meta_path = dir_3p.join("configLibrary").join("_meta.json");
    if meta_path.exists() {
        let meta = serde_json::json!({
            "version": 1,
            "entries": serde_json::Value::Array(vec![]),
        });
        fs::write(
            &meta_path,
            serde_json::to_string_pretty(&meta)
                .map_err(|e| format!("Failed to serialize _meta: {}", e))?,
        )
        .map_err(|e| format!("Failed to write _meta.json: {}", e))?;
    }

    // Reset claude_desktop_config.json deployment mode
    if dir_3p.join("claude_desktop_config.json").exists() {
        let desktop_config = serde_json::json!({ "deploymentMode": "" });
        fs::write(
            dir_3p.join("claude_desktop_config.json"),
            serde_json::to_string_pretty(&desktop_config)
                .map_err(|e| format!("Failed to serialize desktop config: {}", e))?,
        )
        .map_err(|e| format!("Failed to write claude_desktop_config.json: {}", e))?;
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
