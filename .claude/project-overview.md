# sftp-sync — contexto del proyecto

App de escritorio multiplataforma (macOS/Windows/Linux) para **sincronización SFTP**,
alternativa nativa e independiente del editor. **Tauri 2 + React (TS)** en el frontend
y un **núcleo en Rust puro** (sin dependencias nativas en C).

- **Versión:** 0.5.0 (preparada, pendiente de tag). Repo: github.com/marcosesperon/sftp-sync. Licencia: **MIT**.
- **Web (GitHub Pages):** https://marcosesperon.github.io/sftp-sync/ (servida desde `/docs`, ES + `/en/`).
- **v0.5.0:** **conexión SSH** desde el perfil (botón *Conectar por SSH*) en 3 modos (Ajustes → SSH):
  terminal **integrada** (xterm.js + shell `russh` con PTY, **multisesión** con contador/menú y persistente
  al cambiar de pestaña), **terminal del sistema** (iTerm2/Terminal.app, Windows Terminal/cmd, emuladores
  Linux; la contraseña la pide la terminal), y **PuTTY** (solo Windows; `-pwfile` para contraseña, `.ppk`
  por perfil para clave). Además, sonido de error del sistema por perfil al fallar una subida del watcher.
- **v0.4.1:** dedup por hash en el watcher, indicador "Iniciando…" del botón de watcher, y panel de
  Actividad con tamaño alineado a la derecha (sin paréntesis) y ruta truncada con `…`.

## Stack

- **Shell:** Tauri 2 (features `tray-icon`, `image-png`).
- **Frontend:** React 19 + TypeScript + Vite. Gestor: **pnpm**.
- **SSH/SFTP:** `russh` 0.54 + `russh-sftp` 2 (puro Rust; sin libssh2).
- **Terminal integrada:** `@xterm/xterm` + `@xterm/addon-fit` sobre shell `russh` con PTY.
- **Watcher:** `notify` 8 + `notify-debouncer-full`.
- **Globs:** `globset` (ignore + include).
- **Plugins Tauri:** dialog, notification, opener, autostart, single-instance.
- **Async:** tokio.

## Arquitectura

```
docs/                      Landing (GitHub Pages): index.html (ES), en/index.html, styles.css,
                           icon.png, screenshots/*.png
src/                       Frontend React
  types.ts                 Tipos espejo del modelo Rust (Profile, Settings, RemoteEntry, …)
  i18n.ts                  Diccionarios es/en + makeT(lang) + detectLang()
  App.tsx                  UI completa (perfiles con pestañas, monitorización, panel
                           Actividad/Comandos/Explorador/SSH redimensionable, modales Acerca de,
                           Ajustes, host key, renombrar, confirmar borrado; banner de update).
  useSshSession.ts         Hook de terminales SSH integradas (xterm.js): multisesión, attach/fit,
                           hosts siempre montados (visibilidad por CSS) para no perder la sesión
  App.css                  Estilos + temas (claro/oscuro por SO y forzado vía data-theme)
  main.tsx                 Entry point (desactiva el menú contextual del webview)
src-tauri/src/
  config.rs                Profile + Config + persistencia (profiles.json). NotifyMode, putty_ppk_path.
  settings.rs              Settings global (theme, language, dock/tray, autostart watchers,
                           launch_at_login, verify_host_key, check_updates, ssh_mode, putty_path)
  ignore.rs                Compila patrones ignore (gitignore) e include a GlobSet
  sftp.rs                  connect_authenticated (handshake+auth compartido) + verificación de host
                           key (HostKeyMode/ConnectError) + ops SFTP, learn_host_key, human_size
  ssh_shell.rs             Shell SSH interactiva con PTY (tarea propietaria + lectora, Channel<Vec<u8>>)
  system_terminal.rs       Abre SSH en terminal del sistema (macOS/Win/Linux) o PuTTY (Windows)
  sync.rs                  Mapeo local→remoto, sync_all (include/ignore, carpetas vacías, espejo)
  watcher.rs               Watcher notify con debounce, include/ignore, batch de notificaciones,
                           DEDUP POR HASH de contenido (HashMap por sesión; omite idénticos)
  notifications.rs         Notificaciones nativas por modo (off/errors/summary/all) + tope
  events.rs                Eventos a la UI: `sftp-log`, `sftp-watch-state`
  commands.rs              Comandos #[tauri::command], AppState, tray tooltip, host_key_mode,
                           settings, import/export, ops de explorador
  lib.rs                   Builder Tauri: plugins (single-instance PRIMERO), menú nativo macOS +
                           About, bandeja, cerrar-a-bandeja, RunEvent (prevent_exit/Reopen),
                           autostart de watchers al abrir
.github/workflows/release.yml  Releases multi-SO (tauri-action) al pushear tag v*
scripts/changelog.mjs      Extrae notas del CHANGELOG.md para el release
```

### Comandos (invoke) y eventos (listen)
- Comandos: `load_config`, `save_config`, `test_connection`, `cancel_test`, `trust_host_key`,
  `list_remote_dir`, `delete_remote`, `rename_remote`, `upload_files`, `sync_now`, `cancel_sync`,
  `start_watch`, `stop_watch`, `list_watching`, `ssh_open`, `ssh_input`, `ssh_resize`, `ssh_close`,
  `ssh_open_external`, `load_settings`, `save_settings`, `export_config`, `import_config`.
- Eventos: `sftp-log` (actividad por perfil; el frontend le añade hora al recibir),
  `sftp-watch-state` (watcher on/off).
- El frontend envuelve `invoke` en `call()` para registrar cada comando en la pestaña Comandos
  (oculta passphrase/password).

