use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn get_codex_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".codex"))
}

fn get_cc_switch_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".cc-switch"))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexApplyResult {
    pub codex_config_written: bool,
    pub cc_switch_config_written: bool,
    pub gateway_url: String,
    pub model_count: usize,
}

fn is_table_header(line: &str) -> bool {
    let t = line.trim();
    t.starts_with('[') && t.ends_with(']')
}

fn read_root_model_provider(content: &str) -> Option<String> {
    for raw in content.lines() {
        let trimmed = raw.trim();
        if is_table_header(trimmed) {
            break;
        }
        if trimmed.starts_with("model_provider") && trimmed.contains('=') {
            let value = trimmed.split_once('=')?.1.trim();
            let value = value.trim_matches('"').trim_matches('\'').trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn read_root_raw_value(content: &str, key: &str) -> Option<String> {
    for raw in content.lines() {
        let trimmed = raw.trim();
        if is_table_header(trimmed) {
            break;
        }
        if (trimmed.starts_with(&format!("{} ", key)) || trimmed.starts_with(&format!("{}=", key)))
            && trimmed.contains('=')
        {
            return trimmed
                .split_once('=')
                .map(|(_, v)| v.trim().to_string())
                .filter(|v| !v.is_empty());
        }
    }
    None
}

fn quote_toml_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    format!("\"{}\"", escaped)
}

fn normalize_toml_string_value(raw: Option<String>, default_value: &str) -> String {
    match raw {
        Some(v) => {
            let t = v.trim();
            if (t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')) {
                t.to_string()
            } else {
                quote_toml_string(t)
            }
        }
        None => quote_toml_string(default_value),
    }
}

fn normalize_toml_int_value(raw: Option<String>, default_value: i64) -> String {
    raw.and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(default_value)
        .to_string()
}

fn normalize_toml_bool_value(raw: Option<String>, default_value: bool) -> String {
    let normalized = raw
        .map(|v| v.trim().to_lowercase())
        .and_then(|v| match v.as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        })
        .unwrap_or(default_value);
    if normalized { "true".to_string() } else { "false".to_string() }
}

fn remove_root_keys(content: &str, keys: &[&str]) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut in_table = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if is_table_header(trimmed) {
            in_table = true;
            out.push(line.to_string());
            continue;
        }
        if !in_table {
            let is_target = keys.iter().any(|key| {
                (trimmed.starts_with(&format!("{} ", key)) || trimmed.starts_with(&format!("{}=", key)))
                    && trimmed.contains('=')
            });
            if is_target {
                continue;
            }
        }
        out.push(line.to_string());
    }
    out.join("\n").trim().to_string()
}

fn extract_table_block(content: &str, header: &str) -> (Option<String>, String) {
    let lines: Vec<String> = if content.trim().is_empty() {
        Vec::new()
    } else {
        content.lines().map(|l| l.to_string()).collect()
    };
    let Some((start, end)) = find_table_range(&lines, header) else {
        return (None, content.trim().to_string());
    };

    let block = lines[start..end].join("\n").trim().to_string();
    let mut remaining = Vec::new();
    remaining.extend_from_slice(&lines[..start]);
    remaining.extend_from_slice(&lines[end..]);
    let remaining = remaining.join("\n").trim().to_string();
    (Some(block), remaining)
}

fn remove_standalone_model_providers_header(content: &str) -> String {
    let mut out = Vec::new();
    for line in content.lines() {
        if line.trim() == "[model_providers]" {
            continue;
        }
        out.push(line.to_string());
    }
    out.join("\n").trim().to_string()
}

fn find_table_range(lines: &[String], header: &str) -> Option<(usize, usize)> {
    let mut start = None;
    for (idx, line) in lines.iter().enumerate() {
        if line.trim() == header {
            start = Some(idx);
            break;
        }
    }
    let start = start?;
    let mut end = lines.len();
    for (idx, line) in lines.iter().enumerate().skip(start + 1) {
        if is_table_header(line) {
            end = idx;
            break;
        }
    }
    Some((start, end))
}

fn find_key_in_table(lines: &[String], start: usize, end: usize, key: &str) -> Option<usize> {
    for (idx, line) in lines.iter().enumerate().take(end).skip(start + 1) {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with(&format!("{} ", key)) || trimmed.starts_with(&format!("{}=", key)) {
            if trimmed.contains('=') {
                return Some(idx);
            }
        }
    }
    None
}

