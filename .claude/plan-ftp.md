# Plan: soporte FTP/FTPS (`suppaftp`)

Estado: **diseñado, pendiente de implementar.** Objetivo: añadir FTP y FTPS como
protocolos alternativos al SFTP actual.

## Idea

Crate [`suppaftp`](https://crates.io/crates/suppaftp): cliente FTP/FTPS en Rust con
API **async** (encaja con tokio). FTPS necesita backend TLS (`async-native-tls` o
`async-rustls`). Cubre lo necesario: login, `cwd`, `put_file` (STOR), `list`/`mlsd`,
`rm`/`rmdir`, `rename`, `mkdir`. Modo pasivo (PASV) por defecto.

## Reto central: abstraer SFTP vs FTP

Hoy todo usa `SftpConnection` directamente. Hace falta una interfaz común con:
`upload`, `remove_any`, `ensure_dir`, `rename`, `list_dir`, `list_dir_entries`.

**Decisión recomendada:** un **`enum Conn { Sftp(SftpConnection), Ftp(FtpConnection) }`**
con métodos que hacen `match` (sin `async-trait` ni objetos `dyn`, más idiomático).
`sync_all`, `watcher::run` y los comandos pasan a recibir `&Conn`; si los nombres de
método coinciden, el cambio en esos sitios es mínimo.

## Modelo `Profile`

- Nuevo campo **`protocol: "sftp" | "ftp" | "ftps"`** (default `sftp`).
- **Auth:** FTP/FTPS = usuario+contraseña (sin claves). Solo SFTP tiene clave/passphrase
  → la UI oculta la opción de clave si el protocolo no es SFTP.
- **Puerto por defecto** según protocolo: SFTP 22, FTP/FTPS 21 (FTPS explícito).

## Seguridad por protocolo

| Protocolo | Cifrado | Verificación |
|---|---|---|
| SFTP | Sí (SSH) | known_hosts (ya hecho) |
| FTPS | Sí (TLS) | certificado TLS (CA o aceptar autofirmado) |
| FTP | **No** (todo en claro) | — |

- **FTP plano**: credenciales y datos sin cifrar → **avisar** en la UI; desaconsejar
  frente a FTPS/SFTP.
- **FTPS**: explícito (puerto 21 + `AUTH TLS`, lo común) y/o implícito (990). Muchos
  servidores usan **cert autofirmado** → opción **"aceptar certificado no válido"**
  (paralelo al TOFU del host key pero para TLS).

## Explorador sobre FTP

- `MLSD` (si el servidor lo soporta) → datos legibles por máquina (ideal).
- Si no, `LIST` devuelve líneas estilo `ls -l` que hay que parsear (frágil, varía por servidor).
- Degradación: MLSD cuando exista; si no, **solo nombres** (o parseo best-effort).

## Operaciones FTP (mapeo)

- `upload` → `mkdir` recursivo + `put_file` (STOR).
- `remove_any` → `rm` (fichero); carpetas: recursión manual (listar + borrar) + `rmdir`.
- `rename` → `rename`. `ensure_dir` → `mkdir`. `list_*` → `list`/`mlsd`.

## Decisiones (confirmar al implementar)

1. **Alcance:** FTPS + FTP plano (con aviso) — recomendado — o solo FTPS.
2. **FTPS:** explícito (recomendado) y/o implícito.
3. **TLS:** verificar cert por defecto + opción "aceptar autofirmado" (recomendado).
4. **Backend TLS:** `native-tls` (TLS del SO, simple en mac/Win) vs `rustls` (puro Rust,
   coherente con russh). A decidir.
5. **Explorador FTP:** MLSD + fallback a solo nombres.

## Fases

1. **Abstracción** `enum Conn` + refactor de `sync.rs`/`watcher.rs`/`commands.rs` para usarla
   (SFTP intacto por dentro; renombrar usos de `SftpConnection` → `Conn`).
2. **`FtpConnection`** (nuevo módulo) con suppaftp: FTP + FTPS explícito, implementando las
   mismas operaciones que SFTP.
3. **`protocol` en `Profile`** (config.rs) + puertos por defecto + **selector en la UI**
   (App.tsx/types.ts) + auth restringida a contraseña en FTP/FTPS.
4. **Opciones FTPS** (aceptar cert autofirmado, en el perfil o en Ajustes) y avisos de FTP en claro.
5. **Explorador**: MLSD/parseo para FTP en `list_dir_entries`.
6. README (Funcionalidad + tabla de seguridad) + quitar del roadmap.

## Ficheros a tocar (referencia)

- `src-tauri/Cargo.toml` — dep `suppaftp` + features (async + TLS).
- `src-tauri/src/conn.rs` (nuevo) — `enum Conn` y dispatch de operaciones.
- `src-tauri/src/ftp.rs` (nuevo) — `FtpConnection` con suppaftp.
- `src-tauri/src/sftp.rs` — sin cambios internos (lo envuelve `Conn`).
- `src-tauri/src/config.rs` — campo `protocol` + default de puerto.
- `src-tauri/src/commands.rs`, `sync.rs`, `watcher.rs` — usar `Conn` en vez de `SftpConnection`.
- `src/types.ts`, `src/App.tsx` — selector de protocolo, auth condicional, avisos.

## Notas

- Esfuerzo estimado: ~1–2 días (es el mayor de los pendientes).
- Interacción con el plan de **keyring**: la contraseña FTP/FTPS también debería ir al llavero
  cuando se implemente ese plan.
