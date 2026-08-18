// engineFace.ts — giving a SCANNED PLUGIN a face: the library module that extends an `@engine`
// ref and carries the panel beside it. Text and path only — no filesystem — because the
// médiathèque writes through its own routes and is not on the engine's machine.
// Rationale: docs/moduleNamespaces.md.

// moduleTypes only — the leaf with no filesystem. engineCatalogue re-exports `engineRef` but reads the
// scan cache off disk, and this file is imported by the médiathèque's browser bundle.
import {
  categoryForRole,
  engineRef,
  MODULE_TYPES,
  slugifyPluginName,
} from "./moduleTypes";

export interface EngineFace {
  /** The `@engine` ref the module inherits everything from. */
  base: string;
  /** The module's own folder name — the slug. Not the whole ref tail once it is filed under a
   *  sub-folder; `path` is what says where it actually goes. */
  module: string;
  /** Library-relative path of the module file to write. */
  path: string;
  /** …and its whole text. */
  text: string;
}

/** The categories a scanned plugin can be filed under — `io` is the engine's own, never a plugin's. */
export const FACE_CATEGORIES = Object.keys(MODULE_TYPES).filter(
  (c) => c !== "io" && c !== "midi", // `midi` is the legacy alias of transformers; one spelling is offered
);

/**
 * The module that gives `pluginName` a face, filed under `category`.
 *
 * It declares **nothing but `extends`**, and that is the whole design: a scanned plugin's substance is the
 * plugin, so copying its parameters into a file here would be a second, staler copy of what the scan already
 * knows. What this module adds is a NAME a chain can use and a folder a `ui.yaml` can sit in — the two things
 * `@engine/<slug>` cannot have, being a ref with nothing on disk behind it.
 *
 * Deliberately not `materialiseEngineModule`'s job done elsewhere: that one copies a plugin into ONE project,
 * so every song that reaches for it gets its own face to maintain. This is drawn once, in the médiathèque, for
 * every song on every machine.
 */
export function engineFaceModule(
  pluginName: string,
  category: string,
  /** A category-relative sub-folder to file it under (`delay`), or "" for the type folder
   *  itself. The médiathèque's own modules already sit at this depth — `audio/distortion/…` —
   *  and a library given every plugin at once needs it: two hundred effects in one folder is a
   *  level you cannot find anything in. See `faceFolder`. */
  folder = "",
): EngineFace {
  const slug = slugifyPluginName(pluginName);
  if (!slug)
    throw new Error(
      `'${pluginName}' has no name a module folder can take — give the plugin's name as the engine reports it`,
    );
  if (!(category in MODULE_TYPES) || category === "io")
    throw new Error(
      `'${category}' is not a category a plugin can be filed under (${FACE_CATEGORIES.join(", ")})`,
    );
  const base = engineRef(slug);
  const under = folder ? `${category}/${folder}` : category;
  return {
    base,
    module: slug,
    path: `${under}/${slug}/module.yaml`,
    // The header names the plugin as the SCAN spells it: the slug is lossy, and someone reading this file a
    // year later needs to know which of two similarly-slugged plugins it stands for.
    text:
      `# ${slug} — the face for ${pluginName}, a plugin the engine scans.\n` +
      `# Everything it IS comes from the ref below; what lives here is the ui.yaml beside this file.\n` +
      `extends: ${JSON.stringify(base)}\n`,
  };
}

/** As much of a scanned plugin as filing one needs — the shape `scannedPlugins` hands back. */
export interface FaceablePlugin {
  name: string;
  role?: string;
  instrument?: boolean;
  /** The plugin's OWN category, as the scan spells it: `Fx|Delay`, `instrument|synth`. */
  category?: string;
  /**
   * …and the pair that ADDRESSES it rather than files it: the format, and the binary the scan
   * found it in. Nothing here reads either — filing a plugin needs its name and its category
   * and nothing else — but they ride in the same scan reply, and the one thing a face cannot
   * do without them is ask the engine what the plugin's PARAMETERS are.
   */
  format?: string;
  id?: string;
}

/**
 * Category words that say nothing the TYPE folder does not already say. `Fx` under `audio/`
 * would be a level holding everything, which is the same as no level at all.
 */
const SAYS_NOTHING = new Set([
  "fx",
  "effect",
  "effects",
  "audio",
  "instrument",
  "instruments",
  "midi",
]);

/**
 * Where under its type folder a plugin belongs, from the category the SCAN reports — its LAST
 * segment, so `Fx|Delay` files under `delay` and `instrument|synth` under `synth`. "" when the
 * scan says nothing, or nothing that adds to the folder it is already in.
 *
 * The last segment and not the first, because the first repeats the type: every audio effect
 * says `Fx`, every instrument says `instrument`, and what distinguishes them is what follows.
 *
 * This lands the plugins on the axis the médiathèque already files by — `audio/distortion`,
 * `audio/filter`, `audio/utility` are folders somebody made by hand before any of this existed.
 * Filing by MANUFACTURER was the other candidate and would have been a second axis crossing
 * that one, with one folder holding most of the library the moment you install a big free pack.
 */
export function faceFolder(category?: string): string {
  const slug = slugifyPluginName((category ?? "").split("|").pop() ?? "");
  return slug && !SAYS_NOTHING.has(slug) ? slug : "";
}

/**
 * The faces a library is missing, for every plugin a machine has scanned.
 *
 * `have` is the `@engine` refs something in the library already extends — the check that keeps
 * this idempotent, and it is by REF rather than by path on purpose: a face somebody filed by
 * hand under a name of their own (`audio/distortion/bitcrush` extends `@engine/de-rez`) is
 * still that plugin's face, and writing a second one at the default path would give one plugin
 * two names a chain could reach it by.
 *
 * Two plugins whose names slug the same collapse to one, first wins — the identical rule
 * `engineModules` applies to the scan it derives its refs from, and it has to be identical or
 * the face would name a ref the catalogue does not synthesise.
 */
export function engineFaces(
  plugins: FaceablePlugin[],
  have: Iterable<string> = [],
): EngineFace[] {
  const seen = new Set(have);
  const out: EngineFace[] = [];
  for (const p of plugins) {
    let face: EngineFace;
    try {
      face = engineFaceModule(
        p.name,
        categoryForRole(p),
        faceFolder(p.category),
      );
    } catch {
      continue; // a name with no slug in it — skipped exactly as the catalogue skips it
    }
    if (seen.has(face.base)) continue;
    seen.add(face.base);
    out.push(face);
  }
  return out;
}
