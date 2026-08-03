// Re-export the API contract so app code imports types from one place. Two packages
// now: the chains graph is shared with every app that draws one, the rest is pistes'.
export * from "@studio/graph-model";
export * from "@studio/web-protocol";

import type { RankedEngine as Ranked } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";

/** A probed engine carrying the registry's full record. The probe is generic over what an
 *  engine IS — it needs an id and some addresses — so pistes names its own flavour here. */
export type RankedEngine = Ranked<PublicEngine>;
