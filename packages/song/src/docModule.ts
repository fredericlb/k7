// docModule.ts — `@studio/doc`, the module every note on the graph is an instance of. It has
// no file anywhere: one doc module for the whole studio, so a note costs its instance and
// nothing else. Full rationale: docs/docModules.md.

import { DOC_CATEGORY, DOC_REF, MODULE_TYPES } from "./moduleTypes";
import type { LoadedModule } from "./rawDoc";

export { DOC_CATEGORY, DOC_REF } from "./moduleTypes";

/**
 * The built-in, as the ref map holds it.
 *
 * Shaped exactly like the io modules `engineCatalogue` synthesises — `kind`, `inputs`,
 * `category` and a `file` — because a module with no folder still has to answer the same
 * questions as one with a folder. It carries no `content` of its own: the empty note is not a
 * thing anybody wants, and an instance that forgets its text should read as empty rather than
 * inherit somebody else's sentence.
 */
export function docModule(): LoadedModule {
  const meta = MODULE_TYPES[DOC_CATEGORY];
  return {
    kind: meta.kind,
    inputs: meta.inputs,
    outputs: meta.outputs,
    category: DOC_CATEGORY,
    file: "doc",
  };
}

/** The built-in refs, for the ref map to start from. One so far. */
export const studioModules = (): Record<string, LoadedModule> => ({
  [DOC_REF]: docModule(),
});

/** Is this resolved module a note? What every surface asks before drawing one. */
export const isDoc = (m: { kind?: unknown } | null | undefined): boolean =>
  m?.kind === "doc";
