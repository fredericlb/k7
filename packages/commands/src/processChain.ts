// processChain.ts — apply a chain to MATERIAL: bounce a track's clips (or one clip, or one
// audio file) through a chain of the project or of this machine's médiathèque cache, write the
// render beside the original, and point the clip files at it. A bounce in place.
// See docs/processChain.md.

import {
  copyFileSync,
  type Dirent,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse as parsePath, relative, resolve } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import {
  clipDoc,
  DSP_GRAPH_PLUGIN,
  emptyDoc,
  enginePlugin,
  pluginDoc,
  trackDoc,
} from "@studio/engine-protocol/build";
import { CHAINS_FILE, NODES_DIR } from "@studio/mediatek/types";
import { chainSteps } from "@studio/song/chainsGraph";
import { loadModuleRefs } from "@studio/song/loader";
import { resolveModule } from "@studio/song/moduleResolve";
import type { PluginDoc, ProjectDoc } from "@studio/song/project";
import { MIXER_PLUGIN } from "@studio/song/project";
import { librariesDirFor } from "@studio/song/sharedFolders";
import { setFileValue } from "@studio/song/yaml/edit";
import { entityFiles } from "@studio/song/yaml/moduleIO";
import { parse as parseYaml } from "yaml";
import { measureFilePeakDb, needsPeak, withMeasuredPeak } from "./peakPass";
import { renderMixdown } from "./render";

/** What a chain of the médiathèque is named by, so the two vocabularies can't collide with the
 *  project's own chain names. The same token a module ref carries (see @studio/song's mediatekRoot). */
export const MEDIATEK_CHAIN = "@st0/";

/** The one track a bounce document has. A name, so a doc read by hand says what it was for. */
const BOUNCE_CHAIN = "process";

/**
 * Which command is running, and therefore what its target may name.
 *
 * `track process` and `clip process` share every line below but this: the noun in the command IS
 * the promise about what the argument is, so a track name handed to `clip process` is refused
 * and pointed at the other one rather than quietly resolving. They were one command taking
 * either, and that made the first word decorative.
 */
export type Scope = "track" | "clip";

// A module as `loadModuleRefs` hands it over. Taken off that function rather than imported:
// `rawDoc` is not one of @studio/song's export subpaths, and this needs the shape, not the file.
type LoadedModule = ReturnType<typeof loadModuleRefs>[string];

/** A chain resolved far enough to render: what to call the result, and the plugins in order. */
export interface ResolvedChain {
  /** What the user typed — for messages. */
  ref: string;
  /** Filename-safe, appended to each render (`kick.wav` → `kick_vocal-strip.wav`). */
  slug: string;
  plugins: PluginDoc[];
  /** The track this chain already runs on, when it is one of the project's. The caller says
   *  so out loud: baking it into the clips leaves it running on playback too. */
  ownTrack?: string;
}

/** Only numbers reach the engine — `params` on the wire is numeric, and a file-valued one
 *  (a .nam model) travels as its own field. Mirrors nodeProject's numericParams. */
function numbers(params: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(
    (params ?? {}) as Record<string, unknown>,
  ))
    if (typeof v === "number") out[k] = v;
  return out;
}

/** A jsdsp module's compiled graph, from the `.json` sibling of its source. The engine parses
 *  no files, so the graph has to travel inside the document. */
function dspGraphOf(m: LoadedModule): string | undefined {
  if (!m.jsdsp) return undefined;
  const built = `${String(m.jsdsp).replace(/\.[tj]sx?$/, "")}.json`;
  try {
    return readFileSync(built, "utf8");
  } catch {
    return undefined; // never compiled on this machine — reported by the caller
  }
}

/**
 * The chains the account's LIBRARY holds, named as a variant names one: the path under
 * `chains/` (`live/vocal-strip`).
 *
 * Read out of the submodule mounted beside this project, not out of the machine's médiathèque
 * cache — which is why it takes the project dir where it used to take nothing. A chain is a
 * folder holding a `graph.yaml`, at any depth, and nothing inside one is another: the
 * médiathèque's own rule, restated here because `scanFamily` is bound to the cache root and
 * this no longer reads that. A missing submodule is an empty list, never a throw.
 */
