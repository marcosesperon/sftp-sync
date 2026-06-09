import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import {
  CmdLog,
  Config,
  LogEntry,
  NotifyMode,
  Profile,
  RemoteEntry,
  Settings,
  SyncStats,
  WatchState,
  newProfile,
} from "./types";
import { detectLang, Lang, makeT } from "./i18n";
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
      parts.push(`config(${c.profiles?.length ?? 0})`);
    } else if (k === "profileId") {
      parts.push(`profileId=${String(v).slice(0, 8)}…`);
    } else {
      parts.push(`${k}=${JSON.stringify(v)}`);
    }
  }
  return parts.join(", ");
}

// Tamaño de fichero legible.
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// Fecha de modificación compacta (a partir de segundos Unix).
function formatDate(mtime: number | null): string {
  if (!mtime) return "—";
  const d = new Date(mtime * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

// Separa de un mensaje de actividad el tamaño final "(12.1 KB)" si lo hay,
// para mostrarlo en una columna a la derecha y sin paréntesis.
const SIZE_RE = /^(.*?)\s*\((\d[\d.,]*\s?(?:B|KB|MB|GB))\)\s*$/;
function splitLogMessage(message: string): { body: string; size: string } {
  const m = message.match(SIZE_RE);
  if (m) return { body: m[1], size: m[2] };
  return { body: message, size: "" };
}

// Resumen legible del resultado de un comando.
function summarizeResult(res: unknown): string {
  if (res === null || res === undefined) return "ok";
  if (typeof res === "string") return res;
  if (Array.isArray(res)) return `[${res.length}]`;
  return JSON.stringify(res);
}

const DEFAULT_SETTINGS: Settings = {
  language: null,
  theme: "system",
  showInDock: true,
  showTray: true,
  autostartWatchers: false,
  launchAtLogin: false,
  verifyHostKey: true,
  checkUpdates: true,
};

const REPO = "marcosesperon/sftp-sync";

// Compara versiones semver simples: ¿`a` es más nueva que `b`?
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Aplica el tema visual a la ventana y al documento.
async function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  try {
    await getCurrentWindow().setTheme(theme === "system" ? null : theme);
  } catch {
    /* ignore */
  }
  if (theme === "system") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "light dark";
  } else {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
  }
}

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [watching, setWatching] = useState<Set<string>>(new Set());
  const [startingWatch, setStartingWatch] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [cmdLogs, setCmdLogs] = useState<CmdLog[]>([]);
  const [logTab, setLogTab] = useState<"activity" | "commands" | "explorer">(
    "activity"
  );
  const [editTab, setEditTab] = useState<
    "connection" | "sync" | "notifications"
  >("connection");
  const [showAbout, setShowAbout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hostKeyPrompt, setHostKeyPrompt] = useState<{
    fingerprint: string;
    changed: boolean;
  } | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
    url: string;
  } | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [explorerPath, setExplorerPath] = useState<string>("");
  const [explorerEntries, setExplorerEntries] = useState<RemoteEntry[]>([]);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerError, setExplorerError] = useState<string>("");
  const [explorerLoadedId, setExplorerLoadedId] = useState<string | null>(null);
  const [explorerSel, setExplorerSel] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameName, setRenameName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [logHeight, setLogHeight] = useState<number>(() => {
    const v = Number(localStorage.getItem("logHeight"));
    return v >= 140 ? v : 280;
  });

  const lang: Lang = (settings.language as Lang) || detectLang();
  const t = makeT(lang);

  // Refs para que el listener de eventos (registrado una vez) lea el estado actual.
  const logTabRef = useRef(logTab);
  logTabRef.current = logTab;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const explorerPathRef = useRef(explorerPath);
  explorerPathRef.current = explorerPath;
  const loadExplorerRef = useRef<(p: string) => void>(() => {});
  loadExplorerRef.current = loadExplorer;
  const selectedProfileRef = useRef<Profile | null>(null);
  const uploadDroppedRef = useRef<(paths: string[]) => void>(() => {});
  const explorerRefreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const logEndRef = useRef<HTMLDivElement>(null);
  const cmdEndRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  selectedProfileRef.current = selected;

  // Habilitado de acciones según los datos cumplimentados.
  const authOk =
    !!selected &&
    (selected.auth.type === "key"
      ? selected.auth.privateKeyPath.trim() !== ""
      : selected.auth.password !== "");
  const canConnect =
    !!selected &&
    selected.host.trim() !== "" &&
    selected.username.trim() !== "" &&
    authOk;
  const canSync =
    canConnect &&
    !!selected &&
    selected.localRoot.trim() !== "" &&
    selected.remotePath.trim() !== "";

  // Arrastrar el borde superior del panel inferior para redimensionarlo.
  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    const el = logRef.current;
    if (!el) return;
    const bottom = el.getBoundingClientRect().bottom;
    const onMove = (ev: MouseEvent) => {
      const h = Math.min(
        Math.max(bottom - ev.clientY, 140),
        window.innerHeight - 200
      );
      setLogHeight(h);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Wrapper de invoke que registra cada comando en el panel de comandos.
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

  // Carga inicial de configuración + ajustes + estado de watchers.
  useEffect(() => {
    (async () => {
      try {
        const cfg = await call<Config>("load_config");
        setProfiles(cfg.profiles);
        if (cfg.profiles.length > 0) setSelectedId(cfg.profiles[0].id);
        const active = await call<string[]>("list_watching");
        setWatching(new Set(active));
      } catch (e) {
        setStatus(t("status.loadError", { e: String(e) }));
      }
      try {
        const s = await call<Settings>("load_settings");
        setSettings(s);
        applyTheme(s.theme);
        if (s.checkUpdates !== false) checkForUpdates();
      } catch {
        applyTheme("system");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suscripción a eventos del backend.
  useEffect(() => {
    const unlistenLog = listen<LogEntry>("sftp-log", (ev) => {
      const entry = { ...ev.payload, time: new Date().toLocaleTimeString() };
      setLogs((prev) => [...prev.slice(-499), entry]);
      if (
        logTabRef.current === "explorer" &&
        ev.payload.level === "ok" &&
        ev.payload.profileId === selectedIdRef.current
      ) {
        clearTimeout(explorerRefreshTimer.current);
        explorerRefreshTimer.current = setTimeout(() => {
          if (explorerPathRef.current)
            loadExplorerRef.current(explorerPathRef.current);
        }, 800);
      }
    });
    const unlistenWatch = listen<WatchState>("sftp-watch-state", (ev) => {
      setWatching((prev) => {
        const next = new Set(prev);
        if (ev.payload.watching) next.add(ev.payload.profileId);
        else next.delete(ev.payload.profileId);
        return next;
      });
      // El watcher ya respondió (activo o no): deja de estar "iniciando".
      setStartingWatch((prev) => {
        if (!prev.has(ev.payload.profileId)) return prev;
        const next = new Set(prev);
        next.delete(ev.payload.profileId);
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

  useEffect(() => {
    if (logTab === "explorer" && selected && explorerLoadedId !== selected.id) {
      loadExplorer(selected.remotePath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logTab, selectedId]);

  useEffect(() => {
    localStorage.setItem("logHeight", String(logHeight));
  }, [logHeight]);

  // Drag & drop de ficheros locales sobre el explorador → subir.
  useEffect(() => {
    const un = getCurrentWindow().onDragDropEvent((ev) => {
      const p = ev.payload;
      if (logTabRef.current !== "explorer") {
        setDragOver(false);
        return;
      }
      if (p.type === "drop") {
        setDragOver(false);
        uploadDroppedRef.current(p.paths);
      } else if (p.type === "leave") {
        setDragOver(false);
      } else {
        setDragOver(true); // enter / over
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

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

  async function setNotifyMode(mode: NotifyMode) {
    update({ notify: mode });
    if (mode !== "off") {
      try {
        let ok = await isPermissionGranted();
        if (!ok) ok = (await requestPermission()) === "granted";
        if (!ok) setStatus(t("status.notifBlocked"));
      } catch (e) {
        setStatus(t("status.notifPermError", { e: String(e) }));
      }
    }
  }

  async function pickKeyFile() {
    const sel = await open({
      multiple: false,
      directory: false,
      title: t("dialog.pickKey"),
    });
    if (typeof sel === "string") updateAuth({ privateKeyPath: sel });
  }

  async function pickLocalRoot() {
    const sel = await open({
      directory: true,
      multiple: false,
      title: t("dialog.pickLocal"),
    });
    if (typeof sel === "string") update({ localRoot: sel });
  }

  async function persist(next: Profile[]) {
    setProfiles(next);
    try {
      await call("save_config", { config: { profiles: next } });
    } catch (e) {
      setStatus(t("status.saveError", { e: String(e) }));
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
      name: `${p.name} ${t("profile.copySuffix")}`,
      auth: { ...p.auth },
      ignore: [...p.ignore],
      include: [...(p.include ?? [])],
    };
    const idx = profiles.findIndex((x) => x.id === p.id);
    const next = [...profiles];
    next.splice(idx + 1, 0, copy);
    setSelectedId(copy.id);
    persist(next);
  }

  async function save() {
    await persist(profiles);
    setStatus(t("status.saved"));
  }

  async function testConnection() {
    if (!selected) return;
    setStatus(t("action.testing"));
    setTesting(true);
    try {
      const res = await call<{
        status: "ok" | "hostKey";
        message?: string;
        fingerprint?: string;
        changed?: boolean;
      }>("test_connection", { profile: selected });
      if (res.status === "ok") {
        setStatus(`✓ ${res.message}`);
      } else {
        setHostKeyPrompt({
          fingerprint: res.fingerprint ?? "",
          changed: !!res.changed,
        });
        setStatus("");
      }
    } catch (e) {
      setStatus(`✗ ${e}`);
    } finally {
      setTesting(false);
    }
  }

  async function trustHostKey() {
    if (!selected) return;
    setHostKeyPrompt(null);
    try {
      await call("trust_host_key", { profile: selected });
      setStatus(t("hostkey.trusted"));
      testConnection(); // reintenta: ahora la clave ya está confiada
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
  }

  async function cancelTest() {
    if (!selected) return;
    try {
      await call("cancel_test", { profileId: selected.id });
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
  }

  async function syncNow() {
    if (!selected) return;
    await persist(profiles);
    setStatus(t("action.syncing"));
    setSyncing(true);
    try {
      const stats = await call<SyncStats>("sync_now", { profile: selected });
      setStatus(
        t("status.synced", {
          up: stats.uploaded,
          del: stats.deleted,
          skip: stats.skipped,
          err: stats.errors,
        })
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

  async function loadExplorer(path: string) {
    if (!selected) return;
    setExplorerLoadedId(selected.id);
    setExplorerPath(path);
    setExplorerSel(new Set());
    setCtxMenu(null);
    setExplorerLoading(true);
    setExplorerError("");
    try {
      const entries = await call<RemoteEntry[]>("list_remote_dir", {
        profile: selected,
        path,
      });
      entries.sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
      );
      setExplorerEntries(entries);
    } catch (e) {
      setExplorerEntries([]);
      setExplorerError(String(e));
    } finally {
      setExplorerLoading(false);
    }
  }

  function explorerUp() {
    if (!explorerPath || explorerPath === "/") return;
    const parent =
      explorerPath.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
    loadExplorer(parent);
  }

  function explorerEnter(name: string) {
    loadExplorer(joinRemote(name));
  }

  function joinRemote(name: string) {
    const base = (explorerPath || "/").replace(/\/+$/, "");
    return base === "" ? `/${name}` : `${base}/${name}`;
  }

  function explorerClick(e: ReactMouseEvent, name: string) {
    setExplorerSel((prev) => {
      const next = new Set(prev);
      if (e.metaKey || e.ctrlKey) {
        if (next.has(name)) next.delete(name);
        else next.add(name);
      } else {
        next.clear();
        next.add(name);
      }
      return next;
    });
  }

  function openCtxMenu(e: ReactMouseEvent, name: string) {
    e.preventDefault();
    setExplorerSel((prev) => (prev.has(name) ? prev : new Set([name])));
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  function startRename() {
    const names = [...explorerSel];
    setCtxMenu(null);
    if (names.length !== 1) return;
    setRenameName(names[0]);
    setRenameValue(names[0]);
  }

  async function confirmRename() {
    const orig = renameName;
    const val = renameValue.trim();
    setRenameName(null);
    if (!selected || !orig || val === "" || val === orig) return;
    try {
      await call("rename_remote", {
        profile: selected,
        from: joinRemote(orig),
        to: joinRemote(val),
      });
      loadExplorer(explorerPath);
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
  }

  function askDelete() {
    setCtxMenu(null);
    if (explorerSel.size > 0) setConfirmDelete(true);
  }

  async function confirmDeleteNow() {
    setConfirmDelete(false);
    if (!selected || explorerSel.size === 0) return;
    const paths = [...explorerSel].map(joinRemote);
    try {
      await call("delete_remote", { profile: selected, paths });
      loadExplorer(explorerPath);
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
  }

  async function doUpload(paths: string[]) {
    const prof = selectedProfileRef.current;
    const dir = explorerPathRef.current;
    if (!prof || !dir || paths.length === 0) return;
    try {
      const n = await call<number>("upload_files", {
        profile: prof,
        localPaths: paths,
        remoteDir: dir,
      });
      setStatus(t("explorer.uploaded", { n }));
      loadExplorerRef.current(dir);
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
  }
  uploadDroppedRef.current = doUpload;

  async function toggleWatch() {
    if (!selected) return;
    const id = selected.id;
    await persist(profiles);
    try {
      if (watching.has(id)) {
        await call("stop_watch", { profileId: id });
        setStatus(t("status.watchStopped"));
      } else {
        // Marca "iniciando" hasta que llegue el evento de estado del watcher
        // (puede tardar al establecer la vigilancia de árboles grandes o de red).
        setStartingWatch((prev) => new Set(prev).add(id));
        setStatus(t("status.watchStarting"));
        try {
          await call("start_watch", { profile: selected });
          setStatus(t("status.watchStarted"));
        } catch (e) {
          setStartingWatch((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          setStatus(`✗ ${e}`);
        }
      }
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
  }

  async function saveSettings(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (patch.theme !== undefined) applyTheme(next.theme);
    try {
      const saved = await call<Settings>("save_settings", { settings: next });
      setSettings(saved);
    } catch (e) {
      setStatus(t("status.saveError", { e: String(e) }));
    }
  }

  // Consulta la última release de GitHub y avisa si hay versión nueva.
  async function checkForUpdates() {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        { headers: { Accept: "application/vnd.github+json" } }
      );
      if (!res.ok) return;
      const data = await res.json();
      const latest = String(data.tag_name || "").replace(/^v/, "");
      const current = await getVersion();
      const skipped = localStorage.getItem("skipUpdate");
      if (latest && isNewer(latest, current) && latest !== skipped) {
        setUpdateInfo({
          version: latest,
          url: data.html_url || `https://github.com/${REPO}/releases/latest`,
        });
      }
    } catch {
      /* sin conexión o API no disponible: se ignora silenciosamente */
    }
  }

  async function exportConfig() {
    const path = await saveDialog({
      defaultPath: "sftp-sync-profiles.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    try {
      await call("export_config", { path });
      setStatus(t("status.exported"));
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
  }

  async function importConfig() {
    const path = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof path !== "string") return;
    try {
      const cfg = await call<Config>("import_config", { path });
      setProfiles(cfg.profiles);
      setSelectedId(cfg.profiles[0]?.id ?? null);
      setStatus(t("status.imported"));
    } catch (e) {
      setStatus(`✗ ${e}`);
    }
  }

  const profileLogs = selected
    ? logs.filter((l) => l.profileId === selected.id)
    : logs;

  // Panel de log (pestañas Actividad / Comandos / Explorador).
  const logInner = (
    <>
      <div className="log-head tabs">
        <button
          className={`tab ${logTab === "activity" ? "on" : ""}`}
          onClick={() => setLogTab("activity")}
        >
          {t("log.activity")}
        </button>
        <button
          className={`tab ${logTab === "commands" ? "on" : ""}`}
          onClick={() => setLogTab("commands")}
        >
          {t("log.commands")} ({cmdLogs.length})
        </button>
        <button
          className={`tab ${logTab === "explorer" ? "on" : ""}`}
          onClick={() => setLogTab("explorer")}
        >
          {t("log.explorer")}
        </button>
        {logTab === "explorer" ? (
          <button
            className="tab clear"
            onClick={() => explorerPath && loadExplorer(explorerPath)}
            title={t("log.refresh")}
          >
            ↻
          </button>
        ) : (
          <button
            className="tab clear"
            onClick={() => (logTab === "activity" ? setLogs([]) : setCmdLogs([]))}
            title={t("log.clear")}
          >
            {t("log.clear")}
          </button>
        )}
      </div>
      {logTab === "activity" ? (
        <div className="log-body">
          {profileLogs.map((l, i) => {
            const { body, size } = splitLogMessage(l.message);
            return (
              <div key={i} className={`logline act ${l.level}`}>
                {l.time && <span className="logtime">{l.time}</span>}
                <span className="logmsg" title={body}>
                  {body}
                </span>
                {size && <span className="logsize">{size}</span>}
              </div>
            );
          })}
          <div ref={logEndRef} />
        </div>
      ) : logTab === "commands" ? (
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
      ) : (
        <div className={`log-body explorer ${dragOver ? "dragover" : ""}`}>
          {dragOver && (
            <div className="drop-overlay">{t("explorer.dropHint")}</div>
          )}
          <div className="explorer-bar">
            <button
              className="explorer-up"
              onClick={explorerUp}
              disabled={!explorerPath || explorerPath === "/"}
              title={t("explorer.up")}
            >
              ⬆
            </button>
            <span className="explorer-path">{explorerPath || "/"}</span>
          </div>
          {explorerLoading ? (
            <div className="explorer-msg">{t("explorer.loading")}</div>
          ) : explorerError ? (
            <div className="explorer-msg error">{explorerError}</div>
          ) : explorerEntries.length === 0 ? (
            <div className="explorer-msg">{t("explorer.empty")}</div>
          ) : (
            <>
              <div className="explorer-head">
                <span className="ex-icon" />
                <span className="ex-name">{t("col.name")}</span>
                <span className="ex-perms">{t("col.perms")}</span>
                <span className="ex-date">{t("col.modified")}</span>
                <span className="ex-size">{t("col.size")}</span>
              </div>
              {explorerEntries.map((e) => (
                <div
                  key={e.name}
                  className={`explorer-row ${e.isDir ? "dir" : ""} ${
                    explorerSel.has(e.name) ? "sel" : ""
                  }`}
                  onClick={(ev) => explorerClick(ev, e.name)}
                  onDoubleClick={() => e.isDir && explorerEnter(e.name)}
                  onContextMenu={(ev) => openCtxMenu(ev, e.name)}
                  title={e.isDir ? t("explorer.openFolder") : e.name}
                >
                  <span className="ex-icon">{e.isDir ? "📁" : "📄"}</span>
                  <span className="ex-name">{e.name}</span>
                  <span className="ex-perms">{e.perms || "—"}</span>
                  <span className="ex-date">{formatDate(e.mtime)}</span>
                  <span className="ex-size">
                    {e.isDir ? "" : formatSize(e.size)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="app">
      {updateInfo && (
        <div className="update-banner">
          <span>🎉 {t("update.available", { v: updateInfo.version })}</span>
          <button className="ub-primary" onClick={() => openUrl(updateInfo.url)}>
            {t("update.download")}
          </button>
          <button
            className="ub-ghost"
            onClick={() => {
              localStorage.setItem("skipUpdate", updateInfo.version);
              setUpdateInfo(null);
            }}
          >
            {t("update.skip")}
          </button>
          <button
            className="ub-x"
            onClick={() => setUpdateInfo(null)}
            aria-label="cerrar"
          >
            ✕
          </button>
        </div>
      )}
      <aside className="sidebar">
        <div className="sidebar-head">
          <span>{t("sidebar.profiles")}</span>
          <button
            className="icon-btn"
            onClick={addProfile}
            title={t("sidebar.newProfile")}
          >
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
              <span
                className={`dot ${
                  watching.has(p.id)
                    ? "on"
                    : startingWatch.has(p.id)
                    ? "starting"
                    : ""
                }`}
              />
              <span className="pname">{p.name || t("sidebar.unnamed")}</span>
              <button
                className="dup"
                title={t("sidebar.duplicate")}
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
            <li className="empty">{t("sidebar.empty")}</li>
          )}
        </ul>
        <div className="sidebar-foot">
          <div className="foot-links">
            <button className="about-link" onClick={() => setShowSettings(true)}>
              {t("sidebar.settings")}
            </button>
            <button className="about-link" onClick={() => setShowAbout(true)}>
              {t("sidebar.about")}
            </button>
          </div>
          <button
            className="bmc-btn"
            onClick={() => openUrl("https://buymeacoffee.com/marcosesperon")}
            title={t("bmc.title")}
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
            {t("bmc.label")}
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
                  {t("watch.stop")}
                </button>
              </div>
              <div className="log full">{logInner}</div>
            </div>
          ) : (
            <>
              <div className="edit">
                <div className="edit-header">
                  <div className="form-row">
                    <label>{t("field.profileName")}</label>
                    <input
                      value={selected.name}
                      disabled={testing || syncing}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </div>
                  <div className="edit-tabs">
                    {(
                      [
                        ["connection", t("section.connection")],
                        ["sync", t("section.sync")],
                        ["notifications", t("section.notifications")],
                      ] as ["connection" | "sync" | "notifications", string][]
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        className={`etab ${editTab === id ? "on" : ""}`}
                        onClick={() => setEditTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="edit-body">
                  <fieldset className="fields" disabled={testing || syncing}>
                    {editTab === "connection" && (
                    <section className="section">
                      <div className="grid2">
                        <div className="form-row grow">
                          <label>{t("field.host")}</label>
                          <input
                            value={selected.host}
                            placeholder="10.10.10.1"
                            onChange={(e) => update({ host: e.target.value })}
                          />
                        </div>
                        <div className="form-row port">
                          <label>{t("field.port")}</label>
                          <input
                            type="number"
                            value={selected.port}
                            onChange={(e) =>
                              update({
                                port: parseInt(e.target.value || "22", 10),
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="form-row">
                        <label>{t("field.username")}</label>
                        <input
                          value={selected.username}
                          placeholder="admin"
                          onChange={(e) => update({ username: e.target.value })}
                        />
                      </div>

                      <div className="form-row">
                        <label>{t("field.auth")}</label>
                        <div className="seg">
                          <button
                            className={selected.auth.type === "key" ? "on" : ""}
                            onClick={() =>
                              update({
                                auth: {
                                  type: "key",
                                  privateKeyPath: "",
                                  passphrase: "",
                                },
                              })
                            }
                          >
                            {t("auth.key")}
                          </button>
                          <button
                            className={
                              selected.auth.type === "password" ? "on" : ""
                            }
                            onClick={() =>
                              update({ auth: { type: "password", password: "" } })
                            }
                          >
                            {t("auth.password")}
                          </button>
                        </div>
                      </div>

                      {selected.auth.type === "key" ? (
                        <>
                          <div className="form-row">
                            <label>{t("field.keyPath")}</label>
                            <div className="input-with-btn">
                              <input
                                value={selected.auth.privateKeyPath}
                                placeholder="/ruta/clave_validacion.key"
                                onChange={(e) =>
                                  updateAuth({ privateKeyPath: e.target.value })
                                }
                              />
                              <button className="browse" onClick={pickKeyFile}>
                                {t("btn.browse")}
                              </button>
                            </div>
                          </div>
                          <div className="form-row">
                            <label>{t("field.passphrase")}</label>
                            <input
                              type="password"
                              value={selected.auth.passphrase ?? ""}
                              onChange={(e) =>
                                updateAuth({ passphrase: e.target.value })
                              }
                            />
                          </div>
                        </>
                      ) : (
                        <div className="form-row">
                          <label>{t("field.password")}</label>
                          <input
                            type="password"
                            value={selected.auth.password}
                            onChange={(e) =>
                              updateAuth({ password: e.target.value })
                            }
                          />
                        </div>
                      )}

                      <div className="grid2">
                        <div className="form-row grow">
                          <label>{t("field.localRoot")}</label>
                          <div className="input-with-btn">
                            <input
                              value={selected.localRoot}
                              placeholder="/Users/.../proyecto"
                              onChange={(e) =>
                                update({ localRoot: e.target.value })
                              }
                            />
                            <button className="browse" onClick={pickLocalRoot}>
                              {t("btn.browse")}
                            </button>
                          </div>
                        </div>
                        <div className="form-row grow">
                          <label>{t("field.remotePath")}</label>
                          <input
                            value={selected.remotePath}
                            placeholder="/var/www/"
                            onChange={(e) =>
                              update({ remotePath: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    </section>
                    )}

                    {editTab === "sync" && (
                    <section className="section">

                      <div className="form-row">
                        <label>{t("field.include")}</label>
                        <textarea
                          rows={3}
                          placeholder="**/*"
                          value={(selected.include ?? []).join("\n")}
                          onChange={(e) =>
                            update({
                              include: e.target.value
                                .split("\n")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </div>

                      <div className="form-row">
                        <label>{t("field.ignore")}</label>
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
                            onChange={(e) =>
                              update({ uploadOnSave: e.target.checked })
                            }
                          />
                          {t("check.uploadOnSave")}
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={selected.autoDelete}
                            onChange={(e) =>
                              update({ autoDelete: e.target.checked })
                            }
                          />
                          {t("check.autoDelete")}
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={selected.syncEmptyDirs}
                            onChange={(e) =>
                              update({ syncEmptyDirs: e.target.checked })
                            }
                          />
                          {t("check.syncEmptyDirs")}
                        </label>
                        <label title={t("check.mirror.title")}>
                          <input
                            type="checkbox"
                            checked={selected.mirrorDelete}
                            onChange={(e) =>
                              update({ mirrorDelete: e.target.checked })
                            }
                          />
                          {t("check.mirror")}
                        </label>
                      </div>
                    </section>
                    )}

                    {editTab === "notifications" && (
                    <section className="section">
                      <div className="radios">
                        {(
                          [
                            ["off", t("notify.off")],
                            ["errors", t("notify.errors")],
                            ["summary", t("notify.summary")],
                            ["all", t("notify.all")],
                          ] as [NotifyMode, string][]
                        ).map(([mode, label]) => (
                          <label key={mode} className="radio">
                            <input
                              type="radio"
                              name="notify"
                              checked={(selected.notify ?? "off") === mode}
                              onChange={() => setNotifyMode(mode)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <div className="checks" style={{ marginTop: "16px" }}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selected.errorSound}
                            onChange={(e) =>
                              update({ errorSound: e.target.checked })
                            }
                          />
                          {t("check.errorSound")}
                        </label>
                      </div>
                    </section>
                    )}
                  </fieldset>
                </div>

                <div className="actions">
                  {testing ? (
                    <>
                      <span className="testing-msg">{t("action.testing")}</span>
                      <button className="danger" onClick={cancelTest}>
                        {t("action.cancelTest")}
                      </button>
                    </>
                  ) : syncing ? (
                    <>
                      <span className="testing-msg">{t("action.syncing")}</span>
                      <button className="danger" onClick={cancelSync}>
                        {t("action.cancelSync")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={save}>{t("action.save")}</button>
                      <button
                        onClick={testConnection}
                        disabled={!canConnect}
                      >
                        {t("action.test")}
                      </button>
                      <button onClick={syncNow} disabled={!canSync}>
                        {t("action.syncNow")}
                      </button>
                      <button
                        className={
                          watching.has(selected.id) ? "danger" : "primary"
                        }
                        onClick={toggleWatch}
                        disabled={
                          startingWatch.has(selected.id) ||
                          (!watching.has(selected.id) && !canSync)
                        }
                      >
                        {startingWatch.has(selected.id) ? (
                          <>
                            <span className="spinner" /> {t("watch.starting")}
                          </>
                        ) : watching.has(selected.id) ? (
                          t("watch.stop")
                        ) : (
                          t("watch.start")
                        )}
                      </button>
                      <button
                        className="ghost"
                        onClick={() => deleteProfile(selected.id)}
                      >
                        {t("action.delete")}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="log" ref={logRef} style={{ height: logHeight }}>
                <div
                  className="resize-handle"
                  onMouseDown={startResize}
                  title={t("resize.hint")}
                />
                {logInner}
              </div>
            </>
          )
        ) : (
          <div className="placeholder">{t("placeholder.select")}</div>
        )}
      </main>

      <footer className="statusbar">{status}</footer>

      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="about-title">SFTP Sync</h2>
            <p className="about-version">v0.4.1</p>
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
              {t("about.close")}
            </button>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div
            className="modal settings-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="about-title">{t("settings.title")}</h2>

            <div className="settings-section">
              <h3 className="settings-h">{t("settings.appearance")}</h3>
              <div className="settings-row">
                <label>{t("settings.language")}</label>
                <select
                  value={lang}
                  onChange={(e) =>
                    saveSettings({ language: e.target.value as "es" | "en" })
                  }
                >
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="settings-row">
                <label>{t("settings.theme")}</label>
                <select
                  value={settings.theme}
                  onChange={(e) =>
                    saveSettings({
                      theme: e.target.value as Settings["theme"],
                    })
                  }
                >
                  <option value="system">{t("theme.system")}</option>
                  <option value="light">{t("theme.light")}</option>
                  <option value="dark">{t("theme.dark")}</option>
                </select>
              </div>
            </div>

            <div className="settings-section">
              <h3 className="settings-h">{t("settings.window")}</h3>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.showInDock}
                  onChange={(e) =>
                    saveSettings({ showInDock: e.target.checked })
                  }
                />
                {t("settings.showInDock")}
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.showTray}
                  onChange={(e) => saveSettings({ showTray: e.target.checked })}
                />
                {t("settings.showTray")}
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.autostartWatchers}
                  onChange={(e) =>
                    saveSettings({ autostartWatchers: e.target.checked })
                  }
                />
                {t("settings.autostartWatchers")}
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.launchAtLogin}
                  onChange={(e) =>
                    saveSettings({ launchAtLogin: e.target.checked })
                  }
                />
                {t("settings.launchAtLogin")}
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.checkUpdates}
                  onChange={(e) =>
                    saveSettings({ checkUpdates: e.target.checked })
                  }
                />
                {t("settings.checkUpdates")}
              </label>
            </div>

            <div className="settings-section">
              <h3 className="settings-h">{t("settings.security")}</h3>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.verifyHostKey}
                  onChange={(e) =>
                    saveSettings({ verifyHostKey: e.target.checked })
                  }
                />
                {t("settings.verifyHostKey")}
              </label>
            </div>

            <div className="settings-section">
              <h3 className="settings-h">{t("settings.profilesSection")}</h3>
              <div className="settings-btns">
                <button onClick={exportConfig}>{t("settings.export")}</button>
                <button onClick={importConfig}>{t("settings.import")}</button>
              </div>
              <p className="settings-note">{t("settings.importWarn")}</p>
            </div>

            <button
              className="about-close"
              onClick={() => setShowSettings(false)}
            >
              {t("about.close")}
            </button>
          </div>
        </div>
      )}

      {hostKeyPrompt && (
        <div className="modal-overlay" onClick={() => setHostKeyPrompt(null)}>
          <div
            className={`modal hostkey-modal ${
              hostKeyPrompt.changed ? "danger-modal" : ""
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="about-title">{t("hostkey.title")}</h2>
            <p className="hostkey-msg">
              {hostKeyPrompt.changed
                ? t("hostkey.changed")
                : t("hostkey.unknown")}
            </p>
            <code className="hostkey-fp">{hostKeyPrompt.fingerprint}</code>
            <div className="hostkey-actions">
              <button
                className="about-close"
                onClick={() => setHostKeyPrompt(null)}
              >
                {t("hostkey.cancel")}
              </button>
              <button
                className={hostKeyPrompt.changed ? "danger" : "primary"}
                onClick={trustHostKey}
              >
                {hostKeyPrompt.changed
                  ? t("hostkey.trustChanged")
                  : t("hostkey.trust")}
              </button>
            </div>
          </div>
        </div>
      )}

      {ctxMenu && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            className="ctx-menu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button disabled={explorerSel.size !== 1} onClick={startRename}>
              {t("explorer.rename")}
            </button>
            <button className="danger-item" onClick={askDelete}>
              {t("explorer.delete")} ({explorerSel.size})
            </button>
          </div>
        </>
      )}

      {renameName && (
        <div className="modal-overlay" onClick={() => setRenameName(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="about-title">{t("explorer.renameTitle")}</h2>
            <input
              className="rename-input"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmRename();
                if (e.key === "Escape") setRenameName(null);
              }}
            />
            <div className="hostkey-actions">
              <button className="about-close" onClick={() => setRenameName(null)}>
                {t("common.cancel")}
              </button>
              <button className="primary" onClick={confirmRename}>
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div
            className="modal danger-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="about-title">{t("explorer.delete")}</h2>
            <p className="hostkey-msg">
              {t("explorer.deleteConfirm", { n: explorerSel.size })}
            </p>
            <div className="hostkey-actions">
              <button
                className="about-close"
                onClick={() => setConfirmDelete(false)}
              >
                {t("common.cancel")}
              </button>
              <button className="danger" onClick={confirmDeleteNow}>
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
