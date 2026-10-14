// chainsIcons.tsx — the glyphs k7 hands the chains graph. One object per KIND of project, so
// the shells that mount a graph pass the same thing and a third can't invent its own set.
//
// TrackIcon lives in the app because it is the APP's vocabulary: it draws the same lanes
// in the mixer and the timeline, so a chains package owning it would have those two
// importing one. ModuleIcon does NOT — it is keyed on WebModuleCategory, the graph's own
// vocabulary, so it belongs to the graph package and every host gets it from there.

import { trackLabel } from "@studio/song-schema/trackKind";
import type { ChainsIcons } from "@studio/ui-chains-react";
import { ModuleIcon, moduleGlyph } from "@studio/ui-chains-react/module-icons";
import { PANE_META } from "./shellMeta";
import { TrackIcon } from "./trackIcons";

// `trackLabel` travels with the glyph, being the SAME table: the prefix the icon is picked from is the one the name drops.
export const STUDIO_ICONS: ChainsIcons = {
  ModuleIcon,
  moduleGlyph,
  TrackIcon,
  trackLabel,
};

/** The same glyphs with a DECK where the lane icon goes — a whole icon SET, since in a set every lane is a deck, and the glyph is the header's own. */
const DeckIcon = PANE_META.turntables.icon;

export const DECK_ICONS: ChainsIcons = {
  ModuleIcon,
  moduleGlyph,
  // The NAME still drops its code even where the glyph ignores it: a deck's strip reads by its lane, not by `dk.`.
  trackLabel,
  // `name` and `video` are ignored deliberately — see above; sized in `em`, so it lands at the size the node's own font decides.
  TrackIcon: ({ className, style }) => (
    <DeckIcon
      className={className}
      style={style}
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
    />
  ),
};
