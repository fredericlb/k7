// useRehearsalData.ts — the four lists the pages draw, loaded on mount and reloaded whenever the
// recording provider says a session moved behind their back.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useRehearsalRecording } from "../recording/context";
import type { Moment, Page, Release, Session } from "../types";

export function useRehearsalData() {
  const { changed } = useRehearsalRecording();
  const [sessions, setSessions] = useState<Session[]>([]);
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
  // A session edit moves the standalone moments list too, so both refresh together.
  const refreshSessions = useCallback(
    () =>
      Promise.all([
        api.listSessions().then(setSessions),
        api.listMoments().then(setMoments),
      ]),
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `changed` is the trigger, not an input
  useEffect(() => {
    void refreshSessions();
  }, [changed, refreshSessions]);

  const allTags = [...new Set(moments.flatMap((x) => x.tags))].sort();

  return {
    sessions,
    releases,
    pages,
    moments,
    allTags,
    refreshSessions,
    refreshReleases,
    refreshPages,
  };
}
