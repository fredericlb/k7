// The remote's controller: one state bag, one socket, one wake lock, built once per mount.
// Views get the whole controller and call `render()` after mutating `g`; nothing here is React state.

import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { WakeLock } from "../lib/wakeLock";
import { BuzzerSocket } from "../lib/ws";
import { createActions } from "./actions";
import { hydrate, wireSocket } from "./socket";
import { createRemoteState, createRuntime, type RemoteCtx } from "./state";

function createController(render: () => void) {
  const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ctx: RemoteCtx = {
    g: createRemoteState(),
    nr: createRuntime(),
    render,
    socket: new BuzzerSocket(
      `${wsProto}//${window.location.host}/ws?role=remote`,
    ),
    wakeLock: new WakeLock(),
  };
  const actions = createActions(ctx);
  const ensureWakeLock = () => {
    if (!ctx.wakeLock.acquired) void ctx.wakeLock.acquire();
  };
  return { ...ctx, a: actions, ensureWakeLock };
}

export type Remote = ReturnType<typeof createController> & {
  isConnected: boolean;
};

export function useRemote(): Remote {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [remote] = useState(() => createController(force as () => void));
  const { socket, nr, wakeLock, a } = remote;
  const isConnected = useSyncExternalStore(
    socket.subscribe,
    socket.isConnected,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: wired once; the controller is stable for the mount.
  useEffect(() => {
    socket.connect();
    void hydrate(remote, a);
    void a.refreshSessions();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        wakeLock.acquired = false;
        void wakeLock.acquire();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    wireSocket(remote, a);

    return () => {
      a.stopAnswerTimer();
      for (const ws of nr.buzzerSockets.values()) ws.close();
      nr.buzzerSockets.clear();
      document.removeEventListener("visibilitychange", onVisibility);
      wakeLock.release();
      socket.disconnect();
    };
  }, []);

  return { ...remote, isConnected };
}
