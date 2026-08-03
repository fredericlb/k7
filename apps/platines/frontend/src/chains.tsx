// chains.tsx — the deck's signal path, drawn. Thin on purpose: the graph package owns the
// 2000 lines, and this is the ~60 of glue the plan said each host would write for itself.
// See docs/chains.md.

import { buildGraph, layout } from "@studio/ui-chains/graph";
import type { ChainsIcons } from "@studio/ui-chains-react";
import { DomChains } from "@studio/ui-chains-react";
import { ModuleIcon, moduleGlyph } from "@studio/ui-chains-react/module-icons";
import { useMemo, useRef, useState } from "react";
import { DECK } from "./deck";
import { type DeckModule, deckGraph } from "./graph";

/**
 * platines' glyphs.
 *
 * `ModuleIcon` comes from the graph package — it is keyed on `WebModuleCategory`, the
 * graph's own vocabulary, and moving it there is what a second host made obvious. The track
 * one is platines': a deck is not a lane, and lanes' `TrackIcon` reads a name PREFIX to
 * decide between drums and vocals, which is a convention platines does not have.
 */
const PLATINES_ICONS: ChainsIcons = {
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
      <title>platine</title>
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </svg>
  ),
};

export function ChainsPanel({
  song,
  modules,
  onBypass,
}: {
  song: string | null;
  modules: DeckModule[];
  onBypass: (module: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(DECK);
  // The camera lives OUTSIDE the graph, because the graph unmounts with its panel and a
  // camera that reset on every remount would fight the person using it.
  const cam = useRef<{ x: number; y: number; k: number } | null>(null);

  const laid = useMemo(() => {
    const { nodes, edges } = buildGraph(deckGraph(song, modules));
    return layout(nodes, edges);
  }, [song, modules]);

  return (
    <DomChains
      icons={PLATINES_ICONS}
      graph={laid}
      selected={selected}
      onSelect={setSelected}
      camStore={cam}
      // Re-frame when the SHAPE changes, not on every redraw: adding a module should fit
      // the new picture, moving a knob should leave the camera where it was put.
      fitKey={`${modules.length}`}
      onBypassModule={onBypass}
      // platines has no command bar. The prop is required because lanes' graph is driven by
      // one and the package will not pretend otherwise — so this says out loud that a node's
      // command menu does nothing here, rather than silently swallowing it.
      command={(line) => {
        console.warn(`platines has no command bar; ignored: ${line}`);
      }}
    />
  );
}
