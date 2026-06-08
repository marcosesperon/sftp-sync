# Changelog

Todas las novedades notables de este proyecto se documentan en este fichero.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

## [0.4.0] - 2026-06-07

### Añadido
- **Aviso de nueva versión** al iniciar: consulta las releases de GitHub y, si hay una más reciente, muestra un banner con enlace de descarga y opción de omitirla. Configurable en *Ajustes → Ventana y arranque*.
- El panel de **Actividad** ahora muestra la **hora** y el **tamaño** de cada fichero subido.

### Proyecto
- Web de presentación bilingüe (español / inglés) publicada con **GitHub Pages**: [marcosesperon.github.io/sftp-sync](https://marcosesperon.github.io/sftp-sync/).

## [0.3.0] - 2026-06-06

### Añadido
- **Verificación de la clave del servidor (host key)** con modelo TOFU y un `known_hosts` propio de la app: diálogo con la huella SHA256 al confiar por primera vez y alerta si la clave cambia. Configurable en Ajustes → Seguridad.
- **Explorador remoto** ampliado: menú contextual para **renombrar** y **eliminar**, **selección múltiple** (Cmd/Ctrl+clic) con borrado en lote, **drag & drop** de ficheros locales para subirlos, y columnas de **permisos** y **fecha de modificación**.
- Secciones del perfil (Conexión / Sincronización / Notificaciones) como **pestañas**.
- **Panel inferior redimensionable** arrastrando su borde superior (altura recordada).

### Cambiado
- Los botones **Probar conexión**, **Sincronizar** y **Watcher** se deshabilitan si faltan los datos necesarios.
- Botón de donación con texto **"Hacer donación"** en español.
- Tamaños de fuente/botones afinados y selección de texto desactivada salvo en campos.
- Las notas de cada release se generan automáticamente desde este `CHANGELOG.md`.

### Corregido
- El watcher no se iniciaba en silencio cuando la raíz local no era válida: ahora avisa con un error claro y permite reintentar.

## [0.2.0] - 2026-06-06

### Añadido
- **Pantalla de ajustes** con: idioma, tema, mostrar/ocultar en Dock (macOS) y bandeja, iniciar watchers al abrir la app, abrir al iniciar el ordenador, e importar/exportar la configuración de perfiles.
- **Internacionalización (es/en)**, con idioma por defecto según el sistema operativo.
- **Tema claro/oscuro** automático según el SO, o forzado desde ajustes.
- **Notificaciones nativas del sistema** por perfil (ninguna / solo errores / resumen / todas), agrupadas por lote del watcher.
- **Icono en la bandeja del sistema**: al cerrar la ventana, la app sigue vigilando en segundo plano. Instancia única.
- **Explorador de ficheros remoto** (pestaña nueva) con navegación, permisos, fecha y tamaño, y auto-refresco al subir cambios el watcher.
- **Patrones de inclusión** por perfil (qué ficheros sincronizar; por defecto `**/*`).
- Opciones de sincronización: **sincronizar carpetas vacías**, **modo espejo** (borrar huérfanos en remoto) y borrado de **carpetas** en remoto.
- **Selectores nativos** de fichero (clave privada) y carpeta (raíz local).
- **Panel de comandos** con tiempos y argumentos (secretos ocultos).
- **Duplicar perfil** y **modo monitorización** a pantalla completa cuando el watcher está activo.
- Prueba de conexión y sincronización **cancelables**.
- Panel "Acerca de" (in-app y nativo de macOS).

### Cambiado
- Formulario de perfil reorganizado en secciones (Conexión / Sincronización / Notificaciones) con cabecera y acciones siempre visibles.

### Corregido
- Autenticación con claves **RSA**: se intenta `rsa-sha2-512/256` antes de `ssh-rsa`, evitando el rechazo de servidores OpenSSH modernos.
- Menú contextual del navegador desactivado (salvo en campos de texto).

## [0.1.0] - 2026-06-06

### Añadido
- Primera versión (MVP): sincronización **SFTP** con autenticación por clave privada (+ passphrase) o contraseña.
- **Watcher** "subir al guardar" con debounce.
- Patrones `ignore`, sincronización completa manual y prueba de conexión.
- Gestión de **múltiples perfiles**.
- Workflow de **releases** automáticas para macOS, Windows y Linux.
