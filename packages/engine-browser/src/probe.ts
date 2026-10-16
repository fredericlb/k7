// probe.ts — MEASURE each registered engine by reaching it, direct or through the origin's relay.
//
// The whoami round trip is the network half and the buffer size it reports is the audio half;
// their sum is the latency every surface bands into Q1/Q2/Q3. The probe MATCHES THE ID, so a
// lookalike listener cannot pass as this engine.
//
// Ranking is by milliseconds and never by locality: what a musician can do is decided by
// latency, not by which cable they arrive over, so a gigabit LAN beats a laptop sitting at
// 2048 frames. Unreachable is its own state, because it is not a slow link. See docs/access.md.

import { ENGINE_PROXY_PATH } from "@studio/web-protocol";
import {
  type EngineLatency,
  engineLatency,
} from "@studio/web-protocol/quality";
import { forgetPairKey, noteEngineAt, pairKeyFor } from "./pairing.ts";
import { openSocket, RTC_SCHEME } from "./rtcSocket.ts";

/** The least an engine must tell us to be probed, structural rather than imported so no auth or git types come with it. */
export interface ProbeTarget {
  id: string;
  addresses: {
    loopback: string;
    lanIps: string[];
    port: number;
  };
  /** Minted per engine by `/engines`. Absent simply means no relay candidate is offered. */
  proxyTicket?: string;
  /** Its supervisor holds a tunnel, so a WebRTC candidate is offered too — packages/engine-tunnel/docs/rtc.md. */
  rtc?: boolean;
  /** The server's own engine, its tunnel authenticated by the render key — packages/engine-tunnel/docs/jobs.md. */
  server?: boolean;
}

export interface RankedEngine<E extends ProbeTarget = ProbeTarget> {
  engine: E;
  /** What this link costs, measured. Null when nothing answered — unreachable is not a latency. */
  latency: EngineLatency | null;
  wsUrl: string | null; // the engine ws address that answered; null when unreachable
  /** The account's file service — the server's file hub, when it hosts the files; null otherwise. */
  fileBase: string | null;
  token: string | null; // from the whoami reply; null when unreachable
  /** What the FILE service's gate takes when it is not `token`: a hub ticket, for files the server hosts. */
  fileToken?: string | null;
  /** Whether `fileBase` is the server's file hub rather than the engine machine's own service. */
  filesHosted?: boolean;
  /** It answered over the LAN but this device is not paired with it: reachable, and not usable until paired — docs/pairing.md. */
  needsPairing?: boolean;
}

/** The token to show the file service at `fileBase` — the engine's own, unless the server hosts the files. */
export function fileTokenOf(r: RankedEngine): string | null {
  return r.fileToken ?? r.token;
}

/** Answered over LOOPBACK: the engine on the machine this page runs on — the one whose speakers you are in front of. */
export const onThisMachine = (r: { wsUrl: string | null }): boolean =>
  !!r.wsUrl && /^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(r.wsUrl);

/** A loopback or private host: one a browser reaches only on its own machine or its own network. */
const PRIVATE_HOST =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|localhost$|\[(::1|f[cd][0-9a-f]*:.*|fe80:.*)\]$)/i;

/** Answered on a DIRECT socket to one of the engine's own private addresses — never the relay nor WebRTC — see docs/access.md. */
export function reachedDirectly(r: {
  engine: ProbeTarget;
  wsUrl: string | null;
  token: string | null;
}): boolean {
  if (!r.wsUrl || !r.token) return false;
  let u: URL;
  try {
    u = new URL(r.wsUrl);
  } catch {
    return false;
  }
  const { loopback, lanIps, port } = r.engine.addresses;
  return (
    u.protocol === "ws:" &&
    u.port === String(port) &&
    (u.pathname === "/" || u.pathname === "") &&
    [loopback, ...(lanIps ?? [])].includes(u.hostname) &&
    PRIVATE_HOST.test(u.hostname)
  );
}

/** Reachable, and therefore measured. Narrows the three nullable fields the engine answered, in one test. */
export function isReachable<E extends ProbeTarget>(
  r: RankedEngine<E>,
): r is RankedEngine<E> & {
  latency: EngineLatency;
  wsUrl: string;
  token: string;
} {
  return r.latency !== null && r.wsUrl !== null && r.token !== null;
}

/** How long an address has to answer `whoami` — three seconds, and the reason it is not one and a half is in docs/access.md. */
const PROBE_TIMEOUT_MS = 3000;

/** What one address answered: its token, the round trip, and the device it is playing through. */
interface Reply {
  token: string;
  rttMs: number;
  bufferFrames: number;
  sampleRate: number;
  needsPairing: boolean;
}

// Try one address. Resolves the whoami reply on a matching id, else null.
function probeOne(
  url: string,
  expectId: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<Reply | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let done = false;
    let sentAt = 0;
    const finish = (reply: Reply | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* not open */
      }
      resolve(reply);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      ws = openSocket(url);
    } catch {
      return finish(null); // malformed url / blocked scheme
    }
    noteEngineAt(url, expectId);
    ws.onopen = () => {
      // The key first, when this device holds one: over the LAN the engine answers nothing else until it is shown (docs/pairing.md).
      const key = pairKeyFor(expectId);
      if (key) ws.send(JSON.stringify({ type: "pair", key }));
      // Timed from the SEND, not the connect: what we want is what one message costs on an established socket, which is what playing uses.
      sentAt = performance.now();
      ws.send(JSON.stringify({ type: "whoami" }));
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as {
          type?: string;
          id?: string;
          token?: string;
          bufferSize?: number;
          sampleRate?: number;
          code?: string;
          needsPairing?: boolean;
        };
        // The key was refused: this device was unpaired on the machine, and keeping it would refuse every reconnect.
        if (m.type === "error" && m.code === "unpaired")
          forgetPairKey(expectId);
        if (m.type === "whoami" && m.id === expectId)
          finish({
            token: typeof m.token === "string" ? m.token : "",
            rttMs: performance.now() - sentAt,
            // Absent from an older engine, or one whose device has not opened; zero reads as "not measured" downstream, never as "instant".
            bufferFrames: Number(m.bufferSize ?? 0),
            sampleRate: Number(m.sampleRate ?? 0),
            needsPairing: m.needsPairing === true,
          });
      } catch {
        /* ignore non-JSON frames */
      }
    };
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(null);
  });
}

