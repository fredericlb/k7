// probe.ts — MEASURE each registered engine by reaching it: the whoami round trip is the
// network half, the buffer size it reports is the audio half, and their sum is the latency
// every surface then bands into Q1/Q2/Q3 (see @studio/web-protocol/quality). The probe sends
// {type:"whoami"} and MATCHES THE ID, so a lookalike listener can't pass as this engine; the
// reply's token goes to the backend.
//
// This replaced a locality TIER — loopback answered, or a LAN address did, or neither. That
// ranked a gigabit LAN below a laptop whose interface sat at 2048 frames, which is backwards:
// what a musician can and cannot do on an engine is decided by the milliseconds, not by which
// cable they arrive over. Unreachable stays its own state, because it is not a slow link.

import {
  type EngineLatency,
  engineLatency,
} from "@studio/web-protocol/quality";

/**
 * The least an engine must tell us to be probed. Declared structurally rather than
 * imported: the registry's `PublicEngine` satisfies it, and taking the dependency would
 * drag auth, workspaces and git types into the browser client for two field names.
 */
export interface ProbeTarget {
  id: string;
  addresses: {
    loopback: string;
    lanIps: string[];
    port: number;
    filePort: number;
  };
}

export interface RankedEngine<E extends ProbeTarget = ProbeTarget> {
  engine: E;
  /** What this link costs, measured. Null when nothing answered — unreachable is not a latency. */
  latency: EngineLatency | null;
  wsUrl: string | null; // the engine ws address that answered; null when unreachable
  fileBase: string | null; // the file service on the SAME host; null when unreachable
  token: string | null; // from the whoami reply; null when unreachable
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

const PROBE_TIMEOUT_MS = 1500;

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
      ws = new WebSocket(url);
    } catch {
      return finish(null); // malformed url / blocked scheme
    }
    ws.onopen = () => {
      // Timed from the SEND, not from the connect: a WebSocket handshake includes a TCP
      // open and, over TLS, a negotiation — none of which a frame pays again. What we want
      // is what one message costs on an established socket, which is what playing uses.
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
            // Absent from an engine older than this reply, or one whose device has not
            // opened yet. Zero reads as "not measured" downstream, never as "instant".
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
  host: string; // the host that answered — the file service is on the same host
  url: string;
}

function candidatesFor(e: ProbeTarget): Candidate[] {
  const { loopback, lanIps, port } = e.addresses;
  return [
    { host: loopback, url: `ws://${loopback}:${port}` },
    ...lanIps.map((ip): Candidate => ({ host: ip, url: `ws://${ip}:${port}` })),
  ];
}

async function rank<E extends ProbeTarget>(e: E): Promise<RankedEngine<E>> {
  // Every address at once, paying no serial timeout for the misses — then the FASTEST that
  // answered, which is the whole ranking now. Loopback usually wins it; when a LAN address
  // wins instead, that is a measurement rather than an exception to a rule.
  const results = await Promise.all(
    candidatesFor(e).map(async (c) => ({
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
    // The file service is on the SAME host that answered, at its advertised port.
    fileBase: `http://${best.c.host}:${e.addresses.filePort}`,
    token: best.reply.token,
  };
}

/**
 * Ask whatever is listening on loopback who it is.
 *
 * For a surface that wants THIS machine's engine and has no registry to consult — a module
 * preview plays on the machine the module is on, so the registry's whole job (which of my
 * machines?) has no question to answer. Accepts whichever id answers, because the id is not
 * what is being trusted: the TOKEN is, and it is verified by the service that gates on it.
 */
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

// Measure every engine, LOWEST LATENCY first; the unreachable sink to the bottom, since they
// are not a slow link but no link. Assigned ones are measured too, so a caller can grey rather
// than hide.
export async function probeEngines<E extends ProbeTarget>(
  engines: E[],
): Promise<RankedEngine<E>[]> {
  const ranked = await Promise.all(engines.map((e) => rank(e)));
  return ranked.sort(
    (a, b) =>
      (a.latency?.totalMs ?? Number.POSITIVE_INFINITY) -
      (b.latency?.totalMs ?? Number.POSITIVE_INFINITY),
  );
}
