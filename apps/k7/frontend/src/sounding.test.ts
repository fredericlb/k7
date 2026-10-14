// The idle clock's one question about the engine: is anyone playing through it?

import { describe, expect, it } from "vitest";
import { soundingNow } from "./sounding";

const quiet = { playing: false, master: -100, inputLevels: [-90, -120] };

describe("soundingNow", () => {
  it("is false for a stopped transport and silent meters", () => {
    expect(soundingNow(quiet)).toBe(false);
  });
  it("is true while the transport plays, silent or not", () => {
    expect(soundingNow({ ...quiet, playing: true })).toBe(true);
  });
  // The live rig: no transport, a guitar going in and the amp coming out.
  it("is true for sound on the master or on an input", () => {
    expect(soundingNow({ ...quiet, master: -18 })).toBe(true);
    expect(soundingNow({ ...quiet, inputLevels: [-90, -12] })).toBe(true);
  });
});
