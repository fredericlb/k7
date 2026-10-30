// workspaceEntries.ts — the tree mutations a workspace allows on its entries: drop a file, make a
// folder, rename, move, recycle — each through the path guards, never clobbering, and retrying a
// rename while Windows lets go of a handle. Workspace keeps the public methods. See docs/workspace.md.

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { atomicTempFor, writeFileAtomic } from "@studio/song/atomicWrite";
import {
  assertNotEngine,
  planModuleMove,
  refAt,
  repointRefs,
} from "@studio/song/moduleMove";
import {
  isInSharedModules,
  isLibraryEditable,
  isLibraryRootEditable,
  librariesHome,
  libraryOf,
} from "@studio/song/sharedFolders";
import {
  isDotSegment,
  isPlainSegment,
  isWithin,
} from "@studio/web-protocol/paths";
import { RECYCLE_DIR } from "./workspaceFilter.ts";

/** A YAML name, which a workspace refuses: every workspace document is .k7x. */
const YAML_NAME = /\.ya?ml$/i;

/** Throws on a YAML name, which would sit unread beside its .k7x — the one refusal of every route that names a file (docs/workspace.md). */
export function refuseYamlName(rel: string): void {
  if (YAML_NAME.test(rel))
    throw new Error(`${rel}: a workspace file is .k7x, not YAML`);
}

/** The members of the workspace the mutations read. */
export interface EntriesHost {
  readonly root: string;
  activeProject(): string | null;
  safePath(rel: string): string;
  toRel(abs: string): string;
  isRecycled(abs: string): boolean;
  cancelPrewarm(): void;
  invalidateProjectDoc(): void;
}

// Rename, retrying briefly while Windows releases a lingering handle; a non-transient error still throws.
export async function renameWithRetry(
  from: string,
  to: string,
  tries = 25,
  delayMs = 100,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const transient =
        code === "EPERM" ||
        code === "EBUSY" ||
        code === "EACCES" ||
        code === "ENOTEMPTY";
      if (!transient || attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Drop a file into `dir` under `name`, which may carry FOLDERS. Binary-safe, EEXIST rather than clobber. */
export function uploadFileIn(
  h: EntriesHost,
  dir: string,
  name: string,
  bytes: Buffer,
): { path: string } {
  const abs = uploadTarget(h, dir, name);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileAtomic(abs, bytes);
  h.invalidateProjectDoc();
  return { path: h.toRel(abs) };
}

/** An upload over `max` bytes, said as the 413 the route answers. */
export const uploadTooLarge = (max: number): Error =>
  Object.assign(
    new Error(
      `larger than ${max / (1024 * 1024)} MB, the most one upload takes`,
    ),
    { status: 413 },
  );

/** uploadFileIn for a request body: streamed to a hidden temp beside the target, then renamed — docs/fileRoutes.md. */
export async function uploadStreamIn(
  h: EntriesHost,
  dir: string,
  name: string,
  body: Readable,
  max: number,
): Promise<{ path: string }> {
  const abs = uploadTarget(h, dir, name);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = atomicTempFor(abs);
  let size = 0;
  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      if (size > max) done(uploadTooLarge(max));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(body, count, createWriteStream(tmp));
    // Checked again: another upload of the same name may have landed while this one streamed.
    if (existsSync(abs)) throw alreadyExists(h.toRel(abs));
    renameSync(tmp, abs);
  } finally {
    rmSync(tmp, { force: true });
  }
  h.invalidateProjectDoc();
  return { path: h.toRel(abs) };
}

function alreadyExists(rel: string): NodeJS.ErrnoException {
  const err = new Error(`already exists: ${rel}`) as NodeJS.ErrnoException;
  err.code = "EEXIST";
  return err;
}

/** Where an upload of `name` into `dir` lands, every guard passed; throws EEXIST rather than clobber. */
function uploadTarget(h: EntriesHost, dir: string, name: string): string {
  const segs = name
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!segs.length || segs.some(isDotSegment))
    throw new Error(`invalid filename: ${name}`);
  const clean = segs.join("/");
  const base = dir && dir !== "." ? dir.replace(/\/+$/, "") : "";
  const rel = base ? `${base}/${clean}` : clean;
  refuseYamlName(rel);
  const abs = h.safePath(rel);
  guardShared(h.toRel, abs, "add a file to");
  if (existsSync(abs)) throw alreadyExists(rel);
  return abs;
}

