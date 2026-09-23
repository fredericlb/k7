// hostProtocol.ts — the wire contract between the supervisor and the menu-bar view
// (st0-tray): NDJSON on stdio, types only, mirrored by hand in Rust (host.rs).
// Stdout IS the protocol, frames are snapshots not deltas, and the tray computes no
// policy of its own. Full rationale: docs/hostProtocol.md.

import type { SyncTarget } from "@studio/song-schema/syncTarget";

/** Which of the STAGED subsystems the host owns yet — see docs/hostProtocol.md. */
export interface HostOwnership {
  /** Spawning, adopting, stopping and crash-watching the C++ engine. */
  engine: boolean;
  /** Spawning, stopping and watching the engine-side file service. */
  fileService: boolean;
  /** Device/plugin/edit-plugin queries over the engine WebSocket, and audio policy. */
  engineQueries: boolean;
}

/** What the engine is doing, as the status line reports it. */
export type EngineRunState = "stopped" | "running" | "error";

/** One audio interface the engine offered, in the shape the tray's audio submenu draws. */
export interface HostAudioDevice {
  name: string;
  /** The driver backend offering it ("ASIO", "Windows Audio", …). */
  deviceType: string;
  /** The device currently open. */
  current: boolean;
}

/** What joins `audio.priority`'s ordered names: U+001F again, which no device name can contain. A command carries ONE argument, and the ranking is one value. */
export const PRIORITY_SEP = "";

/** What separates `plugin.showUI`'s two halves: U+001F, the one byte neither a session id nor a plugin id can contain (mirrored in tray.rs). */
export const SHOW_UI_SEP = "";

/** One plugin instance in a loaded edit, for the "Native plugin UI ▸" submenu. */
export interface HostEditPlugin {
  /** Which project it is in. The engine holds N, so a bare id names no particular plugin. */
  session: string;
  id: string;
  name: string;
  hasNativePluginUI: boolean;
}

/** One INSTALLED plugin, as the settings window lists them — the catalogue, not the instances `HostEditPlugin` names. */
export interface HostPlugin {
  name: string;
  /** "VST3", "AU", "builtin"… — what the row is badged with, and the only word most users search by. */
  format: string;
  manufacturer: string;
  /** "instrument" | "audioEffect" | "midiEffect", verbatim from the engine. */
  role: string;
}

/** One project the engine is holding, for the "Sessions ▸" submenu — what makes ONE engine serving several apps legible from outside. */
export interface HostSession {
  id: string;
  /** The loaded project's name; "" when the session holds nothing. */
  project: string;
  loaded: boolean;
  playing: boolean;
  tracks: number;
  /** Sockets subscribed to this session's audio — someone is LISTENING over the network. */
  listeners: number;
}

/** One st0 instance this engine is connected to, for the tray's "st0 instances" tab: the union of the registries it heartbeats to and the web origins it lets through. */
export interface HostInstance {
  /** The origin, or the registry URL as configured when it is not a bare origin. */
  url: string;
  /** This engine heartbeats here, so it shows in that instance's picker. */
  registry: boolean;
  /** In `web-origins.json`: that instance's pages may reach the file service. */
  allowed: boolean;
  /** False for a registry that came from `$STUDIO_REGISTRY_URL` rather than from the user — nothing here can un-set it. */
  removable: boolean;
}

/** The paths the tray still opens directly, sent rather than recomputed so `~/.st0`'s layout has exactly one definition. */
export interface HostPaths {
  root: string;
  mergedLog: string;
  webOrigins: string;
}

/** The whole of what the tray draws, in one object, emitted only when its serialisation CHANGES — see docs/hostProtocol.md. */
export interface HostSnapshot {
  owns: HostOwnership;

  // --- engine ---------------------------------------------------------------
  status: EngineRunState;
  /** Set when `status` is "error" — shown verbatim on the status line. */
  error?: string;
  /** True only when the supervisor spawned the running engine; a foreign one must never be stopped, which greys out Stop/Restart. */
  ownsEngine: boolean;
  /** The user pressed Stop — the crash-watch must not undo that. */
  userStopped: boolean;
  engineId: string;
  /** The engine's auth token, present ONLY while `owns.engine` is false, because the tray still spawns the engine at that stage. */
  engineToken?: string;
  enginePort: number;
  filePort: number;

