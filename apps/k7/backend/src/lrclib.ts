// lrclib.ts — timed lyrics looked up on LRCLIB (lrclib.net), a free crowdsourced lyrics database.
// Asked from the backend so the request carries a User-Agent LRCLIB asks for, and a browser
// never talks to a third party on the user's behalf — ../../docs/lyricsTiming.md.

import type { LrcCandidate } from "@k7/shared";

const SEARCH_URL = "https://lrclib.net/api/search";
const USER_AGENT = "k7 songbook (https://studio.frediver.se/k7)";
const TIMEOUT_MS = 10_000;
/** More than this many candidates is a list nobody reads on a phone. */
const MAX_CANDIDATES = 8;

/** One LRCLIB search result, as much of it as k7 reads. */
interface LrclibRecord {
  id: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
}

/** The results worth offering: timed and sung, the ones nearest the track's length first. */
export function rankCandidates(
  records: readonly LrclibRecord[],
  duration?: number,
): LrcCandidate[] {
  const usable = records.filter(
    (r) =>
      !r.instrumental &&
      typeof r.syncedLyrics === "string" &&
      r.syncedLyrics.trim() !== "",
  );
  const gap = (r: LrclibRecord) =>
    duration && r.duration ? Math.abs(r.duration - duration) : 0;
  return [...usable]
    .sort((a, b) => gap(a) - gap(b))
    .slice(0, MAX_CANDIDATES)
    .map((r) => ({
      id: r.id,
      trackName: r.trackName ?? "",
      artistName: r.artistName ?? "",
      albumName: r.albumName ?? "",
      duration: r.duration ?? 0,
      syncedLyrics: r.syncedLyrics as string,
    }));
}

/** Search LRCLIB for a song's timed lyrics; throws when the service cannot be reached. */
export async function searchLrclib(
  artist: string,
  title: string,
  duration?: number,
): Promise<LrcCandidate[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("track_name", title);
  if (artist) url.searchParams.set("artist_name", artist);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`LRCLIB answered ${res.status}`);
  const records = (await res.json()) as LrclibRecord[];
  return rankCandidates(Array.isArray(records) ? records : [], duration);
}