/** Make an empty folder `name` inside `dir` — uploadFile's shape, and no guardMutable. */
export function createFolderIn(
  h: EntriesHost,
  dir: string,
  name: string,
): { path: string } {
  const clean = basename(name).replace(/[\\/]/g, "").trim();
  if (!isPlainSegment(clean)) throw new Error(`invalid folder name: ${name}`);
  const base = dir && dir !== "." ? dir.replace(/\/+$/, "") : "";
  const rel = base ? `${base}/${clean}` : clean;
  const abs = h.safePath(rel);
  guardShared(h.toRel, abs, "create a folder in");
  if (h.isRecycled(abs))
    throw new Error("can't create a folder in the recycle bin");
  if (existsSync(abs)) {
    const err = new Error(`already exists: ${rel}`) as NodeJS.ErrnoException;
    err.code = "EEXIST";
    throw err;
  }
  mkdirSync(abs, { recursive: true });
  // The compiler reads nothing new, but the token is what refreshes the tree.
  h.invalidateProjectDoc();
  return { path: h.toRel(abs) };
}

/** `_modules`'s own STRUCTURE is fixed to every route — its files are edited in place, never renamed, moved or deleted this way — see docs/workspace.md. */
/** A library is written only by an admin, whose account overlays it writable — docs/libraries.md. */
export function assertLibraryWritable(
  toRel: (abs: string) => string,
  abs: string,
  verb = "change",
): void {
  const lib = libraryOf(abs);
  if (lib && !isLibraryRootEditable(lib))
    throw new Error(
      isLibraryEditable(lib.name)
        ? `can't ${verb} '${toRel(abs)}': a published version never changes — edit the draft`
        : `can't ${verb} '${toRel(abs)}': only the origin's admins edit a library`,
    );
}

export function guardShared(
  toRel: (abs: string) => string,
  abs: string,
  verb: string,
): void {
  assertLibraryWritable(toRel, abs, verb);
  if (isInSharedModules(toRel(abs)))
    throw new Error(
      `can't ${verb} '${toRel(abs)}': a shared module is edited in place — ` +
        `change its files directly, or run 'module populate' to rebuild it`,
    );
}

// Never the root, the recycle bin, or the active project's own folder — but anything INSIDE it is fair game.
function guardMutable(h: EntriesHost, abs: string, verb: string): void {
  if (abs === h.root) throw new Error(`can't ${verb} the workspace root`);
  // A library is added and removed from the origin's list, never from a workspace's tree.
  const lib = abs === librariesHome() ? null : libraryOf(abs);
  if (abs === librariesHome() || lib?.root === abs)
    throw new Error(
      `can't ${verb} '${h.toRel(abs)}': the libraries are listed by the admins, not moved from a workspace`,
    );
  guardShared(h.toRel, abs, verb);
  if (h.isRecycled(abs))
    throw new Error(`'${h.toRel(abs)}' is already in the recycle bin`);
  const active = h.activeProject();
  if (active && isWithin(abs, active))
    throw new Error(
      `can't ${verb} the active project's folder — stop it first, then ${verb} it`,
    );
}

// Rename within the same parent: workspace-sandboxed, no clobber, Windows-handle-retry.
export async function renameEntryIn(
  h: EntriesHost,
  rel: string,
  newName: string,
): Promise<{ path: string; repointed?: string[] }> {
  const abs = h.safePath(rel);
  guardMutable(h, abs, "rename");
  // A library module's ref IS its path: renaming it, or a folder of them, repoints every ref (song docs/moduleMove.md).
  const library = libraryOf(abs);
  const oldRef = library ? refAt(library, abs) : null;
  if (library && oldRef) assertNotEngine(library, abs);
  // A single path segment — no separators or traversal (the new name stays in place).
  const clean = basename(newName).replace(/[\\/]/g, "").trim();
  if (!isPlainSegment(clean)) throw new Error(`invalid name: ${newName}`);
  refuseYamlName(clean);
  const destAbs = h.safePath(h.toRel(join(dirname(abs), clean)));
  if (destAbs === abs) return { path: h.toRel(abs) }; // no-op rename to the same name
  if (existsSync(destAbs)) {
    const err = new Error(
      `already exists: ${h.toRel(destAbs)}`,
    ) as NodeJS.ErrnoException;
    err.code = "EEXIST";
    throw err;
  }
  // Release our own handles first; renameWithRetry covers a watcher's that lingers.
  h.cancelPrewarm();
  await renameWithRetry(abs, destAbs);
  const newRef = library ? refAt(library, destAbs) : null;
  const repointed =
    library && oldRef && newRef
      ? repointRefs([library.root, h.root], oldRef, newRef, true)
      : [];
  h.invalidateProjectDoc();
  return {
    path: h.toRel(destAbs),
    ...(repointed.length
      ? { repointed: repointed.map((f) => h.toRel(f)) }
      : {}),
  };
}

