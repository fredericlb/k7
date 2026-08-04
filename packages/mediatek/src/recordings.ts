// recordings.ts — the raw capture zone: `recordings/<YYYY-MM-DD>/<HH-MM-SS>.<ext>`, a root
// zone beside the three families. Fed by machines over the API, listed on its own, and
// scanned into NOTHING — a capture is bytes with a timestamp. See docs/recordings.md.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RECORDINGS_DIR, recordingsDir } from "./layout.ts";
import { extOf, isAudio } from "./media.ts";
import { NotAudioError, segment } from "./song.ts";
import { putFile } from "./write.ts";

/** The zone, mediatek-relative. A path and not a directory, because everything that writes
 *  here goes through `putFile`, which takes one. */
export const recordingsRoot = (): string => RECORDINGS_DIR;

const two = (n: number): string => String(n).padStart(2, "0");

/** The day a capture is filed under, in LOCAL time — a rehearsal that ran to 00:30 is
 *  filed by the wall clock of whoever played it, not by UTC's idea of the date. */
export function dayOf(at: Date): string {
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

/** The capture's own name, `HH-MM-SS`. Colons would be legal on two systems out of three,
 *  which is one too few for a path this one writes. */
export function stampOf(at: Date): string {
  return `${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
}

/**
 * A moment's file name, without extension: `moment-<HH-MM-SS>--<secondes>--<nom>`.
 *
 * A moment is a span cut out of a session — an hour, a length and, sometimes, a name — so
 * all three are in the name. It sits in the same day folder as the captures: it IS one, a
 * shorter one, and splitting it off would make "what did we play that evening" two places.
 *
 * `--` separates the fields, so a name that carries its own run of hyphens is collapsed to
 * one: nothing parses this back, but a human reading `moment-21-05-07--15--Solo` should
 * not have to guess where the length ended.
 */
export function momentStem(
  at: Date,
  durationSec: number,
  label?: string,
): string {
  const seconds = Math.max(0, Math.round(durationSec || 0));
  const name = segment(label, "").replace(/-{2,}/g, "-");
  return `moment-${stampOf(at)}--${seconds}${name ? `--${name}` : ""}`;
}

export interface RecordingFile {
  name: string;
  /** Mediatek-relative POSIX path — what `GET /file` takes, the same id space entries use. */
  path: string;
  bytes: number;
  mtime: number;
}

export interface RecordingDay {
  day: string;
  files: RecordingFile[];
}

/**
 * File one capture, under the day and second it was made.
 *
 * A second is not a unique key — two microphones stopping together is an ordinary
 * afternoon, not a conflict to report — so a taken name gains `-2`, `-3`, … rather than
 * failing or overwriting. That is the opposite of `addSong`'s 409, and deliberately:
 * there, two uploads deducing one folder means the same song twice; here, two files at
 * the same second are two different files.
 */
export function addRecording(opts: {
  filename: string;
  bytes: Uint8Array;
  /** When it was CAPTURED. The caller knows and the server does not — a batch pushed the
   *  morning after would otherwise land, whole, under the wrong day. */
  at?: Date;
  /** How long the span is, in seconds. Present == this is a MOMENT cut out of a session,
   *  and it is named as one. Absent == a whole capture. */
  durationSec?: number;
  /** A moment's name, when it has one. Ignored without `durationSec`: a capture is named
   *  by its clock alone, and nothing names one. */
  label?: string;
}): { path: string; day: string; name: string } {
  if (!isAudio(opts.filename))
    throw new NotAudioError(`${opts.filename}: not an audio file`);
  const at = opts.at ?? new Date();
  const ext = extOf(opts.filename);
  const day = dayOf(at);
  const stem =
    opts.durationSec === undefined
      ? stampOf(at)
      : momentStem(at, opts.durationSec, opts.label);

  const taken = new Set(names(join(recordingsDir(), day)));
  let name = `${stem}${ext}`;
  for (let n = 2; taken.has(name); n++) name = `${stem}-${n}${ext}`;

  const path = `${recordingsRoot()}/${day}/${name}`;
  putFile(path, opts.bytes);
  return { path, day, name };
}

/** How many captures the zone holds, for a tab badge — the count without the listing. */
export function countRecordings(): number {
  return listRecordings().reduce((n, d) => n + d.files.length, 0);
}

/** Directory entry names, or none for a folder that is not there — the ordinary case for
 *  the first capture of a day. */
function names(abs: string): string[] {
  try {
    return readdirSync(abs);
  } catch {
    return [];
  }
}

/**
 * Every day and every capture in it, newest day first.
 *
 * Its own listing rather than a family scan: these produce no `MediatekEntry`, so nothing
 * in the catalogue would ever mention them. Sorted here and not by the caller — a listing
 * that reshuffles between two polls is unusable, and `readdir` order is not stable.
 */
export function listRecordings(): RecordingDay[] {
  const root = recordingsDir();
  const days: RecordingDay[] = [];
  for (const day of names(root)) {
    if (day.startsWith(".")) continue;
    const abs = join(root, day);
    try {
      if (!statSync(abs).isDirectory()) continue;
    } catch {
      continue;
    }
    const files: RecordingFile[] = [];
    for (const name of names(abs)) {
      if (!isAudio(name)) continue;
      try {
        const s = statSync(join(abs, name));
        files.push({
          name,
          path: `${recordingsRoot()}/${day}/${name}`,
          bytes: s.size,
          mtime: s.mtimeMs,
        });
      } catch {
        /* raced away between readdir and stat */
      }
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    days.push({ day, files });
  }
  return days.sort((a, b) => b.day.localeCompare(a.day));
}
