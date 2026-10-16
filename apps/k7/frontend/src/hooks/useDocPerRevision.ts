// useDocPerRevision.ts — the compiled project, fetched once per change token instead of once per
// effect run: the document moves when a file is WRITTEN, never while one is typed (../../docs/audit.md).
// The one thing a reader would get wrong: a failed fetch is dropped at once, so the next caller asks again.

import { useCallback, useState } from "react";
import { api } from "../api";
import { useRevision } from "./useRevision";

/** A getter that hands back the same promise for the same token, and asks afresh on a new one. */
export function docPerRevision<T>(
  fetchDoc: () => Promise<T>,
): (rev: string | null) => Promise<T> {
  let held: { rev: string | null; doc: Promise<T> } | null = null;
  return (rev) => {
    if (held && held.rev === rev) return held.doc;
    const mine = { rev, doc: fetchDoc() };
    held = mine;
    mine.doc.catch(() => {
      if (held === mine) held = null;
    });
    return mine.doc;
  };
}

/** `api.projectDoc`, shared per change token; the callback's identity moves with the token, so an effect on it re-runs once per write. */
export function useDocPerRevision(): () => ReturnType<typeof api.projectDoc> {
  const rev = useRevision();
  const [get] = useState(() => docPerRevision(() => api.projectDoc()));
  return useCallback(() => get(rev), [get, rev]);
}
