// standingWarnings.test.ts — an `applied` frame carries the warnings the session's project was built
// with, so a page that connected after the build, or whose own apply changed nothing, still has them.

import { describe, expect, it } from "vitest";
import { EngineClient } from "./engine";

function client(session = "k7:fred") {
  const c = new EngineClient("ws://never-opened", undefined, session);
  const got: { subject: string; message: string }[][] = [];
  c.onStandingWarnings((w) => got.push(w));
  const feed = (m: object) =>
    (c as unknown as { dispatch: (m: object) => void }).dispatch(m);
  return { feed, got };
}

describe("standing warnings", () => {
  it("hands a no-op apply's standing set to the listener", () => {
    const { feed, got } = client();
    feed({
      type: "applied",
      session: "k7:fred",
      changes: [],
      warnings: [{ subject: "lead:synth", message: "could not create Diva" }],
    });
    expect(got).toEqual([
      [{ subject: "lead:synth", message: "could not create Diva" }],
    ]);
  });

  it("says nothing for an older engine's applied, which carries no set", () => {
    const { feed, got } = client();
    feed({ type: "applied", changes: ["tempo -> 124 bpm"] });
    expect(got).toEqual([]);
  });

  it("drops entries of the wrong shape and another session's frame", () => {
    const { feed, got } = client();
    feed({
      type: "applied",
      warnings: [null, 3, { subject: "a" }, { message: "general" }],
    });
    feed({ type: "applied", session: "k7:other", warnings: [] });
    expect(got).toEqual([[{ subject: "", message: "general" }]]);
  });
});
