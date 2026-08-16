// scan.ts — read one family off disk into entries. The filesystem IS the catalogue, so
// this is the only thing that knows how a family is laid out; everything else consumes
// MediatekEntry. Tolerant throughout: an unreadable corner yields fewer entries, never a
// throw, because a listing that fails entirely is worse than one that is short.

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { familyDir, MODULE_TYPES, SAMPLE_KINDS, toRel } from "./layout.ts";
import { isAudio, isVideo } from "./media.ts";
import { PLAYLIST_EXT, parsePlaylist } from "./playlist.ts";
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

/** How deep an `assets/` walk goes. The same cap `listModuleAssets` uses, and for the same
 *  reason: a pathological tree must not be able to hang a listing request. */
const ASSETS_MAX_DEPTH = 6;

/**
 * What a module carries, as `assets/`-relative POSIX paths, sorted.
 *
 * RECURSIVE, and nested rather than flattened, because that is how this material arrives: a NAM
 * pack is a folder per amp, an IR pack a folder per cabinet. The measured case is
 * `audio/amps/guitar`, whose four folders and twenty-two files this used to report as an empty
 * list — every one of them on disk, and none of them anywhere on screen.
 *
 * The same shape `@studio/song`'s `listModuleAssets` returns, on purpose, so a path a tree
 * shows is a path a `params:` may name. What differs is the filter: that one keeps the
 * extensions a file-valued param accepts, this one keeps EVERYTHING, because a tree that hid
 * the `.wav` beside the `.nam` would be lying about the folder.
 *
 * A folder holding no file at any depth is reported with a TRAILING SLASH. Nothing else would
 * mention it — a folder is otherwise implied by the paths under it — and `scanUnlisted` states
 * the same rule one level up: a "Nouveau dossier…" that answers 200 and appears nowhere reads
 * as the call having done nothing at all.
 */
function assetsOf(moduleAbs: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string, depth: number): void => {
    const before = out.length;
    for (const e of dirents(abs)) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      // Past the cap a folder is named rather than descended into: the row is still true, and
      // it says there is something there to go and look at.
      if (e.isDirectory())
        depth < ASSETS_MAX_DEPTH
          ? walk(join(abs, e.name), child, depth + 1)
          : out.push(`${child}/`);
      else if (e.isFile()) out.push(child);
    }
    // Nothing came out of this folder, so nothing else would ever mention it. A folder with
    // children needs no such row — its own path is a prefix of theirs.
    if (rel && out.length === before) out.push(`${rel}/`);
  };
  walk(join(moduleAbs, ASSETS_DIR), "", 0);
  return out.sort();
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
      kind: files.has(ref.toLowerCase()) ? "file" : "chain",
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

/**
 * Modules: any folder under `modules/<type>/` that HOLDS a `module.yaml`, at whatever depth.
 *
 * The rule is the file and nothing else. This used to read exactly two depths, mirroring the
 * one-category shape `readModuleTree` accepts — which made the folders between a type and a
 * module a fixed, invisible grammar: you could not nest a third level, and dragging a module
 * into one made it vanish from the catalogue. Depth is now the library's business and not the
 * scan's; a folder is a folder, and a module is a folder with a module file in it.
 *
 * Only modules are listed. A folder holding no module file is a FOLDER, and the catalogue is a
 * list of modules — it used to carry those too, flagged `catalogued: false`, which put a row in
 * the middle pane for something nobody authored and counted it in the Modules tab. They still
 * reach a tree, by the route made for exactly this: `scanUnlisted` reports what no entry accounts
 * for, so an empty folder is drawn without being catalogued. See its own note on the difference
 * between a folder that IS an entry and one merely on the way to one.
 */
function scanModules(): MediatekEntry[] {
  const out: MediatekEntry[] = [];
  const root = familyDir("modules");
  const isModuleDir = (abs: string): boolean =>
    dirents(abs).some((f) => f.isFile() && f.name === MODULE_FILE);

  const push = (abs: string, type: string, sub: string): void => {
    const files = dirents(abs);
    const assets = assetsOf(abs);
    out.push({
      family: "modules",
      id: toRel(abs),
      name: sub.split("/").pop() ?? sub,
      path: toRel(abs),
      kind: type,
      mtime: newestUnder(abs),
      // What is ACTUALLY in the folder, so a tree shows the nodes and sidecars rather
      // than three fixed rows that may have nothing to do with what was dropped in.
      files: files
        .filter((f) => f.isFile())
        .map((f) => f.name)
        .sort(),
      // …and what it LOADS. The only place the scan looks inside an entry, and what it finds is
      // the entry's own material rather than more catalogue: nothing under `assets/` is ever an
      // entry of its own, whatever depth it sits at. See `assetsOf`.
      ...(assets.length ? { assets } : {}),
      meta: {
        catalogued: files.some((f) => f.isFile() && f.name === MODULE_FILE),
        // Nodes live beside module.yaml as <node>.yaml — referenced as "<module>:<node>".
        // The other two are the module ITSELF, and counting them read as more uses than there are.
        nodes: files.filter(
          (f) =>
            f.isFile() &&
            f.name.endsWith(".yaml") &&
            f.name !== MODULE_FILE &&
            f.name !== UI_FILE &&
            f.name !== PRESETS_FILE,
        ).length,
      },
    });
  };

  // Walk one folder under a type. A module ends the descent — what is inside one is its own
  // files and its nodes, never more modules.
  const visit = (abs: string, type: string, sub: string): void => {
    if (isModuleDir(abs)) {
      push(abs, type, sub);
      return;
    }
    for (const d of dirents(abs))
      if (d.isDirectory()) visit(join(abs, d.name), type, `${sub}/${d.name}`);
  };

  for (const type of MODULE_TYPES)
    for (const e of dirents(join(root, type)))
      if (e.isDirectory()) visit(join(root, type, e.name), type, e.name);
  return out;
}

