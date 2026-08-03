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
  // A failed render must not leave its scratch directory behind: the caller only gets a
  // `dir` to clean up on SUCCESS, so every other path has to clean up after itself. This
  // hook is what caught renderProject leaking one per attempt.
  expect(scratch().filter((d) => !before.has(d))).toEqual([]);
});

describe("renderProject", () => {
  /**
   * An empty document reaches the two ways this fails, and WHICH one depends on the machine:
   * with no engine built it is "no binary", with one it is "exit 0, nothing written". Both
   * are a RenderError, and asserting only that is what keeps this test from meaning
   * different things on a dev box and in CI — the first draft asserted the message, passed
   * here, and failed the moment it ran beside a real build.
   *
   * A resolved empty result is what must never happen.
   */
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
