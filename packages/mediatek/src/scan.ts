// scan.ts — read one family off disk into entries. The filesystem IS the catalogue, so
// this is the only thing that knows how a family is laid out; everything else consumes
// MediatekEntry. Tolerant throughout: an unreadable corner yields fewer entries, never a
// throw, because a listing that fails entirely is worse than one that is short.

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
// Where a separation's four files land, beside the master. `@studio/song`'s, because the graph
// of a set names the same folder and neither package can hold the word alone.
import { STEMS_DIR } from "@studio/song-schema/stems";
import { parse as parseYaml } from "yaml";
import { familyDir, SAMPLE_KINDS, toRel } from "./layout.ts";
import { isAudio, isVideo } from "./media.ts";
import {
  CHAINS_FILE,
  type Family,
  type MediatekEntry,
  NODES_DIR,
  SONG_FILE,
  type SongVariant,
} from "./types.ts";

/** The file that makes a folder a module — the same name a project's `modules/` uses. */
export const MODULE_FILE = "module.yaml";

/** Its two siblings: the module's PANEL and its named settings. Neither is the generic, and neither is one
 *  of its nodes — see `@studio/song`'s docs/uiLibrary.md and docs/userPresets.md. */
export const UI_FILE = "ui.yaml";
export const PRESETS_FILE = "presets.yaml";

/** Where a module keeps what it LOADS — samples, impulse responses, amp profiles — as opposed to
 *  what it IS. The same folder `@studio/song`'s loader resolves a module's own `ir`/`nam`/rack
 *  files out of (MODULE_ASSETS_DIR there), so a module dropped here plays on any machine. */
export const ASSETS_DIR = "assets";

// A chain's two names and a song's sidecar live in types.ts — the browser needs all three
// words and this file opens `node:fs`. Re-exported because this is where every importer looks.
export { CHAINS_FILE, NODES_DIR, SONG_FILE };

function dirents(abs: string): Dirent[] {
  try {
    return readdirSync(abs, { withFileTypes: true }).filter(
      (e) => !e.name.startsWith("."),
    );
  } catch {
    return [];
  }
}

function mtimeOf(abs: string): number {
  try {
    return statSync(abs).mtimeMs;
  } catch {
    return 0;
  }
}

function sizeOf(abs: string): number | undefined {
  try {
    return statSync(abs).size;
  } catch {
    return undefined;
  }
}

/** The newest mtime anywhere under a folder — what "recently touched" means for an entry
 *  whose payload is several files. */
function newestUnder(abs: string): number {
  let newest = mtimeOf(abs);
  for (const e of dirents(abs)) {
    const p = join(abs, e.name);
    const m = e.isDirectory() ? newestUnder(p) : mtimeOf(p);
    if (m > newest) newest = m;
  }
  return newest;
}

/** A song's sidecar, read for display only. Unparseable is not fatal: the folder is
 *  still a song and still worth listing, just under its folder name. */
