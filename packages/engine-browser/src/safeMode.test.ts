// safeMode.test.ts — an engine started in safe mode says so in `whoami`, and the page is told once
// when it enters and once when a normal engine answers again; an odd field is no safe mode.

import { describe, expect, it } from "vitest";
import { EngineClient } from "./engine";
import { type EngineSafeMode, readSafeMode } from "./engineEvents.ts";

function client() {
  const c = new EngineClient("ws://never-opened");
  const seen: (EngineSafeMode | null)[] = [];
  c.onSafeMode((s) => seen.push(s));
  const feed = (m: object) =>
    (c as unknown as { dispatch: (m: object) => void }).dispatch(m);
  return { feed, seen };
}

describe("safe mode", () => {
  it("is told on entering and on leaving, never on a repeated whoami", () => {
    const { feed, seen } = client();
    const safe = { crashes: 3, lastPlugin: "Crashy.vst3" };
    feed({ type: "whoami", id: "e1", boot: "1", safeMode: safe });
    feed({ type: "whoami", id: "e1", boot: "1", safeMode: safe });
    feed({ type: "whoami", id: "e1", boot: "2" });
    expect(seen).toEqual([null, safe, null]);
  });

  it("keeps only the shape the engine sends", () => {
    expect(readSafeMode(undefined)).toBeNull();
    expect(readSafeMode(true)).toBeNull();
    expect(readSafeMode({ crashes: "3", diedLoading: 4 })).toEqual({
      crashes: 0,
    });
    expect(readSafeMode({ crashes: 4, diedLoading: "A.vst3" })).toEqual({
      crashes: 4,
      diedLoading: "A.vst3",
    });
  });
});
