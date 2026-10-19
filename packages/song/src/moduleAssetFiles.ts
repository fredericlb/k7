// moduleAssetFiles.ts — the files a module LOADS, resolved where it declares them: a rack's
// samples, its file-valued params and the `assets/` folder it carries. What a reader gets wrong:
// every path is resolved absolute in the DECLARING folder, so modules merge without provenance.
// See docs/moduleAssets.md.

import { readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  assetExtsFor,
  FILE_PARAMS,
  LIBRARY_FILE_PARAMS,
} from "@studio/song-schema/moduleTypes";
import {
  MODULE_ASSETS_DIR,
  MODULE_SOURCES_DIR,
  resolveModuleAssetIn,
  resolveModuleFileIn,
} from "./assetPath";
import { confineTo, libraryReadRoots, projectRoots } from "./confine";
import { libraryFile, resolveFileParamIn } from "./libraryFiles";
import type { LoadedModule, RawRack } from "./rawDoc";

// Rewrite a rack's audio refs to ABSOLUTE paths in the declaring folder, so racks merge without tracking provenance.
export function resolveRackAudio(
  rack: RawRack | undefined,
  folderAbs: string,
  // The project a `@project/…` sample is in — every module read for a project is read FOR one.
  projectDir?: string,
): RawRack | undefined {
  if (!rack || typeof rack !== "object") return rack;
  // Searched `sources/`, `assets/`, then beside module.k7x; a ref escaping every root is no file (docs/moduleAssets.md, docs/confine.md).
  const roots = [
    folderAbs,
    ...(projectDir ? projectRoots(projectDir) : libraryReadRoots()),
  ];
  const at = (f: unknown) =>
    typeof f === "string" && f
      ? (confineTo(
          roots,
          isAbsolute(f)
            ? f
            : (resolveModuleFileIn(f, [folderAbs], MODULE_SOURCES_DIR) ??
                resolveModuleAsset(f, folderAbs) ??
                join(folderAbs, f)),
        ) ?? undefined)
      : f;
  const symbols: NonNullable<RawRack["symbols"]> = {};
  for (const [sym, e] of Object.entries(rack.symbols ?? {}))
    symbols[sym] =
      e && typeof e === "object"
        ? {
            ...e,
            // A library SAMPLE is what a tap plays, landing where a clip did; the name it was written with stays beside it.
            clip:
              typeof e.sample === "string" && e.sample
                ? libraryFile("samples", e.sample, projectDir)
                : at(e.clip),
          }
        : e;
  return { ...rack, source: at(rack.source), symbols };
}

/** Each alternative's own `rack`, its audio resolved as the module's is: the set is merged over the module later (docs/alternatives.md). */
export function alternativeRacks(
  value: Record<string, unknown>,
  folderAbs: string,
  projectDir: string | undefined,
): { alternatives?: unknown[] } {
  const list = value.alternatives;
  if (!Array.isArray(list)) return {};
  const has = (a: unknown): a is { rack: RawRack } =>
    !!a && typeof a === "object" && !!(a as { rack?: unknown }).rack;
  if (!list.some(has)) return {};
  return {
    alternatives: list.map((a) =>
      has(a)
        ? { ...a, rack: resolveRackAudio(a.rack, folderAbs, projectDir) }
        : a,
    ),
  };
}

/** What an asset folder holds: every extension a file-valued param takes, from moduleTypes' one table. */
const ASSET_EXT = [...new Set(FILE_PARAMS.flatMap((p) => assetExtsFor(p)))];

// A module's own `assets/<ref>`, confined to that folder, with the machine's model cache as the ONE fallback (docs/moduleAssets.md).
export function resolveModuleAsset(
  ref: unknown,
  folderAbs: string | undefined,
): string | undefined {
  return resolveModuleAssetIn(ref, [folderAbs]);
}

// The file-valued params a module names, resolved absolute inside its OWN folder — see docs/moduleAssets.md.
export function resolveAssets(
  m: Record<string, unknown> | null | undefined,
  folderAbs?: string,
): Pick<LoadedModule, "model" | "assets"> {
  const params = (m?.params ?? {}) as Record<string, unknown>;
  const out: Record<string, string | undefined> = {};
  const assets: Record<string, string> = {};
  for (const field of FILE_PARAMS) {
    const ref = params[field];
    out[field] = resolveFileParamIn(field, ref, [folderAbs]);
    if (typeof ref === "string" && ref) assets[field] = ref;
  }
  // …and the ones a LIBRARY shares, named `@<library>/<path>` rather than by the module's own folder.
  for (const [field, family] of Object.entries(LIBRARY_FILE_PARAMS)) {
    const ref = params[field];
    if (typeof ref !== "string" || !ref) continue;
    out[field] = libraryFile(family, ref, folderAbs);
    assets[field] = ref;
  }
  return {
    ...out,
    ...(Object.keys(assets).length ? { assets } : {}),
  };
}

// The files a module carries, as `assets/`-relative POSIX paths, walked recursively and kept NESTED (docs/moduleAssets.md).
export function listModuleAssets(folderAbs: string): string[] {
  const MAX_DEPTH = 6;
  const out: string[] = [];
  const walk = (abs: string, rel: string, depth: number): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // no assets/ folder, or unreadable — an empty list, not an error
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) walk(join(abs, e.name), child, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = e.name.slice(e.name.lastIndexOf(".")).toLowerCase();
      if (ASSET_EXT.includes(ext)) out.push(child);
    }
  };
  walk(join(folderAbs, MODULE_ASSETS_DIR), "", 0);
  return out.sort();
}

// Read an external `modules_from` tree — only the GENERIC module.k7x, since nodes aren't `extends` targets.
