// layout.ts — the single definition of what lives under the mediatek root, so nothing
// hand-joins one of these paths. Mirrors the discipline of engine-client/paths.ts, and
// for the same reason: a wrong path here does not throw, it reads as an empty library.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { mediatekDir } from "@studio/engine-client/paths";
import { type Family, RECORDINGS_DIR } from "./types.ts";

export { mediatekDir };

/** The schema marker at the root — what says "this folder IS a mediatek", the root being user-chosen. */
export const MARKER = "mediatek.yaml";
export const SCHEMA_VERSION = 1;

/** Where each family lives, relative to the root; `library/` below is not a family but what a module loads. */
export const FAMILY_DIRS: Record<Family, string> = {
  songs: "songs",
  samples: "samples",
};

// `playlists` was the third; an old volume's folder is left inert rather than deleted (docs/index.md).

// No SONG_KINDS beside SAMPLE_KINDS below: `songs/` has no subdivision — see docs/songs.md.

/** The raw capture zone, `recordings/<YYYY-MM-DD>/<HH-MM-SS>.<ext>` — a root zone, not a family; docs/recordings.md. */
export { RECORDINGS_DIR };

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

  // No namespace file is written: the `@st0` prefix is parsed in code rather than declared.

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

/** A path a caller may WRITE, or a refusal — the marker and `.cache/` are the library's own; docs/index.md. */
export function writablePath(rel: string): string {
  const abs = safePath(rel);
  const parts = relative(mediatekDir(), abs).split(sep);
  if (parts[0] === MARKER)
    throw new NotWritableError(`${MARKER} is the library's own, not content`);
  if (parts.some((p) => p.startsWith(".")))
    throw new NotWritableError(`${rel}: derived state is not writable`);
  return abs;
}

/** A mediatek-relative path as an absolute one, confined to the root lexically — see docs/index.md. */
export function safePath(rel: string): string {
  const root = mediatekDir();
  const abs = resolve(root, rel);
  const inside = relative(root, abs);
  if (inside === ".." || inside.startsWith(`..${sep}`))
    throw new PathEscapesError(`path escapes the mediatek: ${rel}`);
  return abs;
}
