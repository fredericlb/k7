// instrumentStatus.test.ts — the engine's answer about which sampled instruments are on its machine reaches
// whoever asked, whatever session the client is on, and an answer missing its map reads as nothing known.

import { describe, expect, it } from "vitest";
import { EngineClient } from "./engine";

function client(session?: string) {
  const c = new EngineClient("ws://never-opened", undefined, session);
  const got: Record<string, boolean>[] = [];
  c.onInstrumentStatus((s) => got.push(s));
  const feed = (m: object) =>
    (c as unknown as { dispatch: (m: object) => void }).dispatch(m);
  return { feed, got };
}

describe("instrument-status", () => {
  it("hands each ref's verdict to the listener", () => {
    const { feed, got } = client("st0:fred");
    feed({
      type: "instrument-status",
      status: { "@instruments/nbo-wurt/wurly.sfz": false },
    });
    expect(got).toEqual([{ "@instruments/nbo-wurt/wurly.sfz": false }]);
  });

  it("reads a reply with no map as an empty one", () => {
    const { feed, got } = client();
    feed({ type: "instrument-status" });
    expect(got).toEqual([{}]);
  });
});
