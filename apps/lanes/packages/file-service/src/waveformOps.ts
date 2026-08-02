// waveformOps.ts — the workspace's waveform machinery: slice the engine-computed file
// envelopes to clip regions, memoize the sliced results, and prewarm the whole active
// project in the background. Extracted from workspace.ts; the durable cache stays the
// engine-written `{source}.cache` sidecars (see waveformCache.ts) — everything here is
// the in-memory, per-session layer over them.

import { readdirSync, unlinkSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { beatGrid, regionWaveform } from "@lanes/commands/waveform";
import { findEngineBinary } from "@lanes/engine-client/engineBinary";
import type { ClipDoc, ProjectDoc } from "@lanes/song/project";
import { loadAudioClipDoc } from "@lanes/song/project";
import type { WaveformStatus, WebWaveform } from "@lanes/web-shared";
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

// The envelope's content fingerprint + the placement/tempo/buckets the region math reads.
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
    p.tempo,
    p.timeSigNumerator,
    buckets,
  ].join("|");

// Slice the disk-cached file envelope to the clip's region and add the bar/beat grid — the WebWaveform drawn.
function buildWaveform(
  env: Parameters<typeof regionWaveform>[0],
  clip: ClipDoc,
  p: ProjectDoc,
  buckets: number,
): WebWaveform {
  const w = regionWaveform(env, clip, p, buckets);
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
  ): Promise<WebWaveform> {
    const dir = this.host.requireActive();
    const p = this.host.cachedProjectDoc(dir);
    // A rack's audio is an absolute path beside its module, not a clip id, so serve its whole-file waveform;
    // the workspace guard keeps the query param from reading arbitrary files.
    if (isAbsolute(clipId) && AUDIO_EXT.test(clipId)) {
      const fileAbs = resolve(clipId);
      if (!this.host.withinRoot(fileAbs))
        throw new Error(`audio path is outside the workspace`);
      const env = await ensureFileEnvelope(fileAbs, findEngineBinary());
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
    // The engine decodes any format and refreshes the sidecar; we slice the returned envelope to the region.
    const env = await ensureFileEnvelope(clip.source, findEngineBinary());
    const key = this.wfKey(`${clipId}${whole ? "::whole" : ""}`, buckets);
    const sig = wfSig(env.fingerprint, clip, p, buckets);
    const cached = this.wfCache.get(key);
    if (cached && cached.sig === sig) return cached.data;
    const data = buildWaveform(env, clip, p, buckets);
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
