// engineLoad.test.ts — the dry run's order: applied first, then a SILENCED copy played and stopped,
// then the real document back; and what the gate sees at each step.

import type { ProjectDoc } from "@studio/song/project";
import { describe, expect, it, vi } from "vitest";
import {
  beginLoad,
  isWarming,
  loadPhase,
  type WarmDeps,
  warmUp,
} from "./engineLoad.ts";

const doc = { masterVolume: -3, tracks: [] } as unknown as ProjectDoc;

function fakeDeps(loadedAfter: number, engine: unknown = {}) {
  const calls: string[] = [];
  let asked = 0;
  const link = { current: true, selected: true };
  const deps: WarmDeps = {
    engine,
    current: () => link.current,
    hasEngine: () => link.selected,
    sendProject: (d) => calls.push(`send ${d.masterVolume}`),
    play: () => calls.push("play"),
    stopAndRewind: () => calls.push("stop"),
    loaded: async () => ++asked > loadedAfter,
    restore: () => calls.push("restore"),
    log: (m) => calls.push(`log ${m}`),
  };
  return { deps, calls, link };
}

describe("the dry run", () => {
  it("waits for the project to be applied, plays it silenced, stops, and restores it", async () => {
    beginLoad("s1");
    const { deps, calls } = fakeDeps(2);
    const run = warmUp("s1", doc, deps);
    expect(loadPhase("s1")).toBe("applying");
    await vi.waitFor(() => expect(isWarming("s1")).toBe(true), {
      timeout: 3000,
    });
    await run;
    expect(calls).toEqual(["send -100", "play", "stop", "restore"]);
    expect(loadPhase("s1")).toBeNull();
  });

  it("runs once: a later document of the same open does not start another", async () => {
    beginLoad("s2");
    const { deps, calls } = fakeDeps(0);
    await warmUp("s2", doc, deps);
    await warmUp("s2", doc, deps);
    expect(calls.filter((c) => c === "play")).toHaveLength(1);
  });

  it("lets the gate go without playing when another project is opened meanwhile", async () => {
    beginLoad("s3");
    const { deps, calls } = fakeDeps(1_000);
    const run = warmUp("s3", doc, deps);
    beginLoad("s3");
    await run;
    expect(calls).not.toContain("play");
    expect(loadPhase("s3")).toBe("copying");
  });

  it("is taken over by the next engine's document when the account's engine changes", async () => {
    beginLoad("s4");
    const old = fakeDeps(1_000_000, "engine A");
    const stuck = warmUp("s4", doc, old.deps);
    // The engine changed: a document reaches the session through the NEW link.
    const next = fakeDeps(1, "engine B");
    await warmUp("s4", doc, next.deps);
    await stuck;
    expect(next.calls).toEqual(["send -100", "play", "stop", "restore"]);
    expect(old.calls).not.toContain("play");
    expect(loadPhase("s4")).toBeNull();
  });

  it("waits for the new engine's document when its link is left before one arrives", async () => {
    beginLoad("s5");
    const old = fakeDeps(1_000_000, "engine A");
    const run = warmUp("s5", doc, old.deps);
    old.link.current = false;
    await run;
    expect(old.calls).not.toContain(
      "log the engine did not report the project loaded in time",
    );
    expect(loadPhase("s5")).toBe("copying");
    const next = fakeDeps(0, "engine B");
    await warmUp("s5", doc, next.deps);
    expect(next.calls).toContain("play");
  });

  it("lets the gate go when the account is left with no engine at all", async () => {
    beginLoad("s6");
    const old = fakeDeps(1_000_000, "engine A");
    const run = warmUp("s6", doc, old.deps);
    old.link.current = false;
    old.link.selected = false;
    await run;
    expect(loadPhase("s6")).toBeNull();
  });
});
