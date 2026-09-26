// The engine-choice policy. Each case pins a decision that is invisible once wrong: a
// preview that connects to the wrong machine looks exactly like one that connects to the
// right one, until you wonder why you cannot hear it.

import type { PublicEngine } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { bestEngine, chooseEngine } from "./choose.ts";
import type { RankedEngine } from "./probe.ts";

const engine = (id: string, ms: number | null): RankedEngine<PublicEngine> =>
  ({
    engine: {
      id,
      hostname: id,
      addresses: {},
      assigned: false,
      sameSourceIp: false,
    },
    latency:
      ms === null
        ? null
        : { networkMs: ms, audioMs: 0, totalMs: ms, quality: "Q1" },
    wsUrl: ms === null ? null : `ws://${id}:8765`,
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

  it("prefers the remembered engine only among the most compatible", () => {
    const eng = [rated("mine", 30, "Q2", 500), rated("other", 2, "Q1", 3000)];
    expect(
      bestEngine(eng, { compat: () => 100, preferId: "mine" })?.engine.id,
    ).toBe("mine");
    expect(
      bestEngine(eng, {
        compat: (id) => (id === "mine" ? 90 : 100),
        preferId: "mine",
      })?.engine.id,
    ).toBe("other");
  });
});