## Funcionalidades implementadas
SFTP (clave/passphrase o contraseña, RSA rsa-sha2), watcher upload-on-save con debounce,
sync completa, prueba de conexión y sync **cancelables**, include/ignore, modo espejo,
carpetas vacías, autoDelete (ficheros y carpetas), notificaciones nativas por modo,
multi-perfil + duplicar, modo monitorización, panel con 3 pestañas (Actividad con hora+tamaño /
Comandos / Explorador), **explorador remoto** (navegar, permisos/fecha/tamaño, menú contextual
renombrar/eliminar, selección múltiple, drag&drop para subir, auto-refresco con el watcher),
**verificación de host key (TOFU + known_hosts propio)**, bandeja + segundo plano + single-instance,
tema claro/oscuro (auto/forzado), i18n es/en, pantalla de ajustes, import/export de perfiles,
**aviso de nuevas versiones** (consulta releases de GitHub), menú contextual del navegador
desactivado y selección de texto solo en campos.

## Decisiones de diseño (acordadas con el usuario)
- **Frontend:** React + TypeScript.
- **Secretos:** credenciales en **claro** en `profiles.json` (keychain pendiente — ver plan).
- **Config:** formato propio, en `app_config_dir` (`profiles.json`, `settings.json`, `known_hosts`).
- **Idioma por defecto:** el del sistema (`navigator.language`); configurable es/en.
- **Bandeja:** Dock visible, cerrar-a-bandeja fijo, single-instance.
- **Auto-iniciar watchers al abrir:** perfiles con "Subir al guardar".
- **Ajustes:** modal.
- **Host key (IMPLEMENTADO):** TOFU con `known_hosts` propio (no toca `~/.ssh`); diálogo con
  huella SHA256 la 1ª vez y alerta si cambia; configurable en Ajustes → Seguridad. La verificación
  ocurre en `check_server_key` (síncrono): si no es de confianza se rechaza con error tipado y la
  UI ofrece confiar (`trust_host_key`) y reintenta.
- **Auth RSA:** `rsa-sha2-512` → `rsa-sha2-256` → `ssh-rsa` (servidores OpenSSH modernos rechazan SHA-1).
- **Actualizaciones:** Vía A (avisar) implementada; Vía B (auto-update con `tauri-plugin-updater`,
  firma minisign gratuita) posible pero con los prompts de "sin firmar" en mac/Win — pendiente.
- **Watcher dedup:** hash del contenido por sesión; omite guardados idénticos (sin log ni subida).
- **@marcosesperon** = perfil en **X** (Twitter); GitHub se enlaza aparte.

## Comandos de desarrollo
```bash
pnpm install
pnpm tauri dev                       # desarrollo (HMR frontend; puerto vite 1420)
pnpm tauri build                     # binario/instalador del SO actual
pnpm exec tsc --noEmit               # typecheck frontend
( cd src-tauri && cargo check )      # typecheck núcleo Rust
pnpm build                           # build de producción frontend
```
Notas: si `tauri dev` deja un Vite huérfano en 1420, matarlo antes de relanzar
(`lsof -ti tcp:1420 | xargs kill`). Las notificaciones macOS solo son fiables en el `.app`
empaquetado. `screencapture` no funciona desde el shell del agente (sin permiso de grabación).

## Flujo de release
- **ANTES de lanzar cada release, limpiar el almacenamiento de Actions** (plan gratuito: 500 MB
  de artifacts/logs + 10 GB de caches). Los builds de release dejan caches de Rust de ~600 MB por SO
  (~1,8 GB en total) que NO se reutilizan en la versión siguiente (la clave cambia con `Cargo.lock`).
  Borrar caches y artifacts caducados para no agotar la cuota:
  ```bash
  for id in $(gh api repos/marcosesperon/sftp-sync/actions/caches --paginate -q '.actions_caches[].id'); do gh api -X DELETE repos/marcosesperon/sftp-sync/actions/caches/$id; done
  for id in $(gh api repos/marcosesperon/sftp-sync/actions/artifacts --paginate -q '.artifacts[].id'); do gh api -X DELETE repos/marcosesperon/sftp-sync/actions/artifacts/$id; done
  ```
  (El contador del billing va con retraso; se promedia y se resetea cada ciclo.)
- Workflow `release.yml` (tauri-action) compila macOS (universal), Windows y Linux al pushear tag `v*`.
  El token de gh necesita scope `workflow`. Notas tomadas de `CHANGELOG.md` vía `scripts/changelog.mjs`.
- Para publicar: añadir sección a `CHANGELOG.md`; subir versión en `package.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (+ `Cargo.lock` vía cargo check) y el "Acerca de"
  de `App.tsx`; `git tag vX.Y.Z && git push origin vX.Y.Z`. El release sale en borrador → publicar
  con `gh release edit vX.Y.Z --draft=false`.
- Si un job falla por **red transitoria** (curl/partial file), reintentar solo el fallido:
  `gh run rerun <run-id> --failed` (no hace falta re-taggear).
- Binarios **sin firmar** (app gratuita, no se asumen certificados de pago).

## Convenciones / preferencias del usuario
- **Commits SIN coautoría de Claude** (NO añadir `Co-Authored-By: Claude`).
- Commitear/push solo cuando el usuario lo pida.
- `Cargo.lock` se versiona; secretos (`*.key`/`*.pem`/`profiles.json`) en `.gitignore`.

## Planes pendientes (en .claude/)
- `plan-keyring.md` — credenciales al keychain del SO.
- `plan-ftp.md` — soporte FTP/FTPS (`suppaftp`).