function libraryChains(dir: string): { ref: string; folder: string }[] {
  const root = librariesDirFor(dir, "chains");
  const out: { ref: string; folder: string }[] = [];
  const walk = (at: string, ref: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return; // not mounted, or not a folder — both are "no chains here"
    }
    if (entries.some((e) => e.isFile() && e.name === CHAINS_FILE))
      return void out.push({ ref, folder: at });
    for (const e of entries)
      if (e.isDirectory())
        walk(join(at, e.name), ref ? `${ref}/${e.name}` : e.name);
  };
  walk(root, "");
  return out;
}

/** The chains this command can name: the project's own, then the médiathèque's under their token. */
export function chainNames(dir: string, project: ProjectDoc): string[] {
  const own = new Set<string>();
  for (const t of project.tracks)
    for (const p of t.plugins) {
      const at = p.id.indexOf(":");
      if (at > 0) own.add(p.id.slice(0, at));
    }
  return [
    ...[...own].sort(),
    ...libraryChains(dir).map((c) => `${MEDIATEK_CHAIN}${c.ref}`),
  ];
}

/**
 * A chain of the PROJECT, taken off the compiled document.
 *
 * The compiler has already resolved every step — its plugin format, its params, the preset it
 * loads, a jsdsp module's graph — and addressed each one `<chain>:<module>`, so the chain is
 * already in the document under that prefix. Rebuilding it here from the chain's own file would be a
 * second compiler, and the two would drift.
 *
 * A chain that feeds no track and is nobody's bus compiles to no plugins at all (see
 * nodeProject's `ownerOf`), so it is not findable this way — and `resolveChain` says that
 * rather than reporting it as a name nobody knows.
 */
function projectChain(
  project: ProjectDoc,
  name: string,
): { plugins: PluginDoc[]; ownTrack: string } | null {
  for (const t of project.tracks) {
    const plugins = t.plugins.filter((p) => p.id.startsWith(`${name}:`));
    if (plugins.length) return { plugins, ownTrack: t.id };
  }
  return null;
}

/** The médiathèque chain a ref names, by path first and then by bare name — the same order
 *  the médiathèque itself resolves a song's variant in (see its docs/variants.md). */
function findChainFolder(
  dir: string,
  want: string,
): { ref: string; folder: string } | null {
  const chains = libraryChains(dir);
  return (
    chains.find((c) => c.ref === want) ??
    chains.find((c) => c.ref.split("/").pop() === want) ??
    null
  );
}

/**
 * A chain of the MÉDIATHÈQUE: its `graph.yaml` for the order, its `nodes/` for what each
 * step runs.
 *
 * Each node is resolved through the project's module vocabulary, so a node that only
 * says `extends: "@st0/audio/eq"` arrives with the eq's plugin, params and preset folded
 * in. That vocabulary is this machine's cache: a step whose module was never synced resolves to
 * nothing, and the bounce is refused rather than writing a copy that quietly skipped a treatment.
 */
function mediatekChain(
  dir: string,
  abs: string,
): { plugins: PluginDoc[]; missing: string[] } {
  const steps = chainSteps(readFileSync(join(abs, CHAINS_FILE), "utf8"));
  const byRef = loadModuleRefs(dir);
  const plugins: PluginDoc[] = [];
  const missing: string[] = [];

  for (const step of steps) {
    const file = join(abs, NODES_DIR, `${step}.yaml`);
    let raw: Record<string, unknown> = {};
    try {
      raw = (parseYaml(readFileSync(file, "utf8"), { version: "1.2" }) ??
        {}) as Record<string, unknown>;
    } catch {
      missing.push(`${step} (no ${NODES_DIR}/${step}.yaml)`);
      continue;
    }
    const m = resolveModule(raw as unknown as LoadedModule, byRef);
    const { type, name } = enginePlugin(m.plugin, step);
    if (!type) {
      missing.push(
        `${step} (extends ${String(raw.extends ?? "nothing")} — not in this machine's cache)`,
      );
      continue;
    }
    const dspGraph = dspGraphOf(m);
    if (type === DSP_GRAPH_PLUGIN && !dspGraph) {
      missing.push(`${step} (its DSP graph has never been compiled here)`);
      continue;
    }
    plugins.push(
      pluginDoc({
        id: `${BOUNCE_CHAIN}:${step}`,
        type,
        name,
        path: m.preset ? String(m.preset) : "",
        ...(m.nam ? { namFile: String(m.nam) } : {}),
        ...(dspGraph ? { dspGraph } : {}),
        params: numbers(m.params),
      }),
    );
  }
  return { plugins, missing };
}

