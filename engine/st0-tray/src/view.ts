// view.ts — what the settings page draws, built from the supervisor's snapshot: rows folded so the page looks nothing up.
// A VIEW: it computes no policy. `canAct` only greys buttons; refusing to touch a foreign engine is the supervisor's.

import type {
  AudioDevice,
  EditPlugin,
  Instance,
  InstanceCheck,
  PairedDevice,
  PairRequest,
  Plugin,
  Session,
  Snapshot,
} from "@studio/supervisor-host/hostProtocol";

export interface AudioRow {
  name: string;
  deviceType: string;
  /** A ranked name with nothing plugged in keeps its row: it is what holds the rank. */
  present: boolean;
  current: boolean;
  currentInput: boolean;
  /** 1-based place in the ranking; null for a device that is merely visible. */
  rank: number | null;
}

export interface PluginUiRow {
  session: string;
  id: string;
  name: string;
}

export interface SessionRow {
  id: string;
  project: string;
  loaded: boolean;
  playing: boolean;
  tracks: number;
  listeners: number;
  plugins: PluginUiRow[];
}

export interface InstrumentView {
  name: string;
  label: string;
  bytes: number;
  wanted: boolean;
  installed: boolean;
  phase: string | null;
  received: number;
  error: string | null;
}

export interface SystemView {
  build: string;
  status: string;
  error: string | null;
  hostError: string | null;
  engineId: string;
  enginePort: number;
  ownsEngine: boolean;
  registryUrl: string;
  lastHeartbeatOk: boolean;
  canStart: boolean;
  canAct: boolean;
}

export interface View {
  audio: AudioRow[];
  plugins: Plugin[];
  /** null while the engine has not answered: "scanning…", never "none installed". */
  pluginCount: number | null;
  sessions: SessionRow[];
  instances: Instance[];
  instanceCheck: InstanceCheck | null;
  /** Openable plugins naming a session the engine did not list: the two are polled apart. */
  orphanPlugins: PluginUiRow[];
  instruments: InstrumentView[];
  pairRequests: PairRequest[];
  pairedDevices: PairedDevice[];
  engineRunning: boolean;
  system: SystemView;
}

/** The ranking first, then whatever else is plugged in: the order the engine consults them. */
export function audioRows(
  devices: AudioDevice[],
  priority: string[],
): AudioRow[] {
  const unranked = devices
    .filter((d) => !priority.includes(d.name))
    .map((d) => d.name);
  return [...priority, ...unranked].map((name, i) => {
    const d = devices.find((x) => x.name === name);
    return {
      name,
      deviceType: d?.deviceType ?? "",
      present: d !== undefined,
      current: d?.current ?? false,
      currentInput: d?.currentInput ?? false,
      rank: i < priority.length ? i + 1 : null,
    };
  });
}

/** The sessions, each with the plugins naming it, plus whatever named no listed session. */
export function sessionRows(
  sessions: Session[],
  plugins: EditPlugin[],
): { rows: SessionRow[]; orphans: PluginUiRow[] } {
  // Only plugins whose own editor can open: a built-in has no window to show.
  const openable = plugins.filter((p) => p.hasNativePluginUI);
  const row = (p: EditPlugin): PluginUiRow => ({
    session: p.session,
    id: p.id,
    name: p.name || p.id,
  });
  return {
    rows: sessions.map((s) => ({
      id: s.id,
      project: s.project,
      loaded: s.loaded,
      playing: s.playing,
      tracks: s.tracks,
      listeners: s.listeners,
      plugins: openable.filter((p) => p.session === s.id).map(row),
    })),
    orphans: openable
      .filter((p) => !sessions.some((s) => s.id === p.session))
      .map(row),
  };
}

export function instrumentRows(snap: Snapshot): InstrumentView[] {
  return snap.instruments.map((i) => {
    const d = snap.downloads.find((x) => x.name === i.name);
    return {
      ...i,
      phase: d?.phase ?? null,
      received: d?.received ?? 0,
      error: d?.error ?? null,
    };
  });
}

export function isRunning(snap: Snapshot): boolean {
  return snap.status === "running";
}

/** An engine the supervisor SPAWNED; a foreign one shows running with Stop and Restart greyed. */
export function ownsRunning(snap: Snapshot): boolean {
  return isRunning(snap) && snap.ownsEngine;
}

export function view(
  snap: Snapshot,
  hostError: string | null,
  build: string,
): View {
  const { rows, orphans } = sessionRows(snap.sessions, snap.editPlugins);
  return {
    audio: audioRows(snap.audioDevices, snap.audioPriority),
    plugins: snap.plugins,
    pluginCount: snap.pluginCount ?? null,
    sessions: rows,
    orphanPlugins: orphans,
    instances: snap.instances,
    instanceCheck: snap.instanceCheck ?? null,
    instruments: instrumentRows(snap),
    pairRequests: snap.pairRequests,
    pairedDevices: snap.pairedDevices,
    engineRunning: isRunning(snap),
    system: {
      build,
      status: snap.status,
      error: snap.error ?? null,
      hostError,
      engineId: snap.engineId,
      enginePort: snap.enginePort,
      ownsEngine: snap.ownsEngine,
      registryUrl: snap.registryUrl,
      lastHeartbeatOk: snap.lastHeartbeatOk,
      canStart: !isRunning(snap),
      canAct: ownsRunning(snap),
    },
  };
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Whether a new snapshot changes anything the window DRAWS: the catalogue is gated on its signature, not compared. */
export function differs(a: Snapshot, b: Snapshot): boolean {
  return (
    a.audioMenuSig !== b.audioMenuSig ||
    a.pluginsSig !== b.pluginsSig ||
    a.pluginCount !== b.pluginCount ||
    a.sessionsSig !== b.sessionsSig ||
    a.editPluginsSig !== b.editPluginsSig ||
    a.status !== b.status ||
    a.error !== b.error ||
    a.ownsEngine !== b.ownsEngine ||
    a.engineId !== b.engineId ||
    a.enginePort !== b.enginePort ||
    a.registryUrl !== b.registryUrl ||
    a.lastHeartbeatOk !== b.lastHeartbeatOk ||
    !same(a.instances, b.instances) ||
    !same(a.instanceCheck, b.instanceCheck) ||
    !same(a.instruments, b.instruments) ||
    !same(a.downloads, b.downloads) ||
    !same(a.pairRequests, b.pairRequests) ||
    !same(a.pairedDevices, b.pairedDevices)
  );
}
