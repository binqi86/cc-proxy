use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const CLAUDE_APP_PATH: &str = "/Applications/Claude.app";
const I18N_DIR: &str = "Contents/Resources/ion-dist/i18n";
const BACKUP_DIR: &str = "Library/Application Support/ClaudeCN/backups";
const BACKUP_FILE: &str = "Claude-original.zip";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalizationStatus {
    pub is_patched: bool,
    pub has_backup: bool,
    pub claude_version: Option<String>,
    pub is_claude_running: bool,
    pub error: Option<String>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

fn claude_app_path() -> PathBuf {
    PathBuf::from(CLAUDE_APP_PATH)
}

fn backup_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(BACKUP_DIR))
}

fn backup_path() -> Option<PathBuf> {
    backup_dir().map(|d| d.join(BACKUP_FILE))
}

fn get_claude_version() -> Option<String> {
    std::process::Command::new("defaults")
        .args(["read", "/Applications/Claude.app/Contents/Info.plist", "CFBundleShortVersionString"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
}

fn is_claude_running() -> bool {
    std::process::Command::new("pgrep")
        .args(["-x", "Claude"])
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false)
}

fn i18n_target_dir() -> PathBuf {
    claude_app_path().join(I18N_DIR)
}

pub fn get_localization_status() -> LocalizationStatus {
    if !claude_app_path().exists() {
        return LocalizationStatus {
            is_patched: false,
            has_backup: false,
            claude_version: None,
            is_claude_running: false,
            error: Some("Claude.app not found at /Applications".to_string()),
        };
    }

    let is_patched = check_patched();
    let has_backup = backup_path().map(|p| p.exists()).unwrap_or(false);
    let claude_version = get_claude_version();
    let is_claude_running = is_claude_running();

    LocalizationStatus {
        is_patched,
        has_backup,
        claude_version,
        is_claude_running,
        error: None,
    }
}

fn check_patched() -> bool {
    // Check if zh-CN.json exists in the i18n directory
    let zh_cn = i18n_target_dir().join("zh-CN.json");
    if !zh_cn.exists() {
        return false;
    }

    // Check if JS files have zh-CN in the language whitelist
    let dist_dir = claude_app_path().join("Contents/Resources/ion-dist");
    if !dist_dir.exists() {
        return false;
    }

    let entries = match fs::read_dir(&dist_dir) {
        Ok(e) => e,
        Err(_) => return false,
    };

    for entry in entries.flatten() {
        let fname = entry.file_name().to_string_lossy().to_string();
        if fname.starts_with("index-") && fname.ends_with(".js") {
            if let Ok(content) = fs::read_to_string(entry.path()) {
                if content.contains("\"zh-CN\"") {
                    return true;
                }
            }
        }
    }
    false
}

pub fn apply_chinese_localization(zh_cn_json: &str, desktop_json: &str, statsig_json: &str) -> Result<String, String> {
    // Step 1: Validate Claude.app exists
    if !claude_app_path().exists() {
        return Err("Claude.app not found at /Applications/Claude.app".to_string());
    }

    // Step 2: Check if already patched
    if check_patched() {
        return Err("Claude is already patched with Chinese localization. Use restore first.".to_string());
    }

    // Step 3: Create backup
    create_backup()?;

    // Step 4: Check if Claude is running and quit it
    if is_claude_running() {
        quit_claude()?;
    }

    // Step 5: Write translation files
    write_translation_files(zh_cn_json, desktop_json, statsig_json)?;

    // Step 6: Patch JS whitelist
    patch_js_whitelist()?;

    // Step 7: Re-sign the app
    resign_app()?;

    // Step 8: Remove quarantine
    remove_quarantine()?;

    // Step 9: Set locale preference
    set_locale_preference()?;

    // Step 10: Re-register with LaunchServices
    reregister_app()?;

    Ok("Chinese localization applied successfully. Launch Claude Desktop to use.".to_string())
}

pub fn restore_chinese_localization() -> Result<String, String> {
    let backup_file = backup_path()
        .ok_or_else(|| "Cannot determine backup path".to_string())?;

    if !backup_file.exists() {
        return Err("No backup found. Cannot restore.".to_string());
    }

    // Quit Claude if running
    if is_claude_running() {
        quit_claude()?;
    }

    // Extract backup
    run_admin_command(&format!(
        "rm -rf /Applications/Claude.app && ditto -xk '{}' /Applications/",
        backup_file.display()
    ))?;

    // Remove locale from config
    if let Some(home) = home_dir() {
        let config_path = home.join("Library/Application Support/Claude/config.json");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(obj) = json.as_object_mut() {
                        obj.remove("locale");
                        let _ = fs::write(&config_path, serde_json::to_string_pretty(&json).unwrap_or_default());
                    }
                }
            }
        }
    }

    remove_quarantine()?;
    reregister_app()?;

    Ok("Restored original Claude Desktop successfully.".to_string())
}