/**
 * The chain to run, from the project or from the médiathèque. Throws with what to do next.
 *
 * The project is asked FIRST and the médiathèque only under its own token, so a project chain
 * can never be shadowed by a library one that happens to share its name.
 *
 * Two things are dropped from a project chain on the way out, and both would otherwise be
 * applied twice: a MIXER module (a track's level is not a treatment — it stays live on the
 * strip, exactly as a freeze leaves it), and a `sidechainFrom`, whose feeding lane does not
 * exist in a document holding one track.
 */
export function resolveChain(
  dir: string,
  project: ProjectDoc,
  ref: string,
): ResolvedChain {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error("no chain named");
  const library = trimmed.startsWith(MEDIATEK_CHAIN);
  const want = (
    library ? trimmed.slice(MEDIATEK_CHAIN.length) : trimmed
  ).replace(/^\/+|\/+$/g, "");
  const slug =
    want
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[^A-Za-z0-9_-]+/g, "-") || "chain";

  if (!library) {
    const own = projectChain(project, trimmed);
    if (own) {
      const plugins = own.plugins
        .filter((p) => p.type !== MIXER_PLUGIN)
        .map((p) => {
          const copy: PluginDoc = { ...p };
          delete copy.sidechainFrom;
          return copy;
        });
      // A chain that is only a strip is a level and nothing else, and the strip is the one thing
      // this drops — so there would be nothing left to bake in, and the "bounce" would write a
      // copy of the source under a name promising a treatment.
      if (!plugins.length)
        throw new Error(
          `chain '${trimmed}' has no treatment to apply — only ${own.ownTrack}'s strip, which stays live`,
        );
      return { ref: trimmed, slug, ownTrack: own.ownTrack, plugins };
    }
  }

  const found = findChainFolder(dir, want);
  if (!found) {
    const known = chainNames(dir, project);
    throw new Error(
      `no chain '${trimmed}' — known here: ${known.join(", ") || "none"}` +
        (libraryChains(dir).length
          ? ""
          : " (this machine has synced no médiathèque chains)"),
    );
  }
  const { plugins, missing } = mediatekChain(dir, found.folder);
  if (missing.length)
    throw new Error(
      `chain '${found.ref}' has steps this machine cannot load: ${missing.join(", ")}`,
    );
  if (!plugins.length)
    throw new Error(`chain '${found.ref}' puts the signal through no module`);
  return { ref: trimmed, slug, plugins };
}

/** What a target resolved to: the audio files to process, and how to name them in a message. */
export interface Targets {
  label: string;
  sources: string[];
  /** The track, when the target was one — so the caller can spot a track processed with its own chain. */
  track?: string;
}

/**
 * What to process, within what the command promised.
 *
 * `track process` takes a TRACK and nothing else: every audio file its clips play, deduplicated,
 * because two placements of one clip are one file and bouncing it twice would run the second
 * pass over the first one's output.
 *
 * `clip process` takes a CLIP by id — the file it plays goes through the chain, so every
 * placement of that clip is treated at once: a clip IS its material — or a project-relative
 * PATH, for audio no clip file has claimed yet.
 *
 * Each refuses the other's argument by name. A track handed to `clip process` used to resolve
 * anyway, which made the first word of the command decorative and the log line the only place
 * you could find out what had actually been bounced.
 */
