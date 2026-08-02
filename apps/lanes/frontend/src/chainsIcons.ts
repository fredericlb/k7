// chainsIcons.ts — the glyphs lanes hands the chains graph. One object, so the two shells
// that mount a graph pass the same thing and a third can't invent its own set.
//
// They live in the app rather than in the graph package because they are the APP's
// vocabulary: `TrackIcon` draws the same lanes in the mixer and the timeline, so a chains
// package owning it would have those two importing one.

import type { ChainsIcons } from "@studio/ui-chains-react";
import { ModuleIcon, moduleGlyph } from "./moduleIcons";
import { TrackIcon } from "./trackIcons";

export const LANES_ICONS: ChainsIcons = { ModuleIcon, moduleGlyph, TrackIcon };
