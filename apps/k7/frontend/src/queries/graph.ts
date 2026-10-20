// graph.ts — the compiled chains graph as ONE cached read per reload key, shared by every pane
// and hook that draws or inspects it. A writing command's answer is put in the cache for the key
// its reload is about to move to, so that read is never made. See ../../docs/state.md.

import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";
import { api } from "../api";
import { retryDelay } from "../hooks/useDocument";
import { useShell } from "../state/shellStore";
import type { WebGraph } from "../types";

/** Which counter a key counts: a shell's reload key, a second device's, or the `/revision` token. */
export type GraphScope = string;

/** The scope of a read keyed by the `/revision` token rather than by a reload counter. */
export const REV_SCOPE: GraphScope = "rev";

export const graphKey = (scope: GraphScope, key: number | string) =>
  ["graph", scope, key] as const;

/** A reload-keyed read retries on a backoff while it fails, as a document read always has; a `/revision`-keyed one does not. */
export function graphQuery(scope: GraphScope, key: number | string) {
  const retries = scope !== REV_SCOPE;
  return queryOptions({
    queryKey: graphKey(scope, key),
    queryFn: () => api.graph(),
    retry: retries,
    retryDelay,
  });
}

/** Hand a command's graph to the cache, as the answer for `key` — what a reload to that key then reads. */
export function seedGraph(
  client: QueryClient,
  scope: GraphScope,
  key: number,
  graph: WebGraph,
): void {
  client.setQueryData(graphKey(scope, key), graph);
}

export interface GraphRead {
  /** The graph at the key, or the last one while the key's own is asked; null before the first. */
  graph: WebGraph | null;
  /** Why the latest ask failed, kept visible while the retries run. */
  error: string | null;
  /** No graph yet and no failure yet: the first ask is in flight. */
  loading: boolean;
}

/** The graph at one key of one scope; `enabled: false` reads the cache without asking. */
export function useGraph(
  scope: GraphScope,
  key: number | string | null,
  enabled = true,
): GraphRead {
  const q = useQuery({
    ...graphQuery(scope, key ?? 0),
    enabled: enabled && key !== null,
    placeholderData: keepPreviousData,
  });
  const failure = q.failureReason ?? q.error;
  return {
    graph: q.data ?? null,
    error: failure ? failure.message : null,
    loading: q.data === undefined && !failure,
  };
}

/** The same, at a key of the host's own reload counter — the scope a pane is mounted under (state/shellStore.ts). */
export function usePaneGraph(key: number, enabled = true): GraphRead {
  return useGraph(
    useShell((s) => s.scope),
    key,
    enabled,
  );
}
