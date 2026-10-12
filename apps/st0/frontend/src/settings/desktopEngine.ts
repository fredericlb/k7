// desktopEngine.ts — the desktop app's built-in engine, as its preload hands it over (`window.studioEngine`):
// the supervisor's latest picture, pushed, and the few commands a page may send. Absent in a browser,
// and that absence is the probe. See apps/st0-standalone/docs/engine.md.

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

/** Ask the supervisor: only `engine.start|stop|restart`, `audio.priority` and `plugins.rescan` are taken. */
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
