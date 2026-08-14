// waveformOps.ts — the workspace's waveform machinery: slice the engine-computed file
// envelopes to clip regions, memoize the sliced results, and prewarm the whole active
// project in the background. Extracted from workspace.ts; the durable cache stays the
// engine-written `{source}.cache` sidecars (see waveformCache.ts) — everything here is
// the in-memory, per-session layer over them.

import { readdirSync, unlinkSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { beatGrid, regionWaveform } from "@studio/commands/waveform";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { resolveOnsets } from "@studio/song/onsets";
import type { ClipDoc, ProjectDoc } from "@studio/song/project";
import { loadAudioClipDoc } from "@studio/song/project";
import { clipOnsets } from "@studio/song/projectEdit";
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

/**
 * The envelope's content fingerprint + the placement/tempo/buckets the region math reads.
 *
 * `sourceFrom`, `sourceTo` and the warp markers are in here because `regionWaveform` reads all
 * three: they decide WHICH part of the file the region shows and at what rate (see
 * docs/waveformCache.md). They were absent while the region math ignored them, which was
 * harmless then and would now mean trimming a clip's `from` left the old picture on screen.
 */
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

// Slice the disk-cached file envelope to the clip's region and add the bar/beat grid — the WebWaveform drawn.
// `window`, when the region is wider than the clip's own from/to, is that pair put on the SAME axis as the
// marks — through the region's own mapping, never a second copy of it.
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
    seconds: w.seconds,
    intervalMs: w.rms.length ? (w.seconds / w.rms.length) * 1000 : 0,
    startBeat: w.startBeat,
    clipBeats: w.clipBeats,
    grid: beatGrid(w),
    warpMarks: w.warpMarks,
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

  /**
   * `whole` asks for the MATERIAL rather than the placement: the clip as its own file defines it, so the span is
   * the source's full duration instead of whatever musical length a track happened to place it with. That is the
   * view a clips/<id>.yaml wants — you are editing the sample there, and `from`/`to` can only be judged against
   * the whole of it.
   */
  async waveform(
    clipId: string,
    buckets: number = DEFAULT_WF_BUCKETS,
    whole = false,
    /** The transient threshold to detect at. Omitted, the source keeps whichever it was last built with. */
    sensitivity?: number,
  ): Promise<WebWaveform> {
    const dir = this.host.requireActive();
    const p = this.host.cachedProjectDoc(dir);
    // A rack's audio is an absolute path beside its module, not a clip id, so serve its whole-file waveform;
    // the workspace guard keeps the query param from reading arbitrary files.
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
    // A placed clip comes from the compiled project; a defined-but-unplaced one is read from its definition, so its
    // waveform shows while you edit it (a video clip has none, and loadAudioClipDoc returns null). `whole` reverses
    // that precedence: the definition carries no start/length/offset, which is exactly what makes the span the file.
    const clip = whole
      ? (loadAudioClipDoc(dir, clipId) ?? findClip(p, clipId))
      : (findClip(p, clipId) ?? loadAudioClipDoc(dir, clipId));
    if (!clip) throw new Error(`no clip '${clipId}'`);
    if (clip.type !== "audio")
      throw new Error(`'${clipId}' is not an audio clip`);
    /**
     * `whole` means the FILE, and the window is the thing being JUDGED against it — so the window must not
     * also crop the picture. It did: `regionWaveform` opens the region AT `sourceFrom` and blanks whatever
     * lies past `sourceTo` (two different cuts — only the first shortens the span). So a NUMERIC `from:`/`to:`
     * — exactly what `clip trim` writes — silently redrew the pane as the trim itself: head gone, tail flat,
     * and no way left to see what had been cut or to judge putting it back.
     *
     * A TIMECODE window escaped it, because `mapClip` only reads a number, so the two spellings of one field
     * drew two different pictures. Drawn windowless here and shaded instead, they draw the same one.
     */
    const window = whole ? materialWindow(clip) : null;
    const drawn = window
      ? { ...clip, sourceFrom: undefined, sourceTo: undefined }
      : clip;
    // The engine decodes any format and refreshes the sidecar; we slice the returned envelope to the region.
    const env = await ensureFileEnvelope(
      clip.source,
      findEngineBinary(),
      sensitivity,
    );
    // The clip's own corrections, applied to the DETECTED set before anything maps it into the region: both
    // are file seconds, and the region mapping is what turns them into the display seconds a surface draws.
    // Resolved here rather than in each surface, so the slice widget, the clip block and the take review all
    // draw the same onsets without knowing corrections exist. See song/onsets.ts.
    const edits = clipOnsets(dir, clipId);
    const corrected = {
      ...env,
      transients: resolveOnsets(env.transients, edits),
    };

    const key = this.wfKey(`${clipId}${whole ? "::whole" : ""}`, buckets);
    // The sensitivity rides in the signature: re-detecting changes the onsets and nothing else, and a memo keyed
    // only on the fingerprint would keep serving the previous threshold's answer. The corrections ride there for
    // exactly the same reason — moving one onset must not be answered from the memo of the last one.
    const sig = `${wfSig(env.fingerprint, clip, p, buckets)}|${env.sensitivity}|${JSON.stringify(edits)}`;
    const cached = this.wfCache.get(key);
    if (cached && cached.sig === sig) return cached.data;
    const data = {
      ...buildWaveform(corrected, drawn, p, buckets, window),
      // The raw set, mapped the same way, so an editor can tell which pins it may only refuse and which it
      // may pick up — and the corrections as the file holds them, in file seconds.
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
      // The try covers only the readdir; each unlink has its own catch, so one locked sidecar doesn't abandon the rest.
      try {
        for (const e of readdirSync(abs, { withFileTypes: true })) {
          // The same exclusions as the tree, so we never sweep where the user doesn't consider their workspace to be.
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
    for (const t of p.tracks)
      for (const c of t.clips) if (c.type === "audio") clips.push(c);

    const engineBin = findEngineBinary();
    // Phase 1: rebuild every stale sidecar in ONE engine process, so a song of fresh clips pays JUCE startup once.
    const stale = engineBin
      ? staleWaveformSources(clips.map((c) => c.source))
      : [];
    this.warmState = {
      warming: stale.length > 0,
      done: 0,
      total: stale.length,
    };
    if (stale.length && engineBin) {
      let done = 0;
      try {
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
      } catch {
        /* engine unavailable mid-batch — the on-demand path surfaces it */
      }
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
