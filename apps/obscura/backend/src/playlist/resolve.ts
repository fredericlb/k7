// Turns a pasted playlist URL into a playable track list. Deezer playlists
// resolve directly; Spotify ones are bridged track-by-track through ISRC (then
// a fuzzy search), since Spotify can't hand out audio. Results are memoised —
// a Spotify bridge costs one Deezer call per track, far too slow to redo at
// every game start.

import * as deezer from "./deezer.ts";
import * as spotify from "./spotify.ts";

export type Provider = "deezer" | "spotify";

export interface PlaylistRef {
  provider: Provider;
  id: string;
  /** Canonical web URL, so a pasted `spotify:` URI still stores a clickable link. */
  url: string;
}

export interface PlaylistTrack {
  artist: string;
  title: string;
  cover: string;
  deezerId: number;
  /** How the audio was found — the UI flags anything but "direct"/"isrc". */
  matchVia: "direct" | "isrc" | "search";
}

export interface ResolvedPlaylist {
  ref: PlaylistRef;
  name: string;
  cover: string;
  tracks: PlaylistTrack[];
  /** Titles with no Deezer counterpart, dropped from `tracks`. */
  unavailable: number;
}

const DEEZER_URL = /(?:deezer\.com)\/(?:[a-z]{2}\/)?playlist\/(\d+)/i;
const SPOTIFY_URL =
  /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]+)/i;
const SPOTIFY_URI = /^spotify:playlist:([A-Za-z0-9]+)$/i;

/**
 * Parse any of the shapes a user might paste. Bare digits are read as a Deezer
 * id (Spotify ids are base-62, never all-numeric), which keeps the field
 * forgiving without guessing wrong.
 */
export function parsePlaylistURL(raw: string): PlaylistRef {
  const s = raw.trim();
  if (s === "") throw new Error("empty playlist URL");

  const dz = s.match(DEEZER_URL);
  if (dz) return deezerRef(dz[1]);
  const sp = s.match(SPOTIFY_URL) ?? s.match(SPOTIFY_URI);
  if (sp) return spotifyRef(sp[1]);

  if (/^\d+$/.test(s)) return deezerRef(s);
  if (/deezer\.page\.link|link\.deezer\.com/i.test(s))
    throw new Error(
      "shortened Deezer links aren't supported — open it and paste the full deezer.com/playlist/… URL",
    );
  throw new Error("unrecognised playlist URL (expected Deezer or Spotify)");
}

const deezerRef = (id: string): PlaylistRef => ({
  provider: "deezer",
  id,
  url: `https://www.deezer.com/playlist/${id}`,
});

const spotifyRef = (id: string): PlaylistRef => ({
  provider: "spotify",
  id,
  url: `https://open.spotify.com/playlist/${id}`,
});

// ─── resolution ─────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 60_000;
const cache = new Map<string, { at: number; value: ResolvedPlaylist }>();
const cacheKey = (ref: PlaylistRef) => `${ref.provider}:${ref.id}`;

/** Resolve a playlist, serving a memoised copy unless `force` is set. */
export async function resolvePlaylist(
  ref: PlaylistRef,
  force = false,
): Promise<ResolvedPlaylist> {
  const key = cacheKey(ref);
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value =
    ref.provider === "deezer"
      ? await resolveDeezer(ref)
      : await resolveSpotify(ref);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function resolveDeezer(ref: PlaylistRef): Promise<ResolvedPlaylist> {
  const [meta, raw] = await Promise.all([
    deezer.fetchPlaylistMeta(ref.id),
    deezer.fetchPlaylistTracks(ref.id),
  ]);
  const tracks: PlaylistTrack[] = raw.map((t) => ({
    artist: t.artist,
    title: t.title,
    cover: t.cover,
    deezerId: t.id,
    matchVia: "direct",
  }));
  return {
    ref,
    name: meta.name,
    cover: meta.cover,
    tracks,
    unavailable: Math.max(0, raw.length - tracks.length),
  };
}

async function resolveSpotify(ref: PlaylistRef): Promise<ResolvedPlaylist> {
  const [meta, items] = await Promise.all([
    spotify.fetchPlaylistMeta(ref.id),
    spotify.fetchPlaylistTracks(ref.id),
  ]);
  // Fired in parallel on purpose — deezer.ts's limiter is what paces them.
  const matched = await Promise.all(items.map(matchOnDeezer));
  const tracks = matched.filter((t): t is PlaylistTrack => t !== null);
  return {
    ref,
    name: meta.name,
    cover: meta.cover,
    tracks,
    unavailable: items.length - tracks.length,
  };
}

/** ISRC first (exact recording), fuzzy search second, give up third. */
async function matchOnDeezer(
  item: spotify.SpotifyTrack,
): Promise<PlaylistTrack | null> {
  if (item.isrc !== "") {
    const hit = await deezer.trackByISRC(item.isrc);
    if (hit) return { ...toTrack(hit, item), matchVia: "isrc" };
  }
  if (item.artist !== "" && item.title !== "") {
    const hit = await deezer.searchTrack(item.artist, item.title);
    if (hit) return { ...toTrack(hit, item), matchVia: "search" };
  }
  return null;
}

/**
 * Keep Spotify's artist/title as the answer text — they're what the player is
 * most likely to type — but take the cover and id from the Deezer match.
 */
function toTrack(
  hit: deezer.DeezerTrack,
  item: spotify.SpotifyTrack,
): Omit<PlaylistTrack, "matchVia"> {
  return {
    artist: item.artist || hit.artist,
    title: item.title || hit.title,
    cover: hit.cover,
    deezerId: hit.id,
  };
}

/** Test seam — the memo is a module-level singleton. */
export function __resetResolveCache(): void {
  cache.clear();
}
