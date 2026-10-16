// bounce.ts — run a resolved chain over MATERIAL: what the target names, the one-track document
// each file renders through, where the render lands, and the clip files pointed at it.
// A bounce in place: the placements stay, the clips they name play the render. See docs/processChain.md.

import { join, parse as parsePath, relative, resolve } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { clipDoc, emptyDoc, trackDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/song/project";
import { setFileValue } from "@studio/song/yaml/edit";
import { entityFiles } from "@studio/song/yaml/moduleIO";
import { wsExists, wsRead } from "@studio/song/yaml/workspaceFile";
import {
  retimeWarpMarkers,
  type WarpMarker,
} from "@studio/song-schema/warpPoints";
import { fileStamp } from "@studio/take-render/recordTake";
import {
  localRenderer,
  type Renderer,
  renderToWav,
} from "@studio/take-render/renderer";
import { wavSeconds } from "@studio/take-render/wavLength";
import { parse as parseYaml } from "yaml";
import { type RunColdStep, runColdPasses } from "./coldPass";
import { measureFilePeakDb, needsPeak, withMeasuredPeak } from "./peakPass";
import { BOUNCE_CHAIN, type ResolvedChain, resolveChain } from "./resolveChain";

/** Which command is running, and therefore what its target may name — see docs/processChain.md. */
export type Scope = "track" | "clip";

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
    const raw = (parseYaml(wsRead(clip.file.path), {
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
  render: Renderer,
  project: ProjectDoc,
  source: string,
  chain: ResolvedChain,
  outWav: string,
): Promise<void> {
  return renderToWav(render, bounceDoc(project, source, chain), outWav);
}

/** Point every clip file that played `from` at `to`, retiming its warp map — the "in place" half, docs/processChain.md. */
export function repointClips(
  dir: string,
  from: string,
  to: string,
  /** The render's length in seconds — absent when it could not be read, and then the map is left alone. */
  seconds?: number | null,
  /** The clip ids allowed to follow — absent means every clip playing `from`; `event process` names its own. */
  only?: readonly string[],
): string[] {
  const moved: string[] = [];
  const rel = relative(dir, to).split("\\").join("/");
  for (const e of entityFiles(join(dir, "clips"), "clips")) {
    if (only && !only.includes(e.id)) continue;
    let raw: { source?: unknown; warp?: { markers?: unknown } };
    try {
      raw = (parseYaml(wsRead(e.file.path), { version: "1.2" }) ?? {}) as {
        source?: unknown;
        warp?: { markers?: unknown };
      };
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
  /** The clip ids the render may be repointed in — see repointClips. */
  only?: readonly string[],
  /** Who bounces: handed in by a host with no engine binary, this machine's binary otherwise. */
  render?: Renderer,
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

  const missing = targets.sources.filter((s) => !wsExists(s));
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
  const renderer = render ?? (engine ? localRenderer(engine) : null);
  if (!renderer)
    return {
      lines: [`${verb} failed: k7-runtime binary not found (build the engine)`],
      changed: false,
    };

  const lines: string[] = [];
  // Asked once up front so a chain with no measuring step pays no decode — see docs/peakPass.md.
  const measuring = needsPeak(chain.plugins);
  // Measuring is a decode, not a render, so it needs this machine's own binary.
  if (measuring && !engine)
    return {
      lines: [
        `${verb} failed: '${chain.ref}' measures its source, which needs an engine binary on this machine`,
      ],
      changed: false,
    };
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
              await measureFilePeakDb(engine as string, source),
            ),
          }
        : chain;
      await bounceThroughChain(renderer, project, source, forThisFile, out);
    } catch (e) {
      // Per source, and the loop continues: one undecodable clip must not cost the others theirs.
      lines.push(`${show(source)}: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    changed = true;
    // The render's own length, so a clip's stretch map can follow it — see repointClips.
    const moved = repointClips(dir, source, out, wavSeconds(out), only);
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
