// scan.ts — read one family off disk into entries. The filesystem IS the catalogue, so
// this is the only thing that knows how a family is laid out; everything else consumes
// MediatekEntry. Tolerant throughout: an unreadable corner yields fewer entries, never a
// throw, because a listing that fails entirely is worse than one that is short.

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  familyDir,
  MODULE_TYPES,
  MORCEAU_KINDS,
  SAMPLE_KINDS,
  toRel,
} from "./layout.ts";
import type { Family, MediatekEntry } from "./types.ts";

/** The sidecar that makes a folder a morceau and carries its provenance. */
export const MORCEAU_FILE = "morceau.yaml";
/** The file that makes a folder a module — the same name a project's `modules/` uses. */
export const MODULE_FILE = "module.yaml";

const AUDIO_EXT = new Set([
  ".wav",
  ".flac",
  ".aiff",
  ".aif",
  ".mp3",
  ".ogg",
  ".opus",
  ".m4a",
  ".webm",
]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);

const isAudio = (n: string): boolean => AUDIO_EXT.has(extname(n).toLowerCase());
const isVideo = (n: string): boolean => VIDEO_EXT.has(extname(n).toLowerCase());

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
            // The upstream key of a mirrored entry. Its ABSENCE is what says "mediatek-native".
            ...(str(meta.grist) ? { grist: str(meta.grist) as string } : {}),
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

/** Modules: `modules/<type>/<name>/`, the same shape a project's `modules/` uses — this
 *  IS a workspace's `_modules` promoted, so a folder that doesn't match resolves nowhere.
 *  One without a `module.yaml` is still listed, flagged, rather than silently dropped. */
function scanModules(): MediatekEntry[] {
  const out: MediatekEntry[] = [];
  const root = familyDir("modules");
  for (const type of MODULE_TYPES) {
    const typeDir = join(root, type);
    for (const e of dirents(typeDir)) {
      if (!e.isDirectory()) continue;
      const abs = join(typeDir, e.name);
      const files = dirents(abs);
      const hasModule = files.some((f) => f.isFile() && f.name === MODULE_FILE);
      out.push({
        family: "modules",
        id: toRel(abs),
        name: e.name,
        path: toRel(abs),
        kind: type,
        mtime: newestUnder(abs),
        meta: {
          catalogued: hasModule,
          // Instances live beside module.yaml as <instance>.yaml — referenced as "<module>:<instance>".
          instances: files.filter(
            (f) =>
              f.isFile() && f.name.endsWith(".yaml") && f.name !== MODULE_FILE,
          ).length,
        },
      });
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