fn upsert_provider_block(
    content: &str,
    provider_id: &str,
    gateway_url: &str,
) -> String {
    let mut lines: Vec<String> = if content.trim().is_empty() {
        Vec::new()
    } else {
        content.lines().map(|l| l.to_string()).collect()
    };
    let header = format!("[model_providers.{}]", provider_id);

    if lines.is_empty() {
        lines.push(header.clone());
        lines.push(format!("name = \"{}\"", provider_id));
        lines.push(format!("base_url = \"{}/v1\"", gateway_url));
        lines.push("wire_api = \"responses\"".to_string());
        lines.push("requires_openai_auth = false".to_string());
        return format!("{}\n", lines.join("\n"));
    }

    let (start, end) = if let Some(range) = find_table_range(&lines, &header) {
        range
    } else {
        if !lines.last().map(|l| l.trim().is_empty()).unwrap_or(false) {
            lines.push(String::new());
        }
        lines.push(header.clone());
        lines.push(format!("name = \"{}\"", provider_id));
        lines.push(format!("base_url = \"{}/v1\"", gateway_url));
        lines.push("wire_api = \"responses\"".to_string());
        lines.push("requires_openai_auth = false".to_string());
        return format!("{}\n", lines.join("\n"));
    };

    if let Some(idx) = find_key_in_table(&lines, start, end, "base_url") {
        lines[idx] = format!("base_url = \"{}/v1\"", gateway_url);
    } else {
        lines.insert(end, format!("base_url = \"{}/v1\"", gateway_url));
    }

    let (_, mut end_after_base) = find_table_range(&lines, &header).unwrap_or((start, lines.len()));
    if let Some(idx) = find_key_in_table(&lines, start, end_after_base, "wire_api") {
        lines[idx] = "wire_api = \"responses\"".to_string();
    } else {
        lines.insert(end_after_base, "wire_api = \"responses\"".to_string());
        end_after_base += 1;
    }

    if let Some(idx) = find_key_in_table(&lines, start, end_after_base, "requires_openai_auth") {
        lines[idx] = "requires_openai_auth = false".to_string();
    } else {
        lines.insert(end_after_base, "requires_openai_auth = false".to_string());
    }

    format!("{}\n", lines.join("\n"))
}

fn provider_block_has_required_fields(content: &str, provider_id: &str, gateway_url: &str) -> bool {
    let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let header = format!("[model_providers.{}]", provider_id);
    let Some((start, end)) = find_table_range(&lines, &header) else {
        return false;
    };

    let mut has_base = false;
    let mut has_wire = false;
    let mut has_auth = false;
    for line in lines.iter().take(end).skip(start + 1) {
        let trimmed = line.trim();
        if trimmed.starts_with("base_url") && trimmed.contains(&format!("\"{}/v1\"", gateway_url)) {
            has_base = true;
        }
        if trimmed == "wire_api = \"responses\"" {
            has_wire = true;
        }
        if trimmed == "requires_openai_auth = false" {
            has_auth = true;
        }
    }
    has_base && has_wire && has_auth
}

/// Write Codex config files directly (~/.codex/config.toml, ~/.codex/auth.json)
/// and optionally write to cc-switch's legacy config for integration.
pub fn apply_codex_config(
    port: u16,
    api_key: &str,
    default_model: &str,
    context_window: bool,
) -> Result<CodexApplyResult, String> {
    let codex_dir = get_codex_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    fs::create_dir_all(&codex_dir)
        .map_err(|e| format!("Failed to create .codex dir: {}", e))?;

    let gateway_url = format!("http://127.0.0.1:{}", port);
    let default_provider_id = "cc-proxy";

    // Update only critical fields in existing config.toml, keep all other settings untouched.
    let config_path = codex_dir.join("config.toml");
    let existing_config = fs::read_to_string(&config_path).unwrap_or_default();
    let provider_id = default_provider_id.to_string();
    let mut config_toml = upsert_provider_block(&existing_config, &provider_id, &gateway_url);
    let model_provider_value = quote_toml_string(&provider_id);
    let model_value = normalize_toml_string_value(
        read_root_raw_value(&existing_config, "model"),
        default_model,
    );
    let model_reasoning_effort_value = normalize_toml_string_value(
        read_root_raw_value(&existing_config, "model_reasoning_effort"),
        "high",
    );
    let disable_response_storage_value = normalize_toml_bool_value(
        read_root_raw_value(&existing_config, "disable_response_storage"),
        true,
    );
    let model_context_window_value = if context_window {
        Some(normalize_toml_int_value(
            read_root_raw_value(&existing_config, "model_context_window"),
            1_000_000,
        ))
    } else { None };
    let model_auto_compact_token_limit_value = if context_window {
        Some(normalize_toml_int_value(
            read_root_raw_value(&existing_config, "model_auto_compact_token_limit"),
            900_000,
        ))
    } else { None };

    let mut remove_keys = vec![
        "model_context_window",
        "model_auto_compact_token_limit",
        "model_provider",
        "model",
        "model_reasoning_effort",
        "disable_response_storage",
    ];
    let remainder = remove_root_keys(&config_toml, &remove_keys);
    let provider_header = format!("[model_providers.{}]", provider_id);
    let (provider_block, other_remainder) = extract_table_block(&remainder, &provider_header);
    let other_remainder = remove_standalone_model_providers_header(&other_remainder);
    let top_block = if context_window {
        format!(
            "model_provider = {}\nmodel = {}\nmodel_reasoning_effort = {}\ndisable_response_storage = {}\n\nmodel_context_window = {}\nmodel_auto_compact_token_limit = {}\n[model_providers]",
            model_provider_value,
            model_value,
            model_reasoning_effort_value,
            disable_response_storage_value,
            model_context_window_value.unwrap_or_default(),
            model_auto_compact_token_limit_value.unwrap_or_default(),
        )
    } else {
        format!(
            "model_provider = {}\nmodel = {}\nmodel_reasoning_effort = {}\ndisable_response_storage = {}\n[model_providers]",
            model_provider_value,
            model_value,
            model_reasoning_effort_value,
            disable_response_storage_value,
        )
    };
    config_toml = match (provider_block, other_remainder.is_empty()) {
        (Some(block), true) => format!("{}\n\n{}\n", top_block, block),
        (Some(block), false) => format!("{}\n\n{}\n\n{}\n", top_block, block, other_remainder),
        (None, true) => format!("{}\n", top_block),
        (None, false) => format!("{}\n\n{}\n", top_block, other_remainder),
    };
    fs::write(&config_path, config_toml)
        .map_err(|e| format!("Failed to write config.toml: {}", e))?;

    // Overwrite-write ~/.codex/auth.json (OpenAI-compatible schema)
    let auth_path = codex_dir.join("auth.json");
    let mut auth = serde_json::Map::new();
    auth.insert("OPENAI_API_KEY".to_string(), serde_json::Value::from(api_key.to_string()));
    fs::write(
        &auth_path,
        serde_json::to_string_pretty(&serde_json::Value::Object(auth))
            .map_err(|e| format!("Failed to serialize auth.json: {}", e))?,
    )
    .map_err(|e| format!("Failed to write auth.json: {}", e))?;

    // Optionally write to cc-switch's legacy config for integration
    let mut cc_switch_written = false;
    if let Some(cc_dir) = get_cc_switch_dir() {
        let cc_config_path = cc_dir.join("config.json");
        // Only write if cc-switch directory exists (indicating cc-switch is installed)
        if cc_dir.exists() {
            let cc_config = serde_json::json!({
                "providers": {
                    provider_id.clone(): {
                        "name": provider_id.clone(),
                        "settingsConfig": {
                            "env": {
                                "OPENAI_BASE_URL": format!("{}/v1", gateway_url),
                                "OPENAI_API_KEY": api_key,
                            }
                        },
                        "meta": {
                            "apiFormat": "openai_chat",
                        }
                    }
                },
                "current": provider_id.clone(),
            });
            if let Ok(json_str) = serde_json::to_string_pretty(&cc_config) {
                fs::create_dir_all(&cc_dir).ok();
                if fs::write(&cc_config_path, &json_str).is_ok() {
                    cc_switch_written = true;
                }
            }
        }
    }

    Ok(CodexApplyResult {
        codex_config_written: true,
        cc_switch_config_written: cc_switch_written,
        gateway_url,
        model_count: 1,
    })
}

