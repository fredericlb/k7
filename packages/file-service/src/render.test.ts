// Tests for the offline bounce. What they pin is the FAILURE shape: a render that produces
// nothing must not read like a successful render of an empty song — from the caller's side
// those are indistinguishable without this — and it must not leave its scratch behind.

import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { RenderError, renderProject } from "./render.ts";

const scratch = () =>
  readdirSync(tmpdir()).filter((d) => d.startsWith("studio-render-"));
const before = new Set(scratch());

afterEach(() => {
  // The caller only gets a `dir` on SUCCESS, so every other path has to clean up after itself.
  expect(scratch().filter((d) => !before.has(d))).toEqual([]);
});

describe("renderProject", () => {
  /** Which of the two failures an empty document hits depends on the machine, so only RenderError is asserted. */
  it("rejects rather than resolving empty", async () => {
    await expect(
      renderProject({
        name: "empty",
        tempo: 120,
        sampleRate: 48000,
        tracks: [],
      }),
    ).rejects.toBeInstanceOf(RenderError);
  }, 30_000);
});
