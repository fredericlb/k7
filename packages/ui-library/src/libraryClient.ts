// libraryClient.ts — the médiathèque's routes under one base: `libraryAt(base)` is a library client, and api.ts's
// `library` is the one under the host's `apiBase()`. A song of the paired server is read and written through a
// client under the forward instead, so one screen can hold both (../docs/songSource.md).

import {
  failed,
  fetchWithin,
  readJson as json,
} from "@studio/http-client/call";
import { upload } from "@studio/http-client/upload";
import type { PlaylistSummary } from "@studio/mediatek/playlists";
import type { RecordingDay } from "@studio/mediatek/recordings";
import type {
  FamilyListing,
  MasterTags,
  OtherTags,
  SongbookSong,
} from "@studio/mediatek/types";
import type {
  Moment,
  MomentPlacement,
  Session,
} from "@studio/rehearsal-shared";
import { libraryConfig } from "./config";

/** The folder a song would land in already holds one — its own type so the dialogue can offer to replace. */
export class SongExists extends Error {}

/** What a call may take before it is given up on — ../docs/audit.md. */
export const TIMEOUT_MS = 30_000;
/** A decode may queue behind two others on the server before it even starts. */
const ANALYSE_MS = 10 * 60_000;

/** `fetch` within `ms` — null for an upload, which a slow link makes long and only the user may cut. */
export const request = (
  url: string,
  init: RequestInit = {},
  ms: number | null = TIMEOUT_MS,
): Promise<Response> =>
  fetchWithin(url, init, ms, (s) => new Error(libraryConfig().noAnswer(s)));

