// scan.ts — read one family off disk into entries. The filesystem IS the catalogue, so
// this is the only thing that knows how a family is laid out; everything else consumes
// MediatekEntry. Tolerant throughout: an unreadable corner yields fewer entries, never a
// throw, because a listing that fails entirely is worse than one that is short.

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  familyDir,
  MODULE_TYPES,
  MORCEAU_KINDS,
  SAMPLE_KINDS,
  toRel,
} from "./layout.ts";
import { isAudio, isVideo } from "./media.ts";
import type { Family, MediatekEntry } from "./types.ts";

/** The sidecar that makes a folder a morceau and carries its provenance. */
export const MORCEAU_FILE = "morceau.yaml";
/** The file that makes a folder a module — the same name a project's `modules/` uses. */
export const MODULE_FILE = "module.yaml";

/** Its two siblings: the module's PANEL and its named settings. Neither is the generic, and neither is one
 *  of its instances — see `@studio/song`'s docs/uiLibrary.md and docs/userPresets.md. */
export const UI_FILE = "ui.yaml";
export const PRESETS_FILE = "presets.yaml";

/** The file that makes a folder a CHAIN — the same name, and the same shape, a pistes project
 *  uses at its root. See docs/chains.md. */
export const CHAINS_FILE = "chains.yaml";
/** Where a chain's instances live, beside its `chains.yaml`. */
export const INSTANCES_DIR = "instances";

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

/** A morceau's sidecar, read for display only. Unparseable is not fatal: the folder is
 *  still a morceau and still worth listing, just under its folder name. */
function readMorceau(abs: string): Record<string, unknown> {
  try {
    const v = parseYaml(readFileSync(join(abs, MORCEAU_FILE), "utf8"), {
      version: "1.2",
    });
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

/**
 * Morceaux: a folder under `morceaux/<kind>/` holding a `morceau.yaml`, or — for one
 * dropped in by hand — any audio file. Both are listed, because a library you can't see
 * the contents of is the problem this is here to fix; the sidecar is what turns one into
 * a catalogued thing with provenance.
 */
function scanMorceaux(): MediatekEntry[] {
  const out: MediatekEntry[] = [];
  const root = familyDir("morceaux");
  for (const kind of MORCEAU_KINDS) {
    const kindDir = join(root, kind);
    const visit = (abs: string): void => {
      const entries = dirents(abs);
      const hasSidecar = entries.some(
        (e) => e.isFile() && e.name === MORCEAU_FILE,
      );
      const master = entries.find((e) => e.isFile() && isAudio(e.name));
      if (hasSidecar || master) {
        const meta = hasSidecar ? readMorceau(abs) : {};
        const title = str(meta.title);
        const artist = str(meta.artist);
        out.push({
          family: "morceaux",
          id: toRel(abs),
          name: title ?? basename(abs),
          path: toRel(abs),
          kind,
          bytes: master ? sizeOf(join(abs, master.name)) : undefined,
          mtime: newestUnder(abs),
          meta: {
            catalogued: hasSidecar, // false == found on disk, never filed
            // The playable file's NAME inside the folder. `path` is the folder — a morceau
            // is a folder with a sidecar — so without this a consumer that has to OPEN the
            // audio (the moteur, which takes file paths) has nothing to open. Absent when
            // the folder is catalogued but carries no audio yet.
            ...(master ? { master: master.name } : {}),
            ...(artist ? { artist } : {}),
            ...(str(meta.uuid) ? { uuid: str(meta.uuid) as string } : {}),
          },
        });
        return; // an entry is a leaf — do not descend into its own files
      }
      for (const e of entries) if (e.isDirectory()) visit(join(abs, e.name));
    };
    visit(kindDir);
  }
  return out;
}

/** Samples: every media FILE under `samples/<kind>/<pack>/…`. The first segment below the
 *  kind is the pack, which is all the grouping a sample gets — it has no provenance to
 *  carry, unlike a morceau. */
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
    out.push({
      family: "modules",
      id: toRel(abs),
      name: sub.split("/").pop() ?? sub,
      path: toRel(abs),
      kind: type,
      mtime: newestUnder(abs),
      // What is ACTUALLY in the folder, so a tree shows the instances and sidecars rather
      // than three fixed rows that may have nothing to do with what was dropped in.
      files: files
        .filter((f) => f.isFile())
        .map((f) => f.name)
        .sort(),
      meta: {
        catalogued: files.some((f) => f.isFile() && f.name === MODULE_FILE),
        // Instances live beside module.yaml as <instance>.yaml — referenced as "<module>:<instance>".
        // The other two are the module ITSELF, and counting them read as more uses than there are.
        instances: files.filter(
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
  // files and its instances, never more modules.
  const visit = (abs: string, type: string, sub: string): void => {
    if (isModuleDir(abs)) return push(abs, type, sub);
    for (const d of dirents(abs))
      if (d.isDirectory()) visit(join(abs, d.name), type, `${sub}/${d.name}`);
  };

  for (const type of MODULE_TYPES)
    for (const e of dirents(join(root, type)))
      if (e.isDirectory()) visit(join(root, type, e.name), type, e.name);
  return out;
}

/**
 * Chains: any folder under `chains/` that HOLDS a `chains.yaml`, at whatever depth.
 *
 * The same rule modules follow, and the same reason — the file is what makes the folder, so
 * how deep you file it is your business and not the scan's. A chain is a TEMPLATE: the segments
 * in that file wire named instances to each other, and the instances themselves are files in
 * `instances/` beside it. See docs/chains.md.
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
        // The instances the segments can name — the folder beside the file, counted so a
        // listing says how big a template is without opening it.
        instances: dirents(join(abs, INSTANCES_DIR)).filter(
          (f) => f.isFile() && f.name.endsWith(".yaml"),
        ).length,
      },
    });
  };

  // A chain ends the descent: `instances/` is inside one, and nothing in there is a chain.
  const visit = (abs: string, sub: string): void => {
    if (isChainDir(abs)) return push(abs, sub);
    for (const d of dirents(abs))
      if (d.isDirectory()) visit(join(abs, d.name), `${sub}/${d.name}`);
  };
  for (const e of dirents(root))
    if (e.isDirectory()) visit(join(root, e.name), e.name);
  return out;
}

/** Read one family off disk. Sorted by name so a listing is stable between scans — readdir
 *  order is not, and a list that reshuffles on every poll is unusable. */
export function scanFamily(family: Family): MediatekEntry[] {
  const entries =
    family === "morceaux"
      ? scanMorceaux()
      : family === "samples"
        ? scanSamples()
        : family === "chains"
          ? scanChains()
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
 * An ENTRY's own folder is never descended into. A morceau and a module ARE folders and their
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
