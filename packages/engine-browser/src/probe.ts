// probe.ts — MEASURE each registered engine by reaching it, direct or through the web
// origin's relay: the whoami round trip is the
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
  /** Minted per engine by `/engines`. Absent simply means no relay candidate is offered. */
  proxyTicket?: string;
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

/**
 * Combien de temps une adresse a pour répondre `whoami`.
 *
 * Trois secondes et non une et demie, pour deux raisons qui vont ensemble. D'abord le coût :
 * les candidats sont mesurés EN PARALLÈLE, donc un moteur réellement absent coûte UN délai et
 * non un par adresse — l'allonger retarde le verdict de rien du tout dans le cas courant.
 *
 * Ensuite ce qu'on mesure. Sur toute machine autre que celle du moteur, les candidats directs
 * sont refusés par le navigateur (une page HTTPS n'ouvre pas de `ws://`), donc la seule voie
 * praticable est le RELAIS : page → proxy → backend → moteur. Juger ce chemin-là au budget
 * d'un aller-retour en loopback, c'est déclarer injoignable ce qui n'est que plus long — et
 * `unreachable` n'est pas une latence lente, c'est un état à part qui cache le moteur.
 */
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
  url: string; // the WebSocket to try
  fileBase: string; // the file service that goes WITH it — the same host, or the same relay
}

/**
 * Every way this browser might reach one engine: loopback, each LAN address, then the RELAY
 * through the web origin.
 *
 * The relay is not a fallback for a broken network. The first two are `ws://`, and a page
 * served over HTTPS may not open one to anything but the loopback — so on any machine other
 * than the engine's, the LAN candidates are refused by the browser before a packet leaves,
 * however healthy the engine is. Measured on a LAN where the port was provably open from the
 * remote machine's own shell. It is also what makes macOS's local-network permission and a
 * closed inbound port stop mattering: nothing dials a LAN address any more.
 *
 * Last in the list, but the order is only documentation — `rank` races them and keeps the
 * FASTEST, so a direct link wins wherever it is allowed, and the extra hop loses on its own.
 */
function candidatesFor(e: ProbeTarget, relayBase: string): Candidate[] {
  const { loopback, lanIps, port, filePort } = e.addresses;
  const direct = [loopback, ...lanIps].map(
    (host): Candidate => ({
      url: `ws://${host}:${port}`,
      fileBase: `http://${host}:${filePort}`,
    }),
  );
  if (!e.proxyTicket) return direct;
  // Same origin as the page, so it inherits its scheme: an HTTPS page relays over `wss:`.
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const path = `${relayBase}/api/engine/${encodeURIComponent(e.id)}`;
  return [
    ...direct,
    {
      url: `${scheme}//${location.host}${path}/ws?ticket=${encodeURIComponent(e.proxyTicket)}`,
      fileBase: `${location.origin}${path}/files`,
    },
  ];
}

async function rank<E extends ProbeTarget>(
  e: E,
  relayBase: string,
): Promise<RankedEngine<E>> {
  // Every address at once, paying no serial timeout for the misses — then the FASTEST that
  // answered, which is the whole ranking now. Loopback usually wins it; when a LAN address
  // wins instead, that is a measurement rather than an exception to a rule.
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
    // Whatever goes with the address that answered: the same host, or the same relay. The two
    // must not be mixed — a relayed socket beside a direct `http://` would be the wall again.
    fileBase: best.c.fileBase,
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
  /** The calling app's own origin prefix — "" for st0, "/pl8", "/m9" — under which its relay
   *  answers. Passed rather than derived, exactly as `registryClient` takes its `base`. */
  relayBase: string,
): Promise<RankedEngine<E>[]> {
  const ranked = await Promise.all(engines.map((e) => rank(e, relayBase)));
  return ranked.sort(
    (a, b) =>
      (a.latency?.totalMs ?? Number.POSITIVE_INFINITY) -
      (b.latency?.totalMs ?? Number.POSITIVE_INFINITY),
  );
}
