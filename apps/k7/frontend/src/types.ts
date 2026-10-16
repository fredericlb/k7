// Re-export the API contract so app code imports types from one place. Two packages:
// the chains graph is shared with every app that draws one, the rest is k7's.
export * from "@studio/graph-model";
export * from "@studio/web-protocol";

import type { RankedEngine as Ranked } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";

/** A probed engine carrying the registry's full record — the probe is generic over what an engine IS, so k7 names its own flavour. */
export type RankedEngine = Ranked<PublicEngine>;