interface Candidate {
  url: string; // the WebSocket to try
}

/** Every way this browser might reach one engine — the order is documentation only, since `rank` races them and keeps the FASTEST. */
function candidatesFor(e: ProbeTarget, relayBase: string): Candidate[] {
  const { loopback, lanIps, port } = e.addresses;
  /** The addresses this page may actually dial in the clear; an HTTPS page counts a LAN attempt as MIXED CONTENT — see docs/access.md. */
  const dialable =
    location.protocol === "https:" ? [loopback] : [loopback, ...lanIps];
  const direct = dialable.map(
    (host): Candidate => ({ url: `ws://${host}:${port}` }),
  );
  if (!e.proxyTicket) return direct;
  const relay = relayUrls(relayBase, e.id, e.proxyTicket, location.href);
  const relayed: Candidate[] = [{ url: relay.ws }];
  // Straight to the engine's machine; the files are the server's, never this channel's.
  if (e.rtc) relayed.push({ url: relay.rtc });
  return [...direct, ...relayed];
}

/** The relay's two doors for one engine; `relayBase` is a path on the page's origin or another origin's URL, both resolved against `pageHref`. */
export function relayUrls(
  relayBase: string,
  id: string,
  ticket: string,
  pageHref: string,
): { ws: string; rtc: string } {
  const http = new URL(
    `${relayBase}${ENGINE_PROXY_PATH}/${encodeURIComponent(id)}`,
    pageHref,
  );
  // The relay's own scheme decides, not the page's: an HTTPS relay is reached over `wss:`.
  const ws = new URL(http.href);
  ws.protocol = http.protocol === "https:" ? "wss:" : "ws:";
  return {
    ws: `${ws.href}/ws?ticket=${encodeURIComponent(ticket)}`,
    rtc: `${RTC_SCHEME}${http.href}/rtc`,
  };
}

async function rank<E extends ProbeTarget>(
  e: E,
  relayBase: string,
): Promise<RankedEngine<E>> {
  // Every address at once, paying no serial timeout for the misses, then the FASTEST that answered — which is the whole ranking now.
  const results = await Promise.all(
    candidatesFor(e, relayBase).map(async (c) => ({
      c,
      reply: await probeOne(c.url, e.id),
    })),
  );
  const hits = results.flatMap((r) =>
    r.reply ? [{ c: r.c, reply: r.reply }] : [],
  );
  // An address this device may USE beats a faster one it would first have to pair on, or one that withheld the token.
  hits.sort(
    (a, b) =>
      Number(a.reply.needsPairing) - Number(b.reply.needsPairing) ||
      Number(!a.reply.token) - Number(!b.reply.token) ||
      a.reply.rttMs - b.reply.rttMs,
  );
  if (!hits.length)
    return {
      engine: e,
      latency: null,
      wsUrl: null,
      fileBase: null,
      token: null,
    };
  const best = hits[0];
  return {
    engine: e,
    latency: engineLatency(
      best.reply.rttMs,
      best.reply.bufferFrames,
      best.reply.sampleRate,
    ),
    wsUrl: best.c.url,
    // The files are the server's hub's, set by `engineAccess` when it hosts them — never the engine machine's.
    fileBase: null,
    // No token until paired, nor through a relay that withheld it (engine-registry docs/ownership.md): every chooser filters on it.
    token: best.reply.needsPairing ? null : best.reply.token || null,
    needsPairing: best.reply.needsPairing,
  };
}

/** Ask whatever is listening on loopback who it is, for a surface with no registry to consult; any id is accepted, since the TOKEN is what is trusted. */
export function probeLocalEngine(
  port = 8765,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<{ id: string; token: string; wsUrl: string } | null> {
  const wsUrl = `ws://127.0.0.1:${port}`;
  return new Promise((resolve) => {
    let ws: WebSocket;
    let done = false;
    const finish = (v: { id: string; token: string; wsUrl: string } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* not open */
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return finish(null);
    }
    ws.onopen = () => ws.send(JSON.stringify({ type: "whoami" }));
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as {
          type?: string;
          id?: string;
          token?: string;
        };
        if (m.type === "whoami" && m.id)
          finish({ id: m.id, token: m.token ?? "", wsUrl });
      } catch {
        /* ignore non-JSON frames */
      }
    };
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(null);
  });
}

// Measure every engine, LOWEST LATENCY first; the unreachable sink to the bottom, and assigned ones are measured too, so a caller can grey rather than hide.
export async function probeEngines<E extends ProbeTarget>(
  engines: E[],
  /** The calling app's own origin prefix under which its relay answers, passed rather than derived, exactly as `registryClient` takes its `base`. */
  relayBase: string,
): Promise<RankedEngine<E>[]> {
  const ranked = await Promise.all(engines.map((e) => rank(e, relayBase)));
  return ranked.sort(
    (a, b) =>
      (a.latency?.totalMs ?? Number.POSITIVE_INFINITY) -
      (b.latency?.totalMs ?? Number.POSITIVE_INFINITY),
  );
}
