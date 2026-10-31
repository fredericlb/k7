// The engine-choice policy. Each case pins a decision that is invisible once wrong: a
// preview that connects to the wrong machine looks exactly like one that connects to the
// right one, until you wonder why you cannot hear it.

import type { PublicEngine } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { bestEngine, chooseEngine } from "./choose.ts";
import { type RankedEngine, reachedDirectly } from "./probe.ts";

const engine = (id: string, ms: number | null): RankedEngine<PublicEngine> =>
  ({
    engine: {
      id,
      hostname: id,
      addresses: {
        loopback: "127.0.0.1",
        lanIps: ["192.168.1.20"],
        port: 8765,
      },
      assigned: false,
      sameSourceIp: false,
    },
    latency:
      ms === null
        ? null
        : { networkMs: ms, audioMs: 0, totalMs: ms, quality: "Q1" },
    wsUrl: ms === null ? null : "ws://192.168.1.20:8765",
    fileBase: ms === null ? null : `http://${id}:8770`,
    token: ms === null ? null : "t",
  }) as unknown as RankedEngine<PublicEngine>;

describe("chooseEngine", () => {
  it("takes the remembered one even when others are reachable", () => {
    const r = chooseEngine([engine("a", 5), engine("b", 30)], "b");
    expect(r.engine?.engine.id).toBe("b");
    expect(r.ambiguous).toBe(false);
  });

  // One reachable engine is not a choice — a dialog in front of the only possible answer.
  it("takes the only reachable one with nothing remembered", () => {
    const r = chooseEngine([engine("a", 5)], undefined);
    expect(r.engine?.engine.id).toBe("a");
    expect(r.ambiguous).toBe(false);
  });

  it("asks only when several are reachable and none is remembered", () => {
    const r = chooseEngine([engine("a", 5), engine("b", 30)], undefined);
    expect(r.engine).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  // UNREACHABLE is "listed but nothing answered here", and offering one produces a preview that silently never connects.
  it("never offers an unreachable engine, remembered or not", () => {
    expect(chooseEngine([engine("far", null)], "far").engine).toBeNull();
    expect(chooseEngine([engine("far", null)], undefined).ambiguous).toBe(
      false,
    );
  });

  // The usual reason is being on the wrong network, and falling back would preview through hardware the user is not sitting at.
  it("falls back to the picker rather than to another machine", () => {
    const r = chooseEngine([engine("a", 5), engine("b", 30)], "gone");
    expect(r.engine).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  it("has nothing to offer when the registry is empty", () => {
    expect(chooseEngine([], "a")).toEqual({ engine: null, ambiguous: false });
  });
});

const rated = (
  id: string,
  ms: number | null,
  quality: "Q1" | "Q2" | "Q3",
  score?: number,
  assigned = false,
): RankedEngine<PublicEngine> => {
  const r = engine(id, ms);
  return {
    ...r,
    latency: r.latency && { ...r.latency, quality },
    engine: {
      ...r.engine,
      assigned,
      performance: score === undefined ? undefined : { score },
    },
  } as unknown as RankedEngine<PublicEngine>;
};

describe("bestEngine", () => {
  // A strong machine behind a link you cannot play through is not the better choice.
  it("prefers the better latency tier over a stronger machine", () => {
    const r = bestEngine([
      rated("far", 40, "Q2", 3000),
      rated("near", 8, "Q1", 900),
    ]);
    expect(r?.engine.id).toBe("near");
  });

  it("within a tier, takes the stronger machine over the lower latency", () => {
    const r = bestEngine([
      rated("fast-link", 4, "Q1", 800),
      rated("fast-box", 9, "Q1", 1600),
    ]);
    expect(r?.engine.id).toBe("fast-box");
  });

  it("falls back to latency when neither reports a score", () => {
    const r = bestEngine([rated("b", 9, "Q1"), rated("a", 4, "Q1")]);
    expect(r?.engine.id).toBe("a");
  });

  // Exactly what the picker greys out: unreachable, or somebody else's.
  it("never takes an unreachable or in-use engine", () => {
    expect(
      bestEngine([
        rated("gone", null, "Q1", 5000),
        rated("busy", 2, "Q1", 5000, true),
        rated("ok", 30, "Q2", 500),
      ])?.engine.id,
    ).toBe("ok");
    expect(bestEngine([rated("busy", 2, "Q1", 900, true)])).toBeNull();
    expect(bestEngine([])).toBeNull();
  });

  // An engine missing a plugin plays the song wrong: no link or machine makes up for that.
  it("compares compatibility before the link and the machine", () => {
    const scores: Record<string, number> = { fast: 50, slow: 100 };
    const r = bestEngine(
      [rated("fast", 2, "Q1", 3000), rated("slow", 40, "Q3", 500)],
      { compat: (id) => scores[id] },
    );
    expect(r?.engine.id).toBe("slow");
  });

  it("among equally compatible engines, falls back to link then machine", () => {
    const r = bestEngine(
      [
        rated("partial", 2, "Q1", 3000),
        rated("full-weak", 4, "Q1", 800),
        rated("full-strong", 9, "Q1", 1600),
      ],
      { compat: (id) => (id === "partial" ? 80 : 100) },
    );
    expect(r?.engine.id).toBe("full-strong");
  });

  // Unknown is not "fully compatible": an engine that could not say ranks under one that could.
  it("ranks an engine whose compatibility is unknown below any known score", () => {
    const r = bestEngine(
      [rated("silent", 2, "Q1", 3000), rated("known", 30, "Q2", 500)],
      { compat: (id) => (id === "known" ? 0 : null) },
    );
    expect(r?.engine.id).toBe("known");
  });

  // The three steps in order: compatibility, latency class, performance — each only among the equals of the one before.
  it("orders by compatibility, then latency class, then performance", () => {
    const scores: Record<string, number> = {
      partial: 90,
      "full-q2-strong": 100,
      "full-q1-weak": 100,
      "full-q1-strong": 100,
    };
    const eng = [
      rated("partial", 1, "Q1", 5000),
      rated("full-q2-strong", 20, "Q2", 4000),
      rated("full-q1-weak", 3, "Q1", 700),
      rated("full-q1-strong", 8, "Q1", 1500),
    ];
    const pickOf = (list: typeof eng) =>
      bestEngine(list, { compat: (id) => scores[id] })?.engine.id;
    expect(pickOf(eng)).toBe("full-q1-strong");
    // Latency class before performance: the weaker Q1 machine over the stronger Q2 one.
    expect(pickOf(eng.filter((e) => e.engine.id !== "full-q1-strong"))).toBe(
      "full-q1-weak",
    );
  });

  // The bug this pins: a stronger machine elsewhere on the LAN took the tab, and the sound came out of ITS speakers.
  it("prefers the engine on this machine over a stronger one elsewhere", () => {
    const here = {
      ...rated("mac", 12, "Q1", 7000),
      wsUrl: "ws://127.0.0.1:8765",
    } as RankedEngine<PublicEngine>;
    const r = bestEngine([rated("studio-pc", 8, "Q1", 12000), here]);
    expect(r?.engine.id).toBe("mac");
  });

  // A person's own pick is a decision, not a measurement: neither this machine nor a stronger one overrules it.
  it("takes the engine this account last chose over this machine's", () => {
    const here = {
      ...rated("mac", 2, "Q1", 7000),
      wsUrl: "ws://localhost:8765",
    } as RankedEngine<PublicEngine>;
    const r = bestEngine([here, rated("studio-pc", 20, "Q2", 3000)], {
      remembered: "studio-pc",
    });
    expect(r?.engine.id).toBe("studio-pc");
  });

  // …unless it cannot be taken: a remembered engine that is gone or busy is no candidate at all.
  it("falls back on this machine when the remembered one is unreachable", () => {
    const here = {
      ...rated("mac", 12, "Q1", 7000),
      wsUrl: "ws://127.0.0.1:8765",
    } as RankedEngine<PublicEngine>;
    const r = bestEngine([rated("studio-pc", null, "Q1", 12000), here], {
      remembered: "studio-pc",
    });
    expect(r?.engine.id).toBe("mac");
  });

  // Compatibility still comes first: this machine missing a plugin plays the song wrong.
  it("still puts compatibility before this machine", () => {
    const here = {
      ...rated("mac", 2, "Q1", 7000),
      wsUrl: "ws://127.0.0.1:8765",
    } as RankedEngine<PublicEngine>;
    const r = bestEngine([here, rated("studio-pc", 8, "Q1", 3000)], {
      compat: (id) => (id === "mac" ? 60 : 100),
    });
    expect(r?.engine.id).toBe("studio-pc");
  });
});

/** The same engine, reached through the origin's relay rather than on its own address. */
const relayed = (r: RankedEngine<PublicEngine>): RankedEngine<PublicEngine> =>
  ({
    ...r,
    wsUrl: `wss://app.k7.rocks/api/engine/${r.engine.id}/ws?ticket=x`,
  }) as RankedEngine<PublicEngine>;

// Anyone may register an engine: one met only through the relay is a stranger's until somebody clicks it.
describe("who is taken unasked", () => {
  it("never auto-picks an engine reached only through the relay", () => {
    expect(bestEngine([relayed(rated("evil", 2, "Q1", 99999))])).toBeNull();
    expect(chooseEngine([relayed(engine("evil", 2))], undefined).engine).toBe(
      null,
    );
  });

  it("prefers a slower direct engine over a faster relayed stranger", () => {
    const r = bestEngine([
      relayed(rated("evil", 1, "Q1", 99999)),
      rated("lan", 30, "Q2", 500),
    ]);
    expect(r?.engine.id).toBe("lan");
  });

  it("takes a relayed engine the account remembered", () => {
    const r = bestEngine([relayed(rated("mine", 9, "Q1"))], {
      remembered: "mine",
    });
    expect(r?.engine.id).toBe("mine");
    expect(chooseEngine([relayed(engine("mine", 9))], "mine").engine).not.toBe(
      null,
    );
  });

  it("takes the server's own engine, flagged by the registry", () => {
    const own = relayed(rated("render", 9, "Q1"));
    const server = {
      ...own,
      engine: { ...own.engine, server: true },
    } as RankedEngine<PublicEngine>;
    expect(bestEngine([server])?.engine.id).toBe("render");
  });

  it("takes an engine through another server only when the account remembered it", () => {
    const far = (r: RankedEngine<PublicEngine>) =>
      ({
        ...r,
        engine: {
          ...r.engine,
          server: true,
          via: { origin: "https://app.k7.rocks", host: "app.k7.rocks" },
        },
      }) as RankedEngine<PublicEngine>;
    expect(bestEngine([far(rated("srv", 9, "Q1"))])).toBeNull();
    expect(chooseEngine([far(engine("tom", 9))], undefined).engine).toBeNull();
    expect(
      bestEngine([far(rated("tom", 9, "Q1"))], { remembered: "tom" })?.engine
        .id,
    ).toBe("tom");
  });

  // A lookalike may advertise any address: only one of its own private addresses, dialled directly, counts.
  it("does not count a public address as direct", () => {
    const pub = rated("pub", 2, "Q1");
    const at = {
      ...pub,
      engine: {
        ...pub.engine,
        addresses: {
          loopback: "127.0.0.1",
          lanIps: ["203.0.113.9"],
          port: 8765,
        },
      },
      wsUrl: "ws://203.0.113.9:8765",
    } as RankedEngine<PublicEngine>;
    expect(reachedDirectly(at)).toBe(false);
    expect(reachedDirectly(rated("lan", 2, "Q1"))).toBe(true);
  });
});
