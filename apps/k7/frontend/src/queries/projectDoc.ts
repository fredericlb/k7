// projectDoc.ts — the compiled project document as ONE cached read per reload key: the shell's
// slice of it, the timeline, the minimap and the clip editors all draw the same answer, asked
// once. Scoped like the graph (graph.ts), by the counter the key counts. The one thing a reader
// would get wrong: each key is a new query, so the fresh answer is shared deep with the previous
// key's, and an unchanged track or clip keeps its identity and its memos (docs/state.md).

import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  replaceEqualDeep,
  useQuery,
} from "@tanstack/react-query";
import { useRef } from "react";
import { api } from "../api";
import { retryDelay } from "../hooks/useDocument";
import { isAnswer } from "../readFailure";
import { useShell } from "../state/shellStore";
import type { WebProject } from "../types";

export function projectDocQuery(scope: string, key: number) {
  return queryOptions({
    queryKey: ["projectDoc", scope, key],
    queryFn: async ({ client }) =>
      sharedWithPrevious(client, scope, key, await api.projectDoc()),
    // Re-asked on a backoff while it fails for a blip; "does not compile" is an answer, re-asked when the files move.
    retry: (_n, e) => !isAnswer(e),
    retryDelay,
  });
}

/** `fresh`, with every part equal to the latest earlier key's answer replaced by that part itself. */
export function sharedWithPrevious(
  client: QueryClient,
  scope: string,
  key: number,
  fresh: WebProject,
): WebProject {
  let prev: WebProject | undefined;
  let prevKey = Number.NEGATIVE_INFINITY;
  for (const [k, data] of client.getQueriesData<WebProject>({
    queryKey: ["projectDoc", scope],
  })) {
    const at = Number(k[2]);
    if (data && at < key && at > prevKey) {
      prev = data;
      prevKey = at;
    }
  }
  if (!prev) return fresh;
  const shared = replaceEqualDeep(prev, fresh);
  // A new root even when nothing changed: an answer landing is itself news to whoever waits on one.
  return shared === prev ? { ...prev } : shared;
}

export interface ProjectDocRead {
  /** The document at the key, or the last one while the key's own is asked; null before the first. */
  doc: WebProject | null;
  /** Why the latest ask failed, kept while the retries run — `status` and all, for readFailure.ts. */
  failure: Error | null;
}

export function useProjectDocQuery(scope: string, key: number): ProjectDocRead {
  const q = useQuery({
    ...projectDocQuery(scope, key),
    placeholderData: keepPreviousData,
  });
  // A key that settles on an error drops its placeholder: the last document stays drawn, as it did while retrying.
  const last = useRef<WebProject | null>(null);
  if (q.data) last.current = q.data;
  return {
    doc: q.data ?? last.current,
    failure: q.failureReason ?? q.error ?? null,
  };
}

/** The same, at a key of the host's own reload counter. */
export function usePaneProjectDoc(key: number): ProjectDocRead {
  return useProjectDocQuery(
    useShell((s) => s.scope),
    key,
  );
}
