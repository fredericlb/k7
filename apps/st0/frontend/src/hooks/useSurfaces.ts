// useSurfaces.ts — the project's `surfaces/` folder, refetched on reloadKey. A surface is a
// special view the PROJECT asks for, so the shell cannot know its list until the project is
// open. See packages/song/docs/surfaces.md.

import type { ProjectSurface } from "@studio/song/yaml/surfaceFile";
import { useEffect, useState } from "react";
import { api } from "../api";

export interface SurfacesState {
  /** In filename order. Empty for almost every project — the folder is optional. */
  surfaces: ProjectSurface[];
  /** Files that would not parse. Reported beside the project's other diagnostics. */
  diagnostics: { file: string; message: string }[];
}

const NONE: SurfacesState = { surfaces: [], diagnostics: [] };

/**
 * Read the project's surfaces.
 *
 * Parsed by the FILE SERVICE and not here. A surface decides what the shell DRAWS, so its
 * validity is the project's business and belongs with the project's other diagnostics; two
 * parsers would be two answers to "is this surface valid". (A desk's bindings used to be read
 * in the browser instead, out of a `views/mix.yaml` only the desk wanted; they are this file's
 * `mapping:` now, and take this road with everything else.)
 *
 * A failure is not fatal and not reported here either: a file service that cannot answer
 * `/surfaces` has bigger problems, all of which the shell is already showing, and a project
 * with no surfaces is indistinguishable from one whose list did not arrive — which is exactly
 * why this returns the empty list for both rather than inventing an error card for the second.
 */
export function useSurfaces(reloadKey: number): SurfacesState {
  const [state, setState] = useState<SurfacesState>(NONE);

  useEffect(() => {
    let alive = true;
    api
      .surfaces()
      .then((s) => {
        if (!alive) return;
        setState({
          surfaces: s.surfaces,
          diagnostics: s.diagnostics.map((d) => ({
            file: d.file,
            message: d.message,
          })),
        });
      })
      .catch(() => {
        if (alive) setState(NONE);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return state;
}
