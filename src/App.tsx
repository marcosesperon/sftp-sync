import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CmdLog,
  Config,
  LogEntry,
  Profile,
  SyncStats,
  WatchState,
  newProfile,
} from "./types";
import "./App.css";

// Resumen legible de los argumentos de un comando, ocultando secretos.
function summarizeArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (k === "profile" && v && typeof v === "object") {
      const p = v as Profile;
      parts.push(`profile="${p.name}" (${p.username}@${p.host}:${p.port})`);
    } else if (k === "config" && v && typeof v === "object") {
      const c = v as Config;
      parts.push(`config(${c.profiles?.length ?? 0} perfiles)`);
    } else if (k === "profileId") {
      parts.push(`profileId=${String(v).slice(0, 8)}…`);
    } else {
      parts.push(`${k}=${JSON.stringify(v)}`);
    }
  }
  return parts.join(", ");
}

// Resumen legible del resultado de un comando.
function summarizeResult(res: unknown): string {
  if (res === null || res === undefined) return "ok";
  if (typeof res === "string") return res;
  if (Array.isArray(res)) return `[${res.length}]`;
  return JSON.stringify(res);
}

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [watching, setWatching] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [cmdLogs, setCmdLogs] = useState<CmdLog[]>([]);
  const [logTab, setLogTab] = useState<"activity" | "commands">("activity");
  const [showAbout, setShowAbout] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const cmdEndRef = useRef<HTMLDivElement>(null);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  // Wrapper de invoke que registra cada comando en el panel de log de comandos.
  async function call<T>(
    command: string,
    args?: Record<string, unknown>
  ): Promise<T> {
    const t0 = performance.now();
    const time = new Date().toLocaleTimeString();
    try {
      const res = await invoke<T>(command, args);
      setCmdLogs((prev) => [
        ...prev.slice(-299),
        {
          time,
          command,
          args: summarizeArgs(args),
          ok: true,
          ms: Math.round(performance.now() - t0),
          detail: summarizeResult(res),
        },
      ]);
      return res;
    } catch (e) {
      setCmdLogs((prev) => [
        ...prev.slice(-299),
        {
          time,
          command,
          args: summarizeArgs(args),
          ok: false,
          ms: Math.round(performance.now() - t0),
          detail: String(e),
        },
      ]);
      throw e;
    }
  }

  // Carga inicial de configuración + estado de watchers.
  useEffect(() => {
    (async () => {
      try {
        const cfg = await call<Config>("load_config");
        setProfiles(cfg.profiles);
        if (cfg.profiles.length > 0) setSelectedId(cfg.profiles[0].id);
        const active = await call<string[]>("list_watching");
        setWatching(new Set(active));
      } catch (e) {
        setStatus(`Error al cargar configuración: ${e}`);
      }
    })();
  }, []);

  // Suscripción a eventos del backend.
  useEffect(() => {
    const unlistenLog = listen<LogEntry>("sftp-log", (ev) => {
      setLogs((prev) => [...prev.slice(-499), ev.payload]);
    });
    const unlistenWatch = listen<WatchState>("sftp-watch-state", (ev) => {
      setWatching((prev) => {
        const next = new Set(prev);
        if (ev.payload.watching) next.add(ev.payload.profileId);
        else next.delete(ev.payload.profileId);
        return next;
      });
    });
    return () => {
      unlistenLog.then((f) => f());
      unlistenWatch.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (logTab === "activity")
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, logTab]);

  useEffect(() => {
    if (logTab === "commands")
      cmdEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [cmdLogs, logTab]);

  function update(patch: Partial<Profile>) {
    if (!selected) return;
    setProfiles((prev) =>
      prev.map((p) => (p.id === selected.id ? { ...p, ...patch } : p))
    );
  }

  function updateAuth(patch: Partial<Extract<Profile["auth"], object>>) {
    if (!selected) return;
    update({ auth: { ...selected.auth, ...patch } as Profile["auth"] });
  }

  async function pickKeyFile() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Selecciona la clave privada",
    });
    if (typeof selected === "string") updateAuth({ privateKeyPath: selected });
  }

  async function pickLocalRoot() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Selecciona la raíz local",
    });
    if (typeof selected === "string") update({ localRoot: selected });
  }

  async function persist(next: Profile[]) {
    setProfiles(next);
    try {
      await call("save_config", { config: { profiles: next } });
    } catch (e) {
      setStatus(`Error al guardar: ${e}`);
    }
  }

  function addProfile() {
    const p = newProfile();
    const next = [...profiles, p];
    setProfiles(next);
    setSelectedId(p.id);
    persist(next);
  }

  function deleteProfile(id: string) {
    const next = profiles.filter((p) => p.id !== id);
    persist(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
  }

  function duplicateProfile(p: Profile) {
    const copy: Profile = {
      ...p,
      id: crypto.randomUUID(),
      name: `${p.name} (copia)`,
      auth: { ...p.auth },
      ignore: [...p.ignore],
    };
    const idx = profiles.findIndex((x) => x.id === p.id);
    const next = [...profiles];
    next.splice(idx + 1, 0, copy);
    setSelectedId(copy.id);
    persist(next);
  }

  async function save() {
    await persist(profiles);
    setStatus("Configuración guardada.");
  }

  async function testConnection() {
    if (!selected) return;
    setStatus("Probando conexión…");
    setTesting(true);
    try {
      const msg = await call<string>("test_connection", { profile: selected });
      setStatus(`✓ ${msg}`);
    } catch (e) {
      setStatus(`✗ ${e}`);
    } finally {
      setTesting(false);
    }
  }

  async function cancelTest() {
    if (!selected) return;
    try {
      await call("cancel_test", { profileId: selected.id });
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
    // El `test_connection` en vuelo se resolverá con error y su `finally`
    // restablecerá `testing`; lo dejamos en manos de ese flujo.
  }

  async function syncNow() {
    if (!selected) return;
    await persist(profiles);
    setStatus("Sincronizando…");
    setSyncing(true);
    try {
      const stats = await call<SyncStats>("sync_now", { profile: selected });
      setStatus(
        `✓ Sincronizado: ${stats.uploaded} subidos, ${stats.deleted} borrados, ${stats.skipped} ignorados, ${stats.errors} errores`
      );
    } catch (e) {
      setStatus(`✗ ${e}`);
    } finally {
      setSyncing(false);
    }
  }

  async function cancelSync() {
    if (!selected) return;
    try {
      await call("cancel_sync", { profileId: selected.id });
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
  }

  async function toggleWatch() {
    if (!selected) return;
    await persist(profiles);
    try {
      if (watching.has(selected.id)) {
        await call("stop_watch", { profileId: selected.id });
        setStatus("Watcher detenido.");
      } else {
        await call("start_watch", { profile: selected });
        setStatus("Watcher iniciado.");
      }
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
  }

  const profileLogs = selected
    ? logs.filter((l) => l.profileId === selected.id)
    : logs;

  // Panel de log (pestañas Actividad / Comandos), reutilizado en la vista de
  // edición y en la vista de monitorización del watcher.
  const logInner = (
    <>
      <div className="log-head tabs">
        <button
          className={`tab ${logTab === "activity" ? "on" : ""}`}
          onClick={() => setLogTab("activity")}
        >
          Actividad
        </button>
        <button
          className={`tab ${logTab === "commands" ? "on" : ""}`}
          onClick={() => setLogTab("commands")}
        >
          Comandos ({cmdLogs.length})
        </button>
        <button
          className="tab clear"
          onClick={() => (logTab === "activity" ? setLogs([]) : setCmdLogs([]))}
          title="Limpiar"
        >
          Limpiar
        </button>
      </div>
      {logTab === "activity" ? (
        <div className="log-body">
          {profileLogs.map((l, i) => (
            <div key={i} className={`logline ${l.level}`}>
              {l.message}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      ) : (
        <div className="log-body">
          {cmdLogs.map((c, i) => (
            <div key={i} className={`logline ${c.ok ? "ok" : "error"}`}>
              <span className="cmd-time">{c.time}</span>{" "}
              <span className="cmd-name">{c.command}</span>
              {c.args && <span className="cmd-args"> ({c.args})</span>}{" "}
              <span className="cmd-arrow">{c.ok ? "✓" : "✗"}</span> {c.detail}
              <span className="cmd-ms"> · {c.ms} ms</span>
            </div>
          ))}
          <div ref={cmdEndRef} />
        </div>
      )}
    </>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span>Perfiles</span>
          <button className="icon-btn" onClick={addProfile} title="Nuevo perfil">
            +
          </button>
        </div>
        <ul className="profile-list">
          {profiles.map((p) => (
            <li
              key={p.id}
              className={p.id === selectedId ? "active" : ""}
              onClick={() => setSelectedId(p.id)}
            >
              <span className={`dot ${watching.has(p.id) ? "on" : ""}`} />
              <span className="pname">{p.name || "(sin nombre)"}</span>
              <button
                className="dup"
                title="Duplicar perfil"
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateProfile(p);
                }}
              >
                ⧉
              </button>
            </li>
          ))}
          {profiles.length === 0 && (
            <li className="empty">No hay perfiles. Pulsa “+”.</li>
          )}
        </ul>
        <div className="sidebar-foot">
          <button className="about-link" onClick={() => setShowAbout(true)}>
            Acerca de
          </button>
          <button
            className="bmc-btn"
            onClick={() => openUrl("https://buymeacoffee.com/marcosesperon")}
            title="Invítame a un café"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
            Buy me a coffee
          </button>
        </div>
      </aside>

      <main className="main">
        {selected ? (
          watching.has(selected.id) ? (
            <div className="watching">
              <div className="watching-head">
                <div className="watching-info">
                  <span className="dot on" />
                  <span className="watching-name">{selected.name}</span>
                  <span className="watching-sub">
                    {selected.username}@{selected.host}:{selected.port} →{" "}
                    {selected.remotePath}
                  </span>
                </div>
                <button className="danger" onClick={toggleWatch}>
                  Detener watcher
                </button>
              </div>
              <div className="log full">{logInner}</div>
            </div>
          ) : (
            <>
              <div className="form">
              <fieldset className="fields" disabled={testing || syncing}>
              <div className="form-row">
                <label>Nombre</label>
                <input
                  value={selected.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </div>
              <div className="grid2">
                <div className="form-row grow">
                  <label>Host</label>
                  <input
                    value={selected.host}
                    placeholder="10.10.10.1"
                    onChange={(e) => update({ host: e.target.value })}
                  />
                </div>
                <div className="form-row port">
                  <label>Puerto</label>
                  <input
                    type="number"
                    value={selected.port}
                    onChange={(e) =>
                      update({ port: parseInt(e.target.value || "22", 10) })
                    }
                  />
                </div>
              </div>
              <div className="form-row">
                <label>Usuario</label>
                <input
                  value={selected.username}
                  placeholder="admin"
                  onChange={(e) => update({ username: e.target.value })}
                />
              </div>

              <div className="form-row">
                <label>Autenticación</label>
                <div className="seg">
                  <button
                    className={selected.auth.type === "key" ? "on" : ""}
                    onClick={() =>
                      update({
                        auth: { type: "key", privateKeyPath: "", passphrase: "" },
                      })
                    }
                  >
                    Clave privada
                  </button>
                  <button
                    className={selected.auth.type === "password" ? "on" : ""}
                    onClick={() => update({ auth: { type: "password", password: "" } })}
                  >
                    Contraseña
                  </button>
                </div>
              </div>

              {selected.auth.type === "key" ? (
                <>
                  <div className="form-row">
                    <label>Ruta de la clave privada</label>
                    <div className="input-with-btn">
                      <input
                        value={selected.auth.privateKeyPath}
                        placeholder="/ruta/clave_validacion.key"
                        onChange={(e) => updateAuth({ privateKeyPath: e.target.value })}
                      />
                      <button className="browse" onClick={pickKeyFile}>
                        Examinar…
                      </button>
                    </div>
                  </div>
                  <div className="form-row">
                    <label>Passphrase (opcional)</label>
                    <input
                      type="password"
                      value={selected.auth.passphrase ?? ""}
                      onChange={(e) => updateAuth({ passphrase: e.target.value })}
                    />
                  </div>
                </>
              ) : (
                <div className="form-row">
                  <label>Contraseña</label>
                  <input
                    type="password"
                    value={selected.auth.password}
                    onChange={(e) => updateAuth({ password: e.target.value })}
                  />
                </div>
              )}

              <div className="grid2">
                <div className="form-row grow">
                  <label>Raíz local</label>
                  <div className="input-with-btn">
                    <input
                      value={selected.localRoot}
                      placeholder="/Users/tú/proyecto"
                      onChange={(e) => update({ localRoot: e.target.value })}
                    />
                    <button className="browse" onClick={pickLocalRoot}>
                      Examinar…
                    </button>
                  </div>
                </div>
                <div className="form-row grow">
                  <label>Ruta remota</label>
                  <input
                    value={selected.remotePath}
                    placeholder="/var/www/"
                    onChange={(e) => update({ remotePath: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <label>Ignorar (un patrón por línea)</label>
                <textarea
                  rows={4}
                  value={selected.ignore.join("\n")}
                  onChange={(e) =>
                    update({
                      ignore: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>

              <div className="checks">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.uploadOnSave}
                    onChange={(e) => update({ uploadOnSave: e.target.checked })}
                  />
                  Subir al guardar (watcher)
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.autoDelete}
                    onChange={(e) => update({ autoDelete: e.target.checked })}
                  />
                  Borrar en remoto al borrar local (ficheros y carpetas)
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.syncEmptyDirs}
                    onChange={(e) => update({ syncEmptyDirs: e.target.checked })}
                  />
                  Sincronizar carpetas vacías
                </label>
                <label title="Al sincronizar, borra del remoto lo que ya no existe en local">
                  <input
                    type="checkbox"
                    checked={selected.mirrorDelete}
                    onChange={(e) => update({ mirrorDelete: e.target.checked })}
                  />
                  Modo espejo (borrar huérfanos en remoto)
                </label>
              </div>

              </fieldset>

              <div className="actions">
                {testing ? (
                  <>
                    <span className="testing-msg">Probando conexión…</span>
                    <button className="danger" onClick={cancelTest}>
                      Cancelar prueba de conexión
                    </button>
                  </>
                ) : syncing ? (
                  <>
                    <span className="testing-msg">Sincronizando…</span>
                    <button className="danger" onClick={cancelSync}>
                      Cancelar sincronización
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={save}>Guardar</button>
                    <button onClick={testConnection}>Probar conexión</button>
                    <button onClick={syncNow}>Sincronizar ahora</button>
                    <button
                      className={watching.has(selected.id) ? "danger" : "primary"}
                      onClick={toggleWatch}
                    >
                      {watching.has(selected.id)
                        ? "Detener watcher"
                        : "Iniciar watcher"}
                    </button>
                    <button
                      className="ghost"
                      onClick={() => deleteProfile(selected.id)}
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>

              <div className="log">{logInner}</div>
            </>
          )
        ) : (
          <div className="placeholder">Crea o selecciona un perfil para empezar.</div>
        )}
      </main>

      <footer className="statusbar">{status}</footer>

      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="about-title">SFTP Sync</h2>
            <p className="about-version">v0.1.0</p>
            <div className="about-author">
              <div className="about-name">Marcos Esperón</div>
              <button
                className="about-row"
                onClick={() => openUrl("https://github.com/marcosesperon")}
              >
                @marcosesperon
              </button>
              <button
                className="about-row"
                onClick={() =>
                  openUrl("https://github.com/marcosesperon/sftp-sync")
                }
              >
                github.com/marcosesperon/sftp-sync
              </button>
            </div>
            <button className="about-close" onClick={() => setShowAbout(false)}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
