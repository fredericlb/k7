// Spotify as a *metadata* source only: preview_url has been dead since
// 2024-11-27 and the Web Playback SDK serves DRM-encrypted audio, so we read
// artist/title/ISRC here and let deezer.ts supply the actual sound. Uses the
// client-credentials grant, which reaches public playlists only.

import { loadEnv } from "../env.ts";

const ACCOUNTS = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

export interface SpotifyTrack {
  artist: string;
  title: string;
  isrc: string;
}

export interface SpotifyPlaylistMeta {
  name: string;
  cover: string;
  trackCount: number;
}

/** Raised when the credentials are absent — handlers turn it into a 501. */
export class SpotifyNotConfigured extends Error {
  constructor() {
    super("spotify not configured (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)");
  }
}

export function spotifyConfigured(): boolean {
  const env = loadEnv();
  return env.SPOTIFY_CLIENT_ID !== "" && env.SPOTIFY_CLIENT_SECRET !== "";
}

let token = "";
let tokenExpiresAt = 0;

async function accessToken(): Promise<string> {
  if (token !== "" && tokenExpiresAt > Date.now()) return token;
  const env = loadEnv();
  if (env.SPOTIFY_CLIENT_ID === "" || env.SPOTIFY_CLIENT_SECRET === "")
    throw new SpotifyNotConfigured();

  const basic = Buffer.from(
    `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(ACCOUNTS, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok)
    throw new Error(`spotify token: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) throw new Error("spotify token: no access_token");
  token = body.access_token;
  // Renew a minute early so an in-flight request never races the expiry.
  tokenExpiresAt = Date.now() + ((body.expires_in ?? 3600) - 60) * 1000;
  return token;
}

async function spotifyGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404)
    throw new Error("spotify: playlist not found (is it public?)");
  if (!res.ok)
    throw new Error(`spotify ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function fetchPlaylistMeta(
  playlistId: string,
): Promise<SpotifyPlaylistMeta> {
  const raw = await spotifyGet<{
    name?: string;
    images?: { url?: string }[];
    tracks?: { total?: number };
  }>(
    `/playlists/${encodeURIComponent(playlistId)}?fields=name,images,tracks(total)`,
  );
  return {
    name: raw.name ?? "",
    cover: raw.images?.[0]?.url ?? "",
    trackCount: raw.tracks?.total ?? 0,
  };
}

interface RawItem {
  track?: {
    name?: string;
    artists?: { name?: string }[];
    external_ids?: { isrc?: string };
  } | null;
}

/** Every track of a public playlist, following Spotify's `next` pagination. */
export async function fetchPlaylistTracks(
  playlistId: string,
): Promise<SpotifyTrack[]> {
  const out: SpotifyTrack[] = [];
  const fields = "items(track(name,artists(name),external_ids(isrc))),next";
  let path =
    `/playlists/${encodeURIComponent(playlistId)}/tracks` +
    `?fields=${encodeURIComponent(fields)}&limit=100`;
  for (;;) {
    const page = await spotifyGet<{ items?: RawItem[]; next?: string | null }>(
      path,
    );
    for (const item of page.items ?? []) {
      const t = item.track;
      // Locally-added files and removed tracks come back as null.
      if (!t?.name) continue;
      out.push({
        artist: t.artists?.[0]?.name ?? "",
        title: t.name,
        isrc: t.external_ids?.isrc ?? "",
      });
    }
    if (!page.next || out.length >= 1000) break;
    path = page.next.replace(API, "");
  }
  return out;
}

/** Test seam — the token is a module-level singleton. */
export function __resetSpotifyState(): void {
  token = "";
  tokenExpiresAt = 0;
}
