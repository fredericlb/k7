import { f } from "./api";
import { type Session, shuffled } from "./game";

// Playlist-mode API calls plus the adapter that turns a resolved playlist into
// the Session shape SoloGame already consumes — one category, mode "", one
// song per track. Answers fall out of artist/title, so alternativesFor() asks
// for both halves exactly as it does for a prepared session.

export interface PlaylistRow {
  id: number;
  provider: string;
  playlistId: string;
  url: string;
  name: string;
  cover: string;
  trackCount: number;
  addedBy: string;
  score?: number;
}

export interface PlaylistTrack {
  artist: string;
  title: string;
  cover: string;
  deezerId: number;
  matchVia: "direct" | "isrc" | "search";
}

export interface PlaylistTracks {
  id: number;
  name: string;
  cover: string;
  unavailable: number;
  tracks: PlaylistTrack[];
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const body = (await r.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

export async function listPlaylists(): Promise<{
  playlists: PlaylistRow[];
  spotify: boolean;
}> {
  return jsonOrThrow(await f("/api/playlists", { cache: "no-store" }));
}

export async function addPlaylist(url: string): Promise<PlaylistRow> {
  const data = await jsonOrThrow<{ playlist: PlaylistRow }>(
    await f("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );
  return data.playlist;
}

export async function deletePlaylist(id: number): Promise<void> {
  await jsonOrThrow(await f(`/api/playlists/${id}`, { method: "DELETE" }));
}

export async function loadPlaylistTracks(id: number): Promise<PlaylistTracks> {
  return jsonOrThrow(
    await f(`/api/playlists/${id}/tracks`, { cache: "no-store" }),
  );
}

/**
 * Wrap a playlist as a one-category Session, in RANDOM order. Each song's
 * `path` points at the backend redirect rather than a CDN URL: Deezer preview
 * signatures die after ~15 minutes, and a long game would otherwise stall
 * halfway through.
 *
 * Shuffled here and not in the backend on purpose. `/playlists/:id/tracks`
 * answers "what is in this playlist", and an endpoint that returned a
 * different order every call would be lying about that; which order to be
 * QUIZZED in is a property of the game, and this is the seam where a playlist
 * becomes one. A prepared session keeps its authored order — that one is
 * curated, and `order`'s from/to even slice it by index.
 *
 * Once per selection, so the order holds for the whole run and only changes
 * when you pick the playlist again. Nothing is lost by re-rolling: a playlist
 * run keeps no resume checkpoint (see PLAYLIST_SCORING), so there is no saved
 * position for a new order to invalidate.
 */
export function sessionFromPlaylist(
  data: PlaylistTracks,
  rng: () => number = Math.random,
): Session {
  return {
    categories: [
      {
        name: data.name,
        mode: "",
        songs: shuffled(data.tracks, rng).map((t) => ({
          artist: t.artist,
          title: t.title,
          path: `/api/playlists/preview/${t.deezerId}`,
        })),
      },
    ],
  };
}
