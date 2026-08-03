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
 * Modules: `modules/<type>/[<category>/]<name>/`, the same shape a project's `modules/` uses —
 * this IS a workspace's `_modules` promoted, so a folder that doesn't match resolves nowhere.
 *
 * TWO depths, mirroring `readModuleTree` rather than guessing at it: a folder with no module
 * file is a CATEGORY, and the modules sit one level under it (`audio/filter/auto-wah`, the
 * shape the shared library ships). Listing only the first level filed the category itself as a
 * module, so opening it looked for a `module.yaml` that was never going to be there — and the
 * real modules under it were absent from the catalogue entirely.
 *
 * A folder with no module file and nothing module-shaped below it is still listed, flagged
 * `catalogued: false`, rather than silently dropped: it is what a folder you just made looks
 * like, and one you cannot see is one you cannot drop into.
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

  for (const type of MODULE_TYPES) {
    const typeDir = join(root, type);
    for (const e of dirents(typeDir)) {
      if (!e.isDirectory()) continue;
      const abs = join(typeDir, e.name);
      if (isModuleDir(abs)) {
        push(abs, type, e.name);
        continue;
      }
      // No module file: a category, if anything below it is a module. One level only — the
      // loader files nothing deeper, so neither does this.
      const leaves = dirents(abs).filter(
        (d) => d.isDirectory() && isModuleDir(join(abs, d.name)),
      );
      if (leaves.length)
        for (const l of leaves)
          push(join(abs, l.name), type, `${e.name}/${l.name}`);
      else push(abs, type, e.name); // neither — a folder somebody just made
    }
  }
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
