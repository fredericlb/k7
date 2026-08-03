// engineFace.ts — giving a SCANNED PLUGIN a face: the library module that extends an `@engine`
// ref and carries the panel beside it. Text and path only — no filesystem — because the
// médiathèque writes through its own routes and is not on the engine's machine.
// Rationale: docs/moduleNamespaces.md.

// moduleTypes only — the leaf with no filesystem. engineCatalogue re-exports `engineRef` but reads the
// scan cache off disk, and this file is imported by the médiathèque's browser bundle.
import { engineRef, MODULE_TYPES, slugifyPluginName } from "./moduleTypes";

export interface EngineFace {
  /** The `@engine` ref the module inherits everything from. */
  base: string;
  /** The folder name, which is also how a chain names it under its library's namespace. */
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
  return {
    base,
    module: slug,
    path: `${category}/${slug}/module.yaml`,
    // The header names the plugin as the SCAN spells it: the slug is lossy, and someone reading this file a
    // year later needs to know which of two similarly-slugged plugins it stands for.
    text:
      `# ${slug} — the face for ${pluginName}, a plugin the engine scans.\n` +
      `# Everything it IS comes from the ref below; what lives here is the ui.yaml beside this file.\n` +
      `extends: ${JSON.stringify(base)}\n`,
  };
}
