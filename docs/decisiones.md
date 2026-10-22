# Decisiones

Bitácora de decisiones del proyecto **sftp-sync**. Cada petición añade su propio
bloque al final; lo anterior no se reescribe.

## 2026-10-22 — Anclaje de ignore al primer nivel y saltos de línea en Incluir/Ignorar

### 1. La petición tal como se ha entendido
_(pendiente de confirmar)_

Dos cambios en los patrones de sincronización por perfil:

1. **Anclaje al primer nivel** (en *Ignorar* **y** *Incluir*): un patrón que
   empiece por `/` (ej. `/logs`) se ancla a la **raíz local** y casa solo en el
   primer nivel —la carpeta y su contenido—, no a cualquier profundidad. Un
   patrón **sin** barra inicial mantiene el comportamiento actual (casa a
   cualquier nivel). Hoy no es posible porque `expand()` siempre añade la variante
   `**/patrón` y se eliminan las barras iniciales/finales.
   - `/logs` → casa `logs` y `logs/**` (no `src/logs`).
   - `logs` (actual) → casa en cualquier nivel.
2. **Saltos de línea**: en los campos *Incluir* e *Ignorar* no se pueden crear
   líneas nuevas con comodidad porque el `onChange` convierte el texto a lista y
   filtra las vacías en cada pulsación (bug: el Enter "no cuaja"). Se editará
   sobre un buffer de texto libre y se convertirá a lista al salir del campo
   (`onBlur`), aplicando entonces trim y descarte de líneas vacías.

### 2. Preguntas y respuestas

**P1.** El anclaje al primer nivel con sintaxis `/patrón` (barra inicial, estilo
gitignore), ¿debe aplicarse solo al campo **Ignorar** o también al de **Incluir**?
→ **Ignorar e Incluir** (comportamiento coherente en ambos campos).

### 3. Fuentes analizadas
- `src-tauri/src/ignore.rs` (v0.5.1) — `build`, `expand`, `build_include`,
  `is_ignored`, `is_included`. El anclaje se implementaría aquí.
- `src/App.tsx` (v0.5.1) — pestaña Sincronización: `<textarea>` de include/ignore
  (líneas ~1344-1375) con `onChange` que hace `split/trim/filter(Boolean)` →
  causa del bug de saltos de línea; `update()` para persistir el perfil.
- `src/main.tsx` — solo desactiva el menú contextual en no-editables; no bloquea
  el Enter en textareas (descartado como causa).

### 4. Decisiones
- **Anclaje con barra inicial** (`/patrón`) estilo gitignore, en **Ignorar e
  Incluir**. Se detecta la `/` inicial antes de recortar barras; si está anclado,
  `expand()` no genera las variantes `**/…`. *Por qué*: es la convención que ya
  conoce cualquiera que use gitignore, y no rompe los patrones actuales (los que no
  empiezan por `/` siguen casando a cualquier nivel).
- **Edición con buffer de texto + parseo en `onBlur`** para Incluir/Ignorar. *Por
  qué*: el bug venía de convertir texto→lista y filtrar vacías en cada pulsación
  sobre un campo controlado, lo que descartaba el salto de línea al instante.
  Separar el texto que se edita de la lista persistida es el patrón correcto y
  deja escribir líneas (y vacías) con normalidad.
- **Tests unitarios en `ignore.rs`**. *Por qué*: el anclaje es lógica con casos
  límite (anclado/no, con/sin comodín, include/ignore); un test fija el
  comportamiento y evita regresiones.

### 5. Alternativas descartadas
- **Quitar solo el `.filter(Boolean)` del `onChange`** (sin buffer): descartado
  porque el `.trim()` por línea en cada tecla sigue molestando al escribir y el
  campo controlado seguiría reconstruyéndose en cada pulsación. El buffer es más
  limpio y robusto.
- **Parsear al pulsar Guardar en vez de en `onBlur`**: descartado por ser menos
  inmediato; con `onBlur` la lista queda al día en cuanto sales del campo (y el
  click en Guardar ya provoca el blur antes).
- **Cambiar la semántica de los patrones con `/` interno** (p. ej. que `a/b` case
  a cualquier nivel): descartado para no alterar el comportamiento ya existente;
  solo la **barra inicial** cambia algo.

### 6. Pendiente de comprobar
- Prueba manual en `pnpm tauri dev`: `/logs` vs `logs`; escribir varias líneas y
  líneas vacías en Incluir/Ignorar y confirmar que al salir del campo se guardan
  bien y que el watcher respeta el anclaje.