export function resolveTargets(
  dir: string,
  project: ProjectDoc,
  target: string,
  scope: Scope,
): Targets {
  const rel = target.trim().replace(/\\/g, "/");
  const track = project.tracks.find((t) => t.id === rel || t.name === rel);

  if (scope === "track") {
    if (!track)
      throw new Error(
        `no track '${rel}'` +
          (entityFiles(join(dir, "clips"), "clips").some((e) => e.id === rel)
            ? " — it is a clip, so run `clip process`"
            : ` (tracks: ${project.tracks.map((t) => t.id).join(", ") || "none"})`),
      );
    const sources = [
      ...new Set(
        track.clips
          .filter((c) => c.type === "audio" && c.source)
          .map((c) => c.source),
      ),
    ];
    if (!sources.length)
      throw new Error(`'${track.id}' has no audio clips to process`);
    return { label: `track '${track.id}'`, sources, track: track.id };
  }

  if (track)
    throw new Error(`'${rel}' is a track, so run \`track process\` instead`);

  const clip = entityFiles(join(dir, "clips"), "clips").find(
    (e) => e.id === rel,
  );
  if (clip) {
    const raw = (parseYaml(readFileSync(clip.file.path, "utf8"), {
      version: "1.2",
    }) ?? {}) as { source?: unknown };
    if (!raw.source)
      throw new Error(`clip '${rel}' names no source (${clip.file.rel})`);
    return {
      label: `clip '${rel}'`,
      sources: [resolve(dir, String(raw.source))],
    };
  }

  return { label: rel, sources: [join(dir, rel)] };
}

/** Where a source's render lands: `<name>_<slug>.wav`, beside it. Re-running strips the
 *  previous suffix rather than stacking one, so processing twice overwrites rather than
 *  producing `kick_warm_warm.wav`. Always `.wav` — the engine writes nothing else. */
export function renderPath(source: string, slug: string): string {
  const p = parsePath(source);
  const base = p.name.replace(new RegExp(`_${slug}$`), "");
  return join(p.dir, `${base}_${slug}.wav`);
}

/**
 * One source through the chain, offline.
 *
 * `--render` and not the transport: it opens no audio device, so a bounce runs while the live
 * engine is playing (see @studio/file-service's docs/render.md). The document is one track
 * holding the file at position 0 with its natural length, and the chain as the plugins on it —
 * the same shape the médiathèque auditions a variant through.
 *
 * Nothing is carried over from the song but its tempo and sample rate: automation is written
 * against SONG time and this clip starts at zero, so baking a curve in would apply it at the
 * wrong moment on every placement.
 */
