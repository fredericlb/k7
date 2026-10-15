// engineFace.ts — giving a SCANNED PLUGIN a face: the library module that extends an `@engine`
// ref and carries the panel beside it. Text and path only — no filesystem — because the
// médiathèque writes through its own routes and is not on the engine's machine.
// Rationale: docs/moduleNamespaces.md.

// moduleTypes only — the leaf with no filesystem, since the médiathèque's browser bundle imports this.
import {
  categoryForRole,
  engineRef,
  MODULE_TYPES,
  slugifyPluginName,
} from "@studio/song-schema/moduleTypes";

export interface EngineFace {
  /** The `@engine` ref the module inherits everything from. */
  base: string;
  /** The module's own folder name — the slug, not the ref tail; `path` says where it actually goes. */
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

/** Built-ins whose working state is not params, so a face over one does nothing — each with why; docs/moduleNamespaces.md. */
export const NO_FACE: Readonly<Record<string, string>> = {
  sampler:
    "plays only as a rack — write `type: rack` rather than a face over it (packages/song/docs/racks.md)",
  "midi-patch-bay":
    "keeps its channel map as state, not params — as a module it only passes MIDI through",
  "patch-bay":
    "keeps its wiring as state, not params — as a module it only passes audio through",
  text: "is a note that touches no sound — a note is an `@meta/doc` node",
  insert:
    "sends to hardware chosen in its state, not params — a module cannot pick the device",
  "freeze-point":
    "marks a spot for Tracktion's own freeze, which k7 does not use — freeze a module with `node freeze`",
  "level-meter":
    "measures what nothing reads — the engine meters every track and the master itself",
  "aux-send":
    "routes over a bus number kept as state, always bus 0 — audio the graph would not show; route in the graph",
  "aux-return":
    "routes over a bus number kept as state, always bus 0 — audio the graph would not show; route in the graph",
};

/** The module that gives `pluginName` a face — nothing but `extends`, see docs/moduleNamespaces.md. */
export function engineFaceModule(
  pluginName: string,
  category: string,
  /** A category-relative sub-folder to file it under (`delay`), or "" for the type folder itself. */
  folder = "",
): EngineFace {
  const slug = slugifyPluginName(pluginName);
  if (!slug)
    throw new Error(
      `'${pluginName}' has no name a module folder can take — give the plugin's name as the engine reports it`,
    );
  const refused = NO_FACE[slug];
  if (refused) throw new Error(`'${pluginName}' gets no face: it ${refused}`);
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
    // The header names the plugin as the SCAN spells it, the slug being lossy.
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
}

/** Category words that say nothing the TYPE folder does not — see docs/moduleNamespaces.md. */
const SAYS_NOTHING = new Set([
  "fx",
  "effect",
  "effects",
  "audio",
  "instrument",
  "instruments",
  "midi",
]);

/** Where under its type folder a plugin belongs — the scan category's LAST segment, docs/moduleNamespaces.md. */
export function faceFolder(category?: string): string {
  const slug = slugifyPluginName((category ?? "").split("|").pop() ?? "");
  return slug && !SAYS_NOTHING.has(slug) ? slug : "";
}

/** The faces a library is missing; `have` makes it idempotent by REF — see docs/moduleNamespaces.md. */
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
