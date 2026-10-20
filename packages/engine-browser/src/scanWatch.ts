// scanWatch.ts — follow ONE engine's plugin scan from a page that drives nothing: a socket that asks
// `plugin-scan` once and then hears the frames the engine broadcasts while a scan runs. It claims
// nothing, so the relay lets it through as a probe. See docs/access.md.

import {
  decodePluginScan,
  type PluginScanStatus,
} from "@studio/engine-protocol/decode";
import { pairFrameFor } from "./pairing.ts";
import { openSocket } from "./rtcSocket.ts";

export type { PluginScanStatus } from "@studio/engine-protocol/decode";

/** How long a lost socket waits before it dials again. */
const REDIAL_MS = 5000;

/** Hear `wsUrl`'s scan until the returned stop is called; `onStatus(null)` while the engine is out of reach. */
export function watchPluginScan(
  wsUrl: string | (() => string | Promise<string | null>),
  onStatus: (s: PluginScanStatus | null) => void,
): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const redial = () => {
    onStatus(null);
    if (!stopped) timer = setTimeout(() => void dial(), REDIAL_MS);
  };
  const dial = async () => {
    // A function is asked on every dial, so a relay ticket that aged is minted again.
    const url = typeof wsUrl === "string" ? wsUrl : await wsUrl();
    if (stopped) return;
    if (!url) return redial();
    try {
      ws = openSocket(url);
    } catch {
      return redial();
    }
    const sock = ws;
    sock.onopen = () => {
      // The device's key first, as every socket to an engine over the LAN must (docs/pairing.md).
      const pair = pairFrameFor(url);
      if (pair) sock.send(pair);
      sock.send(JSON.stringify({ type: "plugin-scan" }));
    };
    sock.onmessage = (ev) => {
      try {
        const s = decodePluginScan(JSON.parse(String(ev.data)));
        if (s) onStatus(s);
      } catch {
        /* not JSON — not the answer */
      }
    };
    sock.onclose = () => {
      if (ws === sock) redial();
    };
  };
  void dial();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    const sock = ws;
    ws = null;
    try {
      sock?.close();
    } catch {
      /* not open */
    }
  };
}
