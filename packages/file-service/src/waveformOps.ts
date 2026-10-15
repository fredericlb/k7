// waveformOps.ts — the workspace's waveform machinery: slice the engine-computed file
// envelopes to clip regions, memoize the sliced results, and prewarm the whole active
// project in the background. Extracted from workspace.ts; the durable cache stays the
// engine-written `{source}.cache` sidecars (see waveformCache.ts) — everything here is
// the in-memory, per-session layer over them.

import { readdirSync, unlinkSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { beatGrid, regionWaveform } from "@studio/audio-probe/waveform";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import {
  confineTo,
  confineToProject,
  projectRoots,
} from "@studio/song/confine";
import { materialRefOf } from "@studio/song/nodeProject";
import type { ClipDoc, ProjectDoc } from "@studio/song/project";
import { loadAudioClipDoc } from "@studio/song/project";
import { resolveOnsets } from "@studio/song-edit/onsets";
import { clipOnsets } from "@studio/song-edit/projectEdit";
import type { WaveformStatus, WebWaveform } from "@studio/web-protocol";
import {
  CACHE_EXT,
  ensureFileEnvelope,
  runWaveformBatch,
  staleWaveformSources,
} from "./waveformCache.ts";

export const DEFAULT_WF_BUCKETS = 1000; // matches the frontend's api.waveform default

// Audio file extensions a rack references directly by absolute path (see waveform()).
export const AUDIO_EXT = /\.(wav|mp3|ogg|flac|aif|aiff|m4a)$/i;

export function findClip(p: ProjectDoc, clipId: string): ClipDoc | undefined {
  for (const t of p.tracks) {
    const c = t.clips.find((c) => c.id === clipId);
    if (c) return c;
  }
  return undefined;
}

// A memo entry for a sliced region; `sig` folds everything it depends on, so a changed source or moved clip misses.
interface WfEntry {
  sig: string;
  data: WebWaveform;
}

/** The fingerprint + everything the region math reads; a cache in front must fold the same (docs/waveformCache.md). */
const wfSig = (
  fingerprint: string,
  clip: ClipDoc,
  p: ProjectDoc,
  buckets: number,
): string =>
  [
    fingerprint,
    clip.offset,
    clip.length,
    clip.start,
    clip.sourceFrom ?? "",
    clip.sourceTo ?? "",
    // The markers themselves, not just "is it warped": moving one changes the rate.
    (clip.warp?.markers ?? []).flat().join(","),
    p.tempo,
    p.timeSigNumerator,
    buckets,
  ].join("|");

/** The clip's own window, in FILE seconds, or null when it has none. A `to` of 0 is the file's end. */
function materialWindow(c: ClipDoc): { from: number; to: number } | null {
  return c.sourceFrom || c.sourceTo
    ? { from: c.sourceFrom ?? 0, to: c.sourceTo ?? 0 }
    : null;
}

// Slice the file envelope to the clip's region and add the bar/beat grid; `window` rides the region's own mapping.
function buildWaveform(
  env: Parameters<typeof regionWaveform>[0],
  clip: ClipDoc,
  p: ProjectDoc,
  buckets: number,
  window: { from: number; to: number } | null = null,
): WebWaveform {
  const w = regionWaveform(env, clip, p, buckets);
  const shade = window
    ? {
        from: Math.max(0, w.toDisplay(window.from)),
        // An unwritten `to` is the file's end, which on this picture is its right edge.
        to:
          window.to > 0
            ? Math.min(w.seconds, w.toDisplay(window.to))
            : w.seconds,
      }
    : null;
  return {
    rms: w.rms,
    peak: w.peak,
    ...(w.low && w.mid && w.high
      ? { low: w.low, mid: w.mid, high: w.high }
      : {}),
    seconds: w.seconds,
    intervalMs: w.rms.length ? (w.seconds / w.rms.length) * 1000 : 0,
    startBeat: w.startBeat,
    clipBeats: w.clipBeats,
    grid: beatGrid(w),
    warpMarks: w.warpMarks,
    sourceMap: w.sourceMap,
    transients: w.transients,
    // Sent only when it actually cuts something: a band over the whole pane says nothing.
    ...(shade &&
    shade.to > shade.from &&
    (shade.from > 1e-6 || shade.to < w.seconds - 1e-6)
      ? { sourceWindow: shade }
      : {}),
  };
}

/** What WaveformOps needs from its workspace — paths, the doc cache, the guards. */
export interface WaveformHost {
  readonly root: string;
  /** The active project's dir, or throw ("no active project …"). */
  requireActive(): string;
  /** The active project's dir, or null. */
  activeProject(): string | null;
  /** The compiled (cached) doc for `dir`. */
  cachedProjectDoc(dir: string): ProjectDoc;
  withinRoot(abs: string): boolean;
  /** The tree's hidden-name rule, reused so the cache sweep skips the same places. */
  skip(name: string): boolean;
}

export class WaveformOps {
  // A per-session memo of sliced regions; the DURABLE cache is the engine's `{source}.cache` sidecars.
  private wfCache = new Map<string, WfEntry>();
  private warmState: WaveformStatus = { warming: false, done: 0, total: 0 };
  private warmRun = 0;
  // Aborts the in-flight prewarm's engine child, so a delete can free the .wav files it holds open (Windows).
  private warmAbort: AbortController | null = null;

  constructor(private readonly host: WaveformHost) {}

  private wfKey(clipId: string, buckets: number): string {
    return `${this.host.activeProject() ?? this.host.root}::${clipId}::${buckets}`;
  }

  /** `whole` asks for the MATERIAL rather than the placement — see docs/waveformCache.md. */
  async waveform(
    clipId: string,
    buckets: number = DEFAULT_WF_BUCKETS,
    whole = false,
    /** The transient threshold to detect at. Omitted, the source keeps whichever it was last built with. */
    sensitivity?: number,
  ): Promise<WebWaveform> {
    const dir = this.host.requireActive();
    const p = this.host.cachedProjectDoc(dir);
    // A rack's audio is an absolute path, not a clip id; the workspace guard confines the query param.
    if (isAbsolute(clipId) && AUDIO_EXT.test(clipId)) {
      const fileAbs = resolve(clipId);
      if (!this.host.withinRoot(fileAbs))
        throw new Error(`audio path is outside the workspace`);
      const env = await ensureFileEnvelope(
        fileAbs,
        findEngineBinary(),
        sensitivity,
      );
      const whole: ClipDoc = {
        id: clipId,
        type: "audio",
        name: basename(fileAbs),
        source: fileAbs,
        start: 0,
        length: 0,
        offset: 0,
        fadeIn: 0,
        fadeOut: 0,
        loopStart: 0,
        loopEnd: 0,
        notes: [],
      };
      return buildWaveform(env, whole, p, buckets);
    }
    // The grid, so a TIMECODE `from:`/`to:` resolves to seconds here as it does in the compiler.
    const grid = {
      tempo: p.tempo,
      num: p.timeSigNumerator,
      den: p.timeSigDenominator,
    };
    // The MATERIAL this id names, where the lookups below want a PLACEMENT — see docs/waveformCache.md.
    const ref = materialRefOf(clipId);
    const clip = whole
      ? (loadAudioClipDoc(dir, ref, grid) ?? findClip(p, clipId))
      : (findClip(p, clipId) ?? loadAudioClipDoc(dir, ref, grid));
    if (!clip) throw new Error(`no clip '${clipId}'`);
    if (clip.type !== "audio")
      throw new Error(`'${clipId}' is not an audio clip`);
    // The window to SHADE is the PLACEMENT's, and it must not also crop — see docs/waveformCache.md.
    const window = whole ? materialWindow(findClip(p, clipId) ?? clip) : null;
    const drawn = window
      ? { ...clip, sourceFrom: undefined, sourceTo: undefined }
      : clip;
    // The engine decodes any format and refreshes the sidecar; we slice the returned envelope to the region.
    // A clip's source is text a file holds: inside the project's roots or nothing (@studio/song docs/confine.md).
    const source = confineToProject(dir, clip.source);
    if (!source)
      throw new Error(`'${clipId}': its file is outside the project`);
    const env = await ensureFileEnvelope(
      source,
      findEngineBinary(),
      sensitivity,
    );
    // The clip's own corrections, applied to the DETECTED set in file seconds before any mapping.
    const edits = clipOnsets(dir, ref);
    const corrected = {
      ...env,
      transients: resolveOnsets(env.transients, edits),
    };

    const key = this.wfKey(`${clipId}${whole ? "::whole" : ""}`, buckets);
    // The sensitivity and the corrections ride in the signature, or the memo serves the previous answer.
    const sig = `${wfSig(env.fingerprint, clip, p, buckets)}|${env.sensitivity}|${JSON.stringify(edits)}`;
    const cached = this.wfCache.get(key);
    if (cached && cached.sig === sig) return cached.data;
    const data = {
      ...buildWaveform(corrected, drawn, p, buckets, window),
      // The raw set, mapped the same way, so an editor can tell a refusable pin from a movable one.
      detected: buildWaveform(env, drawn, p, buckets).transients,
      onsetEdits: edits,
    };
    this.wfCache.set(key, { sig, data });
    return data;
  }

  status(): WaveformStatus {
    return { ...this.warmState };
  }

  // Clear the memo and every `{source}.cache` sidecar — destructive, and a walk, since they sit beside their audio.
  clear(): number {
    this.wfCache.clear();

    let removed = 0;
    const sweep = (abs: string): void => {
      // The try covers only the readdir; each unlink has its own catch (docs/waveformCache.md).
      try {
        for (const e of readdirSync(abs, { withFileTypes: true })) {
          // The same exclusions as the tree, so the sweep stays inside what the user calls their workspace.
          if (e.isDirectory()) {
            if (!this.host.skip(e.name)) sweep(join(abs, e.name));
          } else if (e.name.endsWith(CACHE_EXT)) {
            try {
              unlinkSync(join(abs, e.name));
              removed++;
            } catch {
              // A sidecar the engine still holds open (Windows) stays; the next decode overwrites it anyway.
            }
          }
        }
      } catch {
        // Unreadable directory — nothing to clear in it.
      }
    };
    sweep(this.host.root);

    this.warmState = { warming: false, done: 0, total: 0 };
    return removed;
  }

  // Stop an in-flight prewarm — bump the run guard and kill its child — since a held clip blocks a rename on Windows.
  cancel(): void {
    this.warmRun++;
    this.warmAbort?.abort();
    this.warmAbort = null;
    this.warmState = { warming: false, done: 0, total: 0 };
  }

  async prewarm(buckets: number = DEFAULT_WF_BUCKETS): Promise<void> {
    const active = this.host.activeProject();
    if (!active) return;
    const run = ++this.warmRun;
    const ac = new AbortController();
    this.warmAbort = ac;
    let p: ProjectDoc;
    try {
      p = this.host.cachedProjectDoc(active);
    } catch {
      if (run === this.warmRun)
        this.warmState = { warming: false, done: 0, total: 0 };
      return;
    }
    const clips: ClipDoc[] = [];
    // Only sources inside the project's roots are decoded, and their sidecars written beside them.
    const roots = projectRoots(active);
    for (const t of p.tracks)
      for (const c of t.clips)
        if (c.type === "audio" && confineTo(roots, c.source)) clips.push(c);

    const engineBin = findEngineBinary();
    // Phase 1: rebuild every stale sidecar, a few decodes at a time, before anything is sliced.
    const stale = staleWaveformSources(clips.map((c) => c.source));
    this.warmState = {
      warming: stale.length > 0,
      done: 0,
      total: stale.length,
    };
    if (stale.length) {
      let done = 0;
      // A file that fails is counted and skipped; the on-demand path is what surfaces its error.
      await runWaveformBatch(
        engineBin,
        stale,
        () => {
          if (run !== this.warmRun) return; // a newer prewarm took over
          this.warmState = {
            warming: true,
            done: ++done,
            total: stale.length,
          };
        },
        ac.signal,
      );
    }
    if (run !== this.warmRun) return;

    // Phase 2: memoize the sliced results, hitting the fast no-spawn path now the sidecars are fresh.
    for (const c of clips) {
      if (run !== this.warmRun) return;
      try {
        const env = await ensureFileEnvelope(c.source, engineBin);
        const key = this.wfKey(c.id, buckets);
        const sig = wfSig(env.fingerprint, c, p, buckets);
        if (this.wfCache.get(key)?.sig !== sig)
          this.wfCache.set(key, {
            sig,
            data: buildWaveform(env, c, p, buckets),
          });
      } catch {
        /* unreadable source / no engine — skip; the on-demand path surfaces it */
      }
    }
    if (run === this.warmRun) {
      this.warmState = {
        warming: false,
        done: stale.length,
        total: stale.length,
      };
      if (this.warmAbort === ac) this.warmAbort = null; // this run's controller is spent
    }
  }
}