  // --- file service ---------------------------------------------------------

  /** Nothing is answering the file port while we expect it to be — the red icon and the "⚠ file service down" suffix. */
  fileServiceFailed: boolean;

  // --- registry -------------------------------------------------------------
  registryUrl: string;
  lastHeartbeatOk: boolean;

  // --- sessions -------------------------------------------------------------

  /** The projects the engine holds. Empty when nothing has connected to it yet. */
  sessions: HostSession[];
  /** What the sessions submenu DRAWS, so a playhead moving does not rebuild it — see docs/hostProtocol.md. */
  sessionsSig: string;

  // --- plugins & audio ------------------------------------------------------

  /** null means "the engine hasn't answered yet" — the spinner, not "none found". */
  pluginCount: number | null;
  /** The installed catalogue, name-sorted. It rides the snapshot like every other list — see docs/supervisorPolicy.md. */
  plugins: HostPlugin[];
  /** Changes exactly when the catalogue does, so only a rescan redraws the window's list. */
  pluginsSig: string;
  audioDevices: HostAudioDevice[];
  /** The interfaces the user RANKED, best first. The first one present is where the engine goes; a name with nothing behind it is one that is unplugged, and keeps its rank. */
  audioPriority: string[];
  /** Changes exactly when the audio submenu's CONTENT would — the tray rebuilds only when it differs from what it last drew. */
  audioMenuSig: string;
  editPlugins: HostEditPlugin[];
  /** The same trick for "Native plugin UI ▸": the ids of the openable plugins. */
  editPluginsSig: string;

  /** Where this machine may COPY a set list, as `preferences.yaml` declares them — packages/file-service/docs/playlistSync.md. */
  syncTargets: SyncTarget[];

  // --- web UI allowlist -----------------------------------------------------
  /** The st0 instances this engine is connected to — empty on a fresh machine, which assumes none. */
  instances: HostInstance[];
  webOrigins: string[];
  /** Origins the file service refused, offered for one-click approval. */
  webPending: string[];
  /** Something in the menu needs the user (today: a refused web UI). The icon's dot. */
  attention: boolean;

  paths: HostPaths;
}

/** A passive banner or a modal; passive for anything the app raises on its own, a modal per refusal making the machine unusable. */
export type NotifyKind = "passive" | "modal";

/** Host → tray. One per line on stdout. */
export type HostEvent =
  | ({ t: "state" } & HostSnapshot)
  | { t: "notify"; kind: NotifyKind; title: string; body: string }
  | { t: "result"; id: number; ok: boolean; message?: string };

/** Tray → host, one per line on stdin; `registry.deregister` drops the engine from the picker AT ONCE rather than aging out. */
export type HostCommandName =
  | "engine.start"
  | "engine.stop"
  | "engine.restart"
  | "fileService.restart"
  | "plugins.rescan"
  | "audio.priority"
  | "sync.targets"
  | "plugin.showUI"
  | "session.drop"
  | "weburi.add"
  | "weburi.remove"
  | "weburi.allow"
  | "weburi.deny"
  | "waveforms.clear"
  | "registry.set"
  | "registry.deregister"
  | "shutdown";

export interface HostCommand {
  t: "cmd";
  /** Correlates the `result`. The tray allocates these; the host only echoes them. */
  id: number;
  cmd: HostCommandName;
  /** The command's single argument, when it takes one; an empty string is meaningful for `audio.priority`, where it means "rank nothing", and for `sync.targets`, where it means "none". */
  arg?: string;
}

/**
 * How a supervisor talks to whatever is driving it. Injected rather than imported, so the
 * SAME supervisor serves the desktop app (NDJSON on stdio) and the command line (a status
 * line on a terminal) — one implementation of the contract, two front ends.
 */
export interface HostTransport {
  emit(event: HostEvent): void;
  /** Read commands until the channel ends, then call `onEnd`; on Unix that END is the whole teardown. */
  listen(onCommand: (cmd: HostCommand) => void, onEnd: () => void): void;
}
