// autoFreeze.ts — freezing VST modules WITHOUT anyone asking. A VST is the plugin an engine is most
// likely not to have — installed on one machine, unavailable on another platform — so a track
// through one is rendered once, on a machine that has it, and the render plays everywhere until
// what it was made from changes — but only on an engine LACKING one of its VSTs: one that has them all
// plays them live. Nothing is written to the project's YAML: the render's NAME is a
// fingerprint of its inputs, so a stale render is simply one whose name nobody asks for.
// Renders live in a cache OUTSIDE the project (`<studioHome>/.renders`), never in git: an unused
// one is purged after a month, and "used" is its ATIME. Full rationale: docs/autoFreeze.md.

import { createHash } from "node:crypto";
import { readFileSync, statSync, utimesSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { EXTERNAL_PLUGIN_FORMATS } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import {
  AUTO_RENDERS_HOME_DIR,
  hostsPlugin,
} from "@studio/song-schema/moduleTypes";
import { scanHostsAll } from "./engineCatalogue";
import {
  activeFreezePlans,
  type FreezePlan,
  freezeBlockedBy,
  freezeCut,
  freezePlans,
  pluginModule,
  upstreamOf,
} from "./freeze";
import type { GraphDoc, Module } from "./graph";
import { studioHome } from "./studioHome";
import { wsExists } from "./yaml/workspaceFile";

/** Where automatic renders live: the machine's cache, shared by its projects and kept out of every repository (docs/autoFreeze.md). */
export function autoRendersHome(): string {
  return join(studioHome(), AUTO_RENDERS_HOME_DIR);
}

/** One automatic freeze: where it is taken, what it bakes, and the render it would play. */
export interface AutoFreeze {
  /** The VST module the render is taken at. */
  module: string;
  /** Absolute, in the cache and named by the fingerprint: `<studioHome>/.renders/<module>-<hash>.wav`. */
  render: string;
  plan: FreezePlan;
  /** What the render is made from — the doc the engine's machine is asked to render. */
  cut: ProjectDoc;
  /** The plugins the render needs its RENDERING engine to have: the VSTs inside the plan. */
  plugins: { format: string; name: string }[];
  /** The render is on disk. */
  ready: boolean;
  /** The engine this machine drives has every VST of the plan: it plays them LIVE, and is the one that may render. */
  hosted: boolean;
}

/** Whether `f`'s render stands in for its modules: made, and the engine cannot host them itself. */
export const playsRender = (f: AutoFreeze): boolean => f.ready && !f.hosted;

/** Is this module a VST — an external plugin format in a plugin slot? */
export function isVstModule(m: Module | undefined): boolean {
  if (!m || m.kind !== "plugin" || !hostsPlugin(m.category)) return false;
  const format = String(m.plugin?.type ?? "").toLowerCase();
  return EXTERNAL_PLUGIN_FORMATS.has(format) && !!m.plugin?.name;
}

// Modules the person is EDITING, by project dir: left live so a knob reaches a real plugin. In
// memory and per process, because it is a state of the session, never of the song.
const thawedByDir = new Map<string, Set<string>>();

/** Leave `modules` live in `dir`'s project until thawed again with an empty list — docs/autoFreeze.md. */
export function setThawed(dir: string, modules: Iterable<string>): void {
  const set = new Set(modules);
  if (set.size) thawedByDir.set(resolve(dir), set);
  else thawedByDir.delete(resolve(dir));
}

/** The modules left live in `dir` by `setThawed`. */
export function thawedIn(dir: string): Set<string> {
  return thawedByDir.get(resolve(dir)) ?? new Set();
}

/**
 * Where to freeze: the LAST VST of each run — a VST with no other freezable VST downstream of it —
 * so one render covers every VST before it. A VST the freeze rules refuse (its upstream also leaves
 * the set), one fed by a strudel lane, and one inside a manual freeze are left live.
 */
export function autoFreezePoints(
  g: GraphDoc,
  manual: FreezePlan[],
  thawed: Set<string> = new Set(),
): string[] {
  const underManual = new Set(manual.flatMap((p) => [...p.modules]));
  const onChains = new Set(
    Object.values(g.chains).flatMap((c) => c.use.map((s) => s.module)),
  );
  const upstream = new Map<string, Set<string>>();
  const allowed = Object.keys(g.modules).filter((name) => {
    if (!onChains.has(name) || !isVstModule(g.modules[name])) return false;
    if (underManual.has(name) || thawed.has(name)) return false;
    if (freezeBlockedBy(g.chains, name)) return false;
    const up = upstreamOf(g.chains, name);
    // A thawed module anywhere inside would be baked, which is exactly what thawing it refuses.
    for (const n of up) {
      if (g.tracks[n]?.type === "strudel" || thawed.has(n)) return false;
    }
    upstream.set(name, up);
    return true;
  });
  return allowed.filter(
    (c) => !allowed.some((d) => d !== c && upstream.get(d)?.has(c)),
  );
}

// Content digests of small files, keyed by path and stamped by mtime+size so an edit is seen.
const digests = new Map<string, { stamp: string; digest: string }>();
/** Files this size or under are hashed by CONTENT: a VST's .vstpreset is its params, rewritten in place. */
const CONTENT_HASH_MAX = 1024 * 1024;

/** How a file referenced by the doc enters the fingerprint: named portably, and by content when small. */
function fileToken(abs: string, dir: string): string {
  const rel = relative(dir, abs);
  // Inside the project: its path there. Outside (a médiathèque, a library): its name — both portable.
  const name =
    rel && !rel.startsWith("..") && !isAbsolute(rel)
      ? rel.split(sep).join("/")
      : `~/${basename(abs)}`;
  let st: { size: number; mtimeMs: number };
  try {
    st = statSync(abs);
  } catch {
    return `${name}#missing`;
  }
  if (st.size > CONTENT_HASH_MAX) return `${name}#${st.size}`;
  const stamp = `${st.mtimeMs}:${st.size}`;
  const hit = digests.get(abs);
  if (hit?.stamp === stamp) return `${name}#${hit.digest}`;
  const digest = createHash("sha256")
    .update(readFileSync(abs))
    .digest("hex")
    .slice(0, 16);
  digests.set(abs, { stamp, digest });
  return `${name}#${digest}`;
}

const looksAbsolute = (s: string): boolean =>
  s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s);

