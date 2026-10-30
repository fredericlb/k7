// analysisMarks.ts — the files a decode failed on, or was running on when the process died, kept
// on the volume so neither a sweep after a restart nor a listener decodes them again. A mark holds
// the file's fingerprint: replaced bytes are a new file and are tried again.
// See ../../docs/media/analysis.md.

import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileFingerprint } from "@studio/audio-analysis/fingerprint";
import { mediatekDir } from "@studio/mediatek/layout";

interface Mark {
  fingerprint: string;
  /** `running` until the decode settles; one still there at boot is a decode the process died in. */
  state: "running" | "failed";
  reason: string;
}

/** Under a dot-directory, so no family scan walks it. */
const fileOf = (): string => join(mediatekDir(), ".analysis", "marks.json");

const keyOf = (source: string): string => relative(mediatekDir(), source);

/** The marks last parsed, and the file's stamp when they were: a sweep asks once per song, and a stat is all it costs. */
let held: { stamp: string; marks: Record<string, Mark> } | null = null;

const stampOf = (file: string): string | null => {
  try {
    const st = statSync(file);
    return `${file}:${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
};

function readAll(): Record<string, Mark> {
  const file = fileOf();
  const stamp = stampOf(file);
  if (!stamp) return {};
  if (held?.stamp === stamp) return held.marks;
  try {
    const marks = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      Mark
    >;
    held = { stamp, marks };
    return marks;
  } catch {
    return {};
  }
}

function writeAll(marks: Record<string, Mark>): void {
  // Dropped first: a write that throws must not leave the edited object standing for the file.
  held = null;
  mkdirSync(join(mediatekDir(), ".analysis"), { recursive: true });
  const tmp = `${fileOf()}.part`;
  writeFileSync(tmp, `${JSON.stringify(marks, null, 2)}\n`, "utf8");
  renameSync(tmp, fileOf());
  const stamp = stampOf(fileOf());
  if (stamp) held = { stamp, marks };
}

function fingerprintOf(source: string): string | null {
  try {
    return fileFingerprint(source);
  } catch {
    return null;
  }
}

/** Why `source` is not to be decoded, or null; a mark on other bytes than these is stale and ignored. */
export function markedFailed(source: string): string | null {
  const mark = readAll()[keyOf(source)];
  if (!mark || mark.fingerprint !== fingerprintOf(source)) return null;
  return mark.state === "running"
    ? "the server stopped while decoding this file"
    : mark.reason;
}

/** Written BEFORE a decode starts, so an out-of-memory kill still leaves the file marked. */
export function markRunning(source: string): void {
  const fingerprint = fingerprintOf(source);
  if (!fingerprint) return;
  const marks = readAll();
  marks[keyOf(source)] = { fingerprint, state: "running", reason: "" };
  writeAll(marks);
}

export function markFailed(source: string, reason: string): void {
  const fingerprint = fingerprintOf(source);
  if (!fingerprint) return;
  const marks = readAll();
  marks[keyOf(source)] = { fingerprint, state: "failed", reason };
  writeAll(marks);
}

/** The decode settled without a verdict on the file: success, or a cause that is not the file's. */
export function clearMark(source: string): void {
  const marks = readAll();
  if (!(keyOf(source) in marks)) return;
  delete marks[keyOf(source)];
  writeAll(marks);
}
