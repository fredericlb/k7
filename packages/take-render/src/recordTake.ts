// recordTake.ts — turn a finished take into a clip on its track. The engine writes the
// .wav and says where it landed; declaring it is the brain's job, so this writes the
// clips/<take>.yaml and the track placement — making a recording indistinguishable from a
// clip you dropped in yourself. (Arming, by contrast, is session state and never a file.)

import { existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import {
  editTrackStruct,
  pushTrackClipsToTake,
} from "@studio/song-edit/trackMix";
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
  if (!existsSync(path))
    writeFileSync(
      path,
      `source: clips/${wavName}\nfrom: "${window.from}"\nto: "${window.to}"\n`,
      "utf8",
    );
  return path;
}

// A hair under a tick: two events that merely touch, end to start, are not on top of each other.
const TOUCHING = 1e-6;

/** Does anything the lane is playing sit under this take's span? What decides a take is made. */
function overlaps(
  doc: ProjectDoc,
  take: RecordedTake,
  beats: (s: number) => number,
): boolean {
  const track = doc.tracks.find((t) => t.id === take.track);
  if (!track) return false;
  const from = beats(take.start);
  const to = from + beats(take.length);
  return track.clips.some(
    (c) => c.start < to - TOUCHING && c.start + c.length > from + TOUCHING,
  );
}

/** Declare a finished take and place it on its track; throws if its file is not where it says. */
export function addTakeToTrack(
  dir: string,
  doc: ProjectDoc,
  take: RecordedTake,
): string {
  if (!existsSync(take.file))
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

  writeClipDecl(dir, id, wavName, window);

  // Recording OVER something sets it aside rather than stacking — see docs/rendering.md.
  if (overlaps(doc, take, beats)) pushTrackClipsToTake(dir, take.track);

  // Declare the clip BEFORE placing it: a placement naming no clip fails the compile, so the order keeps it loadable.
  editTrackStruct(
    dir,
    take.track,
    (text) => addPlacement(text, { ref: id, start }),
    `add the recorded clip "${id}"`,
  );
  return id;
}