/** The library's routes under `base()`, read at call time. */
export function libraryAt(base: () => string) {
  const get = async <T>(path: string, what: string): Promise<T> =>
    json(await request(`${base()}/api/mediatek${path}`), what);

  const library = {
    summary: () =>
      get<{
        present: boolean;
        counts: Record<string, number>;
        manage?: boolean;
      }>("", "mediatek"),

    revisions: () =>
      get<{ present: boolean; revisions: Record<string, string> }>(
        "/revision",
        "revision",
      ),

    list: (family: string) =>
      get<FamilyListing>(`/list?family=${encodeURIComponent(family)}`, "list"),

    /** A file's bytes, for an <audio>/<video> src. Served with Range, so seeking works. */
    fileUrl: (path: string) =>
      `${base()}/api/mediatek/file?path=${encodeURIComponent(path)}`,

    /** The same, but a FLAC comes as the Opus copy beside it — what a browser plays (apps/k7/backend/docs/media/derivedStream.md). */
    streamUrl: (path: string) =>
      `${base()}/api/mediatek/stream?path=${encodeURIComponent(path)}`,

    /** Does the library hold this file? One BYTE, not the file, and a refusal reads as absent (../docs/api.md). */
    exists: async (path: string): Promise<boolean> => {
      try {
        const res = await request(library.fileUrl(path), {
          headers: { range: "bytes=0-0" },
        });
        return res.ok;
      } catch {
        return false;
      }
    },

    /** One file's text. The library serves bytes; a module is YAML, so this reads it back. */
    readFile: async (
      path: string,
    ): Promise<{ path: string; content: string }> => {
      const res = await request(
        `${base()}/api/mediatek/file?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) throw await failed(res, "file");
      return { path, content: await res.text() };
    },

    /** Drop OS files into `dir`. The File goes as the BODY: writeFile takes a string and would corrupt a sample. */
    upload: async (dir: string, files: File[]): Promise<void> =>
      library.uploadTree(
        dir,
        files.map((file) => ({ path: file.name, file })),
      ),

    /** Drop OS files into `dir`, FOLDERS INCLUDED — each carries the path it sat at (../docs/api.md). */
    uploadTree: async (
      dir: string,
      files: { path: string; file: File }[],
    ): Promise<void> => {
      for (const { path: rel, file } of files) {
        const path = dir ? `${dir}/${rel}` : rel;
        const res = await request(
          `${base()}/api/mediatek/file?path=${encodeURIComponent(path)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/octet-stream" },
            body: file,
          },
          null,
        );
        if (!res.ok) throw await failed(res, `upload ${rel}:`);
      }
    },

    /** The raw capture zone, day by day — its own call, since a capture enters no catalogue (packages/mediatek/docs/recordings.md). */
    recordings: () =>
      get<{ days: RecordingDay[] }>("/recordings", "recordings"),

    /** The signed-in account's sessions: which captures are its own takes, and how long each runs. */
    mySessions: async (): Promise<Session[]> =>
      json(await request(`${base()}/api/sessions`), "sessions"),

    /** Delete a capture through the rehearsal store, which takes the sessions that saved it too; its moments stay (../docs/recordings.md). */
    deleteRecording: async (path: string): Promise<void> => {
      const res = await request(
        `${base()}/api/moments/recording?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw await failed(res, "delete");
    },

    /** How long a capture runs, read off the médiathèque's measure of it — measured once, then cached there. */
    captureSeconds: async (path: string): Promise<number> =>
      (
        await json<{ seconds: number }>(
          await request(
            `${base()}/api/mediatek/envelope?path=${encodeURIComponent(path)}`,
          ),
          "envelope",
        )
      ).seconds,

    /** Which of the account's moments the paired server holds; `paired` false on any other machine. */
    momentPlacement: async (): Promise<MomentPlacement> =>
      json(await request(`${base()}/api/sync/moments-share`), "moments-share"),

    /** The signed-in account's moments, every recording's: the rehearsal store keeps them (../docs/recordings.md). */
    moments: async (): Promise<Moment[]> =>
      json(await request(`${base()}/api/moments`), "moments"),

    /** The set lists this volume holds — its own call too, no family scan reaching the zone. */
    playlists: () =>
      get<{ playlists: PlaylistSummary[] }>("/playlists", "playlists"),

    /** Create one from the stub. Its text is then read and written with readFile/writeFile. */
    newPlaylist: async (name: string): Promise<PlaylistSummary> => {
      const res = await request(`${base()}/api/mediatek/playlists`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw await failed(res, "playlist");
      return ((await res.json()) as { playlist: PlaylistSummary }).playlist;
    },

    /** Push captures in, one request each, so every file carries its OWN mtime (../docs/api.md). */
    addRecordings: async (
      files: File[],
      signal?: AbortSignal,
    ): Promise<void> => {
      for (const file of files) {
        const q = new URLSearchParams({
          filename: file.name,
          at: new Date(file.lastModified).toISOString(),
        });
        const res = await request(
          `${base()}/api/mediatek/recording?${q}`,
          {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: file,
            signal,
          },
          null,
        );
        if (!res.ok) throw await failed(res, `${file.name}:`);
      }
    },

    /**
     * Measure a file and write its `.cache` sidecar, ON THIS SERVICE: it holds the bytes and has
     * ffmpeg, so no machine is asked — packages/audio-analysis/docs/analysis.md.
     */
    analyse: async (
      path: string,
      signal?: AbortSignal,
    ): Promise<{ bpm: number; bpmSet: boolean; transients: number }> => {
      const res = await request(
        `${base()}/api/mediatek/analyse`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
          signal,
        },
        ANALYSE_MS,
      );
      return json(res, "analyse");
    },

    /** File one audio file as a song: the THREE TAGS go up and never a path (packages/mediatek/docs/songs.md). */
    addSong: async (
      file: File,
      tags: { artist: string; album: string; title: string },
      opts: {
        replace?: boolean;
        signal?: AbortSignal;
        onProgress?: (fraction: number) => void;
      } = {},
    ): Promise<{ path: string; master: string; replaced: boolean }> => {
      const q = new URLSearchParams({ filename: file.name, ...tags });
      if (opts.replace) q.set("replace", "1");
      // No time budget, as for every upload: a slow link makes it long and only the user may cut it.
      const res = await upload(`${base()}/api/mediatek/song?${q}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as {
          error?: string;
          exists?: boolean;
        };
        // Told apart from every other refusal: it is the one the UI can offer to resolve.
        if (res.status === 409) throw new SongExists(detail.error ?? "");
        throw new Error(detail.error ?? `song ${res.status}`);
      }
      return json(res, "song");
    },

    /** One audio file as a VARIANT: the bytes, and the line in `song.yaml` that names them (../docs/api.md). */
    addVariant: async (
      folder: string,
      file: File,
    ): Promise<{
      path: string;
      ref: string;
      name: string;
      declared: boolean;
    }> => {
      const q = new URLSearchParams({ path: folder, filename: file.name });
      const res = await request(
        `${base()}/api/mediatek/variant?${q}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        },
        null,
      );
      if (!res.ok) throw await failed(res, `${file.name}:`);
      return json(res, "variant");
    },

    /** A song with NO audio: its folder and its names, as the songbook makes one — mediatek's docs/songbook.md. */
    addSongWithoutAudio: async (tags: {
      artist: string;
      title: string;
    }): Promise<SongbookSong> => {
      const res = await request(`${base()}/api/mediatek/songbook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tags),
      });
      if (!res.ok) throw await failed(res, "song");
      return json(res, "song");
    },

    /** A library song made a SONGBOOK song in its own folder, so it can carry chords, a tab and sheets. */
    adoptSongbook: async (song: {
      folder: string;
      artist: string;
      title: string;
    }): Promise<SongbookSong> => {
      const res = await request(`${base()}/api/mediatek/songbook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          folder: song.folder,
          // The route wants names; they are written only for a folder with no master to name it.
          artist: song.artist || "?",
          title: song.title || "?",
        }),
      });
      if (!res.ok) throw await failed(res, "songbook");
      return json(res, "songbook");
    },

    /** One audio file made the MASTER of a songbook song's folder, tagged with its names; no time budget, as for every upload. */
    setSongbookMaster: async (
      id: string,
      file: File,
    ): Promise<SongbookSong> => {
      const q = new URLSearchParams({ filename: file.name });
      const res = await request(
        `${base()}/api/mediatek/songbook/${encodeURIComponent(id)}/master?${q}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        },
        null,
      );
      if (!res.ok) throw await failed(res, `${file.name}:`);
      return json(res, "songbook");
    },

    /** One of a songbook song's texts written; an empty one is removed — mediatek's docs/songbook.md. */
    patchSongbook: async (
      id: string,
      patch: {
        chords?: string;
        tablature?: string;
        lyrics?: string;
        /** The instrumental's library path, so the songbook plays it too. */
        instrumental?: string;
      },
    ): Promise<SongbookSong> => {
      const res = await request(
        `${base()}/api/mediatek/songbook/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) throw await failed(res, "songbook");
      return json(res, "songbook");
    },

    /** The song's lyrics looked up on LRCLIB now; its chords come back timed when they are found timed. */
    lookUpLyrics: async (id: string): Promise<SongbookSong> => {
      const res = await request(
        `${base()}/api/mediatek/songbook/${encodeURIComponent(id)}/lyrics/lookup`,
        { method: "POST" },
        // LRCLIB answers in seconds, but the lookups take turns: a page's waits behind the queue's.
        null,
      );
      if (!res.ok) throw await failed(res, "lyrics");
      return json(res, "lyrics");
    },

    /** One sheet added at the end of the song's list; no time budget, a score or a PDF can be large. */
    addSheet: async (
      id: string,
      file: File,
      mime: string,
    ): Promise<SongbookSong> => {
      const q = new URLSearchParams({ name: file.name, mime });
      const res = await request(
        `${base()}/api/mediatek/songbook/${encodeURIComponent(id)}/sheets?${q}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        },
        null,
      );
      if (!res.ok) throw await failed(res, `${file.name}:`);
      return json(res, "sheet");
    },

    /** One sheet removed, its file with it. */
    removeSheet: async (id: string, sheet: string): Promise<SongbookSong> => {
      const res = await request(
        `${base()}/api/mediatek/songbook/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheet)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw await failed(res, "sheet");
      return json(res, "sheet");
    },

    /** A songbook song read whole by its id — its texts and sheets, what the song screen's tabs show (mediatek's docs/songbook.md). */
    songbook: async (id: string): Promise<SongbookSong> => {
      const res = await request(
        `${base()}/api/mediatek/songbook/${encodeURIComponent(id)}`,
      );
      if (!res.ok) throw await failed(res, "songbook");
      return json(res, "songbook");
    },

    /** A song's tags and the file's other tags, read from its master by the song's FOLDER — mediatek's docs/songs.md. */
    songTags: async (
      folder: string,
    ): Promise<{ master: string; tags: MasterTags; others: OtherTags }> => {
      const res = await request(
        `${base()}/api/mediatek/tags?path=${encodeURIComponent(folder)}`,
      );
      if (!res.ok) throw await failed(res, "tags");
      return json(res, "tags");
    },

    /** Rewrite them: a field absent is kept, `""` clears it; answers what the master now says. */
    setSongTags: async (
      folder: string,
      tags: Partial<Record<keyof MasterTags, string | number>>,
    ): Promise<{ master: string; tags: MasterTags }> => {
      const res = await request(
        `${base()}/api/mediatek/tags?path=${encodeURIComponent(folder)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(tags),
        },
      );
      if (!res.ok) throw await failed(res, "tags");
      return json(res, "tags");
    },

    /** Un-declare a variant and remove the file it named (../../docs/api.md). */
    removeVariant: async (folder: string, name: string): Promise<void> => {
      const q = new URLSearchParams({ path: folder, name });
      const res = await request(`${base()}/api/mediatek/variant?${q}`, {
        method: "DELETE",
      });
      if (!res.ok) throw await failed(res, "delete");
    },

    remove: async (path: string): Promise<void> => {
      const res = await request(
        `${base()}/api/mediatek/file?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw await failed(res, "delete");
    },

    /** Move/rename — one server-side syscall, so it works on a folder and can never leave a duplicate. */
    move: async (from: string, to: string): Promise<void> => {
      const res = await request(`${base()}/api/mediatek/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) throw await failed(res, "move");
    },

    newFolder: async (path: string): Promise<void> => {
      const res = await request(`${base()}/api/mediatek/folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw await failed(res, "mkdir");
    },

    /** A whole subtree, on its own route so no caller removes a folder while meaning to remove one entry. */
    removeTree: async (path: string): Promise<void> => {
      const res = await request(
        `${base()}/api/mediatek/folder?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw await failed(res, "delete");
    },

    /** Write one file back. The library replaces — there is no fork. */
    writeFile: async (path: string, content: string): Promise<void> => {
      const res = await request(
        `${base()}/api/mediatek/file?path=${encodeURIComponent(path)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: content,
        },
      );
      if (!res.ok) throw await failed(res, "write");
    },
  };
  return library;
}

export type LibraryClient = ReturnType<typeof libraryAt>;
