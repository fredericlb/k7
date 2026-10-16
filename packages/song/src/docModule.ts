// docModule.ts — `@meta/doc`, the module every note on the graph is a node of. It has
// no file anywhere: one doc module for the whole studio, so a note costs its node and
// nothing else. Full rationale: docs/docModules.md.

import {
  DOC_CATEGORY,
  DOC_REF,
  MODULE_TYPES,
} from "@studio/song-schema/moduleTypes";
import type { LoadedModule } from "./rawDoc";

/** The built-in as the ref map holds it, carrying no `content` of its own — see docs/docModules.md. */
function docModule(): LoadedModule {
  const meta = MODULE_TYPES[DOC_CATEGORY];
  return {
    kind: meta.kind,
    inputs: meta.inputs,
    outputs: meta.outputs,
    category: DOC_CATEGORY,
    file: "doc",
  };
}

/** The built-in refs this file owns; the LANES are the other set (trackModule.ts), seeded alongside. */
export const docModules = (): Record<string, LoadedModule> => ({
  [DOC_REF]: docModule(),
});

/** Is this resolved module a note? What every surface asks before drawing one. */
export const isDoc = (m: { kind?: unknown } | null | undefined): boolean =>
  m?.kind === "doc";
