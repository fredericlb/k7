// moduleAssetChoices.ts — the files a module's file-valued params may be set to: its own
// assets/, plus those of every module it extends, wherever those libraries live.
// One answer, because the panel, the graph and the CLI completion all ask it.
// See docs/moduleAssets.md.

import { join } from "node:path";
import { moduleFolderForRef } from "./controller";
import { listModuleAssets } from "./loader";

// A cycle in `extends` is already refused upstream; this is a backstop so a bad file cannot hang a UI request.
const MAX_ANCESTRY = 16;

/** Just enough of a module to find its folder and its parent — the resolved map and the ref map both fit. */
interface AssetOwner {
  category?: unknown;
  file?: unknown;
  extends?: unknown;
}

/**
 * Every asset `module` can name, as `assets/`-relative POSIX paths, nearest owner first.
 *
 * It walks the ANCESTRY, and that is the whole point. A module's assets used to be looked for at
 * `<project>/modules/<category>/<file>/assets` and nowhere else, which is right only for a module
 * this project both owns and stores the files in. It was wrong for the two shapes that actually
 * carry material:
 *
 * - a module living in a shared library — the médiathèque's `audio/amps/guitar` has the fourteen
 *   NAM profiles, and the project's `modules/audio/guitar` has none;
 * - a thin local module that exists only to override a param of one, which is what `extends`
 *   produces and is the normal way to point a song at a shared amp.
 *
 * Both listed nothing, so the panel's picker opened empty on the one module in the médiathèque
 * built to be picked from.
 *
 * A nearer module's assets come first and a duplicate path is dropped, so a local file shadows an
 * inherited one of the same name — the same precedence `resolveModuleAsset` gives the folders.
 */
export function moduleAssetChoices(
  dir: string,
  module: AssetOwner | undefined,
  refs: Readonly<Record<string, AssetOwner>>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (folder: string | null | undefined) => {
    if (!folder) return;
    for (const f of listModuleAssets(folder))
      if (!seen.has(f)) {
        seen.add(f);
        out.push(f);
      }
  };

  // Its own folder, when this project holds one — a module the engine merely reports has none.
  if (module?.category && module?.file)
    add(join(dir, "modules", String(module.category), String(module.file)));

  // …then everything it inherits from, in order, whichever library each one lives in.
  let ref = module?.extends;
  for (let i = 0; i < MAX_ANCESTRY && typeof ref === "string" && ref; i++) {
    add(moduleFolderForRef(dir, ref));
    ref = refs[ref]?.extends;
  }
  return out;
}

// `assetExtFor` / `assetsForParam` live in moduleTypes.ts, the leaf with no `node:fs`: the picker
// that filters by extension runs in a browser, and this file reads disk.
