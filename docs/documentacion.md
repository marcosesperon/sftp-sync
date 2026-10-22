# Documentación

Documentación de desarrollo de **sftp-sync**: cómo funcionan las cosas y cómo se usan.

## Patrones de sincronización: Incluir e Ignorar

Cada perfil tiene dos campos de patrones en la pestaña *Sincronización*, uno por línea:

- **Incluir**: qué ficheros se sincronizan. Por defecto `**/*` (todo).
- **Ignorar**: qué ficheros/carpetas se excluyen. Se aplica **después** de Incluir
  (si algo está ignorado, no se sube aunque esté incluido).

Se escriben en estilo *glob/gitignore*, relativos a la **raíz local** del perfil.

### Cómo casan los patrones

- Un patrón **sin barra inicial** casa **a cualquier nivel** del árbol.
  - `logs` → ignora/incluye `logs` esté donde esté: en la raíz, en `src/logs`, etc.
  - En **Ignorar**, un nombre de carpeta arrastra también todo su contenido.
- Un patrón **con barra inicial** (`/`) se **ancla al primer nivel** (la raíz local).
  - `/logs` → solo la carpeta `logs` de la raíz y su contenido; **no** `src/logs`.
- Los comodines habituales funcionan: `*` (cualquier texto sin `/`), `**` (cualquier
  profundidad), `?`, `[...]`.

### Ejemplos

| Quieres… | Pones |
|---|---|
| Ignorar una carpeta en cualquier nivel | `node_modules` |
| Ignorar una carpeta solo en la raíz | `/dist` |
| Ignorar por extensión en cualquier sitio | `*.log` |
| Ignorar `.map` solo dentro de `dist` de la raíz | `/dist/*.map` |
| Incluir solo PHP de cualquier nivel | `*.php` |
| Incluir solo un fichero de la raíz | `/config.php` |

### Detalles de implementación

La lógica está en `src-tauri/src/ignore.rs`:

- `build()` compila los patrones de **Ignorar** y `build_include()` los de **Incluir**
  a un `GlobSet` (crate `globset`).
- El anclaje se detecta por la **barra inicial** antes de recortar barras. Si el
  patrón está anclado, `expand()` **no** añade las variantes `**/…` (las que buscan
  en subdirectorios); si no lo está, sí las añade (comportamiento histórico, estilo
  gitignore).
- Hay tests unitarios (`cargo test --lib ignore`) que cubren anclado vs. no anclado
  en ambos campos.

La edición en la interfaz usa un **buffer de texto libre** por campo: mientras
escribes puedes crear líneas nuevas y vacías con normalidad, y el texto se convierte
a lista de patrones (una por línea, sin espacios ni líneas vacías) al **salir del
campo** (`onBlur`). El helper es `parse_lineas()` en `src/App.tsx`.
