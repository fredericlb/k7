// materialRender.ts — the AUDIO half of `selection consolidate`. The sequence half is pure text
// and lives in @studio/song-edit's materialCut.ts; audio has to be RENDERED, so it lives here
// beside the bounce, which already owns "write new material through the engine". An audio
// `event split` renders nothing and is materialCut.ts's. See packages/song/docs/materialCut.md.

import { join } from "node:path";
import { clipDoc, emptyDoc, trackDoc } from "@studio/engine-protocol/build";
import { stringify } from "@studio/k7x/print";
import type { ProjectDoc } from "@studio/song/project";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import { wsWriteText } from "@studio/song/yaml/workspaceDoc";
import {
  addTrackPlacements,
  removeTrackPlacement,
} from "@studio/song-edit/trackMix";
import { beatsToPosition } from "@studio/song-schema/timecode";
import { fileStamp } from "./recordTake";
import { type Renderer, renderToWav } from "./renderer";
import { wavSeconds } from "./wavLength";

/** Two placements at the same beat are the same placement — the rule every event verb shares. */
const EDGE_EPS = 1e-6;

/** The one track a cut renders on. Named, so a doc read by hand says what it was for. */
const CUT_TRACK = "cut";

export interface RenderedMaterial {
  ref: string;
  /** Project-relative POSIX path of the DEFINITION — `clips/<ref>.k7x`. */
  file: string;
  seconds: number;
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

/** The DEFINITION a render files beside its wav: a `source` and NOTHING else — docs/rendering.md. */
export function renderedClipText(verb: string, ref: string): string {
  return stringify(
    { source: `clips/${ref}.wav` },
    { header: [`Rendered by \`event ${verb}\`.`] },
  );
}

/** Render `doc` as `clips/<ref>.wav` + `.k7x`; the reported `seconds` is the wav that came OUT. */
async function fileRender(
  render: Renderer,
  dir: string,
  doc: ProjectDoc,
  ref: string,
  seconds: number,
): Promise<RenderedMaterial> {
  const wav = join(dir, "clips", `${ref}.wav`);
  await renderToWav(render, doc, wav);
  const file = `clips/${ref}.k7x`;
  wsWriteText(join(dir, file), renderedClipText(doc.name, ref));
  return { ref, file, seconds: wavSeconds(wav) ?? seconds };
}

/** Render ONE file over `[fromBeats, toBeats]`, gaps included as real silence — docs/rendering.md. */
export async function consolidateAudioMaterial(
  render: Renderer,
  dir: string,
  project: ProjectDoc,
  trackId: string,
  fromBeats: number,
  toBeats: number,
  num: number,
  den: number,
): Promise<AudioConsolidateReport | null> {
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
  const written = await fileRender(render, dir, doc, ref, span);

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
