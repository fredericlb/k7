// deezer.ts — the fallback identifier when MusicBrainz cannot be reached, no credentials
// needed. Weaker than MusicBrainz on purpose: it has no release-type signal (no telling a
// studio album from a live bootleg) and no date without a second call per candidate, so it
// is a fallback and never the first choice — ../../../docs/media/hunt.md.

import type { Tags } from "./musicbrainz.ts";
import { queryScore } from "./musicbrainz.ts";

const API = "https://api.deezer.com";
const LIMIT = 25;

interface RawTrack {
  id?: number;
  rank?: number;
  title?: string;
  title_short?: string;
  artist?: { name?: string };
  album?: { title?: string };
}

const TIMEOUT_MS = 15_000;

/** Ask Deezer what this text is; `null` for "nothing recognisable" or a network failure. */
export async function lookupDeezer(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Tags | null> {
  const q = query.trim();
  if (!q) return null;
  let tracks: RawTrack[];
  try {
    const res = await fetchImpl(
      `${API}/search?q=${encodeURIComponent(q)}&limit=${LIMIT}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    tracks = ((await res.json()) as { data?: RawTrack[] }).data ?? [];
  } catch {
    return null;
  }
  return chooseTagsDeezer(tracks, q);
}

/** The best-matching track by text, the most POPULAR one breaking a tie — ../../../docs/media/hunt.md. */
export function chooseTagsDeezer(
  tracks: readonly RawTrack[],
  query: string,
): Tags | null {
  const usable = tracks.filter(
    (t) => (t.title || t.title_short) && t.artist?.name,
  );
  if (!usable.length) return null;
  const scored = usable.map((t) => ({
    t,
    q: queryScore(query, t.artist?.name ?? "", t.title_short || t.title || ""),
  }));
  const top = Math.max(...scored.map((s) => s.q));
  const tied = scored.filter((s) => s.q === top);
  tied.sort((a, b) => (b.t.rank ?? 0) - (a.t.rank ?? 0));
  const best = tied[0].t;
  return {
    artist: (best.artist?.name ?? "").trim(),
    title: (best.title_short || best.title || "").trim(),
    album: best.album?.title?.trim() || null,
    // Not in a search result, and not worth a second call per candidate for a fallback path.
    date: null,
  };
}
