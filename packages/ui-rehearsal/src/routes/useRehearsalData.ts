// useRehearsalData.ts — the lists the pages draw: the releases and pages, and the moments whose tags a
// moment's editor offers, reloaded whenever the recording provider says a take moved behind their back.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useRehearsalRecording } from "../recording/context";
import type { Moment, Page, Release } from "../types";

export function useRehearsalData() {
  const { changed } = useRehearsalRecording();
  const [releases, setReleases] = useState<Release[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);

  // Releases and pages live on the server alone: loaded by a ServerOnly that found it, never on mount (an unpaired machine answers 503).
  const refreshReleases = useCallback(
    () =>
      api
        .listReleases()
        .then(setReleases)
        .catch(() => setReleases([])),
    [],
  );
  const refreshPages = useCallback(
    () =>
      api
        .listPages()
        .then(setPages)
        .catch(() => setPages([])),
    [],
  );
  const refreshMoments = useCallback(
    () =>
      api
        .listMoments()
        .then(setMoments)
        .catch(() => {}),
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `changed` is the trigger, not an input
  useEffect(() => {
    void refreshMoments();
  }, [changed, refreshMoments]);

  const allTags = [...new Set(moments.flatMap((x) => x.tags))].sort();

  return {
    releases,
    pages,
    moments,
    allTags,
    refreshMoments,
    refreshReleases,
    refreshPages,
  };
}
