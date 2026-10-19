// eventProcess.ts — `event process <track> <at> <chain>`: bounce ONE event's material through a chain.
// `clip process` repoints every clip playing the file; this one gives the event a copy of its clip
// first whenever anything else plays that material, so only what was right-clicked changes.
// See packages/audio-passes/docs/processChain.md.

import { dirname, join } from "node:path";
import { processWithChain } from "@studio/audio-passes/processChain";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { laneFileFor } from "@studio/song/chainItemEdit";
import { entityFiles } from "@studio/song/yaml/moduleIO";
import { wsCopy, wsExists, wsRemove } from "@studio/song/yaml/workspaceFile";
import { editTrackStruct } from "@studio/song-edit/trackMix";
import { materialRefOf } from "@studio/song-schema/placementId";
import { parsePosition } from "@studio/song-schema/timecode";
import {
  findPlacementAt,
  setPlacementField,
} from "@studio/song-schema/yaml/trackFile";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const EVENT_PROCESS_VERBS: Record<string, SidHandler> = {
  "event.process": processEventCommand,
};

/** How many OTHER events play `ref` — as their material, or as one of their takes. */
export function otherUsesOf(
  project: ProjectDoc,
  ref: string,
  self: { track: string; id: string },
): number {
  let n = 0;
  for (const t of project.tracks)
    for (const c of t.clips) {
      // A comped event's pieces are one event: only its own clip counts, the pieces carry `comp`.
      if (c.comp) continue;
      if (t.id === self.track && c.id === self.id) continue;
      if (materialRefOf(c.id) === ref) n++;
      else if (c.event?.takes?.some((k) => k.ref === ref)) n++;
    }
  return n;
}

/** Give the event at `atBeats` its own copy of clip `ref`, and the copy's id — the lane file now names it. */
export function ownMaterial(
  dir: string,
  track: string,
  atBeats: number,
  num: number,
  den: number,
  ref: string,
): string {
  const clips = entityFiles(join(dir, "clips"), "clips");
  const src = clips.find((e) => e.id === ref);
  if (!src) throw new Error(`clip '${ref}' has no file in clips/`);
  const taken = new Set(clips.map((e) => e.id));
  let n = 2;
  while (taken.has(`${ref}-${n}`)) n++;
  const id = `${ref}-${n}`;
  const to = join(dirname(src.file.path), `${id}.k7x`);
  wsCopy(src.file.path, to);
  let hit = false;
  editTrackStruct(
    dir,
    track,
    (doc) => {
      const at = findPlacementAt(doc, atBeats, num, den);
      if (at < 0) return;
      hit = true;
      setPlacementField(doc, at, "ref", id);
    },
    "give an event its own clip",
  );
  if (!hit) {
    wsRemove(to);
    throw new Error(`no event on '${track}' at that position`);
  }
  return id;
}

/** `event process <track> <at> <chain>` — the chain is the rest of the line, like `clip process`. */
async function processEventCommand(a: string, h: CommandHost): Promise<void> {
  const [trackArg, atTc, ...rest] = splitWords(a);
  const chain = rest.join(" ");
  if (!trackArg || !atTc || !chain) {
    h.refuse([
      "usage: event process <track> <timecode> <chain>  (e.g. event process gtr 5:1 @k7-core/amp-room)",
    ]);
    return;
  }
  const p = h.project();
  const track = p.tracks.find((t) => t.id === trackArg || t.name === trackArg);
  if (!track) {
    h.refuse([`no track "${trackArg}"`]);
    return;
  }
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  let atBeats: number;
  try {
    atBeats = parsePosition(atTc, num, den);
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return;
  }
  const hit = track.clips.find(
    (c) => !c.comp && Math.abs(c.start - atBeats) < 1e-6,
  );
  if (!hit) {
    h.refuse([`no event on '${track.id}' at ${atTc}`]);
    return;
  }
  // A comped event plays several files; consolidating it first makes it one, which this can then process.
  if (hit.event?.comp?.length) {
    h.refuse([
      `the event at ${atTc} is comped from its takes — consolidate it first (selection consolidate)`,
    ]);
    return;
  }
  if (hit.type !== "audio") {
    h.refuse([
      `the event at ${atTc} is not audio — there is no file to bounce`,
    ]);
    return;
  }
  const ref = materialRefOf(hit.id);
  const shared = otherUsesOf(p, ref, { track: track.id, id: hit.id }) > 0;
  let own = ref;
  const lane = laneFileFor(h.songPath, track.id)?.path;
  if (shared) {
    try {
      if (lane) h.snapshot?.(lane);
      own = ownMaterial(h.songPath, track.id, atBeats, num, den, ref);
    } catch (e) {
      h.refuse([`event process failed: ${(e as Error).message}`]);
      return;
    }
  }
  const { lines, changed } = await processWithChain(
    h.songPath,
    p,
    own,
    chain,
    "clip",
    (abs) => h.snapshot?.(abs),
    h.runColdStep,
    [own],
    h.renderer,
  );
  // A bounce that wrote nothing leaves the event as it was found, not on a copy it never needed.
  if (shared && !changed) {
    editTrackStruct(
      h.songPath,
      track.id,
      (doc) => {
        const at = findPlacementAt(doc, atBeats, num, den);
        if (at >= 0) setPlacementField(doc, at, "ref", ref);
      },
      "restore an event's clip",
    );
    const copy = join(h.songPath, "clips", `${own}.k7x`);
    if (wsExists(copy)) wsRemove(copy);
  }
  h.log(
    shared && changed
      ? [
          `${track.id} at ${atTc}: its own clip '${own}', the others keep '${ref}'`,
          ...lines,
        ]
      : lines,
  );
  if (changed) await h.reload();
}
