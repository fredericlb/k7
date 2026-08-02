// chainsIcons.ts — the glyphs lanes hands the chains graph. One object, so the two shells
// that mount a graph pass the same thing and a third can't invent its own set.
//
// TrackIcon lives in the app because it is the APP's vocabulary: it draws the same lanes
// in the mixer and the timeline, so a chains package owning it would have those two
// importing one. ModuleIcon does NOT — it is keyed on WebModuleCategory, the graph's own
// vocabulary, and this file was its only consumer anywhere. platines arriving as a second
// host is what made that visible, so it moved into the graph package.

import type { ChainsIcons } from "@studio/ui-chains-react";
import { ModuleIcon, moduleGlyph } from "@studio/ui-chains-react/module-icons";
import { TrackIcon } from "./trackIcons";

export const LANES_ICONS: ChainsIcons = { ModuleIcon, moduleGlyph, TrackIcon };
