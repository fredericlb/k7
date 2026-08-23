import { f } from "./api";
import { type Session, shuffled } from "./game";

// A resolved playlist as the Session shape SoloGame already eats: one category, one song per track.

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

/** A one-category Session in RANDOM order, drawn once per selection — ../../../docs/effects.md. */
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
