# SFTP Sync

**GUI de escritorio multiplataforma (macOS · Windows · Linux) para sincronización SFTP**, independiente del editor.

Sube ficheros automáticamente al guardar (watcher), respeta patrones `ignore`, soporta múltiples perfiles y autenticación con clave privada o contraseña. Construida con **Tauri 2 + React** y un núcleo en **Rust puro** (sin dependencias nativas en C), lo que produce binarios pequeños y rápidos.

---

## ✨ Funcionalidad

### Conexión y autenticación
- **SFTP sobre SSH** mediante [`russh`](https://crates.io/crates/russh) (implementación pura en Rust).
- Autenticación por **clave privada** (con *passphrase* opcional) o por **contraseña**.
- **Compatibilidad RSA moderna**: para claves RSA prueba automáticamente `rsa-sha2-512` → `rsa-sha2-256` → `ssh-rsa`, evitando el típico rechazo de los servidores OpenSSH actuales que ya no aceptan firmas SHA‑1.
- **Prueba de conexión** que autentica y lista la ruta remota; si falla, informa de **qué métodos de autenticación acepta el servidor**.

### Sincronización
- **Subir al guardar (watcher):** vigila la carpeta local de forma recursiva y sube los cambios automáticamente. Usa *debounce* para agrupar la ráfaga de eventos que generan los editores al guardar (escritura temporal + renombrado).
- **Sincronización completa manual** ("Sincronizar ahora"): recorre todo el árbol local y sube lo que no esté ignorado, recreando la estructura de carpetas en el remoto (`mkdir -p`).
- **Conexión SFTP persistente** durante el watcher, con reconexión automática, para que cada subida no pague el coste del *handshake*.
- Ambas operaciones (prueba de conexión y sincronización) son **cancelables** desde la UI: si el servidor tarda o se cuelga, un botón aborta la operación de verdad y restablece la edición.

### Opciones por perfil
| Opción | Descripción |
|---|---|
| **Subir al guardar** | Activa el watcher (sube los cambios al detectarlos). |
| **Borrar en remoto al borrar local** | Propaga los borrados locales al remoto, **ficheros y carpetas** (rmdir recursivo). |
| **Sincronizar carpetas vacías** | Crea también los directorios sin contenido en el remoto. |
| **Modo espejo** | En la sincronización completa, **borra del remoto** lo que ya no existe en local (o está ignorado). Convierte la subida en un espejo real. |
| **Patrones `ignore`** | Lista de patrones estilo glob/gitignore (`.git`, `.vscode`, `.DS_Store`, `node_modules/**`, …). |

### Interfaz
- **Gestión de múltiples perfiles** con barra lateral; indicador verde de qué perfiles tienen el watcher activo.
- **Duplicar perfil** con un clic (botón ⧉ al pasar el ratón).
- **Selectores nativos** de fichero (clave privada) y de carpeta (raíz local).
- **Modo monitorización:** cuando el watcher está activo, la pantalla se centra en los logs (nombre del perfil + datos de conexión + botón de detener + paneles a pantalla completa), ocultando la configuración.
- **Panel de log con dos pestañas:**
  - **Actividad** — operaciones del backend (`↑ subido`, `🗑 borrado`, `📁 carpeta`, errores…).
  - **Comandos** — registro de cada llamada al backend con argumentos, resultado y **tiempo en ms** (las contraseñas y *passphrases* nunca se registran).
- **Menú contextual del navegador desactivado** (salvo en campos de texto, para conservar copiar/pegar).

---

## 🧱 Stack técnico

| Capa | Tecnología |
|---|---|
| Shell de escritorio | [Tauri 2](https://tauri.app) |
| Frontend | React 19 + TypeScript + [Vite](https://vite.dev) |
| SSH / SFTP | [`russh`](https://crates.io/crates/russh) `0.54` · [`russh-sftp`](https://crates.io/crates/russh-sftp) `2` |
| File watching | [`notify`](https://crates.io/crates/notify) `8` + `notify-debouncer-full` |
| Patrones `ignore` | [`globset`](https://crates.io/crates/globset) |
| Diálogos nativos | `tauri-plugin-dialog` |
| Runtime async | `tokio` |

---

## 📋 Requisitos

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) ≥ 18 y [`pnpm`](https://pnpm.io)
- Dependencias de sistema de Tauri según tu SO: ver [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

---

## 🚀 Desarrollo

```bash
pnpm install
pnpm tauri dev      # arranca la app con hot-reload del frontend
```

## 📦 Empaquetado

```bash
pnpm tauri build    # genera el binario/instalador para el SO actual
```

Los artefactos quedan en `src-tauri/target/release/bundle/`.

## ✅ Comprobaciones

```bash
pnpm exec tsc --noEmit                 # typecheck del frontend
( cd src-tauri && cargo check )        # typecheck del núcleo Rust
pnpm build                             # build de producción del frontend
```

---

## ⬇️ Instalación (binarios sin firmar)

Los binarios publicados en *Releases* se generan automáticamente y **no están firmados ni notarizados**. La aplicación es segura, pero los sistemas operativos muestran avisos al ser de un desarrollador "no identificado". Así se abren en cada SO:

### 🍎 macOS

Al abrir verás *"No se puede abrir porque Apple no puede comprobar que no contiene software malicioso"*. Tienes tres formas de permitirlo:

1. **Clic derecho → Abrir:** en el `.app` (en Aplicaciones), haz **clic derecho (o Control + clic) → Abrir** y, en el diálogo, pulsa **Abrir**. Solo hace falta la primera vez.
2. **Ajustes del sistema:** tras el primer intento, ve a **Ajustes del Sistema → Privacidad y seguridad** y pulsa **"Abrir de todos modos"**.
3. **Terminal** (quita la marca de cuarentena):
   ```bash
   xattr -dr com.apple.quarantine "/Applications/SFTP Sync.app"
   ```

### 🪟 Windows

Al ejecutar el instalador, **SmartScreen** mostrará *"Windows protegió su PC"*:

1. Pulsa **"Más información"** y luego **"Ejecutar de todas formas"**.
2. Si el aviso persiste, haz **clic derecho sobre el instalador → Propiedades**, marca **"Desbloquear"** abajo y pulsa **Aceptar**.

### 🐧 Linux

Linux no tiene un *gatekeeper* equivalente, pero según el formato:

- **AppImage:** dale permisos de ejecución y lánzalo (requiere FUSE):
  ```bash
  chmod +x SFTP-Sync_*.AppImage
  ./SFTP-Sync_*.AppImage
  ```
- **.deb** (Debian/Ubuntu):
  ```bash
  sudo apt install ./sftp-sync_*.deb
  ```
- **.rpm** (Fedora/openSUSE):
  ```bash
  sudo rpm -i sftp-sync-*.rpm
  ```

> **Solución definitiva:** firmar y notarizar la app (Apple Developer ID en macOS, certificado de *code signing* en Windows) elimina estos avisos. Está en la hoja de ruta y requiere certificados de pago.

---

## ⚙️ Configuración

Los perfiles se guardan como JSON (formato propio) en el directorio de configuración de la app:

- **macOS:** `~/Library/Application Support/com.marcosesperon.sftp-sync/profiles.json`
- **Windows:** `%APPDATA%\com.marcosesperon.sftp-sync\profiles.json`
- **Linux:** `~/.config/com.marcosesperon.sftp-sync/profiles.json`

Normalmente no hace falta editarlo a mano (todo se gestiona desde la UI), pero este es el formato:

```jsonc
{
  "profiles": [
    {
      "id": "uuid-generado",
      "name": "Validación",
      "host": "10.10.10.1",
      "port": 22,
      "username": "admin",
      "auth": {
        "type": "key",                       // "key" | "password"
        "privateKeyPath": "/ruta/clave.key",
        "passphrase": "secreto"              // opcional
        // para contraseña: { "type": "password", "password": "secreto" }
      },
      "localRoot": "/Users/tu/proyecto",     // carpeta local a sincronizar
      "remotePath": "/var/www/",             // carpeta remota destino
      "ignore": [".git", ".vscode", ".DS_Store", ".github/**"],
      "uploadOnSave": true,                  // activar watcher
      "autoDelete": false,                   // propagar borrados (ficheros y carpetas)
      "syncEmptyDirs": false,                // crear carpetas vacías
      "mirrorDelete": false                  // modo espejo (borrar huérfanos en remoto)
    }
  ]
}
```

---

## 🔒 Notas de seguridad

Este proyecto es un **MVP funcional**. Ten en cuenta:

- **Las credenciales se guardan en claro** en `profiles.json`. No lo subas a ningún repositorio.
- **No se verifica el host key** del servidor (equivalente a `StrictHostKeyChecking no`). Aceptable en una red controlada, pero conviene endurecerlo.

Ambos puntos están en la hoja de ruta.

---

## 🏗️ Arquitectura

```
src/                       Frontend React
  types.ts                 Tipos espejo del modelo Rust
  App.tsx                  UI: perfiles, edición, monitorización, logs (invoke + listen)
  App.css                  Estilos
  main.tsx                 Entry point (desactiva el menú contextual)
src-tauri/src/
  config.rs                Modelo de configuración + persistencia JSON
  ignore.rs                Compilación de patrones ignore a GlobSet
  sftp.rs                  Conexión russh + operaciones SFTP (subir, borrar, listar, mkdir)
  sync.rs                  Mapeo de rutas local→remoto, sync completa y modo espejo
  watcher.rs               Watcher notify con debounce, reconexión y manejo de carpetas
  events.rs                Eventos hacia la UI (log de actividad, estado del watcher)
  commands.rs              Comandos #[tauri::command] + estado compartido (watchers, cancelaciones)
  lib.rs                   Wiring del builder de Tauri
```

### Comunicación frontend ↔ backend

**Comandos** (`invoke`): `load_config`, `save_config`, `test_connection`, `cancel_test`, `sync_now`, `cancel_sync`, `start_watch`, `stop_watch`, `list_watching`.

**Eventos** (`listen`):
- `sftp-log` — líneas del log de actividad por perfil.
- `sftp-watch-state` — cambios de estado del watcher (activo/inactivo).

---

## 🗺️ Hoja de ruta

- [ ] Verificación de host key (known_hosts).
- [ ] Credenciales en el keychain del SO ([`keyring`](https://crates.io/crates/keyring)).
- [ ] Soporte **FTP/FTPS** ([`suppaftp`](https://crates.io/crates/suppaftp)).
- [ ] Explorador de ficheros remoto en la UI.
- [ ] Icono en la bandeja del sistema (seguir vigilando con la ventana cerrada).
- [ ] Importar configuración desde un fichero `sftp.json` existente.
- [ ] Firma y notarización de los binarios (Apple Developer ID / Windows code signing).

---

## 👤 Autor

**Marcos Esperón** — [@marcosesperon](https://github.com/marcosesperon)

Repositorio: [github.com/marcosesperon/sftp-sync](https://github.com/marcosesperon/sftp-sync)

---

## ☕ Apoyar el proyecto

Si esta herramienta te resulta útil, puedes invitarme a un café:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/marcosesperon)

---

## 📄 Licencia

Pendiente de definir. Se recomienda [MIT](https://choosealicense.com/licenses/mit/) si se publica como código abierto.
