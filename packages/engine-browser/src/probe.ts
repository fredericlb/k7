// probe.ts — MEASURE each registered engine by reaching it, direct or through the origin's relay.
//
// The whoami round trip is the network half and the buffer size it reports is the audio half;
// their sum is the latency every surface bands into Q1/Q2/Q3. The probe MATCHES THE ID, so a
// lookalike listener cannot pass as this engine.
//
// Ranking is by milliseconds and never by locality: what a musician can do is decided by
// latency, not by which cable they arrive over, so a gigabit LAN beats a laptop sitting at
// 2048 frames. Unreachable is its own state, because it is not a slow link. See docs/access.md.

import {
  type EngineLatency,
  engineLatency,
} from "@studio/web-protocol/quality";
import { openSocket, RTC_SCHEME } from "./rtcSocket.ts";

/** The least an engine must tell us to be probed, structural rather than imported so no auth or git types come with it. */
export interface ProbeTarget {
  id: string;
  addresses: {
    loopback: string;
    lanIps: string[];
    port: number;
    filePort: number;
  };
  /** Minted per engine by `/engines`. Absent simply means no relay candidate is offered. */
  proxyTicket?: string;
  /** Its supervisor holds a tunnel, so a WebRTC candidate is offered too — packages/engine-tunnel/docs/rtc.md. */
  rtc?: boolean;
}

export interface RankedEngine<E extends ProbeTarget = ProbeTarget> {
  engine: E;
  /** What this link costs, measured. Null when nothing answered — unreachable is not a latency. */
  latency: EngineLatency | null;
  wsUrl: string | null; // the engine ws address that answered; null when unreachable
  fileBase: string | null; // the file service on the SAME host; null when unreachable
  token: string | null; // from the whoami reply; null when unreachable
  /** What the FILE service's gate takes when it is not `token`: a hub ticket, for files the server hosts. */
  fileToken?: string | null;
  /** Whether `fileBase` is the server's file hub rather than the engine machine's own service. */
  filesHosted?: boolean;
}

/** The token to show the file service at `fileBase` — the engine's own, unless the server hosts the files. */
export function fileTokenOf(r: RankedEngine): string | null {
  return r.fileToken ?? r.token;
}

/** Reachable, and therefore measured. Narrows the four nullable fields in one test. */
export function isReachable<E extends ProbeTarget>(
  r: RankedEngine<E>,
): r is RankedEngine<E> & {
  latency: EngineLatency;
  wsUrl: string;
  fileBase: string;
  token: string;
} {
  return r.latency !== null && r.wsUrl !== null;
}

/** How long an address has to answer `whoami` — three seconds, and the reason it is not one and a half is in docs/access.md. */
const PROBE_TIMEOUT_MS = 3000;

/** What one address answered: its token, the round trip, and the device it is playing through. */
interface Reply {
  token: string;
  rttMs: number;
  bufferFrames: number;
  sampleRate: number;
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
    ws.onopen = () => {
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
        };
        if (m.type === "whoami" && m.id === expectId)
          finish({
            token: typeof m.token === "string" ? m.token : "",
            rttMs: performance.now() - sentAt,
            // Absent from an older engine, or one whose device has not opened; zero reads as "not measured" downstream, never as "instant".
            bufferFrames: Number(m.bufferSize ?? 0),
            sampleRate: Number(m.sampleRate ?? 0),
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
  fileBase: string; // the file service that goes WITH it — the same host, or the same relay
}

/** Every way this browser might reach one engine — the order is documentation only, since `rank` races them and keeps the FASTEST. */
function candidatesFor(e: ProbeTarget, relayBase: string): Candidate[] {
  const { loopback, lanIps, port, filePort } = e.addresses;
  /** The addresses this page may actually dial in the clear; an HTTPS page counts a LAN attempt as MIXED CONTENT — see docs/access.md. */
  const dialable =
    location.protocol === "https:" ? [loopback] : [loopback, ...lanIps];
  const direct = dialable.map(
    (host): Candidate => ({
      url: `ws://${host}:${port}`,
      fileBase: `http://${host}:${filePort}`,
    }),
  );
  if (!e.proxyTicket) return direct;
  // Same origin as the page, so it inherits its scheme: an HTTPS page relays over `wss:`.
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const path = `${relayBase}/api/engine/${encodeURIComponent(e.id)}`;
  const relayed: Candidate[] = [
    {
      url: `${scheme}//${location.host}${path}/ws?ticket=${encodeURIComponent(e.proxyTicket)}`,
      fileBase: `${location.origin}${path}/files`,
    },
  ];
  // Straight to the engine's machine, with the relay's file base: the files never travel over this channel.
  if (e.rtc)
    relayed.push({
      url: `${RTC_SCHEME}${location.origin}${path}/rtc`,
      fileBase: `${location.origin}${path}/files`,
    });
  return [...direct, ...relayed];
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
  hits.sort((a, b) => a.reply.rttMs - b.reply.rttMs);
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
    // Whatever goes with the address that answered; a relayed socket beside a direct `http://` would be the mixed-content wall again.
    fileBase: best.c.fileBase,
    token: best.reply.token,
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
