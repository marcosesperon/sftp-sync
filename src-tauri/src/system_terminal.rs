//! Apertura de sesiones SSH en herramientas externas: la terminal del sistema
//! (macOS / Windows / Linux) o PuTTY (solo Windows). Reutiliza los datos del
//! perfil; las credenciales se pasan a la herramienta según sus posibilidades.

use crate::config::{Auth, Profile};

/// Destino `usuario@host`.
fn target(profile: &Profile) -> String {
    format!("{}@{}", profile.username, profile.host)
}

/// Argumentos del comando `ssh` del sistema (sin entrecomillar).
fn build_ssh_args(profile: &Profile) -> Vec<String> {
    let mut v_args = vec!["ssh".to_string(), "-p".to_string(), profile.port.to_string()];
    if let Auth::Key {
        private_key_path, ..
    } = &profile.auth
    {
        if !private_key_path.is_empty() {
            v_args.push("-i".to_string());
            v_args.push(private_key_path.clone());
        }
    }
    v_args.push(target(profile));
    v_args
}

// ---------------------------------------------------------------------------
// Terminal del sistema
// ---------------------------------------------------------------------------

/// Entrecomilla un argumento para una shell POSIX (comillas simples).
#[cfg(target_os = "macos")]
fn shell_quote(v_arg: &str) -> String {
    format!("'{}'", v_arg.replace('\'', "'\\''"))
}

/// Comando `ssh ...` listo para ejecutarse en una shell POSIX.
#[cfg(target_os = "macos")]
fn ssh_command_string(profile: &Profile) -> String {
    build_ssh_args(profile)
        .iter()
        .map(|v_a| shell_quote(v_a))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Escapa una cadena para incrustarla en un literal de AppleScript.
#[cfg(target_os = "macos")]
fn applescript_escape(v_s: &str) -> String {
    v_s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
pub fn open_system_terminal(profile: &Profile) -> Result<(), String> {
    let v_cmd = ssh_command_string(profile);
    // Usa iTerm2 si está instalado; si no, la Terminal.app del sistema.
    let v_use_iterm = std::path::Path::new("/Applications/iTerm.app").exists();
    let v_script = if v_use_iterm {
        format!(
            "tell application \"iTerm\"\nactivate\nset w to (create window with default profile)\ntell current session of w to write text \"{}\"\nend tell",
            applescript_escape(&v_cmd)
        )
    } else {
        format!(
            "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
            applescript_escape(&v_cmd)
        )
    };
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(&v_script)
        .spawn()
        .map_err(|e| format!("no se pudo abrir la terminal: {e}"))?;
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn open_system_terminal(profile: &Profile) -> Result<(), String> {
    let v_args = build_ssh_args(profile);
    // Emuladores comunes con la opción que precede al comando a ejecutar.
    let v_candidates: &[(&str, &str)] = &[
        ("x-terminal-emulator", "-e"),
        ("gnome-terminal", "--"),
        ("konsole", "-e"),
        ("xfce4-terminal", "-x"),
        ("xterm", "-e"),
    ];
    for (v_bin, v_sep) in v_candidates {
        let v_spawned = std::process::Command::new(v_bin)
            .arg(v_sep)
            .args(&v_args)
            .spawn();
        if v_spawned.is_ok() {
            return Ok(());
        }
    }
    Err("no se encontró un emulador de terminal compatible".to_string())
}

/// Entrecomilla un argumento para `cmd.exe` (comillas dobles si hay espacios).
#[cfg(target_os = "windows")]
fn win_quote(v_arg: &str) -> String {
    if v_arg.contains(' ') {
        format!("\"{v_arg}\"")
    } else {
        v_arg.to_string()
    }
}

#[cfg(target_os = "windows")]
pub fn open_system_terminal(profile: &Profile) -> Result<(), String> {
    let v_args = build_ssh_args(profile);
    // Preferimos Windows Terminal si está disponible.
    if std::process::Command::new("wt.exe")
        .arg("new-tab")
        .args(&v_args)
        .spawn()
        .is_ok()
    {
        return Ok(());
    }
    // Fallback: cmd que ejecuta ssh y mantiene la ventana abierta (/k).
    let v_joined = v_args
        .iter()
        .map(|v_a| win_quote(v_a))
        .collect::<Vec<_>>()
        .join(" ");
    std::process::Command::new("cmd")
        .args(["/c", "start", "", "cmd", "/k", &v_joined])
        .spawn()
        .map_err(|e| format!("no se pudo abrir la terminal: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// PuTTY (solo Windows)
// ---------------------------------------------------------------------------

/// Localiza `putty.exe`: ruta configurada, ubicaciones habituales o el PATH.
#[cfg(target_os = "windows")]
fn resolve_putty(putty_path: Option<&str>) -> String {
    if let Some(v_p) = putty_path {
        if !v_p.is_empty() && std::path::Path::new(v_p).exists() {
            return v_p.to_string();
        }
    }
    let v_candidates = [
        std::env::var("ProgramFiles")
            .ok()
            .map(|d| format!("{d}\\PuTTY\\putty.exe")),
        std::env::var("ProgramFiles(x86)")
            .ok()
            .map(|d| format!("{d}\\PuTTY\\putty.exe")),
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|d| format!("{d}\\Programs\\PuTTY\\putty.exe")),
    ];
    for v_c in v_candidates.into_iter().flatten() {
        if std::path::Path::new(&v_c).exists() {
            return v_c;
        }
    }
    // Confiamos en que esté en el PATH.
    "putty.exe".to_string()
}

/// Escribe la contraseña en un fichero temporal único para `-pwfile`.
#[cfg(target_os = "windows")]
fn write_temp_password(password: &str) -> Result<std::path::PathBuf, String> {
    let v_unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut v_path = std::env::temp_dir();
    v_path.push(format!("sftp-sync-pw-{v_unique}.tmp"));
    std::fs::write(&v_path, password)
        .map_err(|e| format!("no se pudo preparar la contraseña: {e}"))?;
    Ok(v_path)
}

/// Borra el fichero temporal de contraseña tras unos segundos (PuTTY ya lo leyó).
#[cfg(target_os = "windows")]
fn schedule_delete(path: std::path::PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(10));
        let _ = std::fs::remove_file(&path);
    });
}

#[cfg(target_os = "windows")]
pub fn open_putty(profile: &Profile, putty_path: Option<&str>) -> Result<(), String> {
    let v_exe = resolve_putty(putty_path);
    let mut v_args = vec!["-ssh".to_string(), "-P".to_string(), profile.port.to_string()];
    match &profile.auth {
        Auth::Key { .. } => {
            let v_ppk = profile
                .putty_ppk_path
                .as_deref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    "Este perfil usa clave: configura la ruta a la clave .ppk para PuTTY en el perfil."
                        .to_string()
                })?;
            v_args.push("-i".to_string());
            v_args.push(v_ppk.to_string());
        }
        Auth::Password { password } => {
            // PuTTY sí admite inyectar la contraseña, vía fichero temporal.
            let v_file = write_temp_password(password)?;
            v_args.push("-pwfile".to_string());
            v_args.push(v_file.to_string_lossy().to_string());
            schedule_delete(v_file);
        }
    }
    v_args.push(target(profile));
    std::process::Command::new(&v_exe)
        .args(&v_args)
        .spawn()
        .map_err(|e| format!("no se pudo lanzar PuTTY ({v_exe}): {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn open_putty(_profile: &Profile, _putty_path: Option<&str>) -> Result<(), String> {
    Err("PuTTY solo está disponible en Windows.".to_string())
}
