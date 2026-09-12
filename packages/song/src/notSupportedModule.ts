// notSupportedModule.ts — `@studio/not-supported`, what a node stands on when the plugin it was
// is one st0 cannot load. It has no file anywhere: one placeholder for the whole studio, so an
// import writes a node and no module of its own. Full rationale: docs/notSupported.md.

import {
  NOT_SUPPORTED_CATEGORY,
  NOT_SUPPORTED_REF,
  NOT_SUPPORTED_TYPE,
} from "@studio/song-schema/moduleTypes";
import type { LoadedModule } from "./rawDoc";

export {
  isNotSupportedRef,
  NOT_SUPPORTED_CATEGORY,
  NOT_SUPPORTED_REF,
} from "@studio/song-schema/moduleTypes";

/** The built-in as the ref map holds it — see docs/notSupported.md for every field's reason. */
export function notSupportedModule(): LoadedModule {
  return {
    kind: "plugin",
    // Unconstrained on purpose: it stands where a plugin was, and nothing knows what that plugin took.
    inputs: [],
    outputs: [{ name: "out", type: "audio" }],
    category: NOT_SUPPORTED_CATEGORY,
    file: "not-supported",
    // The marker the graph reads to draw the node amber — packages/file-service/docs/graphFlags.md.
    plugin: { type: NOT_SUPPORTED_TYPE },
  };
}

/** The built-in ref this file owns, seeded beside the doc module and the lanes. */
export const notSupportedRefs = (): Record<string, LoadedModule> => ({
  [NOT_SUPPORTED_REF]: notSupportedModule(),
});
