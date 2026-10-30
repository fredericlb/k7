// recordings.ts — the raw capture zone: `recordings/<YYYY-MM-DD>/<HH-MM-SS>.<ext>`, a root
// zone beside the three families. Fed by machines over the API, listed on its own, and
// scanned into NOTHING — a capture is bytes with a timestamp. See docs/recordings.md.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RECORDINGS_DIR, recordingsDir } from "./layout.ts";
import { extOf, isAudio, withoutDerived } from "./media.ts";
import { isMomentClip, MOMENT_PREFIX } from "./recordingName.ts";
import { NotAudioError, segment } from "./song.ts";
import { type OnDisk, putFile } from "./write.ts";

/** The zone, mediatek-relative — a path, not a directory, because every write goes through `putFile`. */
export const recordingsRoot = (): string => RECORDINGS_DIR;

const two = (n: number): string => String(n).padStart(2, "0");

/** The day a capture is filed under, in LOCAL time — the wall clock of whoever played it. */
export function dayOf(at: Date): string {
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

/** The capture's own name, `HH-MM-SS` — colons are legal on only two systems out of three. */
export function stampOf(at: Date): string {
  return `${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
}

/** A moment's file name: `moment-<HH-MM-SS>--<secondes>--<nom>`, in the day folder — docs/recordings.md. */
export function momentStem(
  at: Date,
  durationSec: number,
  label?: string,
): string {
  const seconds = Math.max(0, Math.round(durationSec || 0));
  const name = segment(label, "").replace(/-{2,}/g, "-");
  return `${MOMENT_PREFIX}${stampOf(at)}--${seconds}${name ? `--${name}` : ""}`;
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

/** File one capture under the day and second it was made, a taken name gaining `-2` — docs/recordings.md. */
export function addRecording(opts: {
  filename: string;
  bytes: Uint8Array | OnDisk;
  /** When it was CAPTURED — a batch pushed the morning after would otherwise land under one wrong day. */
  at?: Date;
  /** How long the span is, in seconds; present == a MOMENT cut out of a session, absent == a whole capture. */
  durationSec?: number;
  /** A moment's name, when it has one — ignored without `durationSec`, a capture being named by its clock. */
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

/** Directory entry names, or none for a folder that is not there — the first capture of a day. */
function names(abs: string): string[] {
  try {
    return readdirSync(abs);
  } catch {
    return [];
  }
}

/** Every day and every capture in it, newest day first and sorted here — `readdir` order is not stable. */
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
    // A FLAC's derived copy is no capture (docs/derived.md); `taken` above still sees it, so no capture lands on it.
    const listed = withoutDerived(names(abs).map((name) => ({ name })));
    for (const { name } of listed) {
      // A moment's clip is reached through its moment, under its capture, never as a capture of its own.
      if (!isAudio(name) || isMomentClip(name)) continue;
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
    // A day holding only moments' clips has no capture to show.
    if (files.length > 0) days.push({ day, files });
  }
  return days.sort((a, b) => b.day.localeCompare(a.day));
}
