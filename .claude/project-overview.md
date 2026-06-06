# sftp-sync — contexto del proyecto

App de escritorio multiplataforma (macOS/Windows/Linux) para **sincronización SFTP**,
alternativa nativa e independiente del editor. **Tauri 2 + React (TS)** en el frontend
y un **núcleo en Rust puro** (sin dependencias nativas en C).

Versión actual: **0.2.0**. Repo: github.com/marcosesperon/sftp-sync. Licencia: **MIT**.

## Stack

- **Shell:** Tauri 2 (features `tray-icon`, `image-png`).
- **Frontend:** React 19 + TypeScript + Vite. Gestor: **pnpm**.
- **SSH/SFTP:** `russh` 0.54 + `russh-sftp` 2 (puro Rust; sin libssh2).
- **Watcher:** `notify` 8 + `notify-debouncer-full`.
- **Globs:** `globset` (ignore + include).
- **Plugins Tauri:** dialog, notification, opener, autostart, single-instance.
- **Async:** tokio.

## Arquitectura

```
src/                       Frontend React
  types.ts                 Tipos espejo del modelo Rust (Profile, Settings, RemoteEntry, …)
  i18n.ts                  Diccionarios es/en + makeT(lang) + detectLang()
  App.tsx                  UI completa (perfiles, edición por secciones, monitorización,
                           panel de log con pestañas Actividad/Comandos/Explorador,
                           modales Acerca de y Ajustes). Todas las cadenas pasan por t().
  App.css                  Estilos + temas (claro/oscuro por SO y forzado vía data-theme)
  main.tsx                 Entry point (desactiva el menú contextual del webview)
src-tauri/src/
  config.rs                Profile + Config + persistencia (profiles.json). NotifyMode.
  settings.rs              Settings global + persistencia (settings.json)
  ignore.rs                Compila patrones ignore (estilo gitignore) e include a GlobSet
  sftp.rs                  Conexión russh + ops SFTP (upload, remove_any, mkdir_p,
                           remove_dir_all, list_dir_entries con perms/mtime) + format_permissions
  sync.rs                  Mapeo local→remoto, sync_all (include/ignore, carpetas vacías, espejo)
  watcher.rs               Watcher notify con debounce, include/ignore, batch de notificaciones
  notifications.rs         Notificaciones nativas por modo (off/errors/summary/all) + tope anti-spam
  events.rs                Eventos a la UI: `sftp-log`, `sftp-watch-state`
  commands.rs              Comandos #[tauri::command], AppState (watchers + cancels), tray tooltip,
                           import/export, settings (load/save/apply_settings)
  lib.rs                   Builder Tauri: plugins (single-instance PRIMERO), menú nativo macOS +
                           About metadata, bandeja, cerrar-a-bandeja, RunEvent (prevent_exit/Reopen),
                           autostart de watchers al abrir
```

### Comandos (invoke) y eventos (listen)
- Comandos: `load_config`, `save_config`, `test_connection`, `cancel_test`, `list_remote_dir`,
  `sync_now`, `cancel_sync`, `start_watch`, `stop_watch`, `list_watching`,
  `load_settings`, `save_settings`, `export_config`, `import_config`.
- Eventos: `sftp-log` (líneas de actividad por perfil), `sftp-watch-state` (watcher on/off).
- El frontend envuelve `invoke` en `call()` para registrar cada comando en la pestaña Comandos
  (oculta passphrase/password).

## Decisiones de diseño (acordadas con el usuario)

- **Frontend:** React + TypeScript.
- **Secretos:** credenciales en **claro** en `profiles.json` (no keychain todavía).
- **Config:** formato propio (no se lee el `sftp.json` de otras herramientas), en `app_config_dir`.
- **Idioma por defecto:** el del sistema (`navigator.language`); configurable es/en.
- **Bandeja:** Dock visible, cerrar-a-bandeja fijo, single-instance.
- **Auto-iniciar watchers al abrir:** los perfiles con "Subir al guardar" activado.
- **Pantalla de ajustes:** modal.
- **Host key:** se acepta cualquiera (sin known_hosts) — pendiente de endurecer.
- **Auth RSA:** probar `rsa-sha2-512` → `rsa-sha2-256` → `ssh-rsa` (servidores OpenSSH modernos
  rechazan SHA-1). Fue la causa de "autenticación rechazada" con claves válidas.

## Comandos de desarrollo

```bash
pnpm install
pnpm tauri dev                       # desarrollo (HMR frontend; puerto vite 1420)
pnpm tauri build                     # binario/instalador del SO actual
pnpm exec tsc --noEmit               # typecheck frontend
( cd src-tauri && cargo check )      # typecheck núcleo Rust
pnpm build                           # build de producción frontend
```
Nota: si el `tauri dev` deja un Vite huérfano en el 1420, matarlo antes de relanzar
(`lsof -ti tcp:1420 | xargs kill`). Las notificaciones macOS solo son fiables en el `.app`
empaquetado, no siempre en `tauri dev`.

## Flujo de release

- Workflow `.github/workflows/release.yml` (tauri-action) compila macOS (universal), Windows y Linux
  al hacer push de un tag `v*`. Necesita scope `workflow` en el token de gh.
- Las notas del release se extraen de `CHANGELOG.md` con `scripts/changelog.mjs`.
- Para publicar versión: añadir sección a `CHANGELOG.md`, subir versión en
  `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (+ `Cargo.lock` vía cargo check)
  y el "Acerca de" de `App.tsx`; luego `git tag vX.Y.Z && git push origin vX.Y.Z`.
- Binarios **sin firmar** (app gratuita, no se asumen certificados de pago).

## Convenciones / preferencias del usuario

- **Commits sin coautoría de Claude** (NO añadir `Co-Authored-By: Claude`).
- Commitear/push solo cuando el usuario lo pida.
- `Cargo.lock` se versiona; secretos y `*.key`/`*.pem`/`profiles.json` están en `.gitignore`.
