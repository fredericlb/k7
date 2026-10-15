// autoFreezeJobs.ts — making the renders @studio/song's automatic freezes ask for
// (packages/song/docs/autoFreeze.md), in the background, while nobody is listening. A render is
// made on the ENGINE'S machine — the one that has the VSTs: over the bound machine's jobs path when
// the server hosts the files, by the local engine binary when this service runs beside the engine.
// So a render is only ever made by an engine that will NOT play it: it is for the ones lacking a VST.
// It lands in the account's render cache, never in the project: nothing is committed, and the hub
// purges a render nobody used for a month. See docs/autoFreeze.md.

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import {
  type AutoFreeze,
  playsRender,
  setThawed,
  thawedIn,
} from "@studio/song/autoFreeze";
import { compileWithAutoFreezes } from "@studio/song/nodeProject";
import { localRenderer, renderToWav } from "@studio/take-render/renderer";
import { askBoundMachine, boundJobsUrl } from "./boundMachine.ts";

/** How long the engine must sit stopped with no edit before a THAWED module is frozen again. */
export const THAW_IDLE_MS = 20_000;

/** What the freezer needs from the rest of the service — injected, so a test needs no engine. */
export interface AutoFreezeDeps {
  compile(dir: string): { freezes: AutoFreeze[] };
  render(f: AutoFreeze, outAbs: string): Promise<void>;
  now(): number;
  log(line: string): void;
}

/** One project an engine is serving, as the freezer sees it. */
export interface FreezeTarget {
  dir: string;
  /** The project's revision token — a change is an edit. */
  rev(): string;
  playing(): boolean;
  /** Recompile and re-send, so a render just made is what plays. */
  reload(): void;
}

interface DirState {
  checkedRev: string | null;
  running: boolean;
  /** A render landed while the transport ran: swap it in at the next stop, not under the playhead. */
  pendingReload: boolean;
  /** When a thaw was asked for, or the project last changed while one was in force. */
  thawActivity: number;
  lastRev: string | null;
  /** The freezes whose render the last compile played — a change (another engine bound) is a reload. */
  applied: string | null;
}

export class AutoFreezer {
  private readonly dirs = new Map<string, DirState>();

  constructor(private readonly deps: AutoFreezeDeps) {}

  private stateOf(dir: string): DirState {
    const key = resolve(dir);
    let s = this.dirs.get(key);
    if (!s) {
      s = {
        checkedRev: null,
        running: false,
        pendingReload: false,
        thawActivity: 0,
        lastRev: null,
        applied: null,
      };
      this.dirs.set(key, s);
    }
    return s;
  }

  /** Leave `module` live (on) or let it freeze again (off) — a knob or a plugin window on it asks. */
  thaw(dir: string, module: string, on: boolean): void {
    const thawed = thawedIn(dir);
    if (on) thawed.add(module);
    else thawed.delete(module);
    setThawed(dir, thawed);
    const s = this.stateOf(dir);
    s.thawActivity = this.deps.now();
    s.checkedRev = null; // what freezes has changed without any file doing so
  }

  /** One pass over one served project; answers the modules it rendered. Never throws. */
  async tick(t: FreezeTarget): Promise<string[]> {
    const s = this.stateOf(t.dir);
    if (s.running || t.playing()) return [];
    if (s.pendingReload) {
      s.pendingReload = false;
      s.checkedRev = null;
      t.reload();
    }
    const rev = t.rev();
    // An edit while thawed is the person still at it: the idle clock restarts.
    if (rev !== s.lastRev) {
      s.lastRev = rev;
      if (thawedIn(t.dir).size) s.thawActivity = this.deps.now();
    }
    if (
      thawedIn(t.dir).size &&
      this.deps.now() - s.thawActivity >= THAW_IDLE_MS
    ) {
      setThawed(t.dir, []);
      s.checkedRev = null;
      // Frozen again at once when the render for what is on disk already exists.
      t.reload();
    }
    if (s.checkedRev === rev) return [];
    s.running = true;
    try {
      return await this.renderMissing(t, s, rev);
    } catch (e) {
      this.deps.log(`   ✗ auto-freeze: ${(e as Error).message}`);
      return [];
    } finally {
      s.running = false;
    }
  }

