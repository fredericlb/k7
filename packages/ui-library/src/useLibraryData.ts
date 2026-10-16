// useLibraryData.ts — what the catalogue screen shows of the volume: the counts, the open section's
// listing (or the capture zone's days), and the one poll that reloads a section only when ITS token
// moved, which is the whole reason the service hands out one per section (../docs/library.md).
// The one thing a reader would get wrong: `refresh` reloads nothing itself — it forgets the token, and the next tick does.

import type { RecordingDay } from "@studio/mediatek/recordings";
import {
  type MediatekEntry,
  type PLAYLISTS_DIR,
  RECORDINGS_DIR,
} from "@studio/mediatek/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { library } from "./api";
import { poll } from "./poll";
import type { SectionId } from "./routes";

/** The ones that ARE families, by subtraction — a section missing here becomes one silently (../docs/library.md). */
type FamilyId = Exclude<
  SectionId,
  typeof RECORDINGS_DIR | typeof PLAYLISTS_DIR | "find"
>;

/** Poll interval for the revision map — cheap on the server, slow enough to cost an idle library nothing. */
const POLL_MS = 3000;

export function useLibraryData(section: SectionId) {
  // The capture zone is a section with no family behind it: no `/list`, no entries, no module pane.
  const isZone = section === RECORDINGS_DIR;
  // The hunt is not on the volume — nothing of its own to poll.
  const polls = section !== "find";
  const [present, setPresent] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Whether removals and folder moves are this account's; false until the service says so.
  const [manage, setManage] = useState(false);
  const [entries, setEntries] = useState<MediatekEntry[] | null>(null);
  // What no entry accounts for — an empty folder, a loose file — which the service lists separately.
  const [unlisted, setUnlisted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // What a bulk action just DID: an outcome and not a fault, so never said in the destructive card next door.
  const [notice, setNotice] = useState<string | null>(null);
  // The capture zone's own listing, held apart from `entries` because nothing here is a catalogue entry.
  const [recordings, setRecordings] = useState<RecordingDay[]>([]);
  // The revision each family's listing was fetched at — the refetch condition.
  const seen = useRef<Record<string, string>>({});
  // The section on screen NOW: a listing that lands after the user moved on belongs to nobody.
  const shown = useRef(section);
  shown.current = section;

  // After a write of our own: forgetting the revision is what forces the next poll to reload (../docs/library.md).
  const refresh = useCallback(() => {
    seen.current[section] = "";
    setError(null);
  }, [section]);

  /** Reload SONGS whatever section is open, since the hunt page's finds land there. Stable — FindSongs polls on it. */
  const refreshSongs = useCallback(() => {
    seen.current.songs = "";
  }, []);

  useEffect(() => {
    void library
      .summary()
      .then((s) => {
        setPresent(s.present);
        setCounts(s.counts);
        setManage(s.manage === true);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const load = useCallback(async (f: FamilyId, rev: string) => {
    try {
      const l = await library.list(f);
      if (shown.current !== f) return;
      // The listing's OWN token: a stale one served during a rescan stays unseen, so the next poll reloads.
      seen.current[f] = l.rev ?? rev;
      setEntries(l.entries);
      setUnlisted(l.unlisted ?? []);
      setCounts((c) => ({ ...c, [f]: l.entries.length }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  /** The zone's own reload — its own route, and its own token in the same map. */
  const loadZone = useCallback(async (rev: string) => {
    try {
      const { days } = await library.recordings();
      if (shown.current !== RECORDINGS_DIR) return;
      seen.current[RECORDINGS_DIR] = rev;
      setRecordings(days);
      setCounts((c) => ({
        ...c,
        [RECORDINGS_DIR]: days.reduce((n, d) => n + d.files.length, 0),
      }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  /** Changing section drops what was held AND the token claiming it was current (../docs/library.md). */
  useEffect(() => {
    setEntries(null);
    setUnlisted([]);
    setNotice(null);
    seen.current[section] = "";
  }, [section]);

  // One poll drives every section OF THE LIBRARY, the capture zone included (../docs/library.md).
  useEffect(() => {
    if (!polls) return;
    let stop = false;
    const tick = async () => {
      try {
        const { present: p, revisions } = await library.revisions();
        if (stop) return;
        setPresent(p);
        const rev = revisions[section];
        if (rev !== undefined && seen.current[section] !== rev)
          await (isZone ? loadZone(rev) : load(section as FamilyId, rev));
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    const end = poll(tick, POLL_MS);
    return () => {
      stop = true;
      end();
    };
  }, [polls, isZone, load, loadZone, section]);

  return {
    present,
    manage,
    counts,
    entries,
    unlisted,
    recordings,
    error,
    setError,
    notice,
    refresh,
    refreshSongs,
  };
}
