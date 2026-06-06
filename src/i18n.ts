// Sistema de internacionalización (es/en).

export type Lang = "es" | "en";

type Dict = Record<string, string>;

const es: Dict = {
  // Sidebar
  "sidebar.profiles": "Perfiles",
  "sidebar.newProfile": "Nuevo perfil",
  "sidebar.unnamed": "(sin nombre)",
  "sidebar.empty": "No hay perfiles. Pulsa “+”.",
  "sidebar.duplicate": "Duplicar perfil",
  "sidebar.about": "Acerca de",
  "sidebar.settings": "Ajustes",
  "bmc.title": "Invítame a un café",
  // Watcher
  "watch.stop": "Detener watcher",
  "watch.start": "Iniciar watcher",
  // Campos
  "field.profileName": "Nombre del perfil",
  "section.connection": "Datos de conexión",
  "section.sync": "Modo de sincronización",
  "section.notifications": "Notificaciones",
  "field.host": "Host",
  "field.port": "Puerto",
  "field.username": "Usuario",
  "field.auth": "Autenticación",
  "auth.key": "Clave privada",
  "auth.password": "Contraseña",
  "field.keyPath": "Ruta de la clave privada",
  "btn.browse": "Examinar…",
  "field.passphrase": "Passphrase (opcional)",
  "field.password": "Contraseña",
  "field.localRoot": "Raíz local",
  "field.remotePath": "Ruta remota",
  "field.include": "Incluir (un patrón por línea · por defecto **/* = todo)",
  "field.ignore": "Ignorar (un patrón por línea)",
  "check.uploadOnSave": "Subir al guardar (watcher)",
  "check.autoDelete": "Borrar en remoto al borrar local (ficheros y carpetas)",
  "check.syncEmptyDirs": "Sincronizar carpetas vacías",
  "check.mirror": "Modo espejo (borrar huérfanos en remoto)",
  "check.mirror.title": "Al sincronizar, borra del remoto lo que ya no existe en local",
  "notify.off": "Ninguna",
  "notify.errors": "Solo errores",
  "notify.summary": "Resumen",
  "notify.all": "Todas",
  // Acciones
  "action.testing": "Probando conexión…",
  "action.cancelTest": "Cancelar prueba de conexión",
  "action.syncing": "Sincronizando…",
  "action.cancelSync": "Cancelar sincronización",
  "action.save": "Guardar",
  "action.test": "Probar conexión",
  "action.syncNow": "Sincronizar ahora",
  "action.delete": "Eliminar",
  // Panel de log
  "log.activity": "Actividad",
  "log.commands": "Comandos",
  "log.explorer": "Explorador",
  "log.refresh": "Actualizar",
  "log.clear": "Limpiar",
  "explorer.up": "Subir un nivel",
  "explorer.loading": "Cargando…",
  "explorer.empty": "(carpeta vacía)",
  "explorer.openFolder": "Abrir carpeta",
  "col.name": "Nombre",
  "col.perms": "Permisos",
  "col.modified": "Modificado",
  "col.size": "Tamaño",
  "placeholder.select": "Crea o selecciona un perfil para empezar.",
  // Diálogos
  "dialog.pickKey": "Selecciona la clave privada",
  "dialog.pickLocal": "Selecciona la raíz local",
  // Estado
  "status.loadError": "Error al cargar configuración: {e}",
  "status.saveError": "Error al guardar: {e}",
  "status.saved": "Configuración guardada.",
  "status.synced":
    "✓ Sincronizado: {up} subidos, {del} borrados, {skip} ignorados, {err} errores",
  "status.watchStarted": "Watcher iniciado.",
  "status.watchStopped": "Watcher detenido.",
  "status.notifBlocked": "Notificaciones bloqueadas en los ajustes del sistema",
  "status.notifPermError": "No se pudo solicitar permiso de notificaciones: {e}",
  "status.exported": "Configuración exportada.",
  "status.imported": "Configuración importada.",
  "profile.copySuffix": "(copia)",
  // Acerca de
  "about.close": "Cerrar",
  // Ajustes
  "settings.title": "Ajustes",
  "settings.appearance": "Apariencia",
  "settings.language": "Idioma",
  "settings.theme": "Tema",
  "theme.system": "Sistema",
  "theme.light": "Claro",
  "theme.dark": "Oscuro",
  "settings.window": "Ventana y arranque",
  "settings.showInDock": "Mostrar en el Dock (macOS)",
  "settings.showTray": "Mostrar en la bandeja del sistema",
  "settings.autostartWatchers":
    "Iniciar watchers al abrir la app (perfiles con “Subir al guardar”)",
  "settings.launchAtLogin": "Abrir al iniciar el ordenador",
  "settings.profilesSection": "Perfiles",
  "settings.export": "Exportar configuración…",
  "settings.import": "Importar configuración…",
  "settings.importWarn": "Importar reemplaza todos los perfiles actuales.",
};

