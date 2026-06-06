// Tipos que reflejan el modelo de configuración del core Rust (camelCase).

export type Auth =
  | { type: "key"; privateKeyPath: string; passphrase?: string }
  | { type: "password"; password: string };

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
  uploadOnSave: boolean;
  autoDelete: boolean;
  syncEmptyDirs: boolean;
  mirrorDelete: boolean;
}

export interface Config {
  profiles: Profile[];
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
    uploadOnSave: true,
    autoDelete: false,
    syncEmptyDirs: false,
    mirrorDelete: false,
  };
}