/** Move an entry into another folder — renameEntry's three concerns, plus the self-descent check. */
export async function moveEntryIn(
  h: EntriesHost,
  rel: string,
  toDir: string,
): Promise<{ path: string }> {
  const abs = h.safePath(rel);
  guardMutable(h, abs, "move");
  const destDir = h.safePath(toDir);
  guardShared(h.toRel, destDir, "move into"); // the destination too — a move IN is a write
  if (!existsSync(destDir) || !statSync(destDir).isDirectory())
    throw new Error(`not a folder: ${toDir}`);
  if (h.isRecycled(destDir))
    throw new Error(
      "can't move something into the recycle bin — delete it instead",
    );
  if (destDir === dirname(abs)) return { path: h.toRel(abs) }; // already there
  if (isWithin(abs, destDir))
    throw new Error(`can't move '${basename(abs)}' into itself`);
  const destAbs = join(destDir, basename(abs));
  if (existsSync(destAbs)) {
    const err = new Error(
      `already exists: ${h.toRel(destAbs)}`,
    ) as NodeJS.ErrnoException;
    err.code = "EEXIST";
    throw err;
  }
  h.cancelPrewarm();
  await renameWithRetry(abs, destAbs);
  h.invalidateProjectDoc();
  return { path: h.toRel(destAbs) };
}

/** Move a LIBRARY module to another folder of its library, repointing every ref to it here — song docs/moduleMove.md. */
export async function moveLibraryModuleIn(
  h: EntriesHost,
  rel: string,
  toDir: string,
): Promise<{ path: string; from: string; to: string; repointed: string[] }> {
  const abs = h.safePath(rel);
  const destDir = h.safePath(toDir);
  const library = libraryOf(abs);
  if (!library)
    throw new Error(`${rel} is not in one of the account's libraries`);
  assertLibraryWritable(h.toRel, abs, "move");
  if (libraryOf(destDir)?.name !== library.name)
    throw new Error(
      `a module stays in its library — this one is ${library.name}'s`,
    );
  guardMutable(h, abs, "move");
  const plan = planModuleMove(library, abs, destDir);
  h.cancelPrewarm();
  await renameWithRetry(abs, plan.dest);
  // The library itself first — its chains, assemblies and modules — then every song of this workspace.
  const repointed = repointRefs([library.root, h.root], plan.from, plan.to);
  h.invalidateProjectDoc();
  return {
    path: h.toRel(plan.dest),
    from: plan.from,
    to: plan.to,
    repointed: repointed.map((f) => h.toRel(f)),
  };
}

// Delete by moving into the recycle bin — reversible and hidden, like deleteProject.
export async function deleteEntryIn(
  h: EntriesHost,
  rel: string,
): Promise<{ recycled: string }> {
  const abs = h.safePath(rel);
  guardMutable(h, abs, "delete");
  // A library keeps its own bin at its root: it may sit on another disk than the workspace's.
  const lib = libraryOf(abs);
  const bin = join(lib ? lib.root : h.root, RECYCLE_DIR);
  mkdirSync(bin, { recursive: true });
  // Don't clobber an earlier deletion of the same name — suffix a counter.
  const base = basename(abs);
  let dest = join(bin, base);
  for (let n = 2; existsSync(dest); n++) dest = join(bin, `${base}-${n}`);
  h.cancelPrewarm();
  await renameWithRetry(abs, dest);
  h.invalidateProjectDoc();
  return { recycled: h.toRel(dest) };
}