const en: Dict = {
  "sidebar.profiles": "Profiles",
  "sidebar.newProfile": "New profile",
  "sidebar.unnamed": "(unnamed)",
  "sidebar.empty": "No profiles. Click “+”.",
  "sidebar.duplicate": "Duplicate profile",
  "sidebar.about": "About",
  "sidebar.settings": "Settings",
  "bmc.title": "Buy me a coffee",
  "watch.stop": "Stop watcher",
  "watch.start": "Start watcher",
  "field.profileName": "Profile name",
  "section.connection": "Connection",
  "section.sync": "Sync mode",
  "section.notifications": "Notifications",
  "field.host": "Host",
  "field.port": "Port",
  "field.username": "Username",
  "field.auth": "Authentication",
  "auth.key": "Private key",
  "auth.password": "Password",
  "field.keyPath": "Private key path",
  "btn.browse": "Browse…",
  "field.passphrase": "Passphrase (optional)",
  "field.password": "Password",
  "field.localRoot": "Local root",
  "field.remotePath": "Remote path",
  "field.include": "Include (one pattern per line · default **/* = everything)",
  "field.ignore": "Ignore (one pattern per line)",
  "check.uploadOnSave": "Upload on save (watcher)",
  "check.autoDelete": "Delete on remote when deleted locally (files and folders)",
  "check.syncEmptyDirs": "Sync empty folders",
  "check.mirror": "Mirror mode (delete orphans on remote)",
  "check.mirror.title": "On sync, deletes from remote what no longer exists locally",
  "notify.off": "None",
  "notify.errors": "Errors only",
  "notify.summary": "Summary",
  "notify.all": "All",
  "action.testing": "Testing connection…",
  "action.cancelTest": "Cancel connection test",
  "action.syncing": "Syncing…",
  "action.cancelSync": "Cancel sync",
  "action.save": "Save",
  "action.test": "Test connection",
  "action.syncNow": "Sync now",
  "action.delete": "Delete",
  "log.activity": "Activity",
  "log.commands": "Commands",
  "log.explorer": "Explorer",
  "log.refresh": "Refresh",
  "log.clear": "Clear",
  "explorer.up": "Up one level",
  "explorer.loading": "Loading…",
  "explorer.empty": "(empty folder)",
  "explorer.openFolder": "Open folder",
  "col.name": "Name",
  "col.perms": "Permissions",
  "col.modified": "Modified",
  "col.size": "Size",
  "placeholder.select": "Create or select a profile to start.",
  "dialog.pickKey": "Select the private key",
  "dialog.pickLocal": "Select the local root",
  "status.loadError": "Error loading configuration: {e}",
  "status.saveError": "Error saving: {e}",
  "status.saved": "Configuration saved.",
  "status.synced":
    "✓ Synced: {up} uploaded, {del} deleted, {skip} skipped, {err} errors",
  "status.watchStarted": "Watcher started.",
  "status.watchStopped": "Watcher stopped.",
  "status.notifBlocked": "Notifications blocked in system settings",
  "status.notifPermError": "Could not request notification permission: {e}",
  "status.exported": "Configuration exported.",
  "status.imported": "Configuration imported.",
  "profile.copySuffix": "(copy)",
  "about.close": "Close",
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.language": "Language",
  "settings.theme": "Theme",
  "theme.system": "System",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "settings.window": "Window & startup",
  "settings.showInDock": "Show in Dock (macOS)",
  "settings.showTray": "Show in system tray",
  "settings.autostartWatchers":
    "Start watchers on app launch (profiles with “Upload on save”)",
  "settings.launchAtLogin": "Launch at computer startup",
  "settings.profilesSection": "Profiles",
  "settings.export": "Export configuration…",
  "settings.import": "Import configuration…",
  "settings.importWarn": "Importing replaces all current profiles.",
};

const dicts: Record<Lang, Dict> = { es, en };

/// Detecta el idioma del sistema (es si empieza por "es", si no en).
export function detectLang(): Lang {
  const l = (navigator.language || "es").toLowerCase();
  return l.startsWith("es") ? "es" : "en";
}

/// Crea una función de traducción `t(key, vars?)` para el idioma dado.
export function makeT(lang: Lang) {
  const d = dicts[lang] || es;
  return (key: string, vars?: Record<string, string | number>): string => {
    let s = d[key] ?? es[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(`{${k}}`, String(v));
      }
    }
    return s;
  };
}
