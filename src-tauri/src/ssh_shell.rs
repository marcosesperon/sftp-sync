//! Sesión SSH interactiva (shell + PTY) sobre `russh`, reutilizando la
//! autenticación y verificación de host key del módulo `sftp`.

use russh::ChannelMsg;
use tauri::async_runtime::JoinHandle;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

use crate::config::Profile;
use crate::sftp::{connect_authenticated, HostKeyMode};

/// Órdenes que la UI envía a una shell abierta.
pub enum ShellCmd {
    Input(Vec<u8>),
    Resize(u16, u16),
    Close,
}

/// Sesión shell viva: canal de órdenes hacia la tarea propietaria + tarea lectora.
pub struct SshSession {
    pub tx: mpsc::Sender<ShellCmd>,
    pub reader: JoinHandle<()>,
}

/// Abre una shell interactiva con PTY. `on_data` recibe los bytes crudos de salida.
pub async fn open(
    profile: &Profile,
    mode: HostKeyMode,
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
) -> Result<SshSession, String> {
    // Reutiliza handshake + auth + verificación de host key.
    let session = connect_authenticated(profile, mode)
        .await
        .map_err(|e| e.to_string())?;

    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    let (mut read, write) = channel.split();

    // Solicita un pseudo-terminal y arranca la shell.
    write
        .request_pty(true, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
        .await
        .map_err(|e| e.to_string())?;
    write
        .request_shell(true)
        .await
        .map_err(|e| e.to_string())?;

    // Tarea lectora: reenvía la salida (stdout/stderr) al frontend como bytes crudos.
    let reader = tauri::async_runtime::spawn(async move {
        while let Some(msg) = read.wait().await {
            match msg {
                ChannelMsg::Data { data } => {
                    let _ = on_data.send(data.to_vec());
                }
                ChannelMsg::ExtendedData { data, .. } => {
                    let _ = on_data.send(data.to_vec());
                }
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
    });

    // Tarea propietaria del write-half y del Handle (lo mantiene vivo).
    let (tx, mut rx) = mpsc::channel::<ShellCmd>(64);
    tauri::async_runtime::spawn(async move {
        let _session = session; // mantener viva la sesión SSH mientras dure la shell
        while let Some(cmd) = rx.recv().await {
            match cmd {
                ShellCmd::Input(bytes) => {
                    let _ = write.data(&bytes[..]).await;
                }
                ShellCmd::Resize(c, r) => {
                    let _ = write.window_change(c as u32, r as u32, 0, 0).await;
                }
                ShellCmd::Close => {
                    let _ = write.eof().await;
                    let _ = write.close().await;
                    break;
                }
            }
        }
    });

    Ok(SshSession { tx, reader })
}
