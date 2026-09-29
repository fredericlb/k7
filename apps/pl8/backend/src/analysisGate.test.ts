import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let release: (() => void)[] = [];

vi.mock("@studio/audio-analysis/analyse", () => ({
  freshSidecar: (source: string) =>
    source === "fresh" ? { fresh: true } : null,
  analyseFile: (source: string) => {
    calls.push(source);
    return new Promise((ok) => release.push(() => ok({ source })));
  },
}));

const { analyseShared, ensureAnalysedShared, gateLoad, MAX_DECODES } =
  await import("./analysisGate.ts");

const tick = () => new Promise((ok) => setTimeout(ok, 0));

beforeEach(() => {
  calls.length = 0;
  release = [];
});

describe("the decode gate", () => {
  it("shares one decode between callers asking for the same file", async () => {
    const a = analyseShared("same");
    const b = analyseShared("same");
    await tick();
    expect(calls).toEqual(["same"]);
    release.shift()?.();
    expect(await a).toBe(await b);
  });

  it("runs at most MAX_DECODES at once, and starts a waiting one as a slot frees", async () => {
    const all = ["a", "b", "c", "d"].map((f) => analyseShared(f));
    await tick();
    expect(calls.length).toBe(MAX_DECODES);
    expect(gateLoad().waiting).toBe(4 - MAX_DECODES);
    release.shift()?.();
    await tick();
    await tick();
    expect(calls.length).toBe(MAX_DECODES + 1);
    while (release.length) {
      release.shift()?.();
      await tick();
      await tick();
    }
    await Promise.all(all);
    expect(gateLoad()).toEqual({ active: 0, waiting: 0 });
  });

  it("answers a fresh sidecar without queueing", async () => {
    expect(await ensureAnalysedShared("fresh")).toEqual({ fresh: true });
    expect(calls).toEqual([]);
  });
});
