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
import {
  retimeWarpMarkers,
  type WarpMarker,
} from "@studio/song-schema/warpPoints";
import { fileStamp } from "@studio/take-render/recordTake";
import { renderMixdown } from "@studio/take-render/render";
import { wavSeconds } from "@studio/take-render/wavLength";
import { parse as parseYaml } from "yaml";
import {
  type ColdStep,
  coldStepOf,
  isOfflineModule,
  type RunColdStep,
  runColdPasses,
} from "./coldPass";
import { measureFilePeakDb, needsPeak, withMeasuredPeak } from "./peakPass";

/** The token a médiathèque chain is named by, so it cannot collide with a project's own chain names. */
export const MEDIATEK_CHAIN = "@st0/";

/** The one track a bounce document has. A name, so a doc read by hand says what it was for. */
const BOUNCE_CHAIN = "process";

/** Which command is running, and therefore what its target may name — see docs/processChain.md. */
export type Scope = "track" | "clip";

// A module as `loadModuleRefs` hands it over — taken off that function, since `rawDoc` is not an export subpath.
type LoadedModule = ReturnType<typeof loadModuleRefs>[string];

/** A chain resolved far enough to render: what to call the result, and the plugins in order. */
export interface ResolvedChain {
  /** What the user typed — for messages. */
  ref: string;
  /** Filename-safe, appended to each render (`kick.wav` → `kick_vocal-strip.wav`). */
  slug: string;
  plugins: PluginDoc[];
  /** The steps that produce FILES instead of processing a buffer — an `offline` module, docs/processChain.md. */
  cold: ColdStep[];
  /** The track this chain already runs on, when it is one of the project's — the caller says so out loud. */
  ownTrack?: string;
}

/** Only numbers reach the engine — a file-valued param travels as its own field. Mirrors `numericParams`. */
function numbers(params: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(
    (params ?? {}) as Record<string, unknown>,
  ))
    if (typeof v === "number") out[k] = v;
  return out;
}

/** A jsdsp module's compiled graph, from the `.json` sibling of its source — the engine parses no files. */
function dspGraphOf(m: LoadedModule): string | undefined {
  if (!m.jsdsp) return undefined;
  const built = `${String(m.jsdsp).replace(/\.[tj]sx?$/, "")}.json`;
  try {
    return readFileSync(built, "utf8");
  } catch {
    return undefined; // never compiled on this machine — reported by the caller
  }
}

/** The chains the account's LIBRARY holds, named by their path under `chains/` — see docs/processChain.md. */
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

/** A chain of the PROJECT, taken off the compiled document under its `<chain>:` prefix — docs/processChain.md. */
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

/** The médiathèque chain a ref names, by path first and then by bare name — a variant's own order. */
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

/** A chain of the MÉDIATHÈQUE: its `graph.yaml` for the order, its `nodes/` for what each step runs. */
function mediatekChain(
  dir: string,
  abs: string,
): { plugins: PluginDoc[]; cold: ColdStep[]; missing: string[] } {
  const steps = chainSteps(readFileSync(join(abs, CHAINS_FILE), "utf8"));
  const byRef = loadModuleRefs(dir);
  const plugins: PluginDoc[] = [];
  const cold: ColdStep[] = [];
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
    // An OFFLINE module is diverted here: it has no engine plugin by construction, docs/processChain.md.
    if (isOfflineModule(m)) {
      try {
        cold.push(coldStepOf(step, m));
      } catch (e) {
        missing.push((e as Error).message);
      }
      continue;
    }
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
  return { plugins, cold, missing };
}

/** The chain to run, the project asked FIRST — throws with what to do next; see docs/processChain.md. */
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
      // A chain that is only a strip has nothing left to bake in once the mixer is dropped.
      if (!plugins.length)
        throw new Error(
          `chain '${trimmed}' has no treatment to apply — only ${own.ownTrack}'s strip, which stays live`,
        );
      // No cold steps: the compiler emits no plugin for an offline module, docs/processChain.md.
      return { ref: trimmed, slug, ownTrack: own.ownTrack, plugins, cold: [] };
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
  const { plugins, cold, missing } = mediatekChain(dir, found.folder);
  if (missing.length)
    throw new Error(
      `chain '${found.ref}' has steps this machine cannot load: ${missing.join(", ")}`,
    );
  if (!plugins.length && !cold.length)
    throw new Error(`chain '${found.ref}' puts the signal through no module`);
  // A chain either BOUNCES or SEPARATES, and mixing the two is refused by name — docs/processChain.md.
  if (cold.length && plugins.length)
    throw new Error(
      `chain '${found.ref}' both separates (${cold
        .map((c) => c.step)
        .join(
          ", ",
        )}) and processes (${plugins.length} module(s)) — a bounce cannot say which ` +
        "of the stems the next step treats. Put the separation in a chain of its own.",
    );
  return { ref: trimmed, slug, plugins, cold };
}

/** What a target resolved to: the audio files to process, and how to name them in a message. */
export interface Targets {
  label: string;
  sources: string[];
  /** The track, when the target was one — so the caller can spot a track processed with its own chain. */
  track?: string;
}

/** What to process, within what the command promised — each scope refuses the other's argument, docs/processChain.md. */
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

