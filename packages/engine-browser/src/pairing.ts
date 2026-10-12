// pairing.ts — this browser's side of LAN pairing: the key an engine gave it, sent first on every socket it
// opens, and the request that earns one. A page on the engine's own machine and the server's relay need
// none — the engine trusts both — so a key is only ever needed over the LAN. See docs/pairing.md.

import { openSocket } from "./rtcSocket.ts";

const PREFIX = "st0.engine-pair.";
/** How long a request waits for the musician: the engine forgets it after two minutes too. */
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

// Which engine answered at which address, learnt by the probe: a client opens a URL and must know whose key to show.
const engineAt = new Map<string, string>();

/** The key this browser holds for an engine, or null. Storage can be refused (a private window), and that is no key. */
export function pairKeyFor(engineId: string): string | null {
  try {
    return localStorage.getItem(PREFIX + engineId);
  } catch {
    return null;
  }
}

export function rememberPairKey(engineId: string, key: string): void {
  try {
    localStorage.setItem(PREFIX + engineId, key);
  } catch {
    /* refused: the pairing lasts as long as this page */
  }
}

/** Forgotten when the engine refuses it: the device was unpaired on the machine. */
export function forgetPairKey(engineId: string): void {
  try {
    localStorage.removeItem(PREFIX + engineId);
  } catch {
    /* nothing stored */
  }
}

/** Record that `url` reaches `engineId`; the probe calls it for every address it tries. */
export function noteEngineAt(url: string, engineId: string): void {
  engineAt.set(url, engineId);
}

/** The first frame a socket to `url` sends to prove this device, or null when it holds no key for that engine. */
export function pairFrameFor(url: string): string | null {
  const id = engineAt.get(url);
  const key = id ? pairKeyFor(id) : null;
  return key ? JSON.stringify({ type: "pair", key }) : null;
}

/** What the musician will read on the machine: the kind of device, and the browser on it. */
export function deviceName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const device = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android device"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows PC"
            : /Linux/.test(ua)
              ? "Linux PC"
              : "device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "a browser";
  return `${device} · ${browser}`;
}

export type PairingOutcome = "paired" | "denied" | "expired" | "failed";

/**
 * Ask the engine at `url` to pair this device: `onCode` is handed the code to show, which the musician
 * checks on the machine before approving. Resolves once answered; the key is stored on "paired".
 */
export function requestPairing(
  url: string,
  engineId: string,
  onCode: (code: string) => void,
  name: string = deviceName(),
): Promise<PairingOutcome> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let done = false;
    const finish = (outcome: PairingOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* not open */
      }
      resolve(outcome);
    };
    const timer = setTimeout(() => finish("expired"), REQUEST_TIMEOUT_MS);
    try {
      ws = openSocket(url);
    } catch {
      return finish("failed");
    }
    ws.onopen = () => ws.send(JSON.stringify({ type: "pair-request", name }));
    ws.onmessage = (ev) => {
      let m: { type?: string; code?: string; key?: string };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type === "pair-pending" && m.code) onCode(m.code);
      else if (m.type === "paired" && m.key) {
        rememberPairKey(engineId, m.key);
        noteEngineAt(url, engineId);
        finish("paired");
      } else if (m.type === "pair-denied") finish("denied");
      else if (m.type === "error") finish("failed");
    };
    ws.onerror = () => finish("failed");
    ws.onclose = () => finish("failed");
  });
}
