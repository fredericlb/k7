// moduleAssetChoices.ts — the files a module's file-valued params may be set to: its own
// assets/, plus those of every module it extends, wherever those libraries live.
// One answer, because the panel, the graph and the CLI completion all ask it.
// See docs/moduleAssets.md.

import { join } from "node:path";
import { listModuleAssets } from "./loader";

// A cycle in `extends` is already refused upstream; this is a backstop so a bad file cannot hang a UI request.
const MAX_ANCESTRY = 16;

/** Just enough of a module to find its folder and its parent — the resolved map and the ref map both fit. */
interface AssetOwner {
  category?: unknown;
  file?: unknown;
  extends?: unknown;
  /** Where its files are, stamped by the loader on every module it reads. */
  folderAbs?: unknown;
}

/** `assets/` listings memoised for one request, since ancestors repeat — see docs/moduleAssets.md. */
export interface AssetLookup {
  assetsIn: (folder: string) => string[];
}

export function assetLookup(_dir?: string): AssetLookup {
  const assets = new Map<string, string[]>();
  return {
    assetsIn: (folder) => {
      const hit = assets.get(folder);
      if (hit) return hit;
      const files = listModuleAssets(folder);
      assets.set(folder, files);
      return files;
    },
  };
}

/** Every asset `module` can name, nearest owner first, walking the ANCESTRY — docs/moduleAssets.md. */
export function moduleAssetChoices(
  dir: string,
  module: AssetOwner | undefined,
  refs: Readonly<Record<string, AssetOwner>>,
  lookup: AssetLookup = assetLookup(dir),
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (folder: string | null | undefined) => {
    if (!folder) return;
    for (const f of lookup.assetsIn(folder))
      if (!seen.has(f)) {
        seen.add(f);
        out.push(f);
      }
  };

  // Its own folder: the loader's stamp, else rebuilt for a caller passing a hand-made module.
  add(
    typeof module?.folderAbs === "string" && module.folderAbs
      ? module.folderAbs
      : module?.category && module?.file
        ? join(dir, "modules", String(module.category), String(module.file))
        : undefined,
  );

  // …then everything it inherits from, read off the ref map, so this costs no directory walk.
  let ref = module?.extends;
  for (let i = 0; i < MAX_ANCESTRY && typeof ref === "string" && ref; i++) {
    const parent = refs[ref];
    add(typeof parent?.folderAbs === "string" ? parent.folderAbs : undefined);
    ref = parent?.extends;
  }
  return out;
}

// `assetExtsFor` / `assetsForParam` live in moduleTypes.ts: the picker that filters by extension runs in a browser.