/** Fields that say nothing about the SOUND: a destination, a display echo, what the engine ignores. */
const NOT_SOUND = new Set(["presetSave", "event", "color", "recordDir"]);

/**
 * The fingerprint of a render's inputs: the cut doc as the engine will hear it — tempo, clips,
 * plugins, params, automations — with every file named portably. The same song on two machines
 * gives the same name; any change to what the render is made from gives another.
 */
export function freezeFingerprint(cut: ProjectDoc, dir: string): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === "string")
      return looksAbsolute(v) && wsExists(v) ? fileToken(v, dir) : v;
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort())
        if (!NOT_SOUND.has(k)) out[k] = norm((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  const sound = {
    tempo: cut.tempo,
    sampleRate: cut.sampleRate,
    timeSig: [cut.timeSigNumerator, cut.timeSigDenominator],
    tracks: norm(cut.tracks),
  };
  return createHash("sha256")
    .update(JSON.stringify(sound))
    .digest("hex")
    .slice(0, 16);
}

/** A module name as a file name: what `node freeze` does to its own renders. */
const fileSafe = (module: string): string => module.replace(/[:/\\]/g, "-");

/** The render file an automatic freeze of `module` with `fingerprint` plays. */
export function autoRenderPath(module: string, fingerprint: string): string {
  return join(autoRendersHome(), `${fileSafe(module)}-${fingerprint}.wav`);
}

/** How stale a render's last use may get before it is marked again: an hour, so a compile is not a write. */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

/** Mark `abs` as used now, on its ATIME alone: the mtime is what the engine sync compares, and a bump would copy it again. */
function markUsed(abs: string): void {
  try {
    const st = statSync(abs);
    const now = Date.now();
    if (now - Math.max(st.atimeMs, st.mtimeMs) < TOUCH_EVERY_MS) return;
    utimesSync(abs, new Date(now), st.mtime);
  } catch {
    // A render the purge just took is simply not ready: the next tick makes it again.
  }
}

/** Every automatic freeze of a project, against its LIVE compiled doc (no automatic freeze applied). */
export function autoFreezes(
  dir: string,
  g: GraphDoc,
  live: ProjectDoc,
): AutoFreeze[] {
  const isLane = (n: string) => n in g.tracks;
  const manual = activeFreezePlans(g.chains, g.modules, isLane, (r) =>
    wsExists(resolve(dir, r)),
  );
  const out: AutoFreeze[] = [];
  for (const module of autoFreezePoints(g, manual, thawedIn(dir))) {
    // Only a module the compiler turned into a plugin has a signal to render.
    const compiled = live.tracks.some((t) =>
      t.plugins.some((p) => pluginModule(p.id) === module),
    );
    if (!compiled) continue;
    const [plan] = freezePlans(g.chains, [[module, ""]], isLane);
    const cut = freezeCut(live, plan);
    const render = autoRenderPath(module, freezeFingerprint(cut, dir));
    const plugins = [...plan.modules]
      .map((n) => g.modules[n])
      .filter(isVstModule)
      .map((m) => ({
        format: String(m?.plugin?.type ?? "").toLowerCase(),
        name: String(m?.plugin?.name ?? ""),
      }));
    const f: AutoFreeze = {
      module,
      render,
      plan: { ...plan, render },
      cut,
      plugins,
      ready: wsExists(render),
      hosted: scanHostsAll(plugins),
    };
    if (playsRender(f)) markUsed(render);
    out.push(f);
  }
  return out;
}
