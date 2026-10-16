// layout.ts — the single definition of what lives under the mediatek root, so nothing
// hand-joins one of these paths. Mirrors the discipline of engine-client/paths.ts, and
// for the same reason: a wrong path here does not throw, it reads as an empty library.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { mediatekDir } from "@studio/engine-client/paths";
import { isWithin } from "@studio/web-protocol/paths";
import { type Family, PLAYLISTS_DIR, RECORDINGS_DIR } from "./types.ts";

export { mediatekDir };

/** The schema marker at the root — what says "this folder IS a mediatek", the root being user-chosen. */
export const MARKER = "mediatek.yaml";
export const SCHEMA_VERSION = 1;

/** Where each family lives, relative to the root; `library/` below is not a family but what a module loads. */
export const FAMILY_DIRS: Record<Family, string> = {
  songs: "songs",
  samples: "samples",
};

// `playlists/` is NOT in FAMILY_DIRS: a family is scanned for bytes, and a set list has none (docs/playlists.md).

// No SONG_KINDS beside SAMPLE_KINDS below: `songs/` has no subdivision — see docs/songs.md.

/** The raw capture zone, `recordings/<YYYY-MM-DD>/<HH-MM-SS>.<ext>` — a root zone, not a family; docs/recordings.md. */
/** The set lists, `playlists/<name>.yaml` — a root zone too, holding no bytes; docs/playlists.md. */
export { PLAYLISTS_DIR, RECORDINGS_DIR };

/** Samples split by what plays them, which is also what can read them. */
export const SAMPLE_KINDS = ["audio", "video"] as const;

export function familyDir(family: Family): string {
  return join(mediatekDir(), FAMILY_DIRS[family]);
}

/** Shared assets a module names: `ir/` impulse responses, `nam/` amp models. */
export function libraryDir(): string {
  return join(mediatekDir(), "library");
}

/** The raw capture zone — like `libraryDir`, a root folder that is not a family (docs/recordings.md). */
export function recordingsDir(): string {
  return join(mediatekDir(), RECORDINGS_DIR);
}

/** The set lists — a root zone too, holding names of songs rather than bytes (docs/playlists.md). */
export function playlistsDir(): string {
  return join(mediatekDir(), PLAYLISTS_DIR);
}

/** Everything derived and deletable: the index, waveforms, thumbnails. Never a source. */
export function cacheDir(): string {
  return join(mediatekDir(), ".cache");
}

export function indexPath(): string {
  return join(cacheDir(), "index.json");
}

/** Is there a mediatek at the configured root? Absence is normal, so every caller checks. */
export function exists(): boolean {
  return existsSync(join(mediatekDir(), MARKER));
}

/** Create the layout if it is not there and return the root; an existing marker is left as it is. */
export function ensureLayout(): string {
  const root = mediatekDir();
  // The families and the two zones; nothing INSIDE `songs/`, which has no subdivision to pre-create.
  for (const d of [
    root,
    ...Object.values(FAMILY_DIRS).map((f) => join(root, f)),
    join(root, RECORDINGS_DIR),
    join(root, PLAYLISTS_DIR),
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

  // No namespace file is written: the `@k7-core` prefix is parsed in code rather than declared.

  return root;
}

/** The declared schema version, or 0 — read as a line, since this runs before the shape is trusted. */
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

/** Thrown by `writablePath` for a path inside the library that is nonetheless not one to write. */
export class NotWritableError extends Error {}

/** The folders `ensureLayout` makes, the root included: never written, moved or removed — docs/index.md. */
const LAYOUT_DIRS: ReadonlySet<string> = new Set([
  "",
  ...Object.values(FAMILY_DIRS),
  RECORDINGS_DIR,
  PLAYLISTS_DIR,
  ...SAMPLE_KINDS.map((k) => `${FAMILY_DIRS.samples}/${k}`),
  "library",
  "library/ir",
  "library/nam",
]);

const WINDOWS = process.platform === "win32";
const CASE_BLIND = WINDOWS || process.platform === "darwin";

/** A segment as the filesystem may resolve it: Windows drops trailing dots and spaces, macOS and Windows fold case. */
const folded = (p: string): string => {
  const q = WINDOWS ? p.replace(/[. ]+$/, "") : p;
  return CASE_BLIND ? q.toLowerCase() : q;
};

/** A segment that is, or may be, a dot-folder — on Windows an 8.3 short name like `PROJEC~1` may be one. */
const hidden = (p: string): boolean =>
  p.startsWith(".") || (WINDOWS && /~\d/.test(p));

/** The path as root-relative segments, `[""]` for the root itself. */
const segmentsOf = (abs: string): string[] =>
  relative(mediatekDir(), abs).split(sep);

/** A path a caller may WRITE, or a refusal — the root, the layout, the marker and dot-folders are the library's own; docs/index.md. */
export function writablePath(rel: string): string {
  const abs = safePath(rel);
  const parts = segmentsOf(abs);
  if (LAYOUT_DIRS.has(parts.map(folded).join("/")))
    throw new NotWritableError(`${rel || "."}: the library's own folder`);
  if (folded(parts[0]) === MARKER)
    throw new NotWritableError(`${MARKER} is the library's own, not content`);
  if (parts.some(hidden))
    throw new NotWritableError(`${rel}: derived state is not writable`);
  return abs;
}

/** A path a CLIENT may read: inside the root and under no dot-folder, where server state lives — docs/index.md. */
export function readablePath(rel: string): string {
  const abs = safePath(rel);
  if (segmentsOf(abs).some(hidden))
    throw new PathEscapesError(`${rel}: not a library path`);
  return abs;
}

/** A mediatek-relative path as an absolute one, confined to the root lexically — see docs/index.md. */
export function safePath(rel: string): string {
  if (rel.includes("\0")) throw new PathEscapesError("path holds a NUL byte");
  const root = resolve(mediatekDir());
  const abs = resolve(root, rel);
  if (!isWithin(root, abs))
    throw new PathEscapesError(`path escapes the mediatek: ${rel}`);
  return abs;
}
