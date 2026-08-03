// write.ts — putting a file into the library and taking one out, on whichever side owns
// it. Bumps the family's mutation counter, because a write the walk cannot see (same file
// count, same tick) is exactly the case the counter exists for. See docs/index.md.

import {
  mkdirSync,
  readdirSync,
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
import {
  MorceauExistsError,
  type MorceauTags,
  masterName,
  morceauFolder,
  sidecarFor,
} from "./morceau.ts";
import { bumped } from "./revision.ts";
import { MORCEAU_FILE } from "./scan.ts";
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

/** The audio file already sitting in a morceau folder, or null for a folder that has none
 *  — including one that is not there at all, which is the ordinary case. */
function existingMaster(abs: string): string | null {
  try {
    return readdirSync(abs).find((n) => isAudio(n)) ?? null;
  } catch {
    return null;
  }
}

/**
 * File one uploaded audio file as a morceau: the folder, the master, the sidecar.
 *
 * `morceaux/` is the one family nobody edits by hand — its shape is derived from the three
 * tags, not typed — so this is the way in. The tags are what the caller confirmed, never a
 * path the caller built: a client that could name the folder could name any folder.
 *
 * The sidecar is written LAST, as the mirror does and for the same reason: a crash then
 * leaves an uncatalogued folder rather than a catalogue entry pointing at nothing.
 */
export function addMorceau(opts: {
  filename: string;
  bytes: Uint8Array;
  tags: MorceauTags;
  /** The provenance folder: `imported` (default) or `recorded`. Validated by the route —
   *  see MORCEAU_KINDS. */
  kind?: string;
  /** Replace the master already there. Absent, an occupied folder is a refusal — a silent
   *  clobber is the one outcome the person uploading cannot undo. */
  replace?: boolean;
}): { path: string; master: string; replaced: boolean } {
  const folder = morceauFolder(opts.tags, opts.kind);
  const name = masterName(opts.filename); // refuses anything the scan won't see as audio
  ensureLayout();
  const already = existingMaster(writablePath(folder));
  if (already && !opts.replace)
    throw new MorceauExistsError(`${folder} already holds ${already}`);
  putFile(`${folder}/${name}`, opts.bytes);
  // A replacement in another format would otherwise leave two masters, and the scan picks
  // whichever readdir hands it first.
  if (already && already !== name) removeFile(`${folder}/${already}`);
  putFile(`${folder}/${MORCEAU_FILE}`, sidecarFor(opts.tags));
  return {
    path: folder,
    master: `${folder}/${name}`,
    replaced: Boolean(already),
  };
}

/** Rev the family or zone a path belongs to, so the next poll refetches its listing. */
function bump(abs: string): void {
  const path = relative(mediatekDir(), abs).split(sep).join("/");
  const fam = familyOf(path);
  if (fam) bumped(fam);
  // Not a family, but a zone with a surface polling it — see docs/recordings.md.
  else if (path.startsWith(`${RECORDINGS_DIR}/`)) bumped(RECORDINGS_DIR);
}