/**
 * Chains: any folder under `chains/` that HOLDS a `graph.yaml`, at whatever depth.
 *
 * The same rule modules follow, and the same reason — the file is what makes the folder, so
 * how deep you file it is your business and not the scan's. A chain is a TEMPLATE: the segments
 * in that file wire named nodes to each other, and the nodes themselves are files in
 * `nodes/` beside it. See docs/chains.md.
 */
function scanChains(): MediatekEntry[] {
  const out: MediatekEntry[] = [];
  const root = familyDir("chains");
  const isChainDir = (abs: string): boolean =>
    dirents(abs).some((f) => f.isFile() && f.name === CHAINS_FILE);

  const push = (abs: string, sub: string): void => {
    const files = dirents(abs);
    out.push({
      family: "chains",
      id: toRel(abs),
      name: sub.split("/").pop() ?? sub,
      path: toRel(abs),
      // No subdivision of its own: a chain is a chain. `kind` is the family's own split, and
      // chains have none — what they are FOR is decided by whoever reaches for one.
      kind: "chain",
      mtime: newestUnder(abs),
      files: files
        .filter((f) => f.isFile())
        .map((f) => f.name)
        .sort(),
      meta: {
        catalogued: true,
        // The nodes the segments can name — the folder beside the file, counted so a
        // listing says how big a template is without opening it.
        nodes: dirents(join(abs, NODES_DIR)).filter(
          (f) => f.isFile() && f.name.endsWith(".yaml"),
        ).length,
      },
    });
  };

  // A chain ends the descent: `nodes/` is inside one, and nothing in there is a chain.
  const visit = (abs: string, sub: string): void => {
    if (isChainDir(abs)) {
      push(abs, sub);
      return;
    }
    for (const d of dirents(abs))
      if (d.isDirectory()) visit(join(abs, d.name), `${sub}/${d.name}`);
  };
  for (const e of dirents(root))
    if (e.isDirectory()) visit(join(root, e.name), e.name);
  return out;
}

/**
 * Playlists: every `*.yaml` FILE under `playlists/`, at whatever depth.
 *
 * The one family whose entry is a file rather than a folder — a sample is the other, and for the
 * same reason: there is nothing beside a playlist to keep. A song, a chain and a module are all
 * folders because each carries something its file names (a master, its nodes, its assets); a
 * playlist carries only refs to things filed elsewhere, so a folder around it would be an empty
 * box. That is why there is no `playlist.yaml` marker to look for: the extension is the rule.
 *
 * The file is parsed for two things only, and neither is load-bearing — `title:` for what the
 * listing shows, and how many items it names. A file that does NOT parse is still listed, with
 * `catalogued: false`, the same word an unfiled song folder gets: it is on the disk, and a
 * catalogue that hid it would leave you unable to click the thing you have to go and fix.
 */
function scanPlaylists(): MediatekEntry[] {
  const out: MediatekEntry[] = [];
  const root = familyDir("playlists");
  const visit = (abs: string): void => {
    for (const e of dirents(abs)) {
      const p = join(abs, e.name);
      if (e.isDirectory()) {
        visit(p);
        continue;
      }
      if (!e.name.toLowerCase().endsWith(PLAYLIST_EXT)) continue;
      let parsed: ReturnType<typeof parsePlaylist> = null;
      try {
        parsed = parsePlaylist(readFileSync(p, "utf8"));
      } catch {
        /* unreadable is the same fact as unparseable here: nothing to show it by */
      }
      // The extension off the name the disk actually carries, so a `.YAML` loses its own five
      // characters rather than keeping a case the constant does not spell.
      const stem = e.name.slice(0, -PLAYLIST_EXT.length);
      out.push({
        family: "playlists",
        id: toRel(p),
        name: parsed?.title ?? stem,
        path: toRel(p),
        // No subdivision: a playlist is a playlist. `kind` is the family's own split and this
        // family has none, so "" is honest where a borrowed word would not be.
        kind: "",
        bytes: sizeOf(p),
        mtime: mtimeOf(p),
        meta: {
          catalogued: parsed !== null,
          items: parsed?.items.length ?? 0,
        },
      });
    }
  };
  visit(root);
  return out;
}

/** Read one family off disk. Sorted by name so a listing is stable between scans — readdir
 *  order is not, and a list that reshuffles on every poll is unusable. */
export function scanFamily(family: Family): MediatekEntry[] {
  const entries =
    family === "songs"
      ? scanSongs()
      : family === "samples"
        ? scanSamples()
        : family === "chains"
          ? scanChains()
          : family === "playlists"
            ? scanPlaylists()
            : scanModules();
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
