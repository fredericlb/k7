// shareProgress.test.ts — the share panel's bar: it only ever moves forward across the steps, and the long ones —
// the VST renders and the upload — are where it moves most. See packages/file-service/docs/share.md.

import type { ShareProgress } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { shareProgressLine, shareProgressPct } from "./shareProgress";

const at = (p: Partial<ShareProgress>): ShareProgress => ({
  step: "freeze",
  done: 0,
  total: 0,
  ...p,
});

describe("the share bar", () => {
  it("moves forward through the steps, never back", () => {
    const seen = [
      at({ step: "freeze", done: 0, total: 2 }),
      at({ step: "freeze", done: 1, total: 2 }),
      at({ step: "freeze", done: 2, total: 2 }),
      at({ step: "sync" }),
      at({ step: "checkpoint" }),
      at({ step: "pack" }),
      at({ step: "upload", done: 10, total: 100 }),
      at({ step: "upload", done: 100, total: 100 }),
      at({ step: "done" }),
    ].map(shareProgressPct);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(100);
  });

  it("gives the renders and the upload most of its length", () => {
    expect(shareProgressPct(at({ step: "sync" }))).toBe(50);
    expect(shareProgressPct(at({ step: "upload", total: 1 }))).toBe(65);
  });

  it("says why a share failed", () => {
    expect(
      shareProgressLine(at({ step: "failed", error: "no engine here" })),
    ).toContain("no engine here");
  });
});
