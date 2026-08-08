// moduleIcons.tsx — the médiathèque's glyphs for the shared chains view. Its own file since the
// module preview that used to hold them left for l8; `ChainView` draws with them too.

import type { ChainsIcons } from "@studio/ui-chains-react";
import { ModuleIcon, moduleGlyph } from "@studio/ui-chains-react/module-icons";

/**
 * The médiathèque's glyphs.
 *
 * `ModuleIcon` is the graph package's own — it is keyed on `WebModuleCategory`, the graph's
 * vocabulary, not any app's. The source one is ours: l8' `TrackIcon` reads a name PREFIX
 * to choose between drums and vocals, a convention that means nothing to a single module
 * standing on its own.
 */
export const MEDIATEK_ICONS: ChainsIcons = {
  ModuleIcon,
  moduleGlyph,
  TrackIcon: ({ className, style }) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      style={style}
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
    >
      <title>entrée</title>
      <path
        d="M2 8h9M8 5l3 3-3 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  ),
};
