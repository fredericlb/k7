// scan.ts — read one family off disk into entries. The filesystem IS the catalogue, so
// this is the only thing that knows how a family is laid out; everything else consumes
// MediatekEntry. Tolerant throughout: an unreadable corner yields fewer entries, never a
// throw, because a listing that fails entirely is worse than one that is short.
// Asynchronous throughout: it runs inside a shared server, where a sync walk stalls every user.

import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { MEDIA_YAML_READ } from "@studio/song-schema/mediaYaml";
// Where a separation's four files land, beside the master — shared, because a set's graph names it too.
import { STEMS_DIR, stemsComplete } from "@studio/song-schema/stems";
import { parse as parseYaml } from "yaml";
import { familyDir, SAMPLE_KINDS, toRel } from "./layout.ts";
import { isAudio, isVideo, withoutDerived } from "./media.ts";
import { mapLimit } from "./pool.ts";
import { readMasterTags } from "./tags.ts";
import {
  type Family,
  K7_ARTIST,
  type MediatekEntry,
  SONG_FILE,
  type SongVariant,
} from "./types.ts";

// That word lives in types.ts, which a browser may import; re-exported where importers look.
export { SONG_FILE };

async function dirents(abs: string): Promise<Dirent[]> {
  try {
    // A FLAC's derived copy is no entry, no master and no loose file — docs/derived.md.
    return withoutDerived(
      (await readdir(abs, { withFileTypes: true })).filter(
        (e) => !e.name.startsWith("."),
      ),
    );
  } catch {
    return [];
  }
}

/** Separated means the five aligned files, not just a folder — an older stems/ cannot cancel (docs/stemSplit.md). */
async function separated(abs: string, entries: Dirent[]): Promise<boolean> {
  if (!entries.some((e) => e.isDirectory() && e.name === STEMS_DIR))
    return false;
  return stemsComplete(
    (await dirents(join(abs, STEMS_DIR))).map((e) => e.name),
  );
}

async function mtimeOf(abs: string): Promise<number> {
  try {
    return (await stat(abs)).mtimeMs;
  } catch {
    return 0;
  }
}

async function sizeOf(abs: string): Promise<number | undefined> {
  try {
    return (await stat(abs)).size;
  } catch {
    return undefined;
  }
}

/** The newest mtime under a folder — "recently touched" for an entry whose payload is several files. */
async function newestUnder(abs: string): Promise<number> {
  let newest = await mtimeOf(abs);
  for (const e of await dirents(abs)) {
    const p = join(abs, e.name);
    const m = e.isDirectory() ? await newestUnder(p) : await mtimeOf(p);
    if (m > newest) newest = m;
  }
  return newest;
}

