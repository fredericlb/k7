// layout.ts — the single definition of what lives under the mediatek root, so nothing
// hand-joins one of these paths. Mirrors the discipline of engine-client/paths.ts, and
// for the same reason: a wrong path here does not throw, it reads as an empty library.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { mediatekDir } from "@studio/engine-client/paths";
import type { Family } from "./types.ts";

export { mediatekDir };

/** The schema marker at the root. Its presence is what says "this folder IS a mediatek",
 *  which matters once the root is user-chosen and could be pointed at anything. */
export const MARKER = "mediatek.yaml";
export const SCHEMA_VERSION = 1;

/** Where each family lives, relative to the root. The `library`/`ui` folders below are the
 *  successors of a workspace's `_library`/`_ui`; they are not families of their own — a
 *  module names what it loads out of them. */
export const FAMILY_DIRS: Record<Family, string> = {
  morceaux: "morceaux",
  samples: "samples",
  modules: "modules",
};

/** Morceaux are filed by where they came from: `imported` is obscura's material, `recorded`
 *  is what radiok7 and lanes produced here. Provenance, not taste — it decides what may be
 *  re-derived and what is somebody else's master. */
export const MORCEAU_KINDS = ["imported", "recorded"] as const;

/** Samples split by what plays them, which is also what can read them. */
export const SAMPLE_KINDS = ["audio", "video"] as const;

/** The module type folders, the same vocabulary a project's `modules/` uses — the mediatek
 *  is the `_modules` library promoted, so the shape has to match or nothing would resolve. */
export const MODULE_TYPES = [
  "io",
  "instruments",
  "audio",
  "transformers",
  "video_effects",
  "video_transitions",
] as const;

export function familyDir(family: Family): string {
  return join(mediatekDir(), FAMILY_DIRS[family]);
}

/** Shared assets a module names: `ir/` impulse responses, `nam/` amp models. */
export function libraryDir(): string {
  return join(mediatekDir(), "library");
}

/** Shared module UI panels, keyed by `ref:` — the successor of a workspace's `_ui`. */
export function uiDir(): string {
  return join(mediatekDir(), "ui");
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
  for (const d of [
    root,
    ...Object.values(FAMILY_DIRS).map((f) => join(root, f)),
    ...MORCEAU_KINDS.map((k) => join(root, FAMILY_DIRS.morceaux, k)),
    ...SAMPLE_KINDS.map((k) => join(root, FAMILY_DIRS.samples, k)),
    libraryDir(),
    join(libraryDir(), "ir"),
    join(libraryDir(), "nam"),
    uiDir(),
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
