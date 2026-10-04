// The automatic-freeze scheduler, with the compile and the engine faked. What it must never do
// is the silent part: render WITHOUT the VST (a stub then plays everywhere as the song), or swap a
// track's contents under a rolling transport. packages/song/docs/autoFreeze.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AutoFreeze } from "@studio/song/autoFreeze";
import { setThawed, thawedIn } from "@studio/song/autoFreeze";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AutoFreezeDeps,
  AutoFreezer,
  type FreezeTarget,
  THAW_IDLE_MS,
} from "./autoFreezeJobs";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "freezer-"));
});
afterEach(() => {
  setThawed(dir, []);
  rmSync(dir, { recursive: true, force: true });
});

const HASH = "0123456789abcdef";

/** One freeze at `module`, ready when its render is on disk; `hosted` when the engine has its VST. */
function freeze(module: string, hosted = true, hash = HASH): AutoFreeze {
  const render = join(dir, "cache", `${module}-${hash}.wav`);
  return {
    module,
    render,
    plan: { at: module, render, lanes: new Set(), modules: new Set([module]) },
    cut: {} as AutoFreeze["cut"],
    plugins: [{ format: "vst3", name: "Serum" }],
    ready: existsSync(render),
    hosted,
  };
}

interface Rig {
  freezer: AutoFreezer;
  target: FreezeTarget;
  rendered: string[];
  reloads: number;
  state: { playing: boolean; rev: string; now: number };
}

function rig(opts: {
  freezes: () => AutoFreeze[];
  /** Called during the render, to change the world while it runs. */
  duringRender?: (s: Rig["state"]) => void;
}): Rig {
  const r = {
    rendered: [] as string[],
    reloads: 0,
    state: { playing: false, rev: "r1", now: 1_000 },
  } as Rig;
  const deps: AutoFreezeDeps = {
    compile: () => ({ freezes: opts.freezes() }),
    render: async (f, out) => {
      opts.duringRender?.(r.state);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, "wav");
      r.rendered.push(f.module);
    },
    now: () => r.state.now,
    log: () => {},
  };
  r.freezer = new AutoFreezer(deps);
  r.target = {
    dir,
    rev: () => r.state.rev,
    playing: () => r.state.playing,
    reload: () => {
      r.reloads++;
    },
  };
  return r;
}

describe("AutoFreezer", () => {
  // Made by the engine that hosts the VST, which plays it live: the render is for the others.
  it("renders what is missing while stopped, where the freeze names it, without reloading", async () => {
    const r = rig({ freezes: () => [freeze("amp")] });
    expect(await r.freezer.tick(r.target)).toEqual(["amp"]);
    expect(existsSync(join(dir, "cache", `amp-${HASH}.wav`))).toBe(true);
    expect(r.reloads).toBe(0);
  });

  it("starts nothing while the transport runs", async () => {
    const r = rig({ freezes: () => [freeze("amp")] });
    r.state.playing = true;
    expect(await r.freezer.tick(r.target)).toEqual([]);
    expect(r.rendered).toEqual([]);
  });

  // A render made without the VST bakes its stub — and then plays everywhere as the song.
  it("never renders on an engine that does not host every VST of the plan", async () => {
    const r = rig({ freezes: () => [freeze("amp", false)] });
    expect(await r.freezer.tick(r.target)).toEqual([]);
    expect(r.rendered).toEqual([]);
  });

  it("reloads when another engine binds and the render starts or stops standing in", async () => {
    let hosted = true;
    const r = rig({ freezes: () => [freeze("amp", hosted)] });
    mkdirSync(join(dir, "cache"), { recursive: true });
    writeFileSync(join(dir, "cache", `amp-${HASH}.wav`), "wav");
    await r.freezer.tick(r.target);
    expect(r.reloads).toBe(0);
    hosted = false;
    r.state.rev = "r2";
    await r.freezer.tick(r.target);
    expect(r.reloads).toBe(1);
    hosted = true;
    r.state.rev = "r3";
    await r.freezer.tick(r.target);
    expect(r.reloads).toBe(2);
  });

  it("swaps a render in at the stop, not under the playhead", async () => {
    let hosted = true;
    const r = rig({
      freezes: () => {
        // The transport starts while the compile runs.
        if (!hosted) r.state.playing = true;
        return [freeze("amp", hosted)];
      },
    });
    mkdirSync(join(dir, "cache"), { recursive: true });
    writeFileSync(join(dir, "cache", `amp-${HASH}.wav`), "wav");
    await r.freezer.tick(r.target);
    hosted = false;
    r.state.rev = "r2";
    await r.freezer.tick(r.target);
    expect(r.reloads).toBe(0);
    r.state.playing = false;
    await r.freezer.tick(r.target);
    expect(r.reloads).toBe(1);
  });

  it("does nothing again until the project changes", async () => {
    let calls = 0;
    const r = rig({
      freezes: () => {
        calls++;
        return [];
      },
    });
    await r.freezer.tick(r.target);
    await r.freezer.tick(r.target);
    expect(calls).toBe(1);
    r.state.rev = "r2";
    await r.freezer.tick(r.target);
    expect(calls).toBe(2);
  });

  it("lets a thawed module freeze again once nobody has touched it for a while", async () => {
    const r = rig({ freezes: () => [] });
    r.freezer.thaw(dir, "amp", true);
    expect([...thawedIn(dir)]).toEqual(["amp"]);
    await r.freezer.tick(r.target);
    expect([...thawedIn(dir)]).toEqual(["amp"]);
    // An edit restarts the clock…
    r.state.now += THAW_IDLE_MS - 1;
    r.state.rev = "edited";
    await r.freezer.tick(r.target);
    r.state.now += THAW_IDLE_MS - 1;
    await r.freezer.tick(r.target);
    expect([...thawedIn(dir)]).toEqual(["amp"]);
    // …and a quiet stretch, stopped, ends the thaw.
    r.state.now += 2;
    await r.freezer.tick(r.target);
    expect(thawedIn(dir).size).toBe(0);
  });
});
