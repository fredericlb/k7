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
  /** The paired server's origin, or null — the label is the whole of the settings UI for now. */
  server: string | null;
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

/**
 * What is LEFT of the menu. Every control moved to `/@settings` in st0 — a page has room for
 * the sentence a greyed-out row could never carry — so this keeps only what a page cannot be:
 * the app's presence while no window is open, and the way back to one.
 * See ../docs/settings.md.
 */
export function buildTemplate(
  v: MenuView,
  click: (id: string) => void,
): MenuItemConstructorOptions[] {
  const act = (id: string, label: string, enabled: boolean) => ({
    id,
    label,
    enabled,
    click: () => click(id),
  });

  return [
    // First, because opening the app is what a click on the icon is usually for. Enabled even
    // with no engine: the home page lists local projects and starting one is how you get an
    // engine in the first place.
    act("open_window", "Open studio", true),
    { type: "separator" },
    disabled("status", statusLabel(v)),
    disabled("registry", registryLabel(v)),
    disabled("plugins", pluginsLabel(v)),
    { type: "separator" },
    // Everything that was here is on the page now; this is the way to it.
    act("settings", "Settings…", true),
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
