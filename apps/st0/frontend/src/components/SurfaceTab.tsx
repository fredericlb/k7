// SurfaceTab.tsx — one `split` surface, drawn in the pane the shell gives it: st0's half of
// `surfaces/`. It turns the declaration into a component and hands it the engine, the decks and
// the mapping. The desk itself is @studio/ui-turntables.
//
// It used to also mount the DOCUMENT while the screen was closed, behind an `open` prop, because
// the desk was a `view` that came and went. A pane is mounted once and hidden with CSS, so the
// shell's invariant now covers what that prop protected.
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
  const engine = useMemo(
    () => ({ fileBase: cfg().base, id: cfg().engineId }),
    [],
  );

  /**
   * …and where the LIBRARY answers, which is a different service and a different credential.
   *
   * The desk asks pl8 to separate a record, because pl8 holds the master — the file service used
   * to, out of a médiathèque cache that no longer exists (apps/pl8/docs/stems.md). Same-origin
   * under `/pl8` from here, so the session cookie carries it.
   */
  const library = useMemo(() => ({ base: PL8_API }), []);

  /** The playlist the declaration names — a plain string off the surface, so it needs no
   *  memo of its own; `useDeckSet` takes it as an effect dependency. */
  const playlist = surface.surface.playlist;

  /** …and the chain that SEPARATES a record, which the desk uses to catch up on one put on
   *  unprepared. A plain string too, and read by nothing here — see MixView's `stems`. */
  const stems = surface.surface.stems;

  const set = useDeckSet(deck, project, graph, rev ?? "", mapping, playlist);

  // No `open` branch and no chrome of its own: the pane wrapper in `App` carries the border, the
  // ring and the `hidden` that takes it off screen, exactly as it does for the arrangement and
  // the frame. A header here would be a second title bar inside a pane that already has one.
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
    // The other three `split` surfaces are drawn by the SHELL, in their own panes — the timeline
    // is `TimelineTab`, the frame `ViewportTab` and the master strip `MasteringTab`. The first
    // two need far more of `App` than a surface declaration; the third needs the ENGINE LINK,
    // which this component has not got and should not grow. Only the desk comes through here.
    // The arms exist so the switch covers every type and says which road a kind takes, rather
    // than falling off the end.
    //
    // Note the wording: drawn by the shell, not undrawable anywhere else. `ExternalSurface` mounts
    // all four on a second device, giving each what the shell gives it — which is why that
    // component holds the mirror image of this switch. See ../docs/external.md.
    case "timeline":
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Une surface « timeline » est dessinée par le shell, pas ici.
        </div>
      );
    case "viewport":
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Une surface « viewport » est dessinée par le shell, pas ici.
        </div>
      );
    case "mastering":
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Une surface « mastering » est dessinée par le shell, pas ici.
        </div>
      );
  }
}