/** Where a source's render lands — `<name>_<slug>_<stamp>.wav` beside it, always wav; see docs/processChain.md. */
export function renderPath(
  source: string,
  slug: string,
  stamp = fileStamp(),
): string {
  const p = parsePath(source);
  // A previous run of the SAME chain is stripped, stamp and all; a DIFFERENT chain stacks on purpose.
  const base = p.name.replace(new RegExp(`_${slug}_\\d{6}T\\d{6}$`), "");
  return join(p.dir, `${base}_${slug}_${stamp}.wav`);
}

/** The one-track document a bounce renders — the RAW file at position zero, no warp and no window, docs/processChain.md. */
export function bounceDoc(
  project: ProjectDoc,
  source: string,
  chain: ResolvedChain,
): ProjectDoc {
  const name = parsePath(source).name;
  return emptyDoc({
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
}

export function bounceThroughChain(
  engineBin: string,
  project: ProjectDoc,
  source: string,
  chain: ResolvedChain,
  outWav: string,
): void {
  const doc = bounceDoc(project, source, chain);
  const tmp = mkdtempSync(join(tmpdir(), "tbchain-"));
  try {
    const manifest = renderMixdown(engineBin, doc, tmp);
    copyFileSync(join(tmp, manifest.mix), outWav);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Point every clip file that played `from` at `to`, retiming its warp map — the "in place" half, docs/processChain.md. */
export function repointClips(
  dir: string,
  from: string,
  to: string,
  /** The render's length in seconds — absent when it could not be read, and then the map is left alone. */
  seconds?: number | null,
): string[] {
  const moved: string[] = [];
  const rel = relative(dir, to).split("\\").join("/");
  for (const e of entityFiles(join(dir, "clips"), "clips")) {
    let raw: { source?: unknown; warp?: { markers?: unknown } };
    try {
      raw = (parseYaml(readFileSync(e.file.path, "utf8"), { version: "1.2" }) ??
        {}) as { source?: unknown; warp?: { markers?: unknown } };
    } catch {
      continue; // a clip file that won't parse is the compiler's to report, not this edit's
    }
    if (!raw.source || resolve(dir, String(raw.source)) !== resolve(from))
      continue;
    setFileValue(e.file.path, ["source"], rel);
    // …and the map, when there is one and the file's length moved under it.
    const markers = raw.warp?.markers;
    if (seconds != null && Array.isArray(markers)) {
      const retimed = retimeWarpMarkers(
        markers.map((m): WarpMarker => [Number(m?.[0]), Number(m?.[1])]),
        seconds,
      );
      if (retimed) setFileValue(e.file.path, ["warp", "markers"], retimed);
    }
    moved.push(e.id);
  }
  return moved;
}

/** What one run did, for the caller to log and to decide whether to reload. */
export interface ProcessResult {
  lines: string[];
  changed: boolean;
}

/** The whole flow: resolve the chain and the material, bounce each file, repoint the clips. */
export async function processWithChain(
  dir: string,
  project: ProjectDoc,
  target: string,
  chainRef: string,
  scope: Scope,
  // Called with each render's absolute path just before it is written, so a host can back it up.
  beforeWrite?: (absPath: string) => void,
  /** How to run one COLD step: handed in rather than imported, since the model lives downstream. */
  runCold?: RunColdStep,
): Promise<ProcessResult> {
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

  const show = (s: string) => relative(dir, s).split("\\").join("/");

  // A chain of COLD steps: files in, files out, before the engine check — docs/processChain.md.
  if (chain.cold.length) {
    if (!runCold)
      return {
        lines: [
          `${verb}: '${chain.ref}' runs offline (${chain.cold
            .map((c) => c.step)
            .join(", ")}), and this host cannot run an offline step`,
        ],
        changed: false,
      };
    try {
      const done = await runColdPasses(targets.sources, chain.cold, runCold);
      const wrote = done.reduce((n, d) => n + d.files.length, 0);
      return {
        lines: [
          `${targets.label} through '${chain.ref}' — ${wrote} file(s):`,
          ...done.map(
            (d) =>
              `${show(d.source)} → ${d.files.map(show).join(", ") || "nothing"}`,
          ),
        ],
        // The project's files are untouched, but the workspace's tree has new files in it.
        changed: wrote > 0,
      };
    } catch (e) {
      return {
        lines: [`${verb} failed: ${(e as Error).message}`],
        changed: false,
      };
    }
  }

  const engine = findEngineBinary();
  if (!engine)
    return {
      lines: [
        `${verb} failed: st0-engine binary not found (build the engine)`,
      ],
      changed: false,
    };

  const lines: string[] = [];
  // Asked once up front so a chain with no measuring step pays no decode — see docs/peakPass.md.
  const measuring = needsPeak(chain.plugins);
  let changed = false;
  for (const source of targets.sources) {
    const out = renderPath(source, chain.slug);
    try {
      beforeWrite?.(out); // let the host back up the prior render before we overwrite it
      // Per source and never written back into `chain`, whose next file has its own peak.
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
      // Per source, and the loop continues: one undecodable clip must not cost the others theirs.
      lines.push(`${show(source)}: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    changed = true;
    // The render's own length, so a clip's stretch map can follow it — see repointClips.
    const moved = repointClips(dir, source, out, wavSeconds(out));
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
  // Said rather than refused: baking a track's OWN chain in is legitimate once you bypass it.
  if (changed && chain.ownTrack && chain.ownTrack === targets.track)
    lines.push(
      `note: '${chain.ref}' is the track's own chain and still runs on playback, so the ` +
        "treatment is now heard twice — bypass its modules, or use `track freeze` instead.",
    );
  return { lines, changed };
}
