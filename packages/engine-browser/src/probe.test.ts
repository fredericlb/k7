// The probe's ordering of the answers one engine gave. A relay that measured faster than the
// engine's own loopback must not win: the gate takes unasked only an engine reached directly.

import { describe, expect, it } from "vitest";
import { mayAutoPick } from "./choose.ts";
import { orderHits, type ProbeTarget, reachedDirectly } from "./probe.ts";

const target: ProbeTarget = {
  id: "desk",
  addresses: { loopback: "127.0.0.1", lanIps: [], port: 8765 },
  proxyTicket: "ticket",
};

const hit = (
  url: string,
  direct: boolean,
  rttMs: number,
  reply: { token?: string; needsPairing?: boolean } = {},
) => ({
  c: { url, direct },
  reply: {
    token: reply.token ?? "t",
    needsPairing: reply.needsPairing ?? false,
    rttMs,
  },
});

const RELAY = "wss://k7.example/api/engines/proxy/desk/ws?ticket=ticket";
const LOOPBACK = "ws://127.0.0.1:8765";

describe("orderHits", () => {
  it("puts the direct socket first even when the relay measured faster", () => {
    const [best] = orderHits([hit(RELAY, false, 1), hit(LOOPBACK, true, 5)]);
    expect(best.c.url).toBe(LOOPBACK);
    // …which is what lets the gate take this machine's engine with nobody clicking.
    const ranked = { engine: target, wsUrl: best.c.url, token: "t" };
    expect(reachedDirectly(ranked)).toBe(true);
    expect(
      mayAutoPick({ ...ranked, latency: null, fileBase: null }, undefined),
    ).toBe(true);
  });

  it("still ranks by speed among sockets of the same kind", () => {
    const [best] = orderHits([
      hit("ws://192.168.1.20:8765", true, 9),
      hit(LOOPBACK, true, 2),
    ]);
    expect(best.c.url).toBe(LOOPBACK);
  });

  it("prefers a usable relay to a direct socket that withheld its token or needs pairing", () => {
    expect(
      orderHits([
        hit(LOOPBACK, true, 1, { token: "" }),
        hit(RELAY, false, 9),
      ])[0].c.url,
    ).toBe(RELAY);
    expect(
      orderHits([
        hit(LOOPBACK, true, 1, { needsPairing: true }),
        hit(RELAY, false, 9),
      ])[0].c.url,
    ).toBe(RELAY);
  });
});
