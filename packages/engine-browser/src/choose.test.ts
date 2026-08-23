// The engine-choice policy. Each case pins a decision that is invisible once wrong: a
// preview that connects to the wrong machine looks exactly like one that connects to the
// right one, until you wonder why you cannot hear it.

import type { PublicEngine } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { chooseEngine } from "./choose.ts";
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
