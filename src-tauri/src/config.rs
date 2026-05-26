use serde_json::Value;
use std::fs;
use std::path::Path;

pub fn read_providers(path: &str) -> Result<Value, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read providers.json: {}", e))?;
    let json: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    Ok(json)
}

pub fn write_providers(path: &str, data: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(path, content)
        .map_err(|e| format!("Failed to write: {}", e))?;
    Ok(())
}

pub fn read_env(path: &str) -> Result<std::collections::HashMap<String, String>, String> {
    let mut env_map = std::collections::HashMap::new();

    if !Path::new(path).exists() {
        return Ok(env_map);
    }

    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read .env: {}", e))?;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim().to_string();
            let mut value = value.trim().to_string();

            if (value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\''))
            {
                value = value[1..value.len() - 1].to_string();
            }

            if !key.is_empty() {
                env_map.insert(key, value);
            }
        }
    }

    Ok(env_map)
}

pub fn write_env(path: &str, env: &std::collections::HashMap<String, String>) -> Result<(), String> {
    let mut lines = vec!["# cc-proxy Environment".to_string()];

    let ordered_keys = vec![
        "HOST",
        "PORT",
        "PROXY_API_KEY",
        "CODEX_PROVIDER_PRESET",
        "CODEX_TARGET_API_KEY",
        "CLAUDE_PROVIDER_PRESET",
        "CLAUDE_TARGET_API_KEY",
        "PROVIDER_PRESET",
        "TARGET_API_KEY",
        "DEFAULT_MODEL",
        "REQUEST_TIMEOUT_MS",
        "MAX_REQUEST_BODY_SIZE",
        "DEBUG_REASONING",
    ];

    for key in ordered_keys {
        if let Some(value) = env.get(key) {
            if value.contains(' ') || value.is_empty() {
                lines.push(format!(r#"{}="{}""#, key, value));
            } else {
                lines.push(format!(r#"{}={}"#, key, value));
            }
        }
    }

    let content = lines.join("\n");
    fs::write(path, content)
        .map_err(|e| format!("Failed to write .env: {}", e))?;
    Ok(())
}