// menu.ts — the tray menu as a template, built from one snapshot. The electron import is
// TYPE-ONLY and erased at build, so every label and enable rule here is testable without a
// browser process. Two rules carried over from tray.rs: an empty submenu gets a disabled
// SENTENCE (an empty menu reads as broken, a sentence reads as a fact), and Stop/Restart are
// enabled only for an engine this supervisor OWNS. See docs/tray.md.

import type { HostSnapshot } from "@studio/engine-host/hostProtocol";
import { SHOW_UI_SEP } from "@studio/engine-host/hostProtocol";
import type { MenuItemConstructorOptions } from "electron";
import type { IconState } from "./iconRaster.ts";

/** Everything the menu draws from. `snapshot` is the supervisor's; the rest is ours. */
export interface MenuView {
  snapshot: HostSnapshot;
  /** Replaces the status line when the supervisor itself is the thing that broke. */
  hostError: string | null;
  spinner: number;
  autostart: boolean;
  build: string;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** What a menu draws before the supervisor has reported: ports match its own defaults, so an early frame can't contradict it. */
export const EMPTY_SNAPSHOT: HostSnapshot = {
  owns: { engine: true, fileService: true, engineQueries: true },
  status: "stopped",
  ownsEngine: false,
  userStopped: false,
  engineId: "",
  enginePort: 8765,
  filePort: 8770,
  fileServiceFailed: false,
  registryUrl: "—",
  lastHeartbeatOk: false,
  sessions: [],
  sessionsSig: "",
  pluginCount: null,
  audioDevices: [],
  audioPreferred: null,
  audioFallback: null,
  audioMenuSig: "",
  editPlugins: [],
  editPluginsSig: "",
  webOrigins: [],
  webPending: [],
  attention: false,
  paths: { root: "", mergedLog: "", webOrigins: "" },
} as HostSnapshot;

const short = (id: string): string => id.slice(0, 8);

const running = (v: MenuView): boolean => v.snapshot.status === "running";

/** The safety rule in one place: only an engine the SUPERVISOR spawned may be stopped from here. */
const ownsRunning = (v: MenuView): boolean =>
  running(v) && v.snapshot.ownsEngine;

/**
 * The "Plugins" line. The count arrives only after the scan, so while the engine is up but
 * silent we animate rather than show a bare "—", which reads like "none found".
 */
export function pluginsLabel(v: MenuView): string {
  const n = v.snapshot.pluginCount;
  if (n !== null && n !== undefined) return `Plugins: ${n}`;
  if (running(v)) return `Plugins: ${SPINNER[v.spinner % SPINNER.length]}`;
  return "Plugins: —";
}

export function statusLabel(v: MenuView): string {
  // A missing supervisor REPLACES the line rather than decorating it: with nothing
  // supervising, what the engine half believes is not what the user needs to read.
  if (v.hostError) return `⚠ ${v.hostError}`;
  const s = v.snapshot;
  let text: string;
  if (running(v)) {
    const adopted = s.ownsEngine ? "" : " (adopted)";
    text = `● Running${adopted} · id ${short(s.engineId)} · :${s.enginePort}`;
  } else if (s.status === "error") {
    text = `⚠ ${s.error ?? "error"}`;
  } else {
    text = "○ Stopped";
  }
  // A dead file service shows here too, not just on the icon — the menu explains "red".
  return s.fileServiceFailed ? `${text} · ⚠ file service down` : text;
}

export function registryLabel(v: MenuView): string {
  const url = v.snapshot.registryUrl;
  if (!running(v)) return `registry ${url}`;
  return `registry ${url} · ${v.snapshot.lastHeartbeatOk ? "ok" : "unreachable"}`;
}

export function tooltip(v: MenuView): string {
  if (v.snapshot.fileServiceFailed)
    return "studio-moteur — file service stopped";
  if (running(v)) return "studio-moteur — running";
  if (v.snapshot.status === "error") return "studio-moteur — error";
  return "studio-moteur — stopped";
}

/**
 * Which badge the icon wears. "Running" alone is not enough: an engine still scanning is not
 * usable yet, so it gets the spinner — the same condition that animates the Plugins line.
 */
export function iconStateFor(v: MenuView): IconState {
  // No supervisor, no stack: an unsupervised app must not wear a green dot.
  if (v.hostError) return { kind: "error" };
  // A dead file service is RED even with the engine fine — the web UI can reach no files.
  if (v.snapshot.fileServiceFailed) return { kind: "stopped" };
  if (v.snapshot.status === "error") return { kind: "error" };
  if (v.snapshot.status === "running") {
    return v.snapshot.pluginCount === null ||
      v.snapshot.pluginCount === undefined
      ? { kind: "loading", frame: v.spinner }
      : { kind: "running" };
  }
  return { kind: "stopped" };
}

/** One session row: what the status line could never say — which project, for whom, and whether it is live. */
export function sessionLabel(s: HostSnapshot["sessions"][number]): string {
  // The default session has no name on the wire; it needs one here, or the row reads as a
  // session with no id rather than THE unnamed one.
  const who = s.id === "" ? "(default)" : s.id;
  const what = !s.loaded
    ? " · nothing loaded"
    : ` · ${s.project === "" ? "untitled" : s.project} · ${s.tracks} track${s.tracks === 1 ? "" : "s"}`;
  // Both shown only when true: a column of "▶ no · 0 listening" would bury the one that IS playing.
  const live = `${s.playing ? "  ▶" : ""}${s.listeners > 0 ? `  ♫${s.listeners}` : ""}`;
  return `${who}${what}${live}   ✕`;
}

const disabled = (id: string, label: string): MenuItemConstructorOptions => ({
  id,
  label,
  enabled: false,
});

function sessionsSubmenu(
  v: MenuView,
  click: (id: string) => void,
): MenuItemConstructorOptions {
  const rows = v.snapshot.sessions.map((s) => ({
    id: `session_drop:${s.id}`,
    label: sessionLabel(s),
    // The row IS the drop, and the ✕ says so; there is no other click it could be confused with.
    click: () => click(`session_drop:${s.id}`),
  }));
  return {
    id: "sessions",
    label: "Sessions",
    enabled: true,
    submenu: rows.length
      ? rows
      : [disabled("sessions_none", "No app is driving this engine")],
  };
}

function pluginsSubmenu(
  v: MenuView,
  click: (id: string) => void,
): MenuItemConstructorOptions {
  // Externals only: a built-in has no native editor to open.
  const openable = v.snapshot.editPlugins.filter((p) => p.hasNativePluginUI);
  const manySessions = new Set(openable.map((p) => p.session)).size > 1;
  const rows = openable.map((p) => {
    const id = `plugin_open:${p.session}${SHOW_UI_SEP}${p.id}`;
    return {
      id,
      label: manySessions ? `${p.session} · ${p.name}` : p.name,
      click: () => click(id),
    };
  });
  return {
    id: "edit_plugins",
    label: "Native plugin UI",
    enabled: rows.length > 0,
    submenu: rows.length
      ? rows
      : [disabled("edit_plugins_none", "No plugins with a native UI")],
  };
}

function audioSubmenu(
  v: MenuView,
  click: (id: string) => void,
): MenuItemConstructorOptions {
  const { audioDevices: devices, audioPreferred, audioFallback } = v.snapshot;
  const items: MenuItemConstructorOptions[] = devices.map((d) => {
    const base = d.deviceType ? `${d.name} [${d.deviceType}]` : d.name;
    // Mark the remembered pick only when the engine ISN'T on it: that gap is what needs explaining.
    const gap = audioPreferred === d.name && !d.current ? "   (preferred)" : "";
    return {
      id: `dev:${d.name}`,
      label: `${base}${gap}`,
      type: "checkbox" as const,
      checked: d.current,
      click: () => click(`dev:${d.name}`),
    };
  });

  // A remembered pick absent from the list still gets a row, or "why am I not on my
  // interface?" has no answer on screen.
  if (audioPreferred && !devices.some((d) => d.name === audioPreferred)) {
    items.push(
      disabled(
        "dev_missing",
        `${audioPreferred}   (preferred — not connected)`,
      ),
    );
  }

  const fb: MenuItemConstructorOptions[] = [
    {
      id: "fb:",
      label: "None",
      type: "checkbox",
      checked: audioFallback === null,
      // "" is meaningful on the wire: it IS "none".
      click: () => click("fb:"),
    },
    ...devices.map((d) => ({
      id: `fb:${d.name}`,
      label: d.name,
      type: "checkbox" as const,
      checked: audioFallback === d.name,
      click: () => click(`fb:${d.name}`),
    })),
  ];
  if (audioFallback && !devices.some((d) => d.name === audioFallback)) {
    fb.push(disabled("fb_missing", `${audioFallback}   (not connected)`));
  }

  items.push({ type: "separator" });
  items.push({
    id: "audio_fallback",
    label: audioFallback ? `Fallback: ${audioFallback}` : "Fallback: none",
    submenu: fb,
  });

  return {
    id: "audio",
    label: "Audio interface",
    enabled: devices.length > 0 || audioPreferred !== null,
    submenu: items,
  };
}

function webUiSubmenu(
  v: MenuView,
  click: (id: string) => void,
): MenuItemConstructorOptions {
  const { webOrigins, webPending } = v.snapshot;
  const items: MenuItemConstructorOptions[] = webOrigins.map((o) => ({
    id: `weburi_del:${o}`,
    // The ✕ carries the affordance: a tray menu has no context menu and no delete key.
    label: `${o}   ✕`,
    click: () => click(`weburi_del:${o}`),
  }));
  if (!items.length) items.push(disabled("weburi_none", "No web UI added"));

  if (webPending.length) {
    items.push({ type: "separator" });
    items.push(disabled("weburi_pending_head", "Blocked just now — allow?"));
    for (const o of webPending) {
      items.push({
        id: `weburi_allow:${o}`,
        label: `✓ ${o}`,
        click: () => click(`weburi_allow:${o}`),
      });
      items.push({
        id: `weburi_deny:${o}`,
        label: "        ignore",
        click: () => click(`weburi_deny:${o}`),
      });
    }
  }

  items.push({ type: "separator" });
  items.push({
    id: "weburi_add",
    label: "Add web UI…",
    click: () => click("weburi_add"),
  });

  // Always enabled: it holds "Add…" even when empty, which is when you need it most.
  return { id: "weburi", label: "Web UI", enabled: true, submenu: items };
}

/** The whole menu, in the order tray.rs fixed. */
export function buildTemplate(
  v: MenuView,
  click: (id: string) => void,
): MenuItemConstructorOptions[] {
  const owns = ownsRunning(v);
  const isRunning = running(v);
  const act = (id: string, label: string, enabled: boolean) => ({
    id,
    label,
    enabled,
    click: () => click(id),
  });

  return [
    disabled("status", statusLabel(v)),
    disabled("registry", registryLabel(v)),
    disabled("plugins", pluginsLabel(v)),
    // Needs the engine running: it sends a WebSocket command.
    act("rescan", "Rescan plugins", isRunning),
    sessionsSubmenu(v, click),
    pluginsSubmenu(v, click),
    audioSubmenu(v, click),
    webUiSubmenu(v, click),
    { type: "separator" },
    act("start", "Start engine", !isRunning),
    act("stop", "Stop engine", owns),
    act("restart", "Restart engine", owns),
    // Only when there is one of OURS to restart — i.e. we own a running engine.
    act("restart_file", "Restart file service", owns),
    // Same condition: clearing the cache is an HTTP call to our own file service.
    act("clear_waveform_cache", "Clear waveform cache", owns),
    { type: "separator" },
    {
      id: "autostart",
      label: "Launch at login",
      type: "checkbox",
      checked: v.autostart,
      click: () => click("autostart"),
    },
    act("open_root", "Open workspaces root folder", true),
    act("open_log", "Show logs", true),
    { type: "separator" },
    disabled("build", `build ${v.build}`),
    act("quit", "Quit studio-capot", true),
  ];
}

/**
 * What the menu SHOWS, as one string. Built from the template rather than from the snapshot's
 * three `*Sig` fields so it cannot drift from what is drawn — and the plugins line is excluded
 * because the spinner tick owns it, or an 8fps animation would rebuild the menu at 8fps.
 */
export function menuSignature(items: MenuItemConstructorOptions[]): string {
  const parts: string[] = [];
  const walk = (list: MenuItemConstructorOptions[]) => {
    for (const it of list) {
      if (it.id === "plugins") continue;
      parts.push(
        `${it.id ?? ""}${it.label ?? ""}${it.enabled === false ? 0 : 1}${it.checked ? 1 : 0}${it.type ?? ""}`,
      );
      if (Array.isArray(it.submenu)) walk(it.submenu);
    }
  };
  walk(items);
  return parts.join("\n");
}
