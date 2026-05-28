use std::process::Command;
use std::env;

pub struct ProxyProcess {
    pub pid: u32,
    pub port: u16,
    pub log_rx: Option<std::sync::mpsc::Receiver<String>>,
}

fn resolve_server_js() -> std::path::PathBuf {
    // 1. Search upward from cwd for the project-root server.cjs (dev mode)
    let mut dir = std::env::current_dir().ok();
    while let Some(d) = dir {
        let candidate = d.join("server.cjs");
        if candidate.exists() {
            return candidate;
        }
        dir = d.parent().map(|p| p.to_path_buf());
    }

    // 2. Packaged app: use server.cjs from bundle Resources
    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents) = exe.parent().and_then(|p| p.parent()) {
            let res = contents.join("Resources");
            for sub in &["", "resources", "_up_"] {
                let candidate = if sub.is_empty() { res.join("server.cjs") } else { res.join(sub).join("server.cjs") };
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }

    // 3. Fallback (should not happen)
    std::path::PathBuf::from("server.cjs")
}

pub fn start_proxy(config_path: &str) -> Result<ProxyProcess, String> {
    // Find node in PATH
    let node_path = find_node().unwrap_or_else(|| "node".to_string());

    let server_js = resolve_server_js();
    let port = detect_port_from_config(config_path);

    let mut cmd = Command::new(&node_path);
    cmd.arg(&server_js).env("NODE_ENV", "production");

    // Tell server.cjs where the config directory is (for .env, providers.json, debug_logs)
    let config_dir = std::path::Path::new(config_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if !config_dir.is_empty() {
        cmd.env("CONFIG_DIR", &config_dir);
    }

    // Forward .env config to the Node.js process so it uses the configured port
    if let Ok(env_map) = super::config::read_env(config_path) {
        for (key, value) in &env_map {
            cmd.env(key, value);
        }
    }

    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start node process: {}", e))?;

    let pid = child.id();
    let (tx, rx) = std::sync::mpsc::channel();

    if let Some(stdout) = child.stdout.take() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        if tx.send(l).is_err() { break; }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        if tx.send(l).is_err() { break; }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    Ok(ProxyProcess {
        pid,
        port,
        log_rx: Some(rx),
    })
}

pub fn stop_proxy(pid: u32) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output()
            .map_err(|e| format!("Failed to kill process: {}", e))?;
    } else {
        // On Unix-like systems, use SIGTERM
        Command::new("kill")
            .args([pid.to_string()])
            .output()
            .map_err(|e| format!("Failed to kill process: {}", e))?;
    }
    Ok(())
}

pub fn get_service_status(pid: Option<u32>) -> Result<bool, String> {
    if pid.is_none() {
        return Ok(false);
    }

    // On Unix-like systems, use kill -0 to check if process exists
    if cfg!(target_os = "windows") {
        // On Windows, use tasklist
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid.unwrap())])
            .output()
            .map_err(|e| format!("Failed to check process: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.lines().count() > 1) // Header + process line if exists
    } else {
        // On Unix, use kill -0
        Command::new("kill")
            .args(["-0", &pid.unwrap().to_string()])
            .output()
            .map(|result| result.status.success())
            .map_err(|e| format!("Failed to check process: {}", e))
    }
}

fn find_node() -> Option<String> {
    // First search PATH
    if let Ok(paths) = env::var("PATH") {
        for dir in paths.split(':') {
            let node_path = format!("{}/node", dir);
            if std::path::Path::new(&node_path).exists() {
                return Some(node_path);
            }
        }
    }
    // Fallback to common node locations (GUI apps have limited PATH)
    let fallbacks = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
    ];
    for path in fallbacks {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // Check nvm
    if let Ok(home) = env::var("HOME") {
        let nvm_dir = format!("{}/.nvm/versions/node", home);
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                let node_path = entry.path().join("bin").join("node");
                if node_path.exists() {
                    return Some(node_path.to_string_lossy().to_string());
                }
            }
        }
    }
    // Return "node" as last resort (might work if in PATH)
    Some("node".to_string())
}

pub fn detect_running_proxy() -> Option<ProxyProcess> {
    let port = detect_port_from_env_config();
    if cfg!(target_os = "windows") {
        let output = Command::new("netstat")
            .args(["-ano", "-p", "tcp"])
            .output().ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains(&format!(":{}", port)) && line.contains("LISTENING") {
                let pid_str = line.split_whitespace().last()?;
                if let Ok(pid) = pid_str.parse::<u32>() { return Some(ProxyProcess { pid, port, log_rx: None }); }
            }
        }
    } else {
        let output = Command::new("lsof")
            .args(["-i", &format!(":{}", port), "-t", "-sTCP:LISTEN"])
            .output().ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Ok(pid) = stdout.parse::<u32>() { return Some(ProxyProcess { pid, port, log_rx: None }); }
    }
    None
}

fn detect_port_from_env_config() -> u16 {
    // Try cwd first
    if let Ok(dir) = std::env::current_dir() {
        let env_path = format!("{}/.env", dir.display());
        if let Ok(env_map) = super::config::read_env(&env_path) {
            if let Some(port_str) = env_map.get("PORT") {
                return port_str.parse::<u16>().unwrap_or(8088);
            }
        }
    }
    // Fallback: check ~/.cc-proxy/.env
    if let Ok(home) = std::env::var("HOME") {
        let env_path = format!("{}/.cc-proxy/.env", home);
        if let Ok(env_map) = super::config::read_env(&env_path) {
            if let Some(port_str) = env_map.get("PORT") {
                return port_str.parse::<u16>().unwrap_or(8088);
            }
        }
    }
    8088
}

fn detect_port_from_config(config_path: &str) -> u16 {
    if let Ok(env_map) = super::config::read_env(config_path) {
        if let Some(port_str) = env_map.get("PORT") {
            return port_str.parse::<u16>().unwrap_or(8088);
        }
    }
    8088
}
