// ModulePreview.tsx — the médiathèque's glyphs over the SHARED preview
// (@studio/ui-chains-react/module-preview). The graph and the renderer moved out when l8
// wanted the same panel; what stays here is the one thing the two apps do not share, which is
// what a source node looks like. See ../../docs/modulePreview.md.

import type { ChainsIcons } from "@studio/ui-chains-react";
import { ModuleIcon, moduleGlyph } from "@studio/ui-chains-react/module-icons";
import { ModulePreview as SharedPreview } from "@studio/ui-chains-react/module-preview";
import type { ModuleUI } from "@studio/ui-module-builder/module-ui";

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

export function ModulePreview({
  name,
  path,
  ui,
  params,
  sourceInput,
  onPickSourceInput,
}: {
  name: string;
  path: string;
  ui: ModuleUI;
  params: Record<string, number>;
  /** What the `in` node is fed from, and how to change it — see engine/inputChannels.ts. */
  sourceInput?: string;
  onPickSourceInput?: (x: number, y: number) => void;
}) {
  return (
    <SharedPreview
      icons={MEDIATEK_ICONS}
      name={name}
      path={path}
      ui={ui}
      params={params}
      sourceInput={sourceInput}
      onPickSourceInput={onPickSourceInput}
      // The médiathèque has no command bar. Required by the package rather than defaulted,
      // which is the package saying out loud that a node's command menu does nothing here.
      command={(line) => {
        console.warn(`st0 has no command bar; ignored: ${line}`);
      }}
    />
  );
}
