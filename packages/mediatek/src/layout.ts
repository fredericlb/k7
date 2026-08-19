// layout.ts — the single definition of what lives under the mediatek root, so nothing
// hand-joins one of these paths. Mirrors the discipline of engine-client/paths.ts, and
// for the same reason: a wrong path here does not throw, it reads as an empty library.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { mediatekDir } from "@studio/engine-client/paths";
import { type Family, RECORDINGS_DIR } from "./types.ts";

export { mediatekDir };

/** The schema marker at the root. Its presence is what says "this folder IS a mediatek",
 *  which matters once the root is user-chosen and could be pointed at anything. */
export const MARKER = "mediatek.yaml";
export const SCHEMA_VERSION = 1;

/** Where each family lives, relative to the root. The `library` folder below is the successor
 *  of a workspace's `_library`; it is not a family of its own — a module names what it loads
 *  out of it. A module's PANEL has no folder here at all: it is the `ui.yaml` inside the
 *  module, under `modules/`. */
export const FAMILY_DIRS: Record<Family, string> = {
  songs: "songs",
  samples: "samples",
  playlists: "playlists",
};

// There is deliberately no SONG_KINDS beside SAMPLE_KINDS below: `songs/` has no
// subdivision. Full rationale in docs/songs.md — in short, the provenance split it used to
// carry (`imported`/`recorded`) separated the wrong thing, and `recordings/` already
// separates the right one.

/**
 * The raw capture zone, `recordings/<YYYY-MM-DD>/<HH-MM-SS>.<ext>`.
 *
 * A zone of its own at the root, beside the three families and NOT inside one. It holds no
 * catalogue entries — a capture is an hour and some bytes, with nothing to title it by — so
 * it is not a family; and it is not a folder under `songs/` either, because that is scanned,
 * and a thousand unnamed files would drown three hundred songs. See docs/recordings.md.
 *
 * Declared in types.ts and re-exported here, where the rest of the shape lives: the browser
 * needs the same word and cannot import this file.
 */
export { RECORDINGS_DIR };

/** Samples split by what plays them, which is also what can read them. */
export const SAMPLE_KINDS = ["audio", "video"] as const;

// Two things stood here and left with the `modules` family: the library's own NAMESPACE
// (`modules/config.yaml`, descriptive only — `@studio/song` decides a level from where a root
// SITS), and `MODULE_TYPES`, the type folders this volume laid out. Modules are authored in l8
// and committed to the account's library repository; this volume holds no `modules/` at all.

export function familyDir(family: Family): string {
  return join(mediatekDir(), FAMILY_DIRS[family]);
}

/** Shared assets a module names: `ir/` impulse responses, `nam/` amp models. */
export function libraryDir(): string {
  return join(mediatekDir(), "library");
}

/** The raw capture zone. Like `libraryDir`, a root folder that is not a family — see
 *  RECORDINGS_DIR and docs/recordings.md. */
export function recordingsDir(): string {
  return join(mediatekDir(), RECORDINGS_DIR);
}

/** Everything derived and deletable: the index, waveforms, thumbnails. Never a source. */
export function cacheDir(): string {
  return join(mediatekDir(), ".cache");
}

export function indexPath(): string {
  return join(cacheDir(), "index.json");
}

/** Is there a mediatek at the configured root? Absence is a normal state — nothing has
 *  created one yet — so every caller checks rather than assuming. */
export function exists(): boolean {
  return existsSync(join(mediatekDir(), MARKER));
}

/** Create the layout if it is not there, and return the root. Idempotent: an existing
 *  marker is left exactly as it is, so a hand-edited one is never overwritten. */
export function ensureLayout(): string {
  const root = mediatekDir();
  // The families themselves, and the two zones. Nothing INSIDE `songs/` — it has no
  // subdivision to pre-create, unlike `samples/`, whose two kinds decide what plays a file.
  for (const d of [
    root,
    ...Object.values(FAMILY_DIRS).map((f) => join(root, f)),
    join(root, RECORDINGS_DIR),
    ...SAMPLE_KINDS.map((k) => join(root, FAMILY_DIRS.samples, k)),
    libraryDir(),
    join(libraryDir(), "ir"),
    join(libraryDir(), "nam"),
    cacheDir(),
  ])
    mkdirSync(d, { recursive: true });

  const marker = join(root, MARKER);
  if (!existsSync(marker))
    writeFileSync(
      marker,
      `# The studio mediatek. Created automatically; safe to edit.\nversion: ${SCHEMA_VERSION}\n`,
      "utf8",
    );

  // A `modules/config.yaml` was written here, declaring the namespace chains name this
  // library's modules by (`@st0/<type>/<name>`). It went with the family: modules live in the
  // account's library repository now, and the prefix is `@st0` wherever a ref is parsed
  // (`@studio/song`'s moduleTypes.ts) rather than a line on this volume.

  return root;
}

/** The declared schema version, or 0 when there is no readable marker. Read as a plain
 *  line rather than parsed: this runs before anything trusts the folder's shape. */
export function schemaVersion(): number {
  try {
    const m = /^version:\s*(\d+)\s*$/m.exec(
      readFileSync(join(mediatekDir(), MARKER), "utf8"),
    );
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/** An absolute path as the mediatek-relative POSIX path used for entry ids. */
export function toRel(abs: string): string {
  return relative(mediatekDir(), abs).split(sep).join("/");
}

/** Thrown by `safePath` — a caller-fixable 400, never a 500. */
export class PathEscapesError extends Error {}

/** Thrown by `writablePath` for a path inside the library that is nonetheless not
 *  somebody's to write. */
export class NotWritableError extends Error {}

/**
 * A path a caller may WRITE, or a refusal.
 *
 * Inside the root is not enough. Two things are the library's own and not content:
 * `mediatek.yaml`, which says what this folder IS, and `.cache/`, which is derived —
 * writing there would let a caller poison an index or forge a cache's bookkeeping.
 *
 * Everything else is allowed, including paths in no family: a library that refused
 * unfamiliar folders could never grow a fourth one.
 */
export function writablePath(rel: string): string {
  const abs = safePath(rel);
  const parts = relative(mediatekDir(), abs).split(sep);
  if (parts[0] === MARKER)
    throw new NotWritableError(`${MARKER} is the library's own, not content`);
  if (parts.some((p) => p.startsWith(".")))
    throw new NotWritableError(`${rel}: derived state is not writable`);
  return abs;
}

/**
 * A mediatek-relative path as an absolute one, confined to the root.
 *
 * The local library never needed this: the file service's own `safePath` confines to the
 * workspace, which put the mediatek out of reach entirely. A HOSTED mediatek has no such
 * wall — the path in the request is the only thing between a caller and the disk — so the
 * check moves here, where both sides can use it.
 *
 * Lexical only, deliberately: this runs on every byte served, and the tree it guards is
 * one the service itself writes. A symlink INTO it is a thing an operator did on purpose.
 *
 * Containment is asked of `relative`, not of `startsWith`. They are not the same test:
 * `startsWith` compares SPELLINGS, so a root written with forward slashes in `env.yaml`
 * never matched the backslashed path `resolve` produces, and every nested path was reported
 * as escaping a library it was plainly inside. `relative` normalises both sides and answers
 * the question actually being asked — is this under that.
 */
export function safePath(rel: string): string {
  const root = mediatekDir();
  const abs = resolve(root, rel);
  const inside = relative(root, abs);
  if (inside === ".." || inside.startsWith(`..${sep}`))
    throw new PathEscapesError(`path escapes the mediatek: ${rel}`);
  return abs;
}
