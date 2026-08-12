// SurfaceTab.tsx — one surface: its DOCUMENT, always; its SCREEN, only while open. l8's half of
// `surfaces/`. It turns the declaration into the component that draws it and hands that
// component the engine, the decks and the mapping. The desk itself is @studio/ui-turntables.
//
// The split between the two halves is the load-bearing part and it is m9's, arrived at the hard
// way: see the header on `open` below, and packages/song/docs/surfaces.md.

import { Button } from "@frediverse/ui/button";
import type { WebGraph } from "@studio/graph-model";
import { cfg } from "@studio/project-shell/fileApi";
import type { ProjectSurface } from "@studio/song/yaml/surfaceFile";
import { useDeckSet } from "@studio/ui-turntables/deck-set";
import type { Deck } from "@studio/ui-turntables/engine";
import { Turntables } from "@studio/ui-turntables/surface";
import { Disc3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useRevision } from "../hooks/useRevision";

export function SurfaceTab({
  surface,
  deck,
  project,
  open,
  onClose,
}: {
  surface: ProjectSurface;
  deck: Deck;
  /** Workspace-relative, as every file route here takes it. */
  project: string;
  /**
   * Whether its screen is showing. The component is MOUNTED either way.
   *
   * That is the whole point of this prop, and it is a bug m9 shipped before l8 did. A desk's
   * document — what is loaded, where the crossfader is, what each deck plays at — is not the
   * screen's, and a set does not stop existing when you go and look at the graph. While the
   * hooks below lived behind `openSurface &&`, a trip to the chains view re-centred the
   * crossfader and flattened the EQ while the SOUND stayed where you put it, and the graph had
   * no engine to ask so its knobs showed the number the file declares.
   *
   * So: the document is mounted for as long as the project declares the surface, and only the
   * drawing is conditional. See packages/ui-turntables/docs/deckSet.md.
   */
  open: boolean;
  onClose: () => void;
}) {
  /**
   * The compiled chains, fetched here rather than taken from the shell.
   *
   * `App` holds a `seedGraph` — the graph a writing COMMAND handed back, carrying an id so a
   * consumer takes it once — which is a different thing from "the project's current graph" and
   * is null most of the time. `ChainsTab` fetches its own for the same reason; this is the same
   * call, on the same token.
   */
  const rev = useRevision();
  const [graph, setGraph] = useState<WebGraph | null>(null);
  useEffect(() => {
    if (rev === null) return;
    let alive = true;
    api
      .graph()
      .then((g) => alive && setGraph(g))
      // A project that will not compile still has a desk worth drawing: the bindings resolve to
      // nothing and say so, which is the screen you fix it from.
      .catch(() => alive && setGraph(null));
    return () => {
      alive = false;
    };
  }, [rev]);

  /**
   * The mapping, held stable across renders.
   *
   * `useDeckSet` takes it as an effect dependency, so a fresh object each render would refetch
   * the compiled document on every render. It comes off the surface, which comes off state in
   * `useSurfaces` — stable already — and this pins that rather than relying on it.
   */
  const mapping = useMemo(
    () => surface.surface.mapping,
    [surface.surface.mapping],
  );

  /**
   * Where the chosen machine's file service is — the only thing the desk wants from an engine
   * beyond the link itself, and the only way to the médiathèque's cache on that disk.
   *
   * Read from the transport the gate configured rather than threaded down from `App`: `cfg()`
   * is the same source every other file call here uses, and a second copy of the base is a
   * second thing to keep pointed at the same machine.
   */
  const engine = useMemo(() => ({ fileBase: cfg().base }), []);

  const set = useDeckSet(deck, project, graph, rev ?? "", mapping);

  // Everything above this line runs whether or not the screen is showing; everything below it
  // is the screen. Nothing may be added above that belongs to the drawing, and nothing below
  // that the set would lose.
  if (!open) return null;

  return (
    // Over the layout, the same treatment the help page gets and for the same reason: it is a
    // screen of its own, not a pane, and what is underneath is untouched — the timeline keeps
    // its caret and the graph its camera while a desk is up.
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <Disc3 className="h-4 w-4 text-muted-foreground" />
        <span className="truncate text-sm">{surface.id}</span>
        <Button
          size="xs"
          variant="secondary"
          className="ml-auto"
          onClick={onClose}
        >
          Fermer
        </Button>
      </div>
      {drawn(surface, engine, deck, set, mapping)}
    </div>
  );
}

/** Which component draws this type. Split out so the mount above reads as one thing. */
function drawn(
  surface: ProjectSurface,
  engine: { fileBase: string },
  deck: Deck,
  set: ReturnType<typeof useDeckSet>,
  mapping: ProjectSurface["surface"]["mapping"],
) {
  switch (surface.surface.type) {
    case "turntables":
      return (
        <Turntables
          engine={engine}
          deck={deck}
          set={set}
          mapping={mapping}
          file={surface.file}
        />
      );
    // A `split` surface is drawn in the LAYOUT, by the shell, and never reaches this screen —
    // `App` only resolves the `view` ones here. The arms exist so the switch covers every type
    // and says which of the two roads a kind takes, rather than falling off the end.
    case "timeline":
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Une surface « timeline » se dessine dans la vue, pas en plein écran.
        </div>
      );
    case "viewport":
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Une surface « viewport » se dessine dans la vue, pas en plein écran.
        </div>
      );
  }
}
