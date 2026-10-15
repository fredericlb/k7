// useSurfaces.ts — the project's `surfaces/` folder, refetched on reloadKey and kept through a failed read. A surface is a
// special view the PROJECT asks for, so the shell cannot know its list until the project is
// open. See packages/song/docs/surfaces.md.

import type { ProjectSurface } from "@studio/song-schema/yaml/surfaceFile";
import { useMemo } from "react";
import { api } from "../api";
import { useDocument } from "./useDocument";

export interface SurfacesState {
  /** In filename order. Empty for almost every project — the folder is optional. */
  surfaces: ProjectSurface[];
  /** Files that would not parse. Reported beside the project's other diagnostics. */
  diagnostics: { file: string; message: string }[];
}

const NONE: SurfacesState = { surfaces: [], diagnostics: [] };

/** Read the project's surfaces — parsed by the FILE SERVICE; a failed read keeps the last list and retries, since an empty one unmounts four panes. */
export function useSurfaces(reloadKey: number): SurfacesState {
  // useDocument keeps the last answer through a failure and asks again on a backoff.
  const { doc } = useDocument(() => api.surfaces(), reloadKey);
  return useMemo(
    () =>
      doc
        ? {
            surfaces: doc.surfaces,
            diagnostics: doc.diagnostics.map((d) => ({
              file: d.file,
              message: d.message,
            })),
          }
        : NONE,
    [doc],
  );
}