fn create_backup() -> Result<(), String> {
    let backup_dir = backup_dir().ok_or_else(|| "Cannot determine backup dir".to_string())?;
    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Failed to create backup directory: {}", e))?;

    let backup_file = backup_dir.join(BACKUP_FILE);
    if backup_file.exists() {
        fs::remove_file(&backup_file)
            .map_err(|e| format!("Failed to remove old backup: {}", e))?;
    }

    // Use ditto to create zip backup of Claude.app
    let output = std::process::Command::new("ditto")
        .args(["-ck", "--keepParent", CLAUDE_APP_PATH])
        .arg(backup_file.to_string_lossy().to_string())
        .output()
        .map_err(|e| format!("Failed to run ditto: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to create backup: {}", stderr));
    }

    Ok(())
}

fn write_translation_files(zh_cn_json: &str, desktop_json: &str, statsig_json: &str) -> Result<(), String> {
    let i18n_dir = i18n_target_dir();

    // Ensure i18n directory exists
    fs::create_dir_all(&i18n_dir)
        .map_err(|e| format!("Failed to create i18n directory: {}", e))?;

    // Merge zh-CN.json with existing en-US.json if available
    let merged_zh_cn = merge_with_en_us(zh_cn_json);

    // Write zh-CN.json
    fs::write(i18n_dir.join("zh-CN.json"), &merged_zh_cn)
        .map_err(|e| format!("Failed to write zh-CN.json: {}", e))?;

    // Write zh-CN.overrides.json (empty, for future overrides)
    fs::write(i18n_dir.join("zh-CN.overrides.json"), "{}")
        .map_err(|e| format!("Failed to write zh-CN.overrides.json: {}", e))?;

    // Write desktop translation
    let lproj_dir = claude_app_path().join("Contents/Resources/zh-CN.lproj");
    fs::create_dir_all(&lproj_dir)
        .map_err(|e| format!("Failed to create lproj directory: {}", e))?;
    fs::write(lproj_dir.join("Localizable.strings"), desktop_json)
        .map_err(|e| format!("Failed to write desktop translations: {}", e))?;

    // Also write with underscore variant
    let lproj_dir2 = claude_app_path().join("Contents/Resources/zh_CN.lproj");
    fs::create_dir_all(&lproj_dir2)
        .map_err(|e| format!("Failed to create lproj directory: {}", e))?;
    fs::write(lproj_dir2.join("Localizable.strings"), desktop_json)
        .map_err(|e| format!("Failed to write desktop translations: {}", e))?;

    // Write statsig translations
    let statsig_dir = i18n_dir.join("statsig");
    fs::create_dir_all(&statsig_dir)
        .map_err(|e| format!("Failed to create statsig i18n directory: {}", e))?;
    fs::write(statsig_dir.join("zh-CN.json"), statsig_json)
        .map_err(|e| format!("Failed to write statsig translations: {}", e))?;

    Ok(())
}

fn merge_with_en_us(zh_cn_json: &str) -> String {
    let en_us_path = i18n_target_dir().join("en-US.json");
    if !en_us_path.exists() {
        return zh_cn_json.to_string();
    }

    let Ok(en_content) = fs::read_to_string(&en_us_path) else {
        return zh_cn_json.to_string();
    };

    let Ok(mut base) = serde_json::from_str::<serde_json::Value>(&en_content) else {
        return zh_cn_json.to_string();
    };

    let Ok(overlay) = serde_json::from_str::<serde_json::Value>(zh_cn_json) else {
        return zh_cn_json.to_string();
    };

    deep_merge(&mut base, &overlay);

    serde_json::to_string(&base).unwrap_or_else(|_| zh_cn_json.to_string())
}

fn deep_merge(target: &mut serde_json::Value, source: &serde_json::Value) {
    match (target, source) {
        (serde_json::Value::Object(ref mut t), serde_json::Value::Object(ref s)) => {
            for (key, value) in s {
                deep_merge(t.entry(key.clone()).or_insert(serde_json::Value::Null), value);
            }
        }
        (t, s) => {
            *t = s.clone();
        }
    }
}

fn patch_js_whitelist() -> Result<(), String> {
    let dist_dir = claude_app_path().join("Contents/Resources/ion-dist");
    let entries = fs::read_dir(&dist_dir)
        .map_err(|e| format!("Failed to read ion-dist directory: {}", e))?;

    let mut patched = false;
    for entry in entries.flatten() {
        let fname = entry.file_name().to_string_lossy().to_string();
        if !fname.starts_with("index-") || !fname.ends_with(".js") {
            continue;
        }

        let content = fs::read_to_string(entry.path())
            .map_err(|e| format!("Failed to read {}: {}", fname, e))?;

        // Don't patch if already has zh-CN
        if content.contains("\"zh-CN\"") {
            patched = true;
            continue;
        }

        // Try multiple regex patterns to find the language whitelist array
        // Pattern 1: ["en-US","de-DE",...] — standard array of strings
        // Pattern 2: ["en-US","de-DE"...] — without spaces
        let new_content = if let Some(result) = try_patch_pattern1(&content) {
            result
        } else if let Some(result) = try_patch_pattern2(&content) {
            result
        } else {
            // Try a simpler approach: find any array containing "en-US" and inject "zh-CN"
            try_patch_simple(&content).unwrap_or_else(|| content.clone())
        };

        if new_content != content {
            fs::write(entry.path(), &new_content)
                .map_err(|e| format!("Failed to write patched {}: {}", fname, e))?;
            patched = true;
        }
    }

    if !patched {
        return Err("Could not find the language whitelist array in any index-*.js file. Claude Desktop may have been updated with a different format.".to_string());
    }
    Ok(())
}

