// write.ts — putting a file into the library and taking one out, on whichever side owns
// it. Bumps the family's mutation counter, because a write the walk cannot see (same file
// count, same tick) is exactly the case the counter exists for. See docs/index.md.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, sep } from "node:path";
import {
  ensureLayout,
  mediatekDir,
  RECORDINGS_DIR,
  writablePath,
} from "./layout.ts";
import { isAudio } from "./media.ts";
import { bumped } from "./revision.ts";
import { SONG_FILE } from "./scan.ts";
import {
  masterName,
  SongExistsError,
  type SongTags,
  sidecarFor,
  songFolder,
} from "./song.ts";
import { FAMILIES, type Family } from "./types.ts";

/** Which family a path belongs to, or null for the shared `library`/`ui` folders and
 *  anything else — those have no token of their own. */
export function familyOf(rel: string): Family | null {
  const top = rel.split(/[\\/]+/)[0];
  return FAMILIES.includes(top as Family) ? (top as Family) : null;
}

/**
 * Write one file, creating its folder.
 *
 * Written beside and renamed, like the cache's downloads and for the same reason: the
 * moteur may be reading this tree, and a half-written module.yaml is a project that will
 * not compile.
 */
export function putFile(rel: string, body: Uint8Array | string): string {
  ensureLayout();
  const abs = writablePath(rel);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.part`;
  writeFileSync(tmp, body);
  renameSync(tmp, abs);
  bump(abs);
  return abs;
}

/** Remove one file. Absent is success: the caller wanted it gone. */
export function removeFile(rel: string): void {
  const abs = writablePath(rel);
  rmSync(abs, { force: true });
  bump(abs);
}

/**
 * Move or rename, ATOMICALLY, and for a folder as readily as a file.
 *
 * Composing this from read + write + delete on the client was the previous answer, and it
 * had two faults this does not: a folder cannot be read as bytes at all, and a failure
 * between the write and the delete leaves a duplicate. `renameSync` is one syscall on the
 * same volume, so the tree is never in a state where the entry exists twice or not at all.
 *
 * BOTH ends are bumped: a move between families changes two listings, and revving only the
 * destination would leave the source's catalogue showing something that is no longer there.
 */
export function moveEntry(from: string, to: string): void {
  ensureLayout();
  const src = writablePath(from);
  const dst = writablePath(to);
  mkdirSync(dirname(dst), { recursive: true });
  renameSync(src, dst);
  bump(src);
  bump(dst);
}

/** An empty folder. The scan ignores it until something lands in it, which is the point:
 *  somewhere to drop into that exists before the first file does. */
export function makeFolder(rel: string): string {
  ensureLayout();
  const abs = writablePath(rel);
  mkdirSync(abs, { recursive: true });
  bump(abs);
  return abs;
}

/** Remove a whole subtree. Absent is success, as for a single file. */
export function removeTree(rel: string): void {
  const abs = writablePath(rel);
  rmSync(abs, { recursive: true, force: true });
  bump(abs);
}

/** The audio file already sitting in a song folder, or null for a folder that has none
 *  — including one that is not there at all, which is the ordinary case. */
function existingMaster(abs: string): string | null {
  try {
    return readdirSync(abs).find((n) => isAudio(n)) ?? null;
  } catch {
    return null;
  }
}

/**
 * File one uploaded audio file as a song: the folder, the master, the sidecar.
 *
 * `songs/` is the one family nobody edits by hand — its shape is derived from the three
 * tags, not typed — so this is the way in. The tags are what the caller confirmed, never a
 * path the caller built: a client that could name the folder could name any folder.
 *
 * There is no `kind` any more: the folder is `songs/<artist>/<album>/<title>`, full stop.
 * k7 used to pass `recorded` here to file a published version apart from an upload, and that
 * distinction now costs nothing to drop — raw capture is the `recordings/` zone, and what
 * reaches this function is catalogued work whichever surface sent it.
 *
 * The sidecar is written LAST, as the mirror does and for the same reason: a crash then
 * leaves an uncatalogued folder rather than a catalogue entry pointing at nothing.
 */
export function addSong(opts: {
  filename: string;
  bytes: Uint8Array;
  tags: SongTags;
  /** Replace the master already there. Absent, an occupied folder is a refusal — a silent
   *  clobber is the one outcome the person uploading cannot undo. */
  replace?: boolean;
}): { path: string; master: string; replaced: boolean } {
  const folder = songFolder(opts.tags);
  const name = masterName(opts.filename); // refuses anything the scan won't see as audio
  ensureLayout();
  const already = existingMaster(writablePath(folder));
  if (already && !opts.replace)
    throw new SongExistsError(`${folder} already holds ${already}`);
  putFile(`${folder}/${name}`, opts.bytes);
  // A replacement in another format would otherwise leave two masters, and the scan picks
  // whichever readdir hands it first.
  if (already && already !== name) removeFile(`${folder}/${already}`);
  putFile(`${folder}/${SONG_FILE}`, sidecarFor(opts.tags));
  return {
    path: folder,
    master: `${folder}/${name}`,
    replaced: Boolean(already),
  };
}

/**
 * Seed a song's detected tempo into its sidecar. Answers whether it wrote.
 *
 * NEVER overwrites: `bpm` is a field a person edits, and a detected value is only ever a
 * starting point (the engine's estimate halves an octave on fast material — see
 * packages/file-service/docs/waveformCache.md). Re-analysing a song must not undo a
 * correction, so an existing key — whatever its value — wins.
 *
 * A `bpm` of 0 is the engine's "no tempo found" and writes nothing: an explicit zero in the
 * file would read as a claim, and the absence is the honest state.
 */
export function setSongBpm(folder: string, bpm: number): boolean {
  if (!(bpm > 0)) return false;
  const abs = writablePath(`${folder}/${SONG_FILE}`);
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return false; // no sidecar: the folder is not catalogued, and this does not catalogue it
  }
  // A line-level check, not a YAML parse-and-rewrite: the sidecar carries comments that say
  // how the tree is derived, and a round trip through the parser would drop them.
  if (/^\s*bpm\s*:/m.test(text)) return false;
  writeFileSync(
    abs,
    `${text.endsWith("\n") ? text : `${text}\n`}bpm: ${bpm}\n`,
    "utf8",
  );
  bump(abs);
  return true;
}

/** Rev the family or zone a path belongs to, so the next poll refetches its listing. */
function bump(abs: string): void {
  const path = relative(mediatekDir(), abs).split(sep).join("/");
  const fam = familyOf(path);
  if (fam) bumped(fam);
  // Not a family, but a zone with a surface polling it — see docs/recordings.md.
  else if (path.startsWith(`${RECORDINGS_DIR}/`)) bumped(RECORDINGS_DIR);
}
