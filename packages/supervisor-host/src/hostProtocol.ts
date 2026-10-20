// hostProtocol.ts — the frames engine/k7-supervisor speaks, typed from schema/hostProtocol.schema.json.
// The wire types are GENERATED (hostProtocol.generated.ts); this file adds what a host does with them.
// A frame may leave an empty list out and writes null for "none", so a host reads one through `snapshotOf`, never raw.

import type {
  InstanceCheck,
  NotifyFrame,
  ResultFrame,
  StateFrame,
} from "./hostProtocol.generated.ts";

export type {
  AudioDevice,
  CommandLine,
  Download,
  EditPlugin,
  EngineFrame,
  Instance,
  InstanceCheck,
  InstrumentRow,
  NotifyFrame,
  PairedDevice,
  PairRequest,
  Plugin,
  ResultFrame,
  SafeMode,
  Session,
  StateFrame,
} from "./hostProtocol.generated.ts";

type Lists =
  | "plugins"
  | "audioDevices"
  | "audioPriority"
  | "editPlugins"
  | "sessions"
  | "instances"
  | "downloads"
  | "instruments"
  | "pairRequests"
  | "pairedDevices";

/** The supervisor's whole picture: every list present, and "none" absent rather than null. */
export type Snapshot = Omit<
  StateFrame,
  "t" | "owns" | Lists | "pluginCount" | "instanceCheck"
> &
  Required<Pick<StateFrame, Lists>> & {
    /** Absent while the engine has not answered: "scanning", never "none". */
    pluginCount?: number;
    instanceCheck?: InstanceCheck;
  };

/** Before the first frame, and the defaults a frame's missing fields take. */
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
export function snapshotOf(frame: Partial<StateFrame>): Snapshot {
  const { t: _t, owns: _owns, pluginCount, instanceCheck, ...rest } = frame;
  const s: Snapshot = {
    ...EMPTY_SNAPSHOT,
    ...rest,
    paths: { ...EMPTY_SNAPSHOT.paths, ...frame.paths },
  };
  if (pluginCount != null) s.pluginCount = pluginCount;
  if (instanceCheck != null) s.instanceCheck = instanceCheck;
  return s;
}

/** What a desktop host reads off stdout; `engine` frames are the phones' alone. */
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
