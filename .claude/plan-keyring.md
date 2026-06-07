# Plan: credenciales en el keychain del SO (`keyring`)

Estado: **diseñado, pendiente de implementar.** Objetivo: dejar de guardar
`passphrase`/`password` en claro en `profiles.json` y moverlos al llavero del SO.

## Idea

Crate [`keyring`](https://crates.io/crates/keyring): abstrae Keychain (macOS),
Administrador de credenciales (Windows) y Secret Service / GNOME Keyring / KWallet
(Linux, vía D-Bus). API: `Entry::new(service, account)` + `set_password` /
`get_password` / `delete_credential`.

## Cambio de arquitectura (clave)

Los secretos **dejan de circular** por el frontend y por el JSON; se resuelven en
el backend desde el llavero al conectar.

- **Persistir sin secreto:** marcar los campos de secreto del `Auth` como
  `#[serde(skip)]` → nunca se escriben en `profiles.json`.
- **Guardar el secreto** en el llavero indexado por el `id` del perfil
  (service = `com.marcosesperon.sftp-sync`, account = `<id>:password` o `<id>:passphrase`).
- **Resolver al conectar:** antes de `SftpConnection::connect`, leer el secreto del
  llavero por id e inyectarlo en el `auth` (solo vive en memoria del backend).
- **Informar a la UI** de si existe secreto (flag `hasSecret` por perfil en `load_config`),
  porque el campo ya no viene relleno.

## Flujo

- **Guardar:** el frontend envía el perfil; si hay secreto nuevo, el backend hace
  `set_secret` y luego guarda el JSON (sin el secreto, por `serde(skip)`).
- **Cargar:** `load_config` devuelve perfiles sin secretos + `hasSecret` por perfil.
- **Conectar / sync / watcher / explorador:** el backend recupera el secreto del llavero.
- **Eliminar perfil:** borrar también su entrada del llavero.

## UX de edición

- Campo de contraseña/passphrase **vacío** con placeholder "•••• (guardado)".
- Vacío = **no cambiar**; escribir = **reemplazar**; botón explícito para **borrar**.
- `canConnect` pasa a comprobar `hasSecret` (o que el usuario haya escrito uno nuevo),
  en vez de `password !== ""`.

## Decisiones (defaults recomendados; confirmar al implementar)

1. **Modo:** keyring por defecto **con fallback a claro** en Linux sin Secret Service
   (más robusto que fallar). Avisar en la UI cuando se use el fallback.
2. **Migración automática** de los secretos en claro existentes al actualizar (sí).
3. **UX:** vacío = mantener + botón borrar.
4. (Opcional) toggle en Ajustes "Guardar credenciales en el llavero" como vía de escape.

## Retos / casos límite

- **Linux sin Secret Service** (headless, sin GNOME Keyring/KWallet+D-Bus): keyring falla
  → fallback a claro con aviso, o error claro. Es la principal arruga.
- **Features de `keyring` 3.x** por plataforma en `Cargo.toml`: `apple-native`,
  `windows-native`, y para Linux `sync-secret-service` (libsecret) o `linux-native`.
- **Import/Export:** el JSON exportado ya no lleva secretos (bueno: seguro de compartir);
  al importar en otra máquina hay que reintroducirlos. Documentar.
- **Alcance:** protege passphrase/password; la **clave privada** sigue siendo un fichero
  en disco referenciado por ruta (fuera del alcance de keyring).

## Fases

1. **Núcleo:** dep `keyring` + features; comandos `set_secret`/`get_secret`/`delete_secret`;
   resolución del secreto en el backend al conectar (`test_connection`, `sync_now`/`run_sync`,
   `watcher::run`, `list_remote_dir`, `delete_remote`/`rename_remote`/`upload_files`).
2. **Modelo:** `#[serde(skip)]` en secretos de `Auth` (config.rs); `load_config` devuelve
   `hasSecret`; borrado del secreto al eliminar perfil; migración de los existentes.
3. **UX:** campo con placeholder/“mantener”, botón borrar, `canConnect` con `hasSecret`.
4. **Fallback Linux** + (opcional) toggle en Ajustes. Actualizar README (Notas de seguridad)
   y quitar el punto del roadmap.

## Ficheros a tocar (referencia)

- `src-tauri/Cargo.toml` — dep + features de keyring.
- `src-tauri/src/config.rs` — `#[serde(skip)]` en passphrase/password.
- `src-tauri/src/secrets.rs` (nuevo) — wrapper de keyring (set/get/delete por perfil).
- `src-tauri/src/commands.rs` — resolver secreto al conectar; `load_config` con `hasSecret`;
  `save_config` extrae secretos al llavero; borrado al eliminar.
- `src/types.ts`, `src/App.tsx` — flag `hasSecret`, UX del campo, `canConnect`.
- `README.md` — Notas de seguridad + roadmap.
