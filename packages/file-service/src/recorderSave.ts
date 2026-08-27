// recorderSave.ts — send a recorder node's take to the médiathèque's `recordings/` zone.
//
// The take is a wav the ENGINE wrote, on this machine — which is why this lives in the file
// service and not in the browser: the bytes are here. What arrives from the browser is a path it
// read off a state frame, so it is CHECKED against the project's own record directory before
// anything is opened. Rationale: packages/song/docs/recorderNode.md.

import { readFileSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { pushRecording } from "@studio/mediatek/remote";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";

/** Is `file` inside `dir`? Resolved on both sides, so `..` cannot walk out of it. */
export function insideDir(dir: string, file: string): boolean {
  if (!dir) return false;
  const root = resolve(dir);
  const at = resolve(file);
  // The separator matters: `/takes-old/x.wav` must not pass for being inside `/takes`.
  return at === root || at.startsWith(root.endsWith(sep) ? root : root + sep);
}

export interface SaveTakeResult {
  /** Where it landed in the médiathèque — `recordings/2026-08-27/14-32-08.wav`. */
  path: string;
  bytes: number;
}

/**
 * Read one take and push it. `recordDir` is the project's own, off the compiled document — the
 * only directory a take may come out of, and the reason a browser cannot name an arbitrary file.
 */
export async function saveTake(opts: {
  recordDir: string;
  file: string;
  /** An optional name, which makes it a MOMENT rather than a bare capture (mediatek/docs/recordings.md). */
  label?: string;
}): Promise<SaveTakeResult> {
  const { recordDir, file, label } = opts;
  if (!insideDir(recordDir, file))
    throw new Error(
      `"${file}" is not one of this project's takes — a recording is saved from its own record directory`,
    );
  const base = mediatekBase();
  if (!base)
    throw new Error(
      "no médiathèque is configured on this machine, so there is nowhere to save a take",
    );
  let bytes: Buffer;
  let at: Date;
  try {
    bytes = readFileSync(file);
    // The take's own mtime, not now: a take saved an hour later belongs to the hour it was PLAYED.
    at = statSync(file).mtime;
  } catch (e) {
    throw new Error(`cannot read the take: ${(e as Error).message}`);
  }
  const res = await pushRecording(
    { base, token: mediatekToken() ?? undefined },
    {
      filename: basename(file),
      bytes,
      at,
      ...(label ? { label } : {}),
    },
  );
  return { path: res.path, bytes: bytes.length };
}
