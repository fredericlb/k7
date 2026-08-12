// SurfaceTab.tsx — one surface, drawn. l8's half of `surfaces/`: it turns the declaration into
// the component that draws it and hands that component the engine, the decks and the mapping.
// The desk itself is @studio/ui-turntables. See packages/song/docs/surfaces.md.

import type { WebGraph } from "@studio/graph-model";
import { cfg } from "@studio/project-shell/fileApi";
import type { ProjectSurface } from "@studio/song/yaml/surfaceFile";
import { useDeckSet } from "@studio/ui-turntables/deck-set";
import type { Deck } from "@studio/ui-turntables/engine";
import { Turntables } from "@studio/ui-turntables/surface";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useRevision } from "../hooks/useRevision";

export function SurfaceTab({
  surface,
  deck,
  project,
}: {
  surface: ProjectSurface;
  deck: Deck;
  /** Workspace-relative, as every file route here takes it. */
  project: string;
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
    // `App` only resolves the `view` ones here. The arm exists so the switch covers the type and
    // says which of the two roads a kind takes, rather than falling off the end.
    case "timeline":
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Une surface « timeline » se dessine dans la vue, pas en plein écran.
        </div>
      );
  }
}
