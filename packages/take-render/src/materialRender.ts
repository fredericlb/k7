// materialRender.ts — the AUDIO half of `event split` and `selection consolidate`. The
// sequence half is pure text and lives in @studio/song's materialCut.ts; audio has to be
// RENDERED, so it lives here beside the bounce, which already owns "write new material through
// the engine". See packages/song/docs/materialCut.md.

import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clipDoc, emptyDoc, trackDoc } from "@studio/engine-protocol/build";
import type { ClipDoc, ProjectDoc } from "@studio/song/project";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import {
  addTrackPlacements,
  removeTrackPlacement,
} from "@studio/song-edit/trackMix";
import { beatsToPosition } from "@studio/song-schema/timecode";
import { fileStamp } from "./recordTake";
import { renderMixdown } from "./render";
import { wavSeconds } from "./wavLength";

/** Two placements at the same beat are the same placement — the rule every event verb shares. */
const EDGE_EPS = 1e-6;

/** The one track a cut renders on. Named, so a doc read by hand says what it was for. */
const CUT_TRACK = "cut";

export interface RenderedMaterial {
  ref: string;
  /** Project-relative POSIX path of the DEFINITION — `clips/<ref>.yaml`. */
  file: string;
  seconds: number;
}

export interface AudioSplitReport {
  head: RenderedMaterial;
  tail: RenderedMaterial;
  from: string;
}

export interface AudioConsolidateReport {
  written: RenderedMaterial;
  replaced: number;
  from: string[];
}

/** A free `clips/<name>`, STAMPED rather than numbered — the wav and its definition share it. */
function freeClipName(dir: string, base: string): string {
  const stem = `${base}_${fileStamp()}`;
  for (let n = 0; ; n++) {
    const name = n === 0 ? stem : `${stem}-${n}`;
    if (!entityFileFor(join(dir, "clips"), "clips", name)) return name;
  }
}

/** The DEFINITION a render files beside its wav: a `source:` and NOTHING else — docs/rendering.md. */
export function renderedClipYaml(verb: string, ref: string): string {
  return `# Rendered by \`event ${verb}\`.\nsource: clips/${ref}.wav\n`;
}

