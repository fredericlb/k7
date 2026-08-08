// chains.tsx — the deck's signal path, drawn. Thin on purpose: the graph package owns the
// 2000 lines, and this is the ~60 of glue the plan said each host would write for itself.
// See docs/chains.md.

import { buildGraph, layout } from "@studio/ui-chains/graph";
import type { Cam, ChainsIcons } from "@studio/ui-chains-react";
import { DomChains } from "@studio/ui-chains-react";
import { ModuleIcon, moduleGlyph } from "@studio/ui-chains-react/module-icons";
import { useMemo, useRef, useState } from "react";
import { DECKS, type DeckId } from "./deck";
import { type DeckModule, deckGraph } from "./graph";

/**
 * m9's glyphs.
 *
 * `ModuleIcon` comes from the graph package — it is keyed on `WebModuleCategory`, the
 * graph's own vocabulary, and moving it there is what a second host made obvious. The track
 * one is m9's: a deck is not a lane, and l8' `TrackIcon` reads a name PREFIX to
 * decide between drums and vocals, which is a convention m9 does not have.
 */
export const M9_ICONS: ChainsIcons = {
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

/**
 * One deck's effect chain, drawn.
 *
 * **Nothing mounts this today.** The reworked Mix view is two records and a crossfader, and
 * the per-deck effect chain has no place on it yet — see docs/mix.md, and the entry in
 * docs/inventaire.md so this is a known state and not rot. It is kept, rather than deleted,
 * because it works, it is tested, and the chain is one of the options coming back; the deck
 * it draws is a prop now, which is what it was missing when there was only one.
 */
export function ChainsPanel({
  song,
  modules,
  onBypass,
  deck = DECKS[0],
}: {
  song: string | null;
  modules: DeckModule[];
  onBypass: (module: string) => void;
  deck?: DeckId;
}) {
  const [selected, setSelected] = useState<string | null>(deck);
  // The camera lives OUTSIDE the graph, because the graph unmounts with its panel and a
  // camera that reset on every remount would fight the person using it.
  const cam = useRef<Cam | null>(null);

  const laid = useMemo(() => {
    const { nodes, edges } = buildGraph(deckGraph(song, modules, deck));
    return layout(nodes, edges);
  }, [song, modules, deck]);

  return (
    <DomChains
      icons={M9_ICONS}
      graph={laid}
      selected={selected}
      onSelect={setSelected}
      camStore={cam}
      // Re-frame when the SHAPE changes, not on every redraw: adding a module should fit
      // the new picture, moving a knob should leave the camera where it was put.
      fitKey={`${modules.length}`}
      onBypassModule={onBypass}
      // m9 has no command bar. The prop is required because l8' graph is driven by
      // one and the package will not pretend otherwise — so this says out loud that a node's
      // command menu does nothing here, rather than silently swallowing it.
      command={(line) => {
        console.warn(`m9 has no command bar; ignored: ${line}`);
      }}
    />
  );
}
