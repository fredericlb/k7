// hostProtocol.ts — the wire contract between the supervisor and the menu-bar view
// (studio-capot): NDJSON on stdio, types only, mirrored by hand in Rust (host.rs).
// Stdout IS the protocol, frames are snapshots not deltas, and the tray computes no
// policy of its own. Full rationale: docs/hostProtocol.md.

/**
 * Which of the STAGED subsystems the host owns yet.
 *
 * This is the refactor's staging mechanism made explicit on the wire: each stage flips
 * one more flag and deletes the Rust that used to do that job. The tray merges only
 * the parts of a snapshot whose flag is set, so a half-migrated build has exactly one
 * owner per subsystem instead of two writers racing. When all three are permanently
 * true this collapses to "the tray replaces its state wholesale" and the type can go.
 *
 * Identity, settings, the registry and the web-origins allowlist are NOT here: they
 * moved to the host in one step and have no half-owned state. Their snapshot fields
 * are always authoritative.
 */
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

/** One audio interface the engine offered. Mirrors the tray's old `audio.rs` shape. */
export interface HostAudioDevice {
  name: string;
  /** The driver backend offering it ("ASIO", "Windows Audio", …). */
  deviceType: string;
  /** The device currently open. */
  current: boolean;
}

/** One plugin instance in the loaded edit, for the "Native plugin UI ▸" submenu. */
export interface HostEditPlugin {
  id: string;
  name: string;
  hasNativePluginUI: boolean;
}

/**
 * One project the engine is holding, for the "Sessions ▸" submenu.
 *
 * This is what makes ONE engine serving several apps legible from the outside. Before it,
 * the tray's status line said "Running · :8833" whether that engine held nothing, held
 * lanes' song, or held a deck and a module preview at once — and the apps had no way to
 * see each other either.
 */
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

/** The paths the tray still opens directly (Show logs, Open workspaces root, and the
 *  origins file it falls back to when there is no native prompt). Sent rather than
 *  recomputed so `~/.lanes`'s layout has exactly one definition. */
export interface HostPaths {
  root: string;
  mergedLog: string;
  webOrigins: string;
}

/**
 * The whole of what the tray draws, in one object.
 *
 * Every field here is read by `refresh()` or one of the three submenu builders. The
 * host emits this only when its serialisation CHANGES — the arrays are re-serialised
 * on every emit, so a field that flapped at loop cadence would put the whole snapshot
 * on the wire several times a second to redraw nothing.
 */
export interface HostSnapshot {
  owns: HostOwnership;

  // --- engine ---------------------------------------------------------------
  status: EngineRunState;
  /** Set when `status` is "error" — shown verbatim on the status line. */
  error?: string;
  /** True only when the supervisor spawned the running engine. A foreign/adopted one
   *  must never be stopped from here, which is what greys out Stop/Restart. */
  ownsEngine: boolean;
  /** The user pressed Stop — the crash-watch must not undo that. */
  userStopped: boolean;
  engineId: string;
  /** The engine's auth token. Present ONLY while `owns.engine` is false, because the
   *  tray still spawns the engine itself at that stage and has to pass it down. It
   *  disappears from the wire the moment the host owns the process. */
  engineToken?: string;
  enginePort: number;
  filePort: number;

  // --- file service ---------------------------------------------------------
  /** Nothing is answering the file port while we expect it to be. Drives the red icon
   *  and the "⚠ file service down" suffix. */
  fileServiceFailed: boolean;

  // --- registry -------------------------------------------------------------
  registryUrl: string;
  lastHeartbeatOk: boolean;

  // --- sessions -------------------------------------------------------------
  /** The projects the engine holds. Empty when nothing has connected to it yet. */
  sessions: HostSession[];
  /** What the sessions submenu DRAWS, so a playhead moving does not rebuild it. Same
   *  device as `audioMenuSig` / `editPluginsSig`; see the note on this interface. */
  sessionsSig: string;

  // --- plugins & audio ------------------------------------------------------
  /** null means "the engine hasn't answered yet" — the spinner, not "none found". */
  pluginCount: number | null;
  audioDevices: HostAudioDevice[];
  /** The device the user picked, remembered so it can be RE-selected when it returns. */
  audioPreferred: string | null;
  /** Where to go when the preferred one isn't there. */
  audioFallback: string | null;
  /** Changes exactly when the audio submenu's CONTENT would change. The tray rebuilds
   *  only when this differs from what it last drew — see audioPolicy.menuSignature. */
  audioMenuSig: string;
  editPlugins: HostEditPlugin[];
  /** The same trick for "Native plugin UI ▸": the ids of the openable plugins. */
  editPluginsSig: string;

  // --- web UI allowlist -----------------------------------------------------
  webOrigins: string[];
  /** Origins the file service refused, offered for one-click approval. */
  webPending: string[];
  /** Something in the menu needs the user (today: a refused web UI). The icon's dot. */
  attention: boolean;

  paths: HostPaths;
}

/** A passive OS notification (banner/toast) or a modal the user must dismiss.
 *  Passive for anything the app raises on its own — a blocked browser can be refused
 *  dozens of times a second, and a modal per refusal makes the machine unusable. */
export type NotifyKind = "passive" | "modal";

/** Host → tray. One per line on stdout. */
export type HostEvent =
  | ({ t: "state" } & HostSnapshot)
  | { t: "notify"; kind: NotifyKind; title: string; body: string }
  | { t: "result"; id: number; ok: boolean; message?: string };

/**
 * Tray → host. One per line on stdin.
 *
 * `registry.deregister` is not merely "stop heartbeating": the Stop menu item drops the
 * engine from the registry IMMEDIATELY rather than letting the entry age out, so it
 * vanishes from the picker at once. Letting the TTL expire instead would be a visible
 * regression.
 */
export type HostCommandName =
  | "engine.start"
  | "engine.stop"
  | "engine.restart"
  | "fileService.restart"
  | "plugins.rescan"
  | "audio.select"
  | "audio.fallback"
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
  /** The command's single argument, when it takes one (an origin, a device name, a
   *  plugin id, a URL). Empty string is meaningful for `audio.fallback` — it means
   *  "no fallback". */
  arg?: string;
}
