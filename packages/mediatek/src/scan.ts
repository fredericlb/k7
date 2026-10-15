// scan.ts — read one family off disk into entries. The filesystem IS the catalogue, so
// this is the only thing that knows how a family is laid out; everything else consumes
// MediatekEntry. Tolerant throughout: an unreadable corner yields fewer entries, never a
// throw, because a listing that fails entirely is worse than one that is short.

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
// Where a separation's four files land, beside the master — shared, because a set's graph names it too.
import { STEMS_DIR, stemsComplete } from "@studio/song-schema/stems";
import { parse as parseYaml } from "yaml";
import { familyDir, SAMPLE_KINDS, toRel } from "./layout.ts";
import { isAudio, isVideo, withoutDerived } from "./media.ts";
import {
  type Family,
  K7_ARTIST,
  type MediatekEntry,
  SONG_FILE,
  type SongVariant,
} from "./types.ts";

/** The file that makes a folder a module — the same name a project's `modules/` uses. */
export const MODULE_FILE = "module.yaml";

/** Its sibling: the module's PANEL — see `@studio/song`'s docs/uiLibrary.md. */
export const UI_FILE = "ui.yaml";

/** Where a module keeps what it LOADS rather than what it IS — `@studio/song`'s MODULE_ASSETS_DIR. */
export const ASSETS_DIR = "assets";

// That word lives in types.ts, which a browser may import; re-exported where importers look.
export { SONG_FILE };

function dirents(abs: string): Dirent[] {
  try {
    // A FLAC's derived MP3 is no entry, no master and no loose file — docs/derivedMp3.md.
    return withoutDerived(
      readdirSync(abs, { withFileTypes: true }).filter(
        (e) => !e.name.startsWith("."),
      ),
    );
  } catch {
    return [];
  }
}

/** Separated means the five aligned files, not just a folder — an older stems/ cannot cancel (docs/stemSplit.md). */
function separated(abs: string, entries: Dirent[]): boolean {
  if (!entries.some((e) => e.isDirectory() && e.name === STEMS_DIR))
    return false;
  return stemsComplete(dirents(join(abs, STEMS_DIR)).map((e) => e.name));
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

/** The newest mtime under a folder — "recently touched" for an entry whose payload is several files. */
function newestUnder(abs: string): number {
  let newest = mtimeOf(abs);
  for (const e of dirents(abs)) {
    const p = join(abs, e.name);
    const m = e.isDirectory() ? newestUnder(p) : mtimeOf(p);
    if (m > newest) newest = m;
  }
  return newest;
}

/** A song's sidecar, read for display only — unparseable still lists, under the folder name. */
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

// `bpm: 128` and `bpm: "128"` are both meant; NaN and 0 — the engine's "none found" — are not.
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
};

/** The sidecar's `variants:`, classified against what is in the folder and one way only — see docs/variants.md. */
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

/** Songs: any folder under `songs/` holding a `song.yaml` or, dropped by hand, any audio — see docs/songs.md. */
function scanSongs(): MediatekEntry[] {
  const out: MediatekEntry[] = [];
  const root = familyDir("songs");
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
          // The playable file's NAME inside the folder, since `path` is the folder itself.
          ...(master ? { master: master.name } : {}),
          // Has this song been SEPARATED, COMPLETELY? One readdir, and only for a song that has a stems/.
          ...(separated(abs, entries) ? { stems: true } : {}),
          ...(artist ? { artist } : {}),
          // Detected at upload and then EDITABLE — see setSongBpm and docs/songs.md.
          ...(num(meta.bpm) ? { bpm: num(meta.bpm) as number } : {}),
          // The KEY, typed rather than detected: a property of the recording, so it lives with it
          // and not in any one set's files. `C# minor` — the wheel is drawn from it, docs/songs.md.
          ...(str(meta.key) ? { key: str(meta.key) as string } : {}),
          ...(str(meta.uuid) ? { uuid: str(meta.uuid) as string } : {}),
        },
      });
      return; // an entry is a leaf — do not descend into its own files
    }
    for (const e of entries)
      if (e.isDirectory() && !(abs === root && e.name === K7_ARTIST))
        visit(join(abs, e.name));
  };
  visit(root);
  return out;
}

/** Samples: every media FILE under `samples/<kind>/<pack>/…`, the pack being all the grouping there is. */
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

// Modules, chains and playlists are not this volume's, for two different reasons — ../docs/index.md.

/** Read one family off disk, sorted by name — readdir order is not stable between scans. */
export function scanFamily(family: Family): MediatekEntry[] {
  const entries = family === "songs" ? scanSongs() : scanSamples();
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** The paths under a family that NO entry accounts for — an empty folder, a loose file; see docs/index.md. */
export function scanUnlisted(
  family: Family,
  entries: MediatekEntry[],
): string[] {
  const root = familyDir(family);
  // An entry's own path stops the walk; a folder on the way to one is drawn but still descended.
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