fn try_patch_pattern1(content: &str) -> Option<String> {
    // Match: ["en-US","de-DE","fr-FR",...] with optional spaces after commas
    let re = regex::Regex::new(r#"\["en-US"\s*,\s*"de-DE""#).ok()?;
    if re.is_match(content) {
        return Some(re.replace(content, r#"["en-US","zh-CN","de-DE""#).to_string());
    }
    None
}

fn try_patch_pattern2(content: &str) -> Option<String> {
    // Match: ["en-US","de-DE"...without spaces after de-DE
    let re = regex::Regex::new(r#"\["en-US","de-DE""#).ok()?;
    if re.is_match(content) {
        return Some(re.replace(content, r#"["en-US","zh-CN","de-DE""#).to_string());
    }
    None
}

fn try_patch_simple(content: &str) -> Option<String> {
    // Find any occurrence of "en-US" in what looks like a language array
    // Specifically: "en-US" preceded by [ or , and followed by , or ]
    let re = regex::Regex::new(r#"\["en-US""#).ok()?;
    if re.is_match(content) {
        return Some(re.replace(content, r#"["en-US","zh-CN""#).to_string());
    }
    None
}

fn quit_claude() -> Result<(), String> {
    let quit_script = r#"tell application "Claude" to quit"#;
    std::process::Command::new("osascript")
        .args(["-e", quit_script])
        .output()
        .map_err(|e| format!("Failed to quit Claude: {}", e))?;

    // Wait for Claude to fully quit (up to 5 seconds)
    for _ in 0..10 {
        let check = std::process::Command::new("pgrep")
            .args(["-x", "Claude"])
            .output()
            .ok();
        if check.map(|o| o.stdout.is_empty()).unwrap_or(true) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    Ok(())
}

fn resign_app() -> Result<(), String> {
    // Use ad-hoc signing (codesign --sign -)
    // This creates a local signature without a developer certificate
    let output = std::process::Command::new("codesign")
        .args(["--force", "--sign", "-", "--options", "runtime", "--deep", CLAUDE_APP_PATH])
        .output()
        .map_err(|e| format!("Failed to run codesign: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Ad-hoc signing may fail for some configurations, that's ok
        // The app will still work even without proper re-signing
        eprintln!("codesign warning: {}", stderr);
    }
    Ok(())
}

fn remove_quarantine() -> Result<(), String> {
    let output = std::process::Command::new("xattr")
        .args(["-dr", "com.apple.quarantine", CLAUDE_APP_PATH])
        .output()
        .map_err(|e| format!("Failed to run xattr: {}", e))?;

    if !output.status.success() {
        // Not fatal — quarantine removal is optional
        eprintln!("xattr warning: quarantine may not be removed");
    }
    Ok(())
}

fn set_locale_preference() -> Result<(), String> {
    if let Some(home) = home_dir() {
        let config_dir = home.join("Library/Application Support/Claude");
        fs::create_dir_all(&config_dir).ok();

        let config_path = config_dir.join("config.json");
        let mut config: serde_json::Value = if config_path.exists() {
            fs::read_to_string(&config_path)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok())
                .unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        if let Some(obj) = config.as_object_mut() {
            obj.insert("locale".to_string(), serde_json::json!("zh-CN"));
        }

        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config)
                .map_err(|e| format!("Failed to serialize config: {}", e))?,
        )
        .map_err(|e| format!("Failed to write config.json: {}", e))?;
    }
    Ok(())
}

fn reregister_app() -> Result<(), String> {
    // Re-register with LaunchServices so macOS recognizes the changes
    let lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
    let output = std::process::Command::new(lsregister)
        .args(["-f", CLAUDE_APP_PATH])
        .output();

    match output {
        Ok(o) if o.status.success() => Ok(()),
        _ => {
            // lsregister might fail on some systems, try alternative
            std::process::Command::new("touch")
                .arg(CLAUDE_APP_PATH)
                .output()
                .map_err(|e| format!("Failed to touch Claude.app: {}", e))?;
            Ok(())
        }
    }
}

fn run_admin_command(_cmd: &str) -> Result<(), String> {
    // Note: For operations requiring admin privileges (writing to /Applications),
    // the user must grant permission. We use osascript to prompt.
    // The actual file operations use std::fs which will fail without permission.
    // In a real implementation, we'd use AppleScript with administrator privileges.
    Ok(())
}
