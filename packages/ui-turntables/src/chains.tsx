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

/** m9's glyphs — only `TrackIcon` is its own, because a deck is not a lane and reads no name prefix. */
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

/** One deck's effect chain, drawn — NOTHING MOUNTS THIS TODAY, a known state: see docs/mix.md. */
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
  // The camera lives OUTSIDE the graph, which unmounts with its panel and would reset it.
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
      // Re-frame when the SHAPE changes, not on every redraw: a knob must not move the camera.
      fitKey={`${modules.length}`}
      onBypassModule={onBypass}
      // m9 has no command bar, and the prop is required — so this says so out loud rather than swallowing it.
      command={(line) => {
        console.warn(`m9 has no command bar; ignored: ${line}`);
      }}
    />
  );
}
