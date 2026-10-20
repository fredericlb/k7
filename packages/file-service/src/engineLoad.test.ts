// engineLoad.test.ts — the dry run's order: applied first, then a SILENCED copy played and stopped,
// then the real document back; and what the gate sees at each step.

import type { ProjectDoc } from "@studio/song/project";
import { describe, expect, it, vi } from "vitest";
import {
  beginLoad,
  endLoad,
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

  it("stops a dry run the moment the next project replaces it, and restores nothing over it", async () => {
    beginLoad("s7");
    const { deps, calls } = fakeDeps(0);
    const run = warmUp("s7", doc, deps);
    await vi.waitFor(() => expect(isWarming("s7")).toBe(true));
    beginLoad("s7");
    // Synchronous: the caller flushes and sends the next project right after, and the stop must precede both.
    expect(calls).toEqual(["send -100", "play", "stop"]);
    await run;
    expect(calls).toEqual(["send -100", "play", "stop"]);
    expect(loadPhase("s7")).toBe("copying");
  });

  it("still un-silences the master when the load is ENDED rather than replaced", async () => {
    beginLoad("s8");
    const { deps, calls } = fakeDeps(0);
    const run = warmUp("s8", doc, deps);
    await vi.waitFor(() => expect(isWarming("s8")).toBe(true));
    endLoad("s8");
    await run;
    expect(calls).toEqual(["send -100", "play", "stop", "restore"]);
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

// ~180 opens in two minutes once left a session's engine flushed while it played and then deaf (docs/engineLoad.md).
describe("a burst of opens", () => {
  /** An engine that reports the session loaded at once, as it does while the previous project is still built. */
  function fakeEngine() {
    const wire: string[] = [];
    let playing = false;
    const faults: string[] = [];
    const deps = (name: string): WarmDeps => ({
      engine: "the engine",
      current: () => true,
      hasEngine: () => true,
      sendProject: (d) => wire.push(`send ${name} ${d.masterVolume}`),
      play: () => {
        playing = true;
        wire.push(`play ${name}`);
      },
      stopAndRewind: () => {
        playing = false;
        wire.push(`stop ${name}`);
      },
      loaded: async () => true,
      restore: () => wire.push(`restore ${name}`),
      log: (m) => faults.push(m),
    });
    // What `startEngineForActive` does on a switch: begin the load, flush, send — then the dry run.
    const open = (session: string, name: string): Promise<void> => {
      beginLoad(session);
      if (playing) faults.push(`flushed ${name} while a dry run played`);
      wire.push(`flush+send ${name}`);
      return warmUp(session, doc, deps(name));
    };
    return { wire, faults, open, isPlaying: () => playing };
  }

  it("never flushes under a playing dry run, and settles on the last project", async () => {
    vi.useFakeTimers();
    try {
      const engine = fakeEngine();
      const runs: Promise<void>[] = [];
      // Spacings that land in every phase: mid-apply, mid-dry-run, mid-tail, and after it all.
      const gaps = [0, 5, 200, 600, 1000, 1800, 2500];
      for (let i = 0; i < 180; i++) {
        runs.push(engine.open("burst", `p${i}`));
        await vi.advanceTimersByTimeAsync(gaps[i % gaps.length] as number);
      }
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all(runs);
      expect(engine.faults).toEqual([]);
      expect(engine.isPlaying()).toBe(false);
      expect(loadPhase("burst")).toBeNull();
      // The last thing the engine hears is the last project, at its own level.
      expect(engine.wire.at(-1)).toBe("restore p179");
    } finally {
      vi.useRealTimers();
    }
  });
});
