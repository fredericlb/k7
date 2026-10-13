// androidEngine.ts — the phone's engine, when st0 runs inside the Android app: `window.st0Android`,
// which that app puts in its views (engine/st0-android/.../StudioBridge.kt) and answers for st0's
// origin only. Absent in a browser, so everything here is null there and the section is not drawn.
// See engine/st0-engine/docs/android.md.

import { useEffect, useState } from "react";

interface Channel {
  postMessage(message: string): void;
  addEventListener(
    type: "message",
    listener: (e: { data: string }) => void,
  ): void;
}

/** The supervisor's `state` frame, the part the panel draws. */
export interface EngineState {
  status?: string;
  enginePort?: number;
  error?: string;
  instances?: { url: string; removable?: boolean }[];
  lastHeartbeatOk?: boolean;
  instanceCheck?: { state?: string; url?: string; message?: string };
}

export interface EngineSnapshot {
  state?: EngineState;
  engineExit?: number;
  /** st0's origin for the studio the app's views open. */
  studio: string | null;
}

const channel = (window as { st0Android?: Channel }).st0Android ?? null;

/** Inside the Android app, with its engine to show. */
export const onAndroid = channel !== null;

let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
const watchers = new Set<(s: EngineSnapshot) => void>();
let last: EngineSnapshot | null = null;
let listening = false;

channel?.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.t === "snapshot") {
    last = msg;
    for (const w of watchers) w(msg);
  } else if (msg.t === "reply") {
    const call = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) call?.resolve(msg.value);
    else call?.reject(new Error(msg.error));
  }
});

/** One of the engine methods the Android app answers. */
export function engineCall<T = Record<string, never>>(
  method:
    | "command"
    | "lanAddress"
    | "casInfo"
    | "importCa"
    | "forgetCas"
    | "chooseStudio"
    | "quit",
  arg?: Record<string, string>,
): Promise<T> {
  if (!channel) return Promise.reject(new Error("not in the Android app"));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    channel.postMessage(JSON.stringify({ t: "call", id, method, arg }));
  });
}

/** The latest snapshot, kept current; null until the app has answered, and always in a browser. */
export function useEngineSnapshot(): EngineSnapshot | null {
  const [snapshot, setSnapshot] = useState(last);
  useEffect(() => {
    if (!channel) return;
    watchers.add(setSnapshot);
    // One `listen` per page: the app keeps pushing to whichever page sent the latest.
    if (!listening) {
      listening = true;
      channel.postMessage(JSON.stringify({ t: "listen" }));
    }
    return () => {
      watchers.delete(setSnapshot);
    };
  }, []);
  return snapshot;
}
