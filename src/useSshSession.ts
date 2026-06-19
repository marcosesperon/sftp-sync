import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Profile, Settings } from "./types";

// Paletas del terminal según el tema de la app.
const v_themes = {
  dark: { background: "#0d1117", foreground: "#c9d1d9", cursor: "#c9d1d9" },
  light: { background: "#ffffff", foreground: "#1f2328", cursor: "#1f2328" },
};

// Resuelve la paleta efectiva, expandiendo "system" con el esquema del SO.
function v_resolve_theme(v_theme: Settings["theme"]) {
  if (v_theme === "system") {
    const v_dark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return v_dark ? v_themes.dark : v_themes.light;
  }
  return v_themes[v_theme];
}

// Recursos en memoria de una terminal (fuera del estado de React).
interface TermEntry {
  term: Terminal;
  fit: FitAddon;
  disposers: Array<() => void>;
  opened: boolean;
}

// Metadatos de cada sesión expuestos a la UI.
export interface SshSessionMeta {
  id: string;
  profile: Profile;
  error: string;
}

export interface SshManager {
  /** Sesiones SSH abiertas, en orden de apertura. */
  sessions: SshSessionMeta[];
  /** Sesión visible actualmente (null si no hay ninguna). */
  activeId: string | null;
  /** Abre una nueva sesión para el perfil (admite varias por perfil). */
  open: (profile: Profile) => Promise<void>;
  /** Cierra una sesión concreta y libera su terminal. */
  close: (id: string) => Promise<void>;
  /** Selecciona qué sesión se muestra. */
  setActive: (id: string) => void;
  /** Engancha (o reengancha) el terminal de una sesión a un contenedor del DOM. */
  attach: (id: string, el: HTMLElement) => void;
  /** Reajusta el terminal de una sesión (o de la activa) a su contenedor. */
  fit: (id?: string) => void;
}

/// Gestiona múltiples terminales SSH (xterm.js + backend russh) cuyo ciclo de
/// vida es independiente del montaje/desmontaje de la pestaña que las muestra:
/// cada terminal vive en memoria hasta que se cierra explícitamente.
export function useSshSession(theme: Settings["theme"]): SshManager {
  const v_terms_ref = useRef<Map<string, TermEntry>>(new Map());
  const [v_sessions, set_v_sessions] = useState<SshSessionMeta[]>([]);
  const [v_active_id, set_v_active_id] = useState<string | null>(null);
  // Espejos en refs para usarlos dentro de callbacks estables sin closures obsoletas.
  const v_theme_ref = useRef(theme);
  v_theme_ref.current = theme;
  const v_active_ref = useRef(v_active_id);
  v_active_ref.current = v_active_id;

  const open = useCallback(async (profile: Profile) => {
    // Id único por sesión: permite varias terminales del mismo perfil.
    const v_id = crypto.randomUUID();

    const v_term = new Terminal({
      fontFamily:
        '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: v_resolve_theme(v_theme_ref.current),
    });
    const v_fit = new FitAddon();
    v_term.loadAddon(v_fit);

    // Canal por el que el backend envía la salida cruda del servidor.
    const v_channel = new Channel<number[]>();
    v_channel.onmessage = (v_bytes) => v_term.write(new Uint8Array(v_bytes));

    // Reenvía lo tecleado y los redimensionados al backend.
    const v_on_data = v_term.onData((v_str) => {
      const v_data = Array.from(new TextEncoder().encode(v_str));
      invoke("ssh_input", { sessionId: v_id, data: v_data }).catch(() => {});
    });
    const v_on_resize = v_term.onResize(({ cols, rows }) => {
      invoke("ssh_resize", { sessionId: v_id, cols, rows }).catch(() => {});
    });

    v_terms_ref.current.set(v_id, {
      term: v_term,
      fit: v_fit,
      disposers: [() => v_on_data.dispose(), () => v_on_resize.dispose()],
      opened: false,
    });
    set_v_sessions((v_prev) => [...v_prev, { id: v_id, profile, error: "" }]);
    set_v_active_id(v_id);

    try {
      await invoke("ssh_open", {
        profile,
        sessionId: v_id,
        cols: v_term.cols || 80,
        rows: v_term.rows || 24,
        onData: v_channel,
      });
      v_term.focus();
    } catch (e) {
      // Mostramos el error sin cerrar: el usuario puede cerrar la sesión.
      set_v_sessions((v_prev) =>
        v_prev.map((s) => (s.id === v_id ? { ...s, error: String(e) } : s))
      );
    }
  }, []);

  const close = useCallback(async (id: string) => {
    const v_entry = v_terms_ref.current.get(id);
    if (v_entry) {
      for (const v_dispose of v_entry.disposers) {
        try {
          v_dispose();
        } catch {
          /* noop */
        }
      }
      v_entry.term.dispose();
      v_terms_ref.current.delete(id);
    }
    set_v_sessions((v_prev) => v_prev.filter((s) => s.id !== id));
    set_v_active_id((v_prev) => {
      if (v_prev !== id) return v_prev;
      // Si cerramos la activa, pasamos a la última que quede (o ninguna).
      const v_rest = Array.from(v_terms_ref.current.keys());
      return v_rest.length ? v_rest[v_rest.length - 1] : null;
    });
    try {
      await invoke("ssh_close", { sessionId: id });
    } catch {
      /* noop */
    }
  }, []);

  const setActive = useCallback((id: string) => set_v_active_id(id), []);

  const attach = useCallback((id: string, el: HTMLElement) => {
    const v_entry = v_terms_ref.current.get(id);
    if (!v_entry) return;
    if (!v_entry.opened) {
      v_entry.term.open(el);
      v_entry.opened = true;
    } else if (
      v_entry.term.element &&
      v_entry.term.element.parentElement !== el
    ) {
      // Reengancha el mismo terminal (conserva el buffer) tras un remontaje.
      el.appendChild(v_entry.term.element);
    }
  }, []);

  const fit = useCallback((id?: string) => {
    const v_id = id ?? v_active_ref.current;
    if (!v_id) return;
    const v_entry = v_terms_ref.current.get(v_id);
    requestAnimationFrame(() => {
      try {
        v_entry?.fit.fit();
        v_entry?.term.focus();
      } catch {
        /* noop */
      }
    });
  }, []);

  // Aplica el tema a todas las terminales vivas cuando cambia el de la app.
  useEffect(() => {
    for (const v_entry of v_terms_ref.current.values()) {
      v_entry.term.options.theme = v_resolve_theme(theme);
    }
  }, [theme]);

  // Reajusta la terminal activa al redimensionar la ventana.
  useEffect(() => {
    const v_on_resize = () => fit();
    window.addEventListener("resize", v_on_resize);
    return () => window.removeEventListener("resize", v_on_resize);
  }, [fit]);

  // Cierra todas las sesiones al desmontar la app (evita shells colgando).
  useEffect(() => {
    const v_terms = v_terms_ref.current;
    return () => {
      for (const [v_id, v_entry] of v_terms) {
        for (const v_dispose of v_entry.disposers) {
          try {
            v_dispose();
          } catch {
            /* noop */
          }
        }
        v_entry.term.dispose();
        invoke("ssh_close", { sessionId: v_id }).catch(() => {});
      }
      v_terms.clear();
    };
  }, []);

  return {
    sessions: v_sessions,
    activeId: v_active_id,
    open,
    close,
    setActive,
    attach,
    fit,
  };
}
