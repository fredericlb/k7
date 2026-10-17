// hostProtocol.ts — the TypeScript mirror of engine/k7-supervisor/src/HostProtocol.h, by hand.
// PARTIAL on purpose: a field is added here when a host first reads it.
// A frame may leave an empty list out, so a host reads one through `snapshotOf`, never raw.

export interface AudioDevice {
  name: string;
  deviceType: string;
  current: boolean;
  /** The device the engine takes its inputs from, which need not be `current`. */
  currentInput: boolean;
}

/** One INSTALLED plugin: the catalogue, not an instance. */
export interface Plugin {
  name: string;
  format: string;
  manufacturer: string;
  role: string;
}

/** One plugin instance in one of the engine's sessions. */
export interface EditPlugin {
  session: string;
  id: string;
  name: string;
  hasNativePluginUI: boolean;
}

export interface Session {
  id: string;
  project: string;
  loaded: boolean;
  playing: boolean;
  tracks: number;
  listeners: number;
}

export interface Instance {
  url: string;
  /** False for a registry from `$STUDIO_REGISTRY_URL`. */
  removable: boolean;
}

export interface InstanceCheck {
  url: string;
  state: "checking" | "refused";
  message?: string;
}

export interface Download {
  name: string;
  label: string;
  received: number;
  total: number;
  phase: "queued" | "downloading" | "unpacking" | "failed";
  error?: string;
}

export interface InstrumentRow {
  name: string;
  label: string;
  bytes: number;
  wanted: boolean;
  installed: boolean;
}

export interface PairRequest {
  requestId: string;
  name: string;
  ip: string;
  code: string;
  since: number;
}

export interface PairedDevice {
  deviceId: string;
  name: string;
  created: number;
  lastSeen: number;
}

/** The supervisor's whole picture. A list may be absent from the frame when empty; read it through `snapshotOf`. */
export interface Snapshot {
  status: "stopped" | "running" | "error";
  /** Present only when there is one. */
  error?: string;
  /** Present only while the engine runs without external plugins after quick crashes — engine/k7-supervisor/docs/crashLoop.md. */
  safeMode?: { crashes: number; suspect: string };
  ownsEngine: boolean;
  userStopped: boolean;
  engineId: string;
  enginePort: number;
  registryUrl: string;
  lastHeartbeatOk: boolean;
  /** Absent while the engine has not answered: "scanning", never "none". */
  pluginCount?: number;
  plugins: Plugin[];
  pluginsSig: string;
  audioDevices: AudioDevice[];
  audioPriority: string[];
  audioMenuSig: string;
  editPlugins: EditPlugin[];
  editPluginsSig: string;
  sessions: Session[];
  sessionsSig: string;
  instances: Instance[];
  instanceCheck?: InstanceCheck;
  paths: { root: string; mergedLog: string };
  downloads: Download[];
  instruments: InstrumentRow[];
  pairRequests: PairRequest[];
  pairedDevices: PairedDevice[];
}

/** Before the first frame, and the defaults a frame's missing fields take — as serde's `default` does in host.rs. */
export const EMPTY_SNAPSHOT: Snapshot = {
  status: "stopped",
  ownsEngine: false,
  userStopped: false,
  engineId: "",
  enginePort: 8765,
  registryUrl: "",
  lastHeartbeatOk: false,
  plugins: [],
  pluginsSig: "",
  audioDevices: [],
  audioPriority: [],
  audioMenuSig: "",
  editPlugins: [],
  editPluginsSig: "",
  sessions: [],
  sessionsSig: "",
  instances: [],
  paths: { root: "", mergedLog: "" },
  downloads: [],
  instruments: [],
  pairRequests: [],
  pairedDevices: [],
};

/** A state frame as a whole snapshot, every missing field defaulted. */
export function snapshotOf(frame: Partial<Snapshot>): Snapshot {
  return {
    ...EMPTY_SNAPSHOT,
    ...frame,
    paths: { ...EMPTY_SNAPSHOT.paths, ...frame.paths },
  };
}

/** The snapshot's fields sit at the frame's top level, beside `t`; empty lists may be left out. */
export interface StateFrame extends Partial<Snapshot> {
  t: "state";
}

/** `modal` wants an answer-less dialog, anything else a passive notification. */
export interface NotifyFrame {
  t: "notify";
  kind: string;
  title: string;
  body: string;
}

export interface ResultFrame {
  t: "result";
  id: number;
  ok: boolean;
  message?: string;
}

export type Frame = StateFrame | NotifyFrame | ResultFrame;

/** One stdout line as a frame; null for anything that is not one, which the host logs as text. */
export function parseFrame(line: string): Frame | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const t = (v as { t?: unknown }).t;
  return t === "state" || t === "notify" || t === "result"
    ? (v as Frame)
    : null;
}

/** One command as the line the supervisor's stdin reads. */
export function commandLine(id: number, cmd: string, arg?: string): string {
  return `${JSON.stringify({ t: "cmd", id, cmd, ...(arg === undefined ? {} : { arg }) })}\n`;
}
