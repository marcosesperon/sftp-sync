// Tipos que reflejan el modelo de configuración del core Rust (camelCase).

export type Auth =
  | { type: "key"; privateKeyPath: string; passphrase?: string }
  | { type: "password"; password: string };

export type NotifyMode = "off" | "errors" | "summary" | "all";

export interface Profile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: Auth;
  localRoot: string;
  remotePath: string;
  ignore: string[];
  include: string[];
  uploadOnSave: boolean;
  autoDelete: boolean;
  syncEmptyDirs: boolean;
  mirrorDelete: boolean;
  notify: NotifyMode;
}

export interface Config {
  profiles: Profile[];
}

export interface Settings {
  language: "es" | "en" | null;
  theme: "system" | "light" | "dark";
  showInDock: boolean;
  showTray: boolean;
  autostartWatchers: boolean;
  launchAtLogin: boolean;
}

export interface SyncStats {
  uploaded: number;
  skipped: number;
  deleted: number;
  errors: number;
}

export interface LogEntry {
  profileId: string;
  level: "info" | "ok" | "error";
  message: string;
}

export interface WatchState {
  profileId: string;
  watching: boolean;
}

/// Entrada del explorador de ficheros remoto.
export interface RemoteEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number | null;
  perms: string;
}

/// Entrada del panel de log de comandos (cada invoke al backend).
export interface CmdLog {
  time: string;
  command: string;
  args: string;
  ok: boolean;
  ms: number;
  detail: string;
}

export function newProfile(): Profile {
  return {
    id: crypto.randomUUID(),
    name: "Nuevo perfil",
    host: "",
    port: 22,
    username: "",
    auth: { type: "key", privateKeyPath: "", passphrase: "" },
    localRoot: "",
    remotePath: "/var/www/",
    ignore: [".vscode", ".git", ".DS_Store", ".github/**", ".ci"],
    include: ["**/*"],
    uploadOnSave: true,
    autoDelete: false,
    syncEmptyDirs: false,
    mirrorDelete: false,
    notify: "errors",
  };
}