/// Remove Codex config (reset to defaults)
pub fn remove_codex_config() -> Result<(), String> {
    if let Some(codex_dir) = get_codex_dir() {
        let auth_path = codex_dir.join("auth.json");

        if auth_path.exists() {
            fs::remove_file(&auth_path)
                .map_err(|e| format!("Failed to remove auth.json: {}", e))?;
        }
    }

    if let Some(cc_dir) = get_cc_switch_dir() {
        let cc_config_path = cc_dir.join("config.json");
        if cc_config_path.exists() {
            fs::remove_file(&cc_config_path).ok();
        }
    }

    Ok(())
}

/// Get Codex config status
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexConfigStatus {
    pub applied: bool,
    pub config_file_exists: bool,
    pub auth_file_exists: bool,
    pub gateway_url: String,
    pub cc_switch_config_exists: bool,
}

pub fn get_codex_config_status(gateway_url: &str) -> CodexConfigStatus {
    let (config_exists, auth_exists, managed_config, managed_auth) = if let Some(codex_dir) = get_codex_dir() {
        let config_path = codex_dir.join("config.toml");
        let auth_path = codex_dir.join("auth.json");
        let config_exists = config_path.exists();
        let auth_exists = auth_path.exists();
        let managed_config = if config_exists {
            fs::read_to_string(&config_path)
                .map(|s| {
                    let provider = read_root_model_provider(&s).unwrap_or_else(|| "cc-proxy".to_string());
                    provider_block_has_required_fields(&s, &provider, gateway_url)
                })
                .unwrap_or(false)
        } else {
            false
        };
        let managed_auth = if auth_exists {
            fs::read_to_string(&auth_path)
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.as_object().cloned())
                .map(|m| m.get("OPENAI_API_KEY").and_then(|v| v.as_str()).is_some())
                .unwrap_or(false)
        } else {
            false
        };
        (config_exists, auth_exists, managed_config, managed_auth)
    } else {
        (false, false, false, false)
    };

    let cc_switch_config = get_cc_switch_dir()
        .map(|d| d.join("config.json").exists())
        .unwrap_or(false);

    CodexConfigStatus {
        applied: config_exists && auth_exists && managed_config && managed_auth,
        config_file_exists: config_exists,
        auth_file_exists: auth_exists,
        gateway_url: gateway_url.to_string(),
        cc_switch_config_exists: cc_switch_config,
    }
}
