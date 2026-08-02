// engineProbe.ts — classify each registered engine into a locality tier by actually
// reaching it: loopback answers = same machine (Tier 1), a LAN IP answers = same LAN
// (Tier 2), neither = elsewhere. The probe sends {type:"whoami"} and MATCHES THE ID, so a
// lookalike listener can't pass as this engine; the reply's token goes to the backend.

import type { EngineTier, PublicEngine } from "./types";

export interface RankedEngine {
  engine: PublicEngine;
  tier: EngineTier;
  wsUrl: string | null; // the engine ws address that answered; null for Tier 3
  fileBase: string | null; // the file service on the SAME host; null for Tier 3
  token: string | null; // from the whoami reply; null for Tier 3
}

const PROBE_TIMEOUT_MS = 1500;

// Try one address. Resolves the engine's token on a matching whoami, else null.
function probeOne(
  url: string,
  expectId: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let done = false;
    const finish = (token: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* not open */
      }
      resolve(token);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      return finish(null); // malformed url / blocked scheme
    }
    ws.onopen = () => ws.send(JSON.stringify({ type: "whoami" }));
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as {
          type?: string;
          id?: string;
          token?: string;
        };
        if (m.type === "whoami" && m.id === expectId)
          finish(typeof m.token === "string" ? m.token : "");
      } catch {
        /* ignore non-JSON frames */
      }
    };
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(null);
  });
}

interface Candidate {
  tier: EngineTier;
  host: string; // the host that answered — the file service is on the same host
  url: string;
}

function candidatesFor(e: PublicEngine): Candidate[] {
  const { loopback, lanIps, port } = e.addresses;
  return [
    { tier: 1, host: loopback, url: `ws://${loopback}:${port}` },
    ...lanIps.map(
      (ip): Candidate => ({ tier: 2, host: ip, url: `ws://${ip}:${port}` }),
    ),
  ];
}

async function rank(e: PublicEngine): Promise<RankedEngine> {
  // Probe every candidate at once and take the lowest tier that answered, paying no serial timeout for misses.
  const results = await Promise.all(
    candidatesFor(e).map(async (c) => ({
      c,
      token: await probeOne(c.url, e.id),
    })),
  );
  const hits = results.filter((r) => r.token !== null);
  hits.sort((a, b) => a.c.tier - b.c.tier);
  if (hits.length) {
    const best = hits[0];
    // The file service is on the SAME host that answered, at its advertised port.
    const fileBase = `http://${best.c.host}:${e.addresses.filePort}`;
    return {
      engine: e,
      tier: best.c.tier,
      wsUrl: best.c.url,
      fileBase,
      token: best.token,
    };
  }
  return { engine: e, tier: 3, wsUrl: null, fileBase: null, token: null };
}

// Rank every engine, closest tier first. Assigned ones are ranked too, so a caller can grey rather than hide.
export async function probeEngines(
  engines: PublicEngine[],
): Promise<RankedEngine[]> {
  const ranked = await Promise.all(engines.map(rank));
  return ranked.sort((a, b) => a.tier - b.tier);
}
