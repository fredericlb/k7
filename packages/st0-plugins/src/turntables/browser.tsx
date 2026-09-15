// browser.tsx — the desk's drawer, moved here from the shell's SurfaceTab when turntables
// became a plugin. It takes the three things a ring slot has (surface, deck, project) plus the
// two the shell injects (the library base, the revision token), fetches its own graph, and
// draws @studio/ui-turntables. It imports NO shell code — the deps below are all packages.

import type { WebGraph } from "@studio/graph-model";
import { cfg } from "@studio/project-shell/fileApi";
import { projectApi } from "@studio/project-shell/project";
import type { ProjectSurface } from "@studio/song-schema/yaml/surfaceFile";
import { useDeckSet } from "@studio/ui-turntables/deck-set";
import type { Deck } from "@studio/ui-turntables/engine";
import { Turntables } from "@studio/ui-turntables/surface";
import { useEffect, useMemo, useState } from "react";

/** The props the drawer takes — a structural SUBSET of both mounts' ctx (the ring slot's and a
 *  device's), which is what makes one drawer legal in both (packages/st0-plugins/docs/plugins.md). */
export interface TurntablesPaneProps {
  surface: ProjectSurface;
  deck: Deck;
  /** Workspace-relative, as every file route takes it. */
  project: string;
  /** Where the LIBRARY answers — pl8 holds the master (apps/pl8/docs/stems.md). */
  libraryBase: string;
  /** The project's change token; the graph is refetched whenever it moves. */
  rev: string | null;
}

export function TurntablesPane(props: TurntablesPaneProps) {
  const { surface, deck, project, libraryBase, rev } = props;
  // The compiled chains, fetched here rather than taken from the shell — `App`'s `seedGraph` is a command's answer, not the current graph.
  const [graph, setGraph] = useState<WebGraph | null>(null);
  useEffect(() => {
    if (rev === null) return;
    let alive = true;
    projectApi
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
  const library = useMemo(() => ({ base: libraryBase }), [libraryBase]);

  /** The playlist the declaration names — a plain string off the surface, so it needs no memo of its own. */
  const playlist = surface.surface.playlist;

  /** …and the chain that SEPARATES a record, read by nothing here — see MixView's `stems`. */
  const stems = surface.surface.stems;

  const set = useDeckSet(deck, project, graph, rev ?? "", mapping, playlist);

  // No `open` branch and no chrome of its own: the pane wrapper in `App` carries the border, the ring and the `hidden`.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
    </div>
  );
}
