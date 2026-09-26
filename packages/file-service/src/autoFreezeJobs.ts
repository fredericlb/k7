// autoFreezeJobs.ts — making the renders @studio/song's automatic freezes ask for
// (packages/song/docs/autoFreeze.md), in the background, while nobody is listening. A render is
// made on the ENGINE'S machine — the one that has the VSTs: over the bound machine's jobs path when
// the server hosts the files, by the local engine binary when this service runs beside the engine.
// It is committed under `renders/auto` alone (Git LFS carries the wav), so another machine, even
// one without the VST, gets it with the project. See docs/autoFreeze.md.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { GitEnv } from "@studio/commands/git";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { scannedPlugins } from "@studio/engine-client/pluginCache";
import {
  AUTO_FREEZE_DIR,
  type AutoFreeze,
  isAutoRenderOf,
  setThawed,
  thawedIn,
} from "@studio/song/autoFreeze";
import { compileWithAutoFreezes } from "@studio/song/nodeProject";
import { renderCutAsync } from "@studio/take-render/render";
import {
  type CataloguePlugin,
  compatibility,
} from "@studio/web-protocol/compat";
import { askBoundMachine, boundJobsUrl } from "./boundMachine.ts";

const run = promisify(execFile);

/** How long the engine must sit stopped with no edit before a THAWED module is frozen again. */
export const THAW_IDLE_MS = 20_000;

/** What the freezer needs from the rest of the service — injected, so a test needs no engine. */
export interface AutoFreezeDeps {
  compile(dir: string): { freezes: AutoFreeze[] };
  /** The catalogue of the engine that would RENDER: the bound one's, or this machine's own. */
  catalogue(): CataloguePlugin[];
  render(f: AutoFreeze, outAbs: string): Promise<void>;
  commit(dir: string, message: string, gitEnv: GitEnv): Promise<void>;
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
  gitEnv: GitEnv;
}

interface DirState {
  checkedRev: string | null;
  running: boolean;
  /** A render landed while the transport ran: swap it in at the next stop, not under the playhead. */
  pendingReload: boolean;
  /** When a thaw was asked for, or the project last changed while one was in force. */
  thawActivity: number;
  lastRev: string | null;
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
    const missing = freezes.filter((f) => !f.ready);
    const catalogue = this.deps.catalogue();
    // A render made WITHOUT a VST would bake its stub and then play everywhere as the truth: only
    // an engine that has every VST in the plan renders it. An empty catalogue cannot say.
    const renderable = missing.filter(
      (f) =>
        catalogue.length > 0 &&
        compatibility(f.plugins, catalogue).score === 100,
    );
    s.checkedRev = rev;
    const done: string[] = [];
    for (const f of renderable) {
      const out = resolve(t.dir, f.render);
      mkdirSync(dirname(out), { recursive: true });
      try {
        await this.deps.render(f, out);
      } catch (e) {
        this.deps.log(`   ✗ auto-freeze ${f.module}: ${(e as Error).message}`);
        continue;
      }
      if (!existsSync(out)) continue;
      removeStaleRenders(t.dir, f.module, basename(out));
      done.push(f.module);
    }
    if (!done.length) return [];
    this.deps.log(`   ❄ auto-froze ${done.join(", ")}`);
    await this.deps
      .commit(t.dir, `auto-freeze: ${done.join(", ")}`, t.gitEnv)
      .catch((e: Error) =>
        this.deps.log(`   ✗ auto-freeze commit: ${e.message}`),
      );
    // The render changes what the engine should play: now if stopped, at the stop otherwise.
    if (t.playing()) s.pendingReload = true;
    else {
      s.checkedRev = null;
      t.reload();
    }
    return done;
  }
}

/** Remove `module`'s older renders, keeping `keep`: one render per module, the one its inputs name. */
function removeStaleRenders(dir: string, module: string, keep: string): void {
  const folder = join(dir, AUTO_FREEZE_DIR);
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return;
  }
  for (const n of names)
    if (n !== keep && isAutoRenderOf(module, n))
      rmSync(join(folder, n), { force: true });
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
  if (!bin) throw new Error("no st0-engine binary on this machine");
  await renderCutAsync(bin, f.cut, outAbs);
}

/** Commit `renders/auto` ALONE — never the edits somebody has not committed — then push, best-effort. */
async function commitRenders(
  dir: string,
  message: string,
  gitEnv: GitEnv,
): Promise<void> {
  const opts = { cwd: dir, env: { ...process.env, ...gitEnv } };
  try {
    await run("git", ["rev-parse", "--is-inside-work-tree"], opts);
  } catch {
    return; // not a repository: the renders still play here, there is just nowhere to send them
  }
  await run("git", ["add", "-A", "--", AUTO_FREEZE_DIR], opts);
  const { stdout } = await run(
    "git",
    ["diff", "--cached", "--name-only", "--", AUTO_FREEZE_DIR],
    opts,
  );
  if (!stdout.trim()) return;
  await run("git", ["commit", "-m", message, "--", AUTO_FREEZE_DIR], opts);
  // Offline or with no upstream, the commit stands and the next push carries it.
  await run("git", ["push"], { ...opts, timeout: 60_000 }).catch(() => {});
}

/** The freezer the service runs: the real compile, catalogue, render and commit. */
export const autoFreezer = new AutoFreezer({
  compile: compileWithAutoFreezes,
  catalogue: scannedPlugins,
  render: renderOnEngineMachine,
  commit: commitRenders,
  now: Date.now,
  log: (line) => console.log(line),
});
