# SFTP Sync

**GUI de escritorio multiplataforma (macOS · Windows · Linux) para sincronización SFTP**, independiente del editor.

Sube ficheros automáticamente al guardar (watcher), respeta patrones `ignore`, soporta múltiples perfiles y autenticación con clave privada o contraseña. Construida con **Tauri 2 + React** y un núcleo en **Rust puro** (sin dependencias nativas en C), lo que produce binarios pequeños y rápidos.

🌐 **Web del proyecto:** [marcosesperon.github.io/sftp-sync](https://marcosesperon.github.io/sftp-sync/) · ⬇️ **[Descargas](https://github.com/marcosesperon/sftp-sync/releases/latest)**

## 📸 Capturas

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/perfil.png" alt="Edición de un perfil" />
      <sub>Edición de un perfil (pestañas Conexión / Sincronización / Notificaciones)</sub>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/explorador.png" alt="Explorador de ficheros remoto" />
      <sub>Explorador remoto con menú contextual y selección múltiple</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/ajustes.png" alt="Pantalla de ajustes" />
      <sub>Ajustes: idioma, tema, ventana/arranque y seguridad</sub>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/actividad.png" alt="Monitorización en segundo plano" />
      <sub>Monitorización en segundo plano con el watcher activo</sub>
    </td>
  </tr>
</table>

---

## 👤 Autor y apoyo al proyecto

Creado y mantenido por **Marcos Esperón** — [@marcosesperon](https://x.com/marcosesperon) en X · perfil de [GitHub](https://github.com/marcosesperon).

Es un proyecto **libre y gratuito**, desarrollado en mi tiempo libre. Si te resulta útil, puedes apoyarlo invitándome a un café:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/marcosesperon)

¿Ideas, dudas o fallos? Abre un [issue](https://github.com/marcosesperon/sftp-sync/issues) en el repositorio.

---

## 🚀 Para el usuario final

Sincroniza una carpeta local con un servidor por SFTP, subiendo los cambios automáticamente al guardar. Sin depender de ningún editor.

### Conexión y autenticación
- **SFTP sobre SSH** mediante [`russh`](https://crates.io/crates/russh) (implementación pura en Rust).
- Autenticación por **clave privada** (con *passphrase* opcional) o por **contraseña**.
- **Compatibilidad RSA moderna**: para claves RSA prueba automáticamente `rsa-sha2-512` → `rsa-sha2-256` → `ssh-rsa`, evitando el típico rechazo de los servidores OpenSSH actuales que ya no aceptan firmas SHA‑1.
- **Prueba de conexión** que autentica y lista la ruta remota; si falla, informa de **qué métodos de autenticación acepta el servidor**.
- **Verificación de la clave del servidor** (host key) con modelo TOFU y `known_hosts` propio; ver [Seguridad](#seguridad).

### Sincronización
- **Subir al guardar (watcher):** vigila la carpeta local de forma recursiva y sube los cambios automáticamente. Usa *debounce* para agrupar la ráfaga de eventos que generan los editores al guardar (escritura temporal + renombrado).
- **Sincronización completa manual** ("Sincronizar ahora"): recorre todo el árbol local y sube lo que no esté ignorado, recreando la estructura de carpetas en el remoto (`mkdir -p`).
- **Conexión SFTP persistente** durante el watcher, con reconexión automática, para que cada subida no pague el coste del *handshake*.
- Ambas operaciones (prueba de conexión y sincronización) son **cancelables** desde la UI: si el servidor tarda o se cuelga, un botón aborta la operación de verdad y restablece la edición.

### Conexión SSH (terminal)
Además de la sincronización, cada perfil ofrece un botón **Conectar por SSH** que reutiliza sus credenciales. El modo se elige en *Ajustes → SSH*:
- **Terminal integrada** (por defecto): abre una sesión SSH interactiva en una **pestaña dentro de la app** (xterm.js + `russh`), con la misma autenticación y verificación de host key del perfil. Admite **varias sesiones simultáneas** —contador en la pestaña y menú para alternar entre ellas, incluso del mismo perfil— y la sesión **sigue viva** al cambiar de pestaña o activar el watcher.
- **Terminal del sistema**: lanza el `ssh` del sistema en la terminal nativa (iTerm2 o Terminal.app en macOS, Windows Terminal/`cmd` en Windows, emuladores comunes en Linux). Con autenticación por contraseña, la pide la propia terminal; usa el `known_hosts` del sistema.
- **PuTTY** (solo Windows): abre PuTTY con autodetección del ejecutable (ruta configurable). Con contraseña se inyecta automáticamente; con clave, se indica una clave **`.ppk`** en el perfil.

### Opciones por perfil
| Opción | Descripción |
|---|---|
| **Subir al guardar** | Activa el watcher (sube los cambios al detectarlos). |
| **Borrar en remoto al borrar local** | Propaga los borrados locales al remoto, **ficheros y carpetas** (rmdir recursivo). |
| **Sincronizar carpetas vacías** | Crea también los directorios sin contenido en el remoto. |
| **Modo espejo** | En la sincronización completa, **borra del remoto** lo que ya no existe en local (o está ignorado). Convierte la subida en un espejo real. |
| **Patrones `include`** | Qué ficheros sincronizar (estilo glob). Por defecto `**/*` (todo). Útil para subir solo ciertos tipos: p. ej. `*.php`, `*.js`. Un patrón sin barra (`*.php`) casa a cualquier profundidad. |
| **Patrones `ignore`** | Lista de patrones a excluir, estilo glob/gitignore (`.git`, `.vscode`, `.DS_Store`, `node_modules/**`, …). Se aplica **después** de `include`. |
| **Notificaciones** | Notificaciones nativas del sistema: `Ninguna` · `Solo errores` · `Resumen` (una por ráfaga del watcher / por sync) · `Todas` (una por acción, con tope anti-spam). |
| **Sonido de error** | Reproduce el sonido de error del sistema si falla una subida con el watcher iniciado. |
| **Clave `.ppk` (PuTTY)** | Ruta a la clave en formato PuTTY, usada solo en el modo de conexión SSH con PuTTY (Windows). |

### Interfaz
- **Gestión de múltiples perfiles** con barra lateral; indicador verde de qué perfiles tienen el watcher activo.
- **Duplicar perfil** con un clic (botón ⧉ al pasar el ratón).
- **Selectores nativos** de fichero (clave privada) y de carpeta (raíz local).
- **Modo monitorización:** cuando el watcher está activo, la pantalla se centra en los logs (nombre del perfil + datos de conexión + botón de detener + paneles a pantalla completa), ocultando la configuración.
- **Panel inferior redimensionable con tres pestañas:**
  - **Actividad** — operaciones del backend (`↑ subido`, `🗑 borrado`, `📁 carpeta`, errores…).
  - **Comandos** — registro de cada llamada al backend con argumentos, resultado y **tiempo en ms** (las contraseñas y *passphrases* nunca se registran).
  - **Explorador** — navegación del árbol remoto vía SFTP: entrar en carpetas, columnas de permisos/fecha/tamaño, **menú contextual** (renombrar/eliminar), **selección múltiple** y **arrastrar ficheros locales** para subirlos.
- **Icono en la bandeja del sistema:** al cerrar la ventana, la app **se minimiza a la bandeja y sigue vigilando en segundo plano**. Clic en el icono (o en el Dock en macOS) reabre la ventana. **Instancia única**.
- **Tema claro/oscuro** automático según el sistema (o forzado), y **multiidioma** (español / inglés).
- **Pantalla de ajustes** con: idioma, tema, mostrar/ocultar en Dock (macOS) y bandeja, iniciar watchers al abrir la app, abrir al iniciar el ordenador, verificación de host key, **modo de conexión SSH** (integrada / terminal del sistema / PuTTY) e **importar/exportar** la configuración de perfiles.
- **Menú contextual del navegador desactivado** (salvo en campos de texto) y **selección de texto** limitada a los campos.

### Descargas

Descarga la última versión desde **[Releases](https://github.com/marcosesperon/sftp-sync/releases/latest)**. Cada release incluye los instaladores para los tres sistemas:

| macOS | Windows | Linux |
|---|---|---|
| `.dmg` (universal: Intel + Apple Silicon) | `.exe` (setup) · `.msi` | `.AppImage` · `.deb` · `.rpm` |

### Instalación (binarios sin firmar)

Los binarios se generan automáticamente y **no están firmados ni notarizados**. La aplicación es segura, pero los sistemas operativos muestran avisos al ser de un desarrollador "no identificado". Así se abren:

**🍎 macOS** — verás *"No se puede abrir porque Apple no puede comprobar…"*:
1. **Clic derecho → Abrir** sobre el `.app` y, en el diálogo, pulsa **Abrir** (solo la primera vez).
2. O en **Ajustes del Sistema → Privacidad y seguridad → "Abrir de todos modos"**.
3. O por terminal: `xattr -dr com.apple.quarantine "/Applications/SFTP Sync.app"`

**🪟 Windows** — **SmartScreen** mostrará *"Windows protegió su PC"*:
1. **"Más información" → "Ejecutar de todas formas"**.
2. Si persiste, **clic derecho en el instalador → Propiedades → "Desbloquear" → Aceptar**.

**🐧 Linux**:
- **AppImage:** `chmod +x SFTP-Sync_*.AppImage` y ejecútalo (requiere FUSE).
- **.deb:** `sudo apt install ./sftp-sync_*.deb`
- **.rpm:** `sudo rpm -i sftp-sync-*.rpm`

> **Nota:** firmar y notarizar (Apple Developer ID / certificado *code signing* de Windows) eliminaría estos avisos, pero requiere **certificados de pago**. Al ser una app **gratuita**, no se puede asumir ese coste, así que los binarios se distribuyen sin firmar.

---

## 🛠️ Parte técnica

### Stack
| Capa | Tecnología |
|---|---|
| Shell de escritorio | [Tauri 2](https://tauri.app) |
| Frontend | React 19 + TypeScript + [Vite](https://vite.dev) |
| SSH / SFTP | [`russh`](https://crates.io/crates/russh) `0.54` · [`russh-sftp`](https://crates.io/crates/russh-sftp) `2` |
| Terminal integrada | [`xterm.js`](https://xtermjs.org) (`@xterm/xterm` + `addon-fit`) sobre una shell `russh` con PTY |
| File watching | [`notify`](https://crates.io/crates/notify) `8` + `notify-debouncer-full` |
| Patrones glob | [`globset`](https://crates.io/crates/globset) |
| Plugins Tauri | dialog · notification · opener · autostart · single-instance |
| Runtime async | `tokio` |

### Requisitos
- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) ≥ 18 y [`pnpm`](https://pnpm.io)
- Dependencias de sistema de Tauri según tu SO: ver [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

### Desarrollo
```bash
pnpm install
pnpm tauri dev      # arranca la app con hot-reload del frontend
```
> En **macOS**, las notificaciones nativas se entregan de forma fiable en la app empaquetada (`.app`); en `pnpm tauri dev` pueden no aparecer. Pruébalas con `pnpm tauri build`.

### Empaquetado
```bash
pnpm tauri build    # genera el binario/instalador para el SO actual
```
Los artefactos quedan en `src-tauri/target/release/bundle/`.

### Comprobaciones
```bash
pnpm exec tsc --noEmit                 # typecheck del frontend
( cd src-tauri && cargo check )        # typecheck del núcleo Rust
pnpm build                             # build de producción del frontend
```

### Configuración

Los perfiles y los ajustes se guardan como JSON en el directorio de configuración de la app:

- **macOS:** `~/Library/Application Support/com.marcosesperon.sftp-sync/`
- **Windows:** `%APPDATA%\com.marcosesperon.sftp-sync\`
- **Linux:** `~/.config/com.marcosesperon.sftp-sync/`

(`profiles.json` para los perfiles, `settings.json` para los ajustes globales y `known_hosts` para las claves de servidor confiadas.) Normalmente no hace falta editarlo a mano, pero este es el formato de un perfil:

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
      "include": ["**/*"],                   // qué sincronizar (**/* = todo; p. ej. ["*.php"])
      "uploadOnSave": true,                  // activar watcher
      "autoDelete": false,                   // propagar borrados (ficheros y carpetas)
      "syncEmptyDirs": false,                // crear carpetas vacías
      "mirrorDelete": false,                 // modo espejo (borrar huérfanos en remoto)
      "notify": "errors"                     // "off" | "errors" | "summary" | "all"
    }
  ]
}
```

### Seguridad

- **Las credenciales se guardan en claro** en `profiles.json` (en el directorio de configuración de la app). No lo subas a ningún repositorio. (Pendiente: moverlas al keychain del SO — ver hoja de ruta.)
- **Verificación de la clave del servidor (host key)** con modelo **TOFU** (*Trust On First Use*), al estilo de OpenSSH:
  - Las claves confiadas se guardan en un `known_hosts` **propio** de la app, sin tocar tu `~/.ssh/known_hosts`.
  - La primera vez que conectas a un host, *Probar conexión* muestra la **huella SHA256** y pide confirmación antes de confiarla.
  - Si la clave **cambia** respecto a la guardada, se muestra una **alerta** (posible suplantación) y hay que confirmar para continuar.
  - Se puede desactivar en *Ajustes → Seguridad* (no recomendado).
  - **Implementación:** `check_server_key` es síncrono en el handshake, así que ante una clave no confiable la conexión se **rechaza** devolviendo un error tipado con la huella; la UI pregunta y, al aceptar, `trust_host_key` guarda la clave (`learn_known_hosts_path`) y se reintenta.

### Arquitectura
```
src/                       Frontend React
  types.ts                 Tipos espejo del modelo Rust
  i18n.ts                  Diccionarios es/en + t()
  App.tsx                  UI: perfiles, edición, monitorización, logs, explorador, ajustes
  useSshSession.ts         Hook de las terminales SSH integradas (xterm.js, multisesión)
  App.css                  Estilos (temas claro/oscuro)
  main.tsx                 Entry point (desactiva el menú contextual)
src-tauri/src/
  config.rs                Modelo de perfiles + persistencia JSON
  settings.rs              Ajustes globales + persistencia
  ignore.rs                Compilación de patrones include/ignore a GlobSet
  sftp.rs                  Conexión russh + verificación de host key + operaciones SFTP
  ssh_shell.rs             Shell SSH interactiva (PTY) para la terminal integrada
  system_terminal.rs       Apertura de SSH en terminal del sistema o PuTTY
  sync.rs                  Mapeo local→remoto, sync completa y modo espejo
  watcher.rs               Watcher notify con debounce, reconexión y manejo de carpetas
  notifications.rs         Notificaciones nativas por modo
  events.rs                Eventos hacia la UI (log de actividad, estado del watcher)
  commands.rs              Comandos #[tauri::command] + estado compartido
  lib.rs                   Wiring del builder de Tauri (plugins, bandeja, menú, arranque)
```

**Comandos** (`invoke`): `load_config`, `save_config`, `test_connection`, `cancel_test`, `trust_host_key`, `list_remote_dir`, `delete_remote`, `rename_remote`, `upload_files`, `sync_now`, `cancel_sync`, `start_watch`, `stop_watch`, `list_watching`, `ssh_open`, `ssh_input`, `ssh_resize`, `ssh_close`, `ssh_open_external`, `load_settings`, `save_settings`, `export_config`, `import_config`.

**Eventos** (`listen`): `sftp-log` (líneas de actividad por perfil) · `sftp-watch-state` (estado del watcher).

### Hoja de ruta
- [ ] Credenciales en el keychain del SO ([`keyring`](https://crates.io/crates/keyring)).
- [ ] Soporte **FTP/FTPS** ([`suppaftp`](https://crates.io/crates/suppaftp)).

---

## 📄 Licencia

Distribuido bajo licencia **MIT**. Consulta el fichero [LICENSE](LICENSE) para más detalles.