/** A song's sidecar, read for display only — unparseable still lists, under the folder name. */
async function readSong(abs: string): Promise<Record<string, unknown>> {
  try {
    const v = parseYaml(
      await readFile(join(abs, SONG_FILE), "utf8"),
      MEDIA_YAML_READ,
    );
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

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
async function scanSongs(): Promise<MediatekEntry[]> {
  const root = familyDir("songs");
  // Level by level, so the folders read at once stay at FANOUT however deep the tree goes.
  const leaves: { abs: string; entries: Dirent[] }[] = [];
  let level = [root];
  while (level.length) {
    const listed = await mapLimit(level, async (abs) => ({
      abs,
      entries: await dirents(abs),
    }));
    level = [];
    for (const { abs, entries } of listed) {
      const isEntry = entries.some(
        (e) => e.isFile() && (e.name === SONG_FILE || isAudio(e.name)),
      );
      // An entry is a leaf — do not descend into its own files.
      if (isEntry) leaves.push({ abs, entries });
      else
        for (const e of entries)
          if (e.isDirectory() && !(abs === root && e.name === K7_ARTIST))
            level.push(join(abs, e.name));
    }
  }
  return mapLimit(leaves, ({ abs, entries }) => songEntry(abs, entries));
}

/** One song folder as its entry, the sidecar read and the folder's insides measured. */
async function songEntry(
  abs: string,
  entries: Dirent[],
): Promise<MediatekEntry> {
  const hasSidecar = entries.some((e) => e.isFile() && e.name === SONG_FILE);
  const master = entries.find((e) => e.isFile() && isAudio(e.name));
  const meta = hasSidecar ? await readSong(abs) : {};
  // The music's own facts are the master's tags; the sidecar holds only provenance and variants.
  const tags = master ? await readMasterTags(join(abs, master.name)) : {};
  const variants = readVariants(meta, entries);
  return {
    family: "songs",
    id: toRel(abs),
    name: tags.title ?? basename(abs),
    path: toRel(abs),
    kind: "",
    bytes: master ? await sizeOf(join(abs, master.name)) : undefined,
    mtime: await newestUnder(abs),
    ...(variants.length ? { variants } : {}),
    meta: {
      catalogued: hasSidecar, // false == found on disk, never filed
      // The playable file's NAME inside the folder, since `path` is the folder itself.
      ...(master ? { master: master.name } : {}),
      // Has this song been SEPARATED, COMPLETELY? One readdir, and only for a song that has a stems/.
      ...((await separated(abs, entries)) ? { stems: true } : {}),
      ...(tags.artist ? { artist: tags.artist } : {}),
      ...(tags.album ? { album: tags.album } : {}),
      // Detected at upload and then EDITABLE — see setSongBpm and docs/songs.md.
      ...(tags.bpm ? { bpm: tags.bpm } : {}),
      // The KEY, typed rather than detected: a property of the recording, so it lives in the recording's own tags.
      ...(tags.key ? { key: tags.key } : {}),
      // The album position, which orders the tree's songs inside their album (ui-library's docs/library.md).
      ...(tags.track ? { track: tags.track } : {}),
      ...(str(meta.uuid) ? { uuid: str(meta.uuid) as string } : {}),
    },
  };
}

/** Samples: every media FILE under `samples/<kind>/<pack>/…`, the pack being all the grouping there is. */
async function scanSamples(): Promise<MediatekEntry[]> {
  const root = familyDir("samples");
  const found: { p: string; name: string; kind: string; pack: string }[] = [];
  let level = SAMPLE_KINDS.map((kind) => ({
    abs: join(root, kind),
    kind,
    pack: "",
  }));
  while (level.length) {
    const listed = await mapLimit(level, async (d) => ({
      ...d,
      entries: await dirents(d.abs),
    }));
    level = [];
    for (const { abs, kind, pack, entries } of listed) {
      const wanted = kind === "audio" ? isAudio : isVideo;
      for (const e of entries) {
        const p = join(abs, e.name);
        if (e.isDirectory()) level.push({ abs: p, kind, pack: pack || e.name });
        else if (wanted(e.name)) found.push({ p, name: e.name, kind, pack });
      }
    }
  }
  return mapLimit(found, async ({ p, name, kind, pack }) => {
    const st = await stat(p).catch(() => null);
    return {
      family: "samples",
      id: toRel(p),
      name,
      path: toRel(p),
      kind,
      bytes: st?.size,
      mtime: st?.mtimeMs ?? 0,
      ...(pack ? { meta: { pack } } : {}),
    };
  });
}

// Modules, chains and playlists are not this volume's, for two different reasons — ../docs/index.md.

/** Read one family off disk, sorted by name — readdir order is not stable between scans. */
export async function scanFamily(family: Family): Promise<MediatekEntry[]> {
  const entries = await (family === "songs" ? scanSongs() : scanSamples());
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** The paths under a family that NO entry accounts for — an empty folder, a loose file; see docs/index.md. */
export async function scanUnlisted(
  family: Family,
  entries: MediatekEntry[],
): Promise<string[]> {
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
  let level = [{ abs: root, rel: "" }];
  while (level.length) {
    const listed = await mapLimit(level, async (d) => ({
      ...d,
      entries: await dirents(d.abs),
    }));
    level = [];
    for (const { abs, rel, entries: ds } of listed)
      for (const d of ds) {
        const at = rel ? `${rel}/${d.name}` : d.name;
        if (isEntry.has(at)) continue; // the entry stands for it, insides included
        // A folder on the way to an entry is already drawn, but something below may not be.
        if (!onTheWay.has(at)) out.push(at);
        if (onTheWay.has(at) || d.isDirectory())
          level.push({ abs: join(abs, d.name), rel: at });
      }
  }
  return out.sort();
}
