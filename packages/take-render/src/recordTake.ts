// recordTake.ts — turn a finished take into a clip on its track, or into a TAKE of the event it was
// recorded over. The engine writes the .wav and says where it landed; declaring it is the brain's
// job, so this writes the clips/<take>.yaml and the placement or the take entry — making a recording
// indistinguishable from a clip you dropped in yourself. (Arming is session state and never a file.)

import { renameSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { wsExists, wsWrite } from "@studio/song/yaml/workspaceFile";
import { addEventTake } from "@studio/song-edit/takeEdit";
import { editTrackStruct } from "@studio/song-edit/trackMix";
import { beatsToPosition } from "@studio/song-schema/timecode";
import { addPlacement } from "@studio/song-schema/yaml/trackFile";

// A finished take as the engine reports it. Position in SECONDS — it has no tempo map, so converting is ours.
export interface RecordedTake {
  track: string; // track id
  file: string; // absolute path of the recorded .wav
  start: number; // seconds
  length: number; // seconds
}

/** A wall-clock stamp for a filename — `260814T194357`, shared with a bounce; docs/rendering.md. */
export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Declare `id` as a clip sourced from `wav`, its window written out in FULL — docs/rendering.md. */
function writeClipDecl(
  dir: string,
  id: string,
  wavName: string,
  window: { from: string; to: string },
): string {
  const path = join(dir, "clips", `${id}.yaml`);
  // The FILENAME is the id, so there is no wrapper naming it a second time.
  if (!wsExists(path))
    wsWrite(
      path,
      `source: clips/${wavName}\nfrom: "${window.from}"\nto: "${window.to}"\n`,
    );
  return path;
}

/** A finished take, renamed and declared as a clip, with where it lands — the half both placements share. */
function declareTake(
  dir: string,
  doc: ProjectDoc,
  take: RecordedTake,
): { id: string; start: string; startBeats: number; lengthBeats: number } {
  if (!wsExists(take.file))
    throw new Error(`recorded file is missing: ${take.file}`);

  // Seconds -> quarter notes -> timecodes; every one of these is a POSITION, docs/rendering.md.
  const beats = (s: number) => (s * doc.tempo) / 60;
  const at = (b: number) =>
    beatsToPosition(b, doc.timeSigNumerator, doc.timeSigDenominator);
  const start = at(beats(take.start));
  const window = { from: at(0), to: at(beats(take.length)) };

  // Rename the take to {trackId}_{bar.beat}_{stamp} — the engine wrote only a temporary name.
  const trackTok = take.track.replace(/[^A-Za-z0-9._-]/g, "-");
  const barBeat = start.split(":").slice(0, 2).join(".");
  const ext = extname(take.file);
  const id = `${trackTok}_${barBeat}_${fileStamp()}`;
  const wavName = `${id}${ext}`;
  const dest = join(dirname(take.file), wavName);
  if (dest !== take.file) renameSync(take.file, dest);

  // Declare the clip BEFORE placing it: a placement naming no clip fails the compile.
  writeClipDecl(dir, id, wavName, window);
  return {
    id,
    start,
    startBeats: beats(take.start),
    lengthBeats: beats(take.length),
  };
}

/** Declare a finished take and place it on its track; throws if its file is not where it says. */
export function addTakeToTrack(
  dir: string,
  doc: ProjectDoc,
  take: RecordedTake,
): string {
  const { id, start } = declareTake(dir, doc, take);
  // The engine mutes the armed track for the roll, so here is only the placement (docs/rendering.md).
  editTrackStruct(
    dir,
    take.track,
    (text) => addPlacement(text, { ref: id, start }),
    `add the recorded clip "${id}"`,
  );
  return id;
}

/** Where a take recorded in the TAKES view goes: the event starting at `eventBeats`, punched into `punch` when set. */
export interface TakeTarget {
  eventBeats: number;
  punch?: { from: number; to?: number };
}

/** Declare a finished take and add it to the event it was recorded over, comped in where it was played (song docs/takes.md). */
export function addTakeToEvent(
  dir: string,
  doc: ProjectDoc,
  take: RecordedTake,
  target: TakeTarget,
): string {
  const { id, start, startBeats, lengthBeats } = declareTake(dir, doc, take);
  const num = doc.timeSigNumerator;
  const den = doc.timeSigDenominator;
  // Heard from where it starts to where it stops, or only inside the punch: the rest is kept, unheard.
  const from = Math.max(startBeats, target.punch?.from ?? startBeats);
  const to = Math.min(
    startBeats + lengthBeats,
    target.punch?.to ?? Number.POSITIVE_INFINITY,
  );
  const span =
    to > from
      ? {
          from: beatsToPosition(from, num, den),
          to: beatsToPosition(to, num, den),
        }
      : null;
  addEventTake(
    dir,
    take.track,
    target.eventBeats,
    { ref: id, start },
    span,
    num,
    den,
  );
  return id;
}
