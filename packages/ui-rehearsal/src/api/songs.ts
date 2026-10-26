// songs.ts — the songbook's calls: a song, its sheets, its track, its copy from a server.

import { apiBase } from "../config";
import type {
  FetchStatus,
  LrcCandidate,
  PublicationsStatus,
  Song,
  SongbookPlacement,
  SongEnvelope,
  SongListEntry,
} from "../types";
import { f, json } from "./http";

export const songsApi = {
  // --- Songs (songbook) ---
  /** The songbook's rows, without any song's texts: a song's own GET has them. */
  listSongs: (): Promise<SongListEntry[]> => f("/api/songs").then(json),
  /** Whether releases and pages can be reached: they live on the server alone — ../../../rehearsal-server/docs/publications.md. */
  publicationsStatus: (): Promise<PublicationsStatus> =>
    f("/api/publications").then(json),
  /** Where each song lives on a machine paired with a server — ../../../rehearsal-server/docs/songbookCopy.md. */
  songbookPlacement: (): Promise<SongbookPlacement> =>
    f("/api/sync/songbook-copy").then(json),
  /** Copy one server-only song here, its sheets and track with it. */
  downloadSong: (id: string): Promise<unknown> =>
    f("/api/sync/songbook-copy/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).then(json),

  getSong: (id: string): Promise<Song> => f(`/api/songs/${id}`).then(json),

  createSong: (data: { artist: string; title: string }): Promise<Song> =>
    f("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  updateSong: (
    id: string,
    patch: Partial<
      Pick<
        Song,
        | "artist"
        | "title"
        | "lyrics"
        | "tablature"
        | "lyricTimings"
        | "lyricsMatch"
        | "fetchIgnored"
      >
    > & { fetchStatus?: Partial<FetchStatus> },
  ): Promise<Song> =>
    f(`/api/songs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  // Timed lyrics for a song on LRCLIB, asked through the backend; the track's length ranks them.
  searchLrclib: (id: string, duration?: number): Promise<LrcCandidate[]> =>
    f(
      `/api/songs/${id}/lrclib${duration ? `?duration=${Math.round(duration)}` : ""}`,
    ).then(json),

  // The song forgets its library track and instrumental; the médiathèque keeps the files.
  unlinkSongAudio: (id: string): Promise<Song> =>
    f(`/api/songs/${id}/audio`, { method: "DELETE" }).then(json),

  // "Fetch song": a library master copied in as the track, and an instrumental mixed from its stems.
  copyLibraryTrack: (id: string, path: string): Promise<Song> =>
    f(`/api/songs/${id}/audio/from-library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).then(json),

  mixInstrumental: (id: string, folder: string): Promise<Song> =>
    f(`/api/songs/${id}/instrumental/from-library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    }).then(json),

  // A star is the connected user's own, so it has its own route rather than a song field.
  setSongFavorite: (id: string, favorite: boolean): Promise<Song> =>
    f(`/api/songs/${id}/favorite`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite }),
    }).then(json),

  deleteSong: (id: string): Promise<null> =>
    f(`/api/songs/${id}`, { method: "DELETE" }).then(json),

  // Sheet files (PDF / images): multipart with a repeated "files" field, answering the song.
  uploadSheetFiles: (id: string, files: File[]): Promise<Song> => {
    const body = new FormData();
    for (const file of files) body.append("files", file);
    return f(`/api/songs/${id}/sheets`, { method: "POST", body }).then(json);
  },

  deleteSheetFile: (id: string, fileId: string): Promise<Song> =>
    f(`/api/songs/${id}/sheets/${fileId}`, { method: "DELETE" }).then(json),

  // The reference track: one per song, multipart under the field "audio".
  uploadSongAudio: (id: string, file: File): Promise<Song> => {
    const body = new FormData();
    body.append("audio", file);
    return f(`/api/songs/${id}/audio`, { method: "POST", body }).then(json);
  },

  /** The track's shape; the backend measures it the first time and keeps it. */
  getSongEnvelope: (id: string): Promise<SongEnvelope> =>
    f(`/api/songs/${id}/envelope`).then(json),

  // `name` is decoration the EPUB export needs: the media type is read off the extension.
  sheetFileUrl: (id: string, fileId: string, name?: string) =>
    `${apiBase()}/api/songs/${id}/sheets/${fileId}${
      name ? `/${encodeURIComponent(name)}` : ""
    }`,
};
