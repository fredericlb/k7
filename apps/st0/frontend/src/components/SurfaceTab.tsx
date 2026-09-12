// SurfaceTab.tsx — one `split` surface, drawn in the pane the shell gives it: st0's half of
// `surfaces/`. It turns the declaration into a component and hands it the engine, the decks and
// the mapping. The desk itself is @studio/ui-turntables.
//
// It needs no `open` prop to keep the DOCUMENT alive while the screen is hidden: a pane is
// mounted once and hidden with CSS, and that shell invariant covers it.
//
// See packages/song/docs/surfaces.md and packages/ui-turntables/docs/deckSet.md.

import type { WebGraph } from "@studio/graph-model";
import { cfg } from "@studio/project-shell/fileApi";
import type { ProjectSurface } from "@studio/song-schema/yaml/surfaceFile";
import { useDeckSet } from "@studio/ui-turntables/deck-set";
import type { Deck } from "@studio/ui-turntables/engine";
import { Turntables } from "@studio/ui-turntables/surface";
import { useEffect, useMemo, useState } from "react";
import { api, PL8_API } from "../api";
import { useRevision } from "../hooks/useRevision";
import { m } from "../paraglide/messages.js";

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
  /** The compiled chains, fetched here rather than taken from the shell — `App`'s `seedGraph` is a command's answer, not the current graph. */
  const rev = useRevision();
  const [graph, setGraph] = useState<WebGraph | null>(null);
  useEffect(() => {
    if (rev === null) return;
    let alive = true;
    api
      .graph()
      .then((g) => alive && setGraph(g))
      // A project that will not compile still has a desk worth drawing: the bindings say so, and it is the screen you fix it from.
      .catch(() => alive && setGraph(null));
    return () => {
      alive = false;
    };
  }, [rev]);

  /** The mapping, held stable across renders: `useDeckSet` takes it as an effect dependency. */
  const mapping = useMemo(
    () => surface.surface.mapping,
    [surface.surface.mapping],
  );

  /** Where the chosen machine's file service is — read from the transport the gate configured, a second copy being a second thing to keep pointed. */
  const engine = useMemo(
    () => ({ fileBase: cfg().base, id: cfg().engineId }),
    [],
  );

  /** …and where the LIBRARY answers, a different service and a different credential: pl8 holds the master (apps/pl8/docs/stems.md). */
  const library = useMemo(() => ({ base: PL8_API }), []);

  /** The playlist the declaration names — a plain string off the surface, so it needs no memo of its own. */
  const playlist = surface.surface.playlist;

  /** …and the chain that SEPARATES a record, read by nothing here — see MixView's `stems`. */
  const stems = surface.surface.stems;

  const set = useDeckSet(deck, project, graph, rev ?? "", mapping, playlist);

  // No `open` branch and no chrome of its own: the pane wrapper in `App` carries the border, the ring and the `hidden`.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {drawn(surface, engine, library, deck, set, mapping, playlist, stems)}
    </div>
  );
}

/** Which component draws this type. Split out so the mount above reads as one thing. */
function drawn(
  surface: ProjectSurface,
  engine: { fileBase: string; id: string },
  library: { base: string },
  deck: Deck,
  set: ReturnType<typeof useDeckSet>,
  mapping: ProjectSurface["surface"]["mapping"],
  playlist: ProjectSurface["surface"]["playlist"],
  stems: ProjectSurface["surface"]["stems"],
) {
  switch (surface.surface.type) {
    case "turntables":
      return (
        <Turntables
          engine={engine}
          library={library}
          deck={deck}
          set={set}
          mapping={mapping}
          playlist={playlist}
          stems={stems}
          file={surface.file}
        />
      );
    // The other three `split` surfaces are drawn by the SHELL, in their own panes; the arms exist so the switch covers every type (../docs/external.md).
    case "timeline":
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {m["srf.timelineElsewhere"]()}
        </div>
      );
    case "viewport":
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {m["srf.viewportElsewhere"]()}
        </div>
      );
    case "mastering":
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {m["srf.masteringElsewhere"]()}
        </div>
      );
  }
}