function readSong(abs: string): Record<string, unknown> {
  try {
    const v = parseYaml(readFileSync(join(abs, SONG_FILE), "utf8"), {
      version: "1.2",
    });
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

// A hand-edited `bpm: 128` is a number; `bpm: "128"` is what somebody quoting it writes. Both
// are meant, and neither NaN nor 0 is — 0 is the engine's "none found" and never reaches here.
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * The `variants:` mapping of a sidecar, classified against what is actually in the folder.
 *
 * A value naming a file that IS there is a file variant; anything else names a chain. The
 * check runs one way only — see SongVariant on why a chain is not verified here — so an
 * entry that names a chain nobody wrote still reads as a chain, and the surface holding both
 * listings is what says it is missing. Getting that backwards would file a typo'd chain name
 * as a missing FILE, which sends you looking in the wrong folder.
 *
 * A non-string value is dropped rather than coerced: `variants: {a: [x]}` is a malformed
 * sidecar, and inventing "[object Object]" as a ref would put an unfollowable row on screen.
 */
function readVariants(
  meta: Record<string, unknown>,
  entries: Dirent[],
): SongVariant[] {
  const raw = meta.variants;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const files = new Set(
    entries.filter((e) => e.isFile()).map((e) => e.name.toLowerCase()),
  );
  const out: SongVariant[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const ref = str(value);
    if (!name || !ref) continue;
    out.push({
      name,
      ref,
      kind: files.has(ref.toLowerCase()) ? "file" : "missing",
    });
  }
  return out;
}

/**
 * Songs: a folder anywhere under `songs/` holding a `song.yaml`, or — for one dropped in by
 * hand — any audio file. Both are listed, because a library you can't see the contents of is
 * the problem this is here to fix; the sidecar is what turns one into a catalogued thing.
 *
 * The walk starts at the family root and not at a fixed set of subfolders, because `songs/`
 * has none: whatever tree the caller built is the tree. `kind` is therefore "" — this family
 * does not divide, and an entry saying so is honest where a borrowed word would not be.
 */
function scanSongs(): MediatekEntry[] {
  const out: MediatekEntry[] = [];
  const visit = (abs: string): void => {
    const entries = dirents(abs);
    const hasSidecar = entries.some((e) => e.isFile() && e.name === SONG_FILE);
    const master = entries.find((e) => e.isFile() && isAudio(e.name));
    if (hasSidecar || master) {
      const meta = hasSidecar ? readSong(abs) : {};
      const title = str(meta.title);
      const artist = str(meta.artist);
      const variants = readVariants(meta, entries);
      out.push({
        family: "songs",
        id: toRel(abs),
        name: title ?? basename(abs),
        path: toRel(abs),
        kind: "",
        bytes: master ? sizeOf(join(abs, master.name)) : undefined,
        mtime: newestUnder(abs),
        ...(variants.length ? { variants } : {}),
        meta: {
          catalogued: hasSidecar, // false == found on disk, never filed
          // The playable file's NAME inside the folder. `path` is the folder — a song
          // is a folder with a sidecar — so without this a consumer that has to OPEN the
          // audio (the moteur, which takes file paths) has nothing to open. Absent when
          // the folder is catalogued but carries no audio yet.
          ...(master ? { master: master.name } : {}),
          // Has this song been SEPARATED — is there a `stems/` beside its master? The desk asks,
          // because a deck can only subtract an instrument from a record whose stems exist
          // (packages/dsp/docs/stemcut.md), and the browser shows it so a set can be prepared.
          //
          // Read off the dirents already in hand: the folder, not its contents. Descending would
          // be a syscall per song for a fact the directory entry itself carries — and the same
          // "is it there" the preparation command asks before skipping a song.
          ...(entries.some((e) => e.isDirectory() && e.name === STEMS_DIR)
            ? { stems: true }
            : {}),
          ...(artist ? { artist } : {}),
          // Detected at upload and then EDITABLE — see setSongBpm. Surfaced because a surface
          // that lines a song up to a grid needs it, and re-reading the sidecar would be a
          // second source of truth.
          ...(num(meta.bpm) ? { bpm: num(meta.bpm) as number } : {}),
          ...(str(meta.uuid) ? { uuid: str(meta.uuid) as string } : {}),
        },
      });
      return; // an entry is a leaf — do not descend into its own files
    }
    for (const e of entries) if (e.isDirectory()) visit(join(abs, e.name));
  };
  visit(familyDir("songs"));
  return out;
}

/** Samples: every media FILE under `samples/<kind>/<pack>/…`. The first segment below the
 *  kind is the pack, which is all the grouping a sample gets — it has no title or artist to
 *  carry, unlike a song. */
function scanSamples(): MediatekEntry[] {
  const out: MediatekEntry[] = [];
  const root = familyDir("samples");
  for (const kind of SAMPLE_KINDS) {
    const kindDir = join(root, kind);
    const wanted = kind === "audio" ? isAudio : isVideo;
    const visit = (abs: string, pack: string): void => {
      for (const e of dirents(abs)) {
        const p = join(abs, e.name);
        if (e.isDirectory()) {
          visit(p, pack || e.name);
          continue;
        }
        if (!wanted(e.name)) continue;
        out.push({
          family: "samples",
          id: toRel(p),
          name: e.name,
          path: toRel(p),
          kind,
          bytes: sizeOf(p),
          mtime: mtimeOf(p),
          ...(pack ? { meta: { pack } } : {}),
        });
      }
    };
    visit(kindDir, "");
  }
  return out;
}

// `scanModules` was here, and `scanChains` below it. Both left with their families: a module
// and a chain are authored in st0 and committed to the account's LIBRARY REPOSITORY, which is
// a git repository somebody owns rather than a folder on this volume. See ../docs/index.md.

// `scanPlaylists` stood here. Playlists left the volume too, and for a reason of their own
// rather than the one above: a playlist holds no BYTES. It is pure reference — names of songs
// filed elsewhere — so hosting it bought nothing, while costing the account a document it could
// not version alongside the work it was written for. A set list lives in the workspace's
// `_playlists/` now, in the repository, and st0 is the app that opens one
// (`@studio/song/docs/playlists.md`).

/** Read one family off disk. Sorted by name so a listing is stable between scans — readdir
 *  order is not, and a list that reshuffles on every poll is unusable. */
export function scanFamily(family: Family): MediatekEntry[] {
  const entries = family === "songs" ? scanSongs() : scanSamples();
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The paths under a family that NO entry accounts for — an empty folder, a loose file.
 *
 * A tree draws itself from the entry paths, which works right up to the thing that is not an
 * entry: the folder `POST /folder` just made ("somewhere to drop into before the first file"),
 * or a file dropped where no catalogue reaches. Both answered 200 and appeared nowhere, which
 * reads as the call having done nothing at all.
 *
 * An ENTRY's own folder is never descended into. A song and a module ARE folders and their
 * insides are theirs — a module's files travel on the entry (`files`), because a tree drawing
 * one has to know which of the three canonical names are missing, not merely what is there.
 */
export function scanUnlisted(
  family: Family,
  entries: MediatekEntry[],
): string[] {
  const root = familyDir(family);
  // An entry's own path, and every folder on the way to one: the first stops the walk, the
  // second is already drawn. Conflating them would either hide a library or descend into a module.
  const isEntry = new Set<string>();
  const onTheWay = new Set<string>();
  for (const e of entries) {
    const rel = e.path.split("/").slice(1); // drop the family segment
    isEntry.add(rel.join("/"));
    for (let i = 1; i < rel.length; i++)
      onTheWay.add(rel.slice(0, i).join("/"));
  }
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const d of dirents(abs)) {
      const at = rel ? `${rel}/${d.name}` : d.name;
      if (isEntry.has(at)) continue; // the entry stands for it, insides included
      if (onTheWay.has(at)) {
        walk(join(abs, d.name), at); // already drawn, but something below may not be
        continue;
      }
      out.push(at);
      if (d.isDirectory()) walk(join(abs, d.name), at);
    }
  };
  walk(root, "");
  return out.sort();
}
