// recordTake.ts — turn a finished take into a clip on its track. The engine writes the
// .wav and says where it landed; declaring it is the brain's job, so this writes the
// clips/<take>.yaml and the track placement — making a recording indistinguishable from a
// clip you dropped in yourself. (Arming, by contrast, is session state and never a file.)

import { existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { beatsToPosition } from "@studio/song/timecode";
import { editTrackStruct } from "@studio/song/trackMix";
import { addPlacement } from "@studio/song/yaml/trackFile";

// A finished take as the engine reports it. Position in SECONDS — it has no tempo map, so converting is ours.
export interface RecordedTake {
  track: string; // track id
  file: string; // absolute path of the recorded .wav
  start: number; // seconds
  length: number; // seconds
}

// A wall-clock stamp for a take's filename, so two takes of one track at one bar don't collide.
function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * Declare `id` as a clip sourced from `wav` unless already declared — one file per clip, as hand-written ones
 * are. The window is written out in full, `from` included, even though "1:1" to the take's end is exactly what
 * an absent window already means.
 *
 * Because that is the file you open to trim the take, and the two numbers you came to change should be sitting
 * there, at their real values, rather than having to be conjured from a blank file. It also pins the extent at
 * the length the engine reported: the wav on disk is the only other record of it, and a take does not want its
 * end to be a property of how a decoder rounds.
 */
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

/**
 * Declare a finished take and place it on its track. Returns the clip id.
 *
 * Throws if the take's file isn't where it says (a clip whose wav is missing makes
 * the whole project fail to compile — better to refuse the edit than to write a
 * song that no longer loads).
 */
export function addTakeToTrack(
  dir: string,
  doc: ProjectDoc,
  take: RecordedTake,
): string {
  if (!existsSync(take.file))
    throw new Error(`recorded file is missing: ${take.file}`);

  // Seconds -> quarter notes, then to timecodes. Every one of these is a POSITION (1-based): where the take
  // lands on the timeline, and where its window opens and closes IN THE FILE. `to` is the take's length read as
  // a position from the file's start, which is what "1:1" for `from` makes it — not a duration.
  const beats = (s: number) => (s * doc.tempo) / 60;
  const at = (b: number) =>
    beatsToPosition(b, doc.timeSigNumerator, doc.timeSigDenominator);
  const start = at(beats(take.start));
  const window = { from: at(0), to: at(beats(take.length)) };

  // Rename the take to {trackId}_{bar.beat}_{stamp}: the engine wrote a temporary name, the brain owns the final
  // one. Colons never leave here (not filesystem-safe), and the clip id IS the basename, so this renames both.
  const trackTok = take.track.replace(/[^A-Za-z0-9._-]/g, "-");
  const barBeat = start.split(":").slice(0, 2).join(".");
  const ext = extname(take.file);
  const id = `${trackTok}_${barBeat}_${fileStamp()}`;
  const wavName = `${id}${ext}`;
  const dest = join(dirname(take.file), wavName);
  if (dest !== take.file) renameSync(take.file, dest);

  writeClipDecl(dir, id, wavName, window);

  // Declare the clip BEFORE placing it: a placement naming no clip fails the compile, so the order keeps it loadable.
  editTrackStruct(
    dir,
    take.track,
    (text) => addPlacement(text, { ref: id, start }),
    `add the recorded clip "${id}"`,
  );
  return id;
}