export function bounceThroughChain(
  engineBin: string,
  project: ProjectDoc,
  source: string,
  chain: ResolvedChain,
  outWav: string,
): void {
  const name = parsePath(source).name;
  const doc = emptyDoc({
    name: `${name} · ${chain.ref}`,
    tempo: project.tempo,
    sampleRate: project.sampleRate,
    tracks: [
      trackDoc(BOUNCE_CHAIN, {
        name,
        clips: [
          clipDoc({
            id: `${BOUNCE_CHAIN}-clip`,
            type: "audio",
            name,
            source,
          }),
        ],
        plugins: chain.plugins,
      }),
    ],
  });
  const tmp = mkdtempSync(join(tmpdir(), "tbchain-"));
  try {
    const manifest = renderMixdown(engineBin, doc, tmp);
    copyFileSync(join(tmp, manifest.mix), outWav);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Point every clip file that played `from` at `to`, and say which ones moved.
 *
 * This is the "in place" half. A placement holds a POSITION and names a clip; the clip names
 * the file — so rewriting that one line leaves every placement, window, fade and loop exactly
 * where it was, and only the material changes. The original file is untouched on disk, which
 * makes the whole edit one line to undo.
 *
 * The clip's `from`/`to` window stays valid because the render is the whole file: same start,
 * same rate, so the seconds it cuts at still mean the same thing.
 */
export function repointClips(dir: string, from: string, to: string): string[] {
  const moved: string[] = [];
  const rel = relative(dir, to).split("\\").join("/");
  for (const e of entityFiles(join(dir, "clips"), "clips")) {
    let raw: { source?: unknown };
    try {
      raw = (parseYaml(readFileSync(e.file.path, "utf8"), { version: "1.2" }) ??
        {}) as { source?: unknown };
    } catch {
      continue; // a clip file that won't parse is the compiler's to report, not this edit's
    }
    if (!raw.source || resolve(dir, String(raw.source)) !== resolve(from))
      continue;
    setFileValue(e.file.path, ["source"], rel);
    moved.push(e.id);
  }
  return moved;
}

/** What one run did, for the caller to log and to decide whether to reload. */
export interface ProcessResult {
  lines: string[];
  changed: boolean;
}

/**
 * The whole flow: resolve the chain and the material, bounce each file, repoint the clips.
 *
 * Every failure is reported with what to do about it and nothing half-written: the chain is
 * resolved before the first render, so a chain naming a module this machine has not got costs
 * no time and leaves no file behind.
 */
export function processWithChain(
  dir: string,
  project: ProjectDoc,
  target: string,
  chainRef: string,
  scope: Scope,
  // Called with each render's absolute path just before it is written, so a host can back it up.
  beforeWrite?: (absPath: string) => void,
): ProcessResult {
  // Every message names the command that produced it, both of them being one implementation.
  const verb = `${scope} process`;
  let chain: ResolvedChain;
  let targets: Targets;
  try {
    chain = resolveChain(dir, project, chainRef);
    targets = resolveTargets(dir, project, target, scope);
  } catch (e) {
    return { lines: [`${verb}: ${(e as Error).message}`], changed: false };
  }

  const missing = targets.sources.filter((s) => !existsSync(s));
  if (missing.length)
    return {
      lines: [
        `missing source(s) for ${targets.label}: ${missing
          .map((m) => relative(dir, m).split("\\").join("/"))
          .join(", ")}`,
      ],
      changed: false,
    };

  const engine = findEngineBinary();
  if (!engine)
    return {
      lines: [
        `${verb} failed: studio-moteur binary not found (build the engine)`,
      ],
      changed: false,
    };

  const show = (s: string) => relative(dir, s).split("\\").join("/");
  const lines: string[] = [];
  // A chain with a MEASURING cold step in it — a normaliser — needs its number before it can be
  // rendered, and the number is a fact about THIS file. So the measurement sits inside the loop,
  // which is what "offline, on a file, immediately before the render" means. Asked once, up front,
  // so a chain with no such step pays no decode: most bounces are not normalisations.
  const measuring = needsPeak(chain.plugins);
  let changed = false;
  for (const source of targets.sources) {
    const out = renderPath(source, chain.slug);
    try {
      beforeWrite?.(out); // let the host back up the prior render before we overwrite it
      // Per source, and never written back into `chain`: the next file has its own peak, and a
      // shared chain would hand it this one's gain.
      const forThisFile = measuring
        ? {
            ...chain,
            plugins: withMeasuredPeak(
              chain.plugins,
              measureFilePeakDb(engine, source),
            ),
          }
        : chain;
      bounceThroughChain(engine, project, source, forThisFile, out);
    } catch (e) {
      // Per source, and the loop continues: one clip the engine could not decode must not cost
      // the other three their bounce.
      lines.push(`${show(source)}: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    changed = true;
    const moved = repointClips(dir, source, out);
    lines.push(
      `${show(source)} → ${show(out)}` +
        (moved.length
          ? moved.length === 1
            ? ` (clip ${moved[0]} now plays it)`
            : ` (clips ${moved.join(", ")} now play it)`
          : " (no clip file named it — nothing to repoint)"),
    );
  }

  if (changed)
    lines.unshift(
      `${targets.label} through '${chain.ref}' — ${chain.plugins.length} module(s):`,
    );
  // Baking a track's OWN chain in leaves that chain running on playback, so the treatment
  // would be heard twice. Said here rather than refused: applying a chain to the material it
  // already runs on is a legitimate thing to want, once you bypass it.
  if (changed && chain.ownTrack && chain.ownTrack === targets.track)
    lines.push(
      `note: '${chain.ref}' is the track's own chain and still runs on playback, so the ` +
        "treatment is now heard twice — bypass its modules, or use `track freeze` instead.",
    );
  return { lines, changed };
}
