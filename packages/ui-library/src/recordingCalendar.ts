// recordingCalendar.ts — the capture zone as the calendar draws it: each capture at the time it
// started, with the account's moments cut from it, newest first, narrowed to a tag. Pure, and tested.
// The one thing a reader would get wrong: a capture's time is its NAME's, its mtime only a fallback.

import { dayKey } from "@frediverse/ui/calendar";
import { capturedAt } from "@studio/mediatek/recordingName";
import type { RecordingDay, RecordingFile } from "@studio/mediatek/recordings";
import type { Moment } from "@studio/rehearsal-shared";

export interface CaptureEntry {
  file: RecordingFile;
  /** When it started: its `HH-MM-SS` name, else its file's mtime. */
  at: Date;
  /** The calendar's key for that day. */
  day: string;
  moments: Moment[];
}

/** Every capture with its moments by offset, newest first; with a tag, only captures with a moment carrying it. */
export function captureEntries(
  days: RecordingDay[],
  moments: Moment[],
  tag: string | null,
): CaptureEntry[] {
  const byPath = new Map<string, Moment[]>();
  for (const m of moments) {
    if (!m.recordingPath || (tag && !m.tags.includes(tag))) continue;
    const list = byPath.get(m.recordingPath) ?? [];
    list.push(m);
    byPath.set(m.recordingPath, list);
  }
  return days
    .flatMap((d) => d.files)
    .flatMap((file): CaptureEntry[] => {
      const own = (byPath.get(file.path) ?? []).sort(
        (a, b) => a.startSec - b.startSec,
      );
      if (tag && own.length === 0) return [];
      const at = capturedAt(file.path) ?? new Date(file.mtime);
      return [{ file, at, day: dayKey(at), moments: own }];
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** The tags the moments of the listed captures carry, sorted. */
export function captureTags(days: RecordingDay[], moments: Moment[]): string[] {
  const listed = new Set(days.flatMap((d) => d.files.map((f) => f.path)));
  const tags = moments
    .filter((m) => m.recordingPath && listed.has(m.recordingPath))
    .flatMap((m) => m.tags);
  return [...new Set(tags)].sort((a, b) => a.localeCompare(b));
}