  private async renderMissing(
    t: FreezeTarget,
    s: DirState,
    rev: string,
  ): Promise<string[]> {
    const { freezes } = this.deps.compile(t.dir);
    // A render made WITHOUT a VST would bake its stub and then play everywhere as the truth: only
    // an engine that has every VST in the plan renders it. An empty catalogue cannot say.
    const renderable = freezes.filter((f) => !f.ready && f.hosted);
    s.checkedRev = rev;
    this.reloadIfApplied(t, s, freezes);
    const done: string[] = [];
    for (const f of renderable) {
      const out = f.render;
      mkdirSync(dirname(out), { recursive: true });
      try {
        await this.deps.render(f, out);
      } catch (e) {
        this.deps.log(`   ✗ auto-freeze ${f.module}: ${(e as Error).message}`);
        continue;
      }
      if (!existsSync(out)) continue;
      done.push(f.module);
    }
    if (!done.length) return [];
    this.deps.log(`   ❄ auto-froze ${done.join(", ")}`);
    // Made by an engine that hosts the VSTs, so nothing it plays changes; another engine will use it.
    return done;
  }

  /** Every missing render of `dir` now, transport or not; answers the ones no connected machine can make (docs/share.md). */
  async renderAllNow(
    dir: string,
    onProgress: (done: number, total: number, module: string) => void,
  ): Promise<{ module: string; plugins: string[] }[]> {
    const s = this.stateOf(dir);
    // The timer's pass on this project finishes first: two renders of one freeze would race for one file.
    while (s.running) await new Promise((r) => setTimeout(r, 200));
    s.running = true;
    try {
      const { freezes } = this.deps.compile(dir);
      const missing = freezes.filter((f) => !f.ready);
      const impossible = missing
        .filter((f) => !f.hosted)
        .map((f) => ({
          module: f.module,
          plugins: f.plugins.map((p) => p.name),
        }));
      const renderable = missing.filter((f) => f.hosted);
      for (const [i, f] of renderable.entries()) {
        onProgress(i, renderable.length, f.module);
        mkdirSync(dirname(f.render), { recursive: true });
        try {
          await this.deps.render(f, f.render);
        } catch (e) {
          this.deps.log(
            `   ✗ auto-freeze ${f.module}: ${(e as Error).message}`,
          );
        }
        if (!existsSync(f.render))
          impossible.push({
            module: f.module,
            plugins: f.plugins.map((p) => p.name),
          });
      }
      onProgress(renderable.length, renderable.length, "");
      return impossible;
    } finally {
      s.running = false;
    }
  }

  /** Reload when the renders the compile plays changed (an engine bound with another catalogue): now if stopped, at the stop otherwise. */
  private reloadIfApplied(
    t: FreezeTarget,
    s: DirState,
    freezes: AutoFreeze[],
  ): void {
    const applied = freezes
      .filter(playsRender)
      .map((f) => f.render)
      .sort()
      .join("\n");
    const before = s.applied;
    s.applied = applied;
    // The first look only learns: the doc already sent was compiled from the same state.
    if (before === null || before === applied) return;
    if (t.playing()) s.pendingReload = true;
    else {
      s.checkedRev = null;
      t.reload();
    }
  }
}

/** Render on the machine that has the VSTs: the bound one's jobs path, else this machine's engine. */
async function renderOnEngineMachine(
  f: AutoFreeze,
  outAbs: string,
): Promise<void> {
  if (boundJobsUrl()) {
    // The doc's clips and `out` are server paths: the tunnel brings the first down and the render back up.
    const reply = await askBoundMachine(
      { type: "render", doc: f.cut, out: outAbs },
      "rendered",
    );
    if (!reply) throw new Error("no engine machine is bound to render on");
    return;
  }
  const bin = findEngineBinary();
  if (!bin) throw new Error("no k7-runtime binary on this machine");
  await renderToWav(localRenderer(bin), f.cut, outAbs);
}

/** The freezer the service runs: the real compile and render. */
export const autoFreezer = new AutoFreezer({
  compile: compileWithAutoFreezes,
  render: renderOnEngineMachine,
  now: Date.now,
  log: (line) => console.log(line),
});
