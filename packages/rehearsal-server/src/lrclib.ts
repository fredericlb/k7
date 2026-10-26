// lrclib.ts — timed lyrics looked up on LRCLIB (lrclib.net), a free crowdsourced lyrics database.
// Asked from the backend so the request carries a User-Agent LRCLIB asks for, and a browser
// never talks to a third party on the user's behalf — ../../ui-rehearsal/docs/lyricsTiming.md.

import type { LrcCandidate } from "@studio/rehearsal-shared";

const SEARCH_URL = "https://lrclib.net/api/search";
const USER_AGENT = "k7 songbook (https://app.k7.rocks/rehearsal)";
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
  plainLyrics?: string | null;
}

/** The results worth offering: timed lyrics, or an instrumental, the ones nearest the track's length first. */
export function rankCandidates(
  records: readonly LrclibRecord[],
  duration?: number,
): LrcCandidate[] {
  const usable = records.filter(
    (r) =>
      r.instrumental === true ||
      (typeof r.syncedLyrics === "string" && r.syncedLyrics.trim() !== ""),
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
      syncedLyrics: r.instrumental ? "" : (r.syncedLyrics ?? ""),
      instrumental: r.instrumental === true,
    }));
}

/** LRCLIB's records for a title and artist; throws when the service cannot be reached. */
async function searchRecords(
  artist: string,
  title: string,
): Promise<LrclibRecord[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("track_name", title);
  if (artist) url.searchParams.set("artist_name", artist);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`LRCLIB answered ${res.status}`);
  const records = (await res.json()) as LrclibRecord[];
  return Array.isArray(records) ? records : [];
}

/** Search LRCLIB for a song's timed lyrics; throws when the service cannot be reached. */
export async function searchLrclib(
  artist: string,
  title: string,
  duration?: number,
): Promise<LrcCandidate[]> {
  return rankCandidates(await searchRecords(artist, title), duration);
}

/** What an unattended lookup settles on: timed lyrics, plain ones, an instrumental, or nothing sure enough. */
export type LyricsFound =
  | { kind: "synced"; text: string }
  | { kind: "plain"; text: string }
  | { kind: "instrumental" }
  | null;

/** How far a record's length may be from the track's and still be that recording, in seconds. */
export const DURATION_SLACK_S = 5;

const loose = (s: string | undefined): string =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The one record an unattended lookup may trust — nobody reviews it, so a near length or exact names, never a guess. */
export function pickRecord(
  records: readonly LrclibRecord[],
  artist: string,
  title: string,
  duration?: number,
): LyricsFound {
  const text = (v: string | null | undefined) =>
    typeof v === "string" && v.trim() ? v : "";
  const usable = records.filter(
    (r) =>
      r.instrumental === true || text(r.syncedLyrics) || text(r.plainLyrics),
  );
  const fits = (r: LrclibRecord) =>
    duration && r.duration
      ? Math.abs(r.duration - duration) <= DURATION_SLACK_S
      : loose(r.trackName) === loose(title) &&
        (!artist || loose(r.artistName) === loose(artist));
  const gap = (r: LrclibRecord) =>
    duration && r.duration ? Math.abs(r.duration - duration) : 0;
  // Timed lyrics beat plain ones at the same distance: they are what the songbook follows.
  const best = usable
    .filter(fits)
    .sort(
      (a, b) =>
        gap(a) - gap(b) ||
        Number(Boolean(text(b.syncedLyrics))) -
          Number(Boolean(text(a.syncedLyrics))),
    )[0];
  if (!best) return null;
  if (best.instrumental) return { kind: "instrumental" };
  const synced = text(best.syncedLyrics);
  return synced
    ? { kind: "synced", text: synced }
    : { kind: "plain", text: text(best.plainLyrics) };
}

/** Look a song's lyrics up for nobody in particular: the record `pickRecord` trusts, or null. */
export async function lookupLyrics(
  artist: string,
  title: string,
  duration?: number,
): Promise<LyricsFound> {
  return pickRecord(
    await searchRecords(artist, title),
    artist,
    title,
    duration,
  );
}
