// useGraphAt.ts — the compiled graph of ONE folder other than the open project's: an assembly
// template's or a library chain's, which is what its builder draws and lists params from.
// Dropped from the cache with its last reader: a builder reopened later reads the folder again.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { WebGraph } from "../types";

/** The folder's graph at one `key` of its writer's counter — the last one while the next is asked; null while closed or before the first. */
export function useGraphAt(
  folder: string | null,
  key: number,
): { graph: WebGraph | null; error: string | null } {
  const q = useQuery({
    queryKey: ["graphAt", folder, key],
    queryFn: () => api.graphAt(folder ?? ""),
    enabled: folder !== null,
    gcTime: 0,
    placeholderData: keepPreviousData,
  });
  if (folder === null) return { graph: null, error: null };
  return { graph: q.data ?? null, error: q.error ? q.error.message : null };
}
