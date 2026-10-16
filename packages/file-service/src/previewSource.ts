// previewSource.ts — a play button's request turned into a file and a window: a clip id, a media
// path or an absolute audio path, each confined to the workspace, the project's roots or a library's
// shared sounds. See docs/workspace.md.

import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { confineToProject } from "@studio/song/confine";
import { materialRefOf } from "@studio/song/nodeProject";
import type { ClipDoc, ProjectDoc } from "@studio/song/project";
import { loadAudioClipDoc } from "@studio/song/project";
import { libraryOf } from "@studio/song/sharedFolders";
import type { PreviewReq } from "@studio/web-protocol";
import { AUDIO_EXT, findClip } from "./waveformOps.ts";

/** The members of the workspace a preview reads. */
export interface PreviewHost {
  requireActive(): string;
  withinRoot(abs: string): boolean;
  cachedProjectDoc(dir: string): ProjectDoc;
}

/** Is `abs` inside one of the account libraries' `samples/`, `irs/` or `wavetables/` — and nowhere else of theirs? */
function inLibrarySounds(abs: string): boolean {
  const lib = libraryOf(abs);
  if (!lib) return false;
  const family = relative(lib.root, abs).split(sep)[0];
  return family === "samples" || family === "irs" || family === "wavetables";
}

// Resolve a play-button request to a file + window: an absolute path (guarded), else a clip id, else a media path.
export function resolvePreview(
  h: PreviewHost,
  req: PreviewReq,
): { file: string; start: number; length: number } {
  const dir = h.requireActive();
  // A clip's source is text a file holds: inside the project's roots or nothing (@studio/song docs/confine.md).
  const confinedSource = (source: string): string => {
    const abs = confineToProject(dir, source);
    if (!abs) throw new Error("audio path is outside the project");
    return abs;
  };
  // A clip id / media path / absolute audio path -> an absolute file within the root.
  const resolveSource = (spec: string): string => {
    if (!spec) throw new Error("preview: empty source");
    if (isAbsolute(spec) && AUDIO_EXT.test(spec)) {
      const abs = resolve(spec);
      // A library module's own audio is the other place a preview may play from.
      if (!h.withinRoot(abs) && !libraryOf(abs))
        throw new Error("audio path is outside the workspace");
      return abs;
    }
    let clip: ClipDoc | null | undefined;
    try {
      clip =
        findClip(h.cachedProjectDoc(dir), spec) ?? loadAudioClipDoc(dir, spec);
    } catch {
      clip = undefined; // not a clip id — try it as a plain path below
    }
    if (clip && clip.type === "audio") return confinedSource(clip.source);
    const abs = resolve(dir, spec);
    // …or in a library's shared SOUNDS, where a rack tap's sample and a cabinet IR live (@studio/song's libraryFiles.md).
    if (!h.withinRoot(abs) && !inLibrarySounds(abs))
      throw new Error("audio path is outside the workspace");
    if (!existsSync(abs)) throw new Error(`no audio for '${spec}'`);
    return abs;
  };
  if (req.kind === "clip") {
    const p = h.cachedProjectDoc(dir);
    // The grid, so a TIMECODE `from:`/`to:` becomes seconds here as it does in the compiler.
    const grid = {
      tempo: p.tempo,
      num: p.timeSigNumerator,
      den: p.timeSigDenominator,
    };
    // A clip id may name a PLACEMENT (`bass_2_0@16`); the definition is keyed by the material.
    const clip =
      findClip(p, req.clip) ??
      loadAudioClipDoc(dir, materialRefOf(req.clip), grid);
    if (!clip) throw new Error(`no clip '${req.clip}'`);
    if (clip.type !== "audio")
      throw new Error(`'${req.clip}' is not an audio clip`);
    // The clip's own WINDOW, not the whole file — see docs/workspace.md.
    const start = Math.max(0, clip.sourceFrom ?? 0);
    const to = clip.sourceTo ?? 0;
    return {
      file: confinedSource(clip.source),
      start,
      length: to > start ? to - start : 0,
    };
  }
  if (req.kind === "slice") {
    const from = Math.max(0, req.from);
    return {
      file: resolveSource(req.source),
      start: from,
      length: Math.max(0, req.to - from),
    };
  }
  // kind === "source": the whole file.
  return { file: resolveSource(req.source), start: 0, length: 0 };
}
