// desktopEngine.ts — the desktop app's built-in engine, as its preload hands it over (`window.studioEngine`):
// the supervisor's latest picture, pushed, and the few commands a page may send. Absent in a browser,
// and that absence is the probe. See apps/k7-standalone/docs/engine.md.

import { useEffect, useState } from "react";

/** What this page draws of the supervisor's snapshot (packages/supervisor-host/src/hostProtocol.ts). */
export interface DesktopEngineSnapshot {
  status: "stopped" | "running" | "error";
  error?: string;
  userStopped: boolean;
  engineId: string;
  enginePort: number;
  lastHeartbeatOk: boolean;
  pluginCount?: number;
  plugins?: { name: string; format: string; manufacturer: string }[];
  audioDevices?: {
    name: string;
    deviceType: string;
    current: boolean;
    currentInput: boolean;
  }[];
  audioPriority?: string[];
  instruments?: {
    name: string;
    label: string;
    bytes: number;
    wanted: boolean;
    installed: boolean;
  }[];
  downloads?: {
    name: string;
    received: number;
    total: number;
    phase: "queued" | "downloading" | "unpacking" | "failed";
    error?: string;
  }[];
}

/** One instrument as the Downloads section draws it: the catalogue row and where its download stands. */
export interface InstrumentRow {
  name: string;
  label: string;
  bytes: number;
  installed: boolean;
  wanted: boolean;
  phase: "queued" | "downloading" | "unpacking" | "failed" | null;
  received: number;
  error: string | null;
}

/** Every instrument the engine can play, each with its download's phase when one is queued or running. */
export function instrumentRows(
  s: Pick<DesktopEngineSnapshot, "instruments" | "downloads">,
): InstrumentRow[] {
  const downloads = s.downloads ?? [];
  return (s.instruments ?? []).map((i) => {
    const d = downloads.find((x) => x.name === i.name);
    return {
      ...i,
      phase: d?.phase ?? null,
      received: d?.received ?? 0,
      error: d?.error ?? null,
    };
  });
}

/** The row's one action, or none while a download runs: the supervisor cannot cut one mid-file. */
export function instrumentAction(
  i: InstrumentRow,
): { label: "cancel" | "retry" | "remove" | "download"; cmd: string } | null {
  if (i.phase === "downloading" || i.phase === "unpacking") return null;
  if (i.phase === "queued")
    return { label: "cancel", cmd: "instruments.remove" };
  if (i.phase === "failed")
    return { label: "retry", cmd: "instruments.download" };
  if (i.installed) return { label: "remove", cmd: "instruments.remove" };
  return { label: "download", cmd: "instruments.download" };
}

/** "748 MB", "1.3 GB": the size the list pins, which is what the download costs. */
export function sizeOf(bytes: number): string {
  const mb = bytes / 1e6;
  return mb >= 1000
    ? `${(mb / 1000).toFixed(1)} GB`
    : `${Math.max(1, Math.round(mb))} MB`;
}

export interface DesktopEngineState {
  snapshot: DesktopEngineSnapshot | null;
  /** Why the supervisor is away (restarting, failed), or null. */
  down: string | null;
}

interface EngineBridge {
  state: () => Promise<DesktopEngineState | null>;
  subscribe: (cb: (s: DesktopEngineState) => void) => () => void;
  send: (cmd: string, arg?: string) => void;
}

declare global {
  interface Window {
    studioEngine?: EngineBridge;
  }
}

/** True inside the desktop app, which runs an engine of its own. */
export const onDesktopEngine = (): boolean =>
  typeof window !== "undefined" && !!window.studioEngine;

/** Ask the supervisor: only `engine.start|stop|restart`, `audio.priority`, `plugins.rescan` and `instruments.download|remove` are taken. */
export const engineCommand = (cmd: string, arg?: string): void =>
  window.studioEngine?.send(cmd, arg);

/** The engine's state, asked once and then pushed. */
export function useDesktopEngine(): DesktopEngineState | null {
  const [state, setState] = useState<DesktopEngineState | null>(null);
  useEffect(() => {
    const bridge = window.studioEngine;
    if (!bridge) return;
    let live = true;
    void bridge.state().then((s) => live && s && setState(s));
    const off = bridge.subscribe((s) => live && setState(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

/** The ranking as the supervisor keeps it: ranked names first (present or not), then the devices not ranked. */
export function rankedDevices(s: DesktopEngineSnapshot): {
  name: string;
  deviceType: string;
  present: boolean;
  current: boolean;
  currentInput: boolean;
  ranked: boolean;
}[] {
  const devices = s.audioDevices ?? [];
  const priority = s.audioPriority ?? [];
  const rest = devices
    .filter((d) => !priority.includes(d.name))
    .map((d) => d.name);
  return [...priority, ...rest].map((name, i) => {
    const d = devices.find((x) => x.name === name);
    return {
      name,
      deviceType: d?.deviceType ?? "",
      present: d !== undefined,
      current: d?.current ?? false,
      currentInput: d?.currentInput ?? false,
      ranked: i < priority.length,
    };
  });
}

/** The list on screen IS the ranking: what is shown, in its order, is sent whole on every move. */
export function moveDevice(
  names: string[],
  from: number,
  to: number,
): string[] {
  const out = [...names];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}
