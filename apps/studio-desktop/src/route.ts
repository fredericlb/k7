// route.ts — one menu id to one act. Pure, because the two subtle encodings live here: a
// plugin row carries `<session>SHOW_UI_SEP<id>` and is forwarded VERBATIM for the supervisor
// to split, and `fb:` with nothing after it is a meaningful empty arg meaning "no fallback".
// Anything the supervisor owns becomes a command; the rest is ours to do. See docs/tray.md.

import type { HostCommandName } from "@studio/engine-host/hostProtocol";

/** Something the supervisor does, or something this app does itself. */
export type MenuAction =
  | { kind: "command"; cmd: HostCommandName; arg?: string }
  | { kind: "local"; what: LocalAction };

export type LocalAction =
  | "openWindow"
  | "autostart"
  | "openRoot"
  | "openLog"
  | "addWebUi"
  | "quit";

const PREFIX: ReadonlyArray<[string, HostCommandName]> = [
  ["session_drop:", "session.drop"],
  ["plugin_open:", "plugin.showUI"],
  ["dev:", "audio.select"],
  ["weburi_del:", "weburi.remove"],
  ["weburi_allow:", "weburi.allow"],
  ["weburi_deny:", "weburi.deny"],
];

const PLAIN: Readonly<Record<string, HostCommandName>> = {
  start: "engine.start",
  // One command, not stop-then-start: the supervisor sequences it, so no crash-watch tick
  // sees the gap and "recovers" mid-restart.
  restart: "engine.restart",
  stop: "engine.stop",
  restart_file: "fileService.restart",
  clear_waveform_cache: "waveforms.clear",
  rescan: "plugins.rescan",
};

const LOCAL: Readonly<Record<string, LocalAction>> = {
  open_window: "openWindow",
  autostart: "autostart",
  open_root: "openRoot",
  open_log: "openLog",
  weburi_add: "addWebUi",
  quit: "quit",
};

/** What a click means, or null for a row that is not clickable (a status line, a placeholder). */
export function routeMenuId(id: string): MenuAction | null {
  const plain = PLAIN[id];
  if (plain) return { kind: "command", cmd: plain };
  const local = LOCAL[id];
  if (local) return { kind: "local", what: local };

  // Checked before the prefix table: "fb:" alone is the empty arg, and startsWith would
  // otherwise hand the fallback an id it cannot tell from a device named "".
  if (id.startsWith("fb:")) {
    return { kind: "command", cmd: "audio.fallback", arg: id.slice(3) };
  }
  for (const [prefix, cmd] of PREFIX) {
    if (id.startsWith(prefix)) {
      return { kind: "command", cmd, arg: id.slice(prefix.length) };
    }
  }
  return null;
}
