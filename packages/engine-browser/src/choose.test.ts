// The engine-choice policy. Each case pins a decision that is invisible once wrong: a
// preview that connects to the wrong machine looks exactly like one that connects to the
// right one, until you wonder why you cannot hear it.

import type { PublicEngine } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { chooseEngine } from "./choose.ts";
import type { RankedEngine } from "./probe.ts";

const engine = (id: string, tier: 1 | 2 | 3): RankedEngine<PublicEngine> =>
  ({
    engine: {
      id,
      hostname: id,
      addresses: {},
      assigned: false,
      sameSourceIp: false,
    },
    tier,
    wsUrl: tier === 3 ? null : `ws://${id}:8765`,
    fileBase: tier === 3 ? null : `http://${id}:8770`,
    token: tier === 3 ? null : "t",
  }) as unknown as RankedEngine<PublicEngine>;

describe("chooseEngine", () => {
  it("takes the remembered one even when others are reachable", () => {
    const r = chooseEngine([engine("a", 1), engine("b", 2)], "b");
    expect(r.engine?.engine.id).toBe("b");
    expect(r.ambiguous).toBe(false);
  });

  // One reachable engine is not a choice — a dialog in front of the only possible answer.
  it("takes the only reachable one with nothing remembered", () => {
    const r = chooseEngine([engine("a", 1)], undefined);
    expect(r.engine?.engine.id).toBe("a");
    expect(r.ambiguous).toBe(false);
  });

  it("asks only when several are reachable and none is remembered", () => {
    const r = chooseEngine([engine("a", 1), engine("b", 2)], undefined);
    expect(r.engine).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  // Tier 3 is "listed but not reachable from this browser". Offering one produces a preview
  // that silently never connects — a broken editor, not a wrong network.
  it("never offers an unreachable engine, remembered or not", () => {
    expect(chooseEngine([engine("far", 3)], "far").engine).toBeNull();
    expect(chooseEngine([engine("far", 3)], undefined).ambiguous).toBe(false);
  });

  // The usual reason is being on the wrong network; falling back to another machine would
  // preview through hardware the user is not sitting at.
  it("falls back to the picker rather than to another machine", () => {
    const r = chooseEngine([engine("a", 1), engine("b", 2)], "gone");
    expect(r.engine).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  it("has nothing to offer when the registry is empty", () => {
    expect(chooseEngine([], "a")).toEqual({ engine: null, ambiguous: false });
  });
});