/** Render `doc` as `clips/<ref>.wav` + `.yaml`; the reported `seconds` is the wav that came OUT. */
function fileRender(
  engineBin: string,
  dir: string,
  doc: ProjectDoc,
  ref: string,
  seconds: number,
): RenderedMaterial {
  const wav = join(dir, "clips", `${ref}.wav`);
  const tmp = mkdtempSync(join(tmpdir(), "tbcut-"));
  try {
    const manifest = renderMixdown(engineBin, doc, tmp);
    copyFileSync(join(tmp, manifest.mix), wav);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const file = `clips/${ref}.yaml`;
  writeFileSync(join(dir, file), renderedClipYaml(doc.name, ref), "utf8");
  return { ref, file, seconds: wavSeconds(wav) ?? seconds };
}

/** One clip, at position zero, playing exactly `[from, to)` of its source. */
function windowDoc(
  project: ProjectDoc,
  name: string,
  clip: ClipDoc,
  from: number,
  to: number,
): ProjectDoc {
  return emptyDoc({
    name,
    tempo: project.tempo,
    sampleRate: project.sampleRate,
    tracks: [
      trackDoc(CUT_TRACK, {
        name: CUT_TRACK,
        clips: [
          clipDoc({
            id: `${CUT_TRACK}-clip`,
            type: "audio",
            name: clip.name,
            source: clip.source,
            sourceFrom: from,
            sourceTo: to,
          }),
        ],
      }),
    ],
  });
}

/** The window a compiled clip plays, in seconds of its source. */
const windowOf = (c: ClipDoc, tempo: number) => ({
  from: c.sourceFrom ?? 0,
  to:
    c.sourceTo ??
    (c.length > 0 ? (c.sourceFrom ?? 0) + (c.length * 60) / tempo : 0),
});

/** Cut an AUDIO placement's material in two at `atBeats` — TWO renders, see docs/rendering.md. */
export function splitAudioMaterial(
  engineBin: string,
  dir: string,
  project: ProjectDoc,
  trackId: string,
  fromBeats: number,
  atBeats: number,
  num: number,
  den: number,
): AudioSplitReport | null {
  const track = project.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find(
    (c) => Math.abs(c.start - fromBeats) < EDGE_EPS,
  );
  if (!clip) return null;
  if (clip.type !== "audio")
    throw new Error(
      `'${clip.name}' is a sequence — its physical split is text, not a render`,
    );
  if (clip.loopEnd > clip.loopStart)
    throw new Error(
      `'${clip.name}' repeats here — set its loop back to 1 before splitting it`,
    );

  const win = windowOf(clip, project.tempo);
  const cut = win.from + ((atBeats - fromBeats) * 60) / project.tempo;
  if (!(atBeats > fromBeats + EDGE_EPS))
    throw new Error("the cut has to be after the event starts");
  if (win.to > 0 && cut >= win.to - EDGE_EPS)
    throw new Error("the cut has to be before the event ends");

  const base = clip.name || clip.id;
  const headRef = freeClipName(dir, base);
  const head = fileRender(
    engineBin,
    dir,
    windowDoc(project, "split", clip, win.from, cut),
    headRef,
    cut - win.from,
  );
  const tailRef = freeClipName(dir, base);
  const tail = fileRender(
    engineBin,
    dir,
    windowDoc(project, "split", clip, cut, win.to),
    tailRef,
    Math.max(0, win.to - cut),
  );

  removeTrackPlacement(dir, trackId, fromBeats, num, den);
  addTrackPlacements(dir, trackId, [
    { ref: head.ref, start: beatsToPosition(fromBeats, num, den) },
    { ref: tail.ref, start: beatsToPosition(atBeats, num, den) },
  ]);
  return { head, tail, from: base };
}

/** Render ONE file over `[fromBeats, toBeats]`, gaps included as real silence — docs/rendering.md. */
export function consolidateAudioMaterial(
  engineBin: string,
  dir: string,
  project: ProjectDoc,
  trackId: string,
  fromBeats: number,
  toBeats: number,
  num: number,
  den: number,
): AudioConsolidateReport | null {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`no track '${trackId}'`);
  const picked = track.clips
    .filter(
      (c) => c.start >= fromBeats - EDGE_EPS && c.start <= toBeats + EDGE_EPS,
    )
    .sort((a, b) => a.start - b.start);
  if (!picked.length) return null;
  const seq = picked.find((c) => c.type !== "audio");
  if (seq)
    throw new Error(
      `'${seq.name}' is a sequence — consolidating notes is text, not a render`,
    );

  const span = ((toBeats - fromBeats) * 60) / project.tempo;
  const doc = emptyDoc({
    name: "consolidate",
    tempo: project.tempo,
    sampleRate: project.sampleRate,
    tracks: [
      trackDoc(CUT_TRACK, {
        name: CUT_TRACK,
        clips: picked.map((c, i) =>
          clipDoc({
            ...c,
            id: `${CUT_TRACK}-${i}`,
            // Re-based on the rectangle; everything else about the clip rides along untouched.
            start: c.start - fromBeats,
          }),
        ),
      }),
    ],
  });

  const ref = freeClipName(dir, trackId);
  const written = fileRender(engineBin, dir, doc, ref, span);

  for (const c of [...picked].reverse())
    removeTrackPlacement(dir, trackId, c.start, num, den);
  addTrackPlacements(dir, trackId, [
    { ref: written.ref, start: beatsToPosition(fromBeats, num, den) },
  ]);
  return {
    written,
    replaced: picked.length,
    from: picked.map((c) => c.name || c.id),
  };
}
