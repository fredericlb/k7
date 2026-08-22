// chainsIcons.tsx — the glyphs st0 hands the chains graph. One object per KIND of project, so
// the shells that mount a graph pass the same thing and a third can't invent its own set.
//
// TrackIcon lives in the app because it is the APP's vocabulary: it draws the same lanes
// in the mixer and the timeline, so a chains package owning it would have those two
// importing one. ModuleIcon does NOT — it is keyed on WebModuleCategory, the graph's own
// vocabulary, and this file was its only consumer anywhere. m9 arriving as a second
// host is what made that visible, so it moved into the graph package.

import type { ChainsIcons } from "@studio/ui-chains-react";
import { ModuleIcon, moduleGlyph } from "@studio/ui-chains-react/module-icons";
import { PANE_META } from "./shellMeta";
import { TrackIcon } from "./trackIcons";

export const STUDIO_ICONS: ChainsIcons = { ModuleIcon, moduleGlyph, TrackIcon };

/**
 * The same glyphs, with a DECK where the lane icon goes — what a SET's graph gets.
 *
 * st0's `TrackIcon` reads a name PREFIX to decide between drums and vocals (`ge`, `vo`, …), a
 * convention a set does not have: `deckA` matches nothing, so every deck in a set's graph wore
 * the question mark that means "this lane declares no instrument". Which is true and useless —
 * a deck declares no instrument because it is not one.
 *
 * A whole icon SET rather than a flag on the lane, because that is the seam the graph package
 * already has (`icons`), and because the question is about the project rather than about the
 * node: in a set every lane is a deck. `@studio/ui-turntables` makes the same choice for its
 * own graph — see `M9_ICONS` there.
 *
 * The glyph is `PANE_META.turntables.icon` and not another record drawn by hand: it is the one
 * in the header, and the point is that the two are the SAME mark. A hand-rolled copy would be
 * the same picture until somebody changed one of them.
 */
const DeckIcon = PANE_META.turntables.icon;

export const DECK_ICONS: ChainsIcons = {
  ModuleIcon,
  moduleGlyph,
  // `name` and `video` are ignored deliberately — see above. Sized in `em` like every other
  // glyph here, so it lands at the size the node's own font decides.
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
