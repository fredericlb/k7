// api.ts — the media library's routes on the host's backend, under `apiBase()`. The catalogue lives
// there, so browsing it needs no engine and no local service. The base is read at CALL time, the
// host setting it once through `configureLibrary` (../docs/host.md).

import { type EngineAccess, engineAccess } from "@studio/engine-browser/access";
import {
  failed,
  fetchWithin,
  readJson as json,
} from "@studio/http-client/call";
import { upload } from "@studio/http-client/upload";
import type { PlaylistSummary } from "@studio/mediatek/playlists";
import type { RecordingDay } from "@studio/mediatek/recordings";
import type { FamilyListing, LibraryPlacement } from "@studio/mediatek/types";
import type { PublicEngine } from "@studio/web-protocol";
import type { HuntList, HuntRecord } from "@studio/web-protocol/hunt";
import type {
  SlskdCheck,
  SlskdSettings,
  SlskdSettingsInput,
} from "@studio/web-protocol/settings";
import { apiBase, libraryConfig } from "./config";
// Type only, so the cycle with prefs.ts never reaches the bundle — see ../docs/api.md.
import type { Pl8Prefs } from "./prefs";

/** The folder a song would land in already holds one — its own type so the dialogue can offer to replace. */
export class SongExists extends Error {}

/** What a call may take before it is given up on — ../docs/audit.md. */
const TIMEOUT_MS = 30_000;
/** The host's transport answers from memory: past this, it is not coming. */
const PLAYER_MS = 10_000;
/** A decode may queue behind two others on the server before it even starts. */
const ANALYSE_MS = 10 * 60_000;

/** `fetch` within `ms` — null for an upload, which a slow link makes long and only the user may cut. */
const request = (
  url: string,
  init: RequestInit = {},
  ms: number | null = TIMEOUT_MS,
): Promise<Response> =>
  fetchWithin(url, init, ms, (s) => new Error(libraryConfig().noAnswer(s)));

const get = async <T>(path: string, what: string): Promise<T> =>
  json(await request(`${apiBase()}/api/mediatek${path}`), what);

/** What a machine's player reports about itself, with the path it was ASKED FOR (../docs/api.md). */
export interface MachinePlayerState {
  path: string | null;
  playing: boolean;
  position: number;
  duration: number;
  /** Nothing left to play — the end of a track, or nothing was ever loaded. */
  idle: boolean;
}

/**
 * This service's own player: mpv on the HOST's outputs, same origin and on the session cookie.
 * The library is right there, so a relative path is all that crosses — packages/mpv-player/docs/mpvPlayer.md.
 */
export const player = {
  /** False only when the host has no player routes, i.e. no mpv; any other failure says nothing. */
  available: async (): Promise<boolean> =>
    request(`${apiBase()}/api/player`, {}, PLAYER_MS).then(
      (res) => res.status !== 404,
      () => true,
    ),

  state: async (): Promise<MachinePlayerState> =>
    json(await request(`${apiBase()}/api/player`, {}, PLAYER_MS), "player"),

  play: async (path: string, from = 0): Promise<MachinePlayerState> =>
    json(
      await request(
        `${apiBase()}/api/player/play`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, from }),
        },
        PLAYER_MS,
      ),
      "player",
    ),

  pause: async (paused: boolean): Promise<MachinePlayerState> =>
    json(
      await request(
        `${apiBase()}/api/player/pause`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paused }),
        },
        PLAYER_MS,
      ),
      "player",
    ),

  seek: async (to: number): Promise<MachinePlayerState> =>
    json(
      await request(
        `${apiBase()}/api/player/seek`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to }),
        },
        PLAYER_MS,
      ),
      "player",
    ),

  stop: async (): Promise<void> => {
    await request(
      `${apiBase()}/api/player/stop`,
      { method: "POST" },
      PLAYER_MS,
    ).catch(() => {});
  },
};

type Engines = EngineAccess<PublicEngine, Pl8Prefs>;
let access: { base: string; engines: Engines } | null = null;

/** THE engine registry, bound to the CURRENT base and rebuilt only when the host moves it (../docs/api.md). */
export function engines(): Engines {
  const base = apiBase();
  if (access?.base !== base)
    access = {
      base,
      engines: engineAccess<PublicEngine, Pl8Prefs>(base, json),
    };
  return access.engines;
}

// `/api/projects` and `/api/shares` are this service's routes, called from k7 (../docs/api.md).

/** `/api/hunt`, its own prefix: what answers is a daemon on another machine, not this volume. */
const hget = async <T>(path: string, what: string): Promise<T> =>
  json(await request(`${apiBase()}/api/hunt${path}`), what);

/** Finding a song on Soulseek. Starting one ANSWERS AT ONCE with the row — see ../docs/hunt.md. */
export const hunt = {
  list: () => hget<HuntList>("", "hunt"),

  /** A hunt files the song into the media library and stops there; a playlist is out of its reach. */
  start: async (query: string): Promise<HuntRecord> =>
    json(
      await request(`${apiBase()}/api/hunt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      }),
      "hunt",
    ),

  /** The fallback on a failed row: retry THAT hunt through YouTube, so the tags file it in the same place. */
  youtube: async (id: string): Promise<HuntRecord> =>
    json(
      await request(`${apiBase()}/api/hunt/${encodeURIComponent(id)}/youtube`, {
        method: "POST",
      }),
      "youtube",
    ),

  /** Cancels it if it is still running, and takes the row off the list either way. */
  forget: async (id: string): Promise<void> => {
    await json(
      await request(`${apiBase()}/api/hunt/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
      "hunt",
    );
  },
};

/** The instance's slskd settings — the secrets go in and never come back (../docs/settings.md). */
export const settings = {
  slskd: async (): Promise<SlskdSettings> =>
    json(await request(`${apiBase()}/api/settings/slskd`), "settings"),

  saveSlskd: async (input: SlskdSettingsInput): Promise<SlskdSettings> =>
    json(
      await request(`${apiBase()}/api/settings/slskd`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      "settings",
    ),

  /** Tests what is SAVED, not what is typed: the screen saves first. */
  checkSlskd: async (): Promise<SlskdCheck> =>
    json(
      await request(
        `${apiBase()}/api/settings/slskd/check`,
        { method: "POST" },
        2 * TIMEOUT_MS,
      ),
      "settings",
    ),
};

export const library = {
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

  /** Where each entry lives on a machine paired with a server — ../../mediatek/docs/serverCopy.md. */
  placement: async (family: string): Promise<LibraryPlacement> =>
    json(
      await request(
        `${apiBase()}/api/sync/library?family=${encodeURIComponent(family)}`,
      ),
      "placement",
    ),

  /** Bring server-only entries down to this machine — one, an album, a playlist's; unbounded, since a song's master is long. */
  download: async (family: string, paths: string[]): Promise<void> => {
    await json(
      await request(
        `${apiBase()}/api/sync/library/download`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ family, paths }),
        },
        null,
      ),
      "download",
    );
  },

  /** A file's bytes, for an <audio>/<video> src. Served with Range, so seeking works. */
  fileUrl: (path: string) =>
    `${apiBase()}/api/mediatek/file?path=${encodeURIComponent(path)}`,

  /** The same, but a FLAC comes as the Opus copy beside it — what a browser plays (apps/k7/backend/docs/media/derivedStream.md). */
  streamUrl: (path: string) =>
    `${apiBase()}/api/mediatek/stream?path=${encodeURIComponent(path)}`,

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
      `${apiBase()}/api/mediatek/file?path=${encodeURIComponent(path)}`,
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
        `${apiBase()}/api/mediatek/file?path=${encodeURIComponent(path)}`,
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
  recordings: () => get<{ days: RecordingDay[] }>("/recordings", "recordings"),

  /** The set lists this volume holds — its own call too, no family scan reaching the zone. */
  playlists: () =>
    get<{ playlists: PlaylistSummary[] }>("/playlists", "playlists"),

  /** Create one from the stub. Its text is then read and written with readFile/writeFile. */
  newPlaylist: async (name: string): Promise<PlaylistSummary> => {
    const res = await request(`${apiBase()}/api/mediatek/playlists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw await failed(res, "playlist");
    return ((await res.json()) as { playlist: PlaylistSummary }).playlist;
  },

  /** Push captures in, one request each, so every file carries its OWN mtime (../docs/api.md). */
  addRecordings: async (files: File[], signal?: AbortSignal): Promise<void> => {
    for (const file of files) {
      const q = new URLSearchParams({
        filename: file.name,
        at: new Date(file.lastModified).toISOString(),
      });
      const res = await request(
        `${apiBase()}/api/mediatek/recording?${q}`,
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
      `${apiBase()}/api/mediatek/analyse`,
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
    const res = await upload(`${apiBase()}/api/mediatek/song?${q}`, {
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
      `${apiBase()}/api/mediatek/variant?${q}`,
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

  /** Un-declare a variant and remove the file it named (../../docs/api.md). */
  removeVariant: async (folder: string, name: string): Promise<void> => {
    const q = new URLSearchParams({ path: folder, name });
    const res = await request(`${apiBase()}/api/mediatek/variant?${q}`, {
      method: "DELETE",
    });
    if (!res.ok) throw await failed(res, "delete");
  },

  remove: async (path: string): Promise<void> => {
    const res = await request(
      `${apiBase()}/api/mediatek/file?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw await failed(res, "delete");
  },

  /** Move/rename — one server-side syscall, so it works on a folder and can never leave a duplicate. */
  move: async (from: string, to: string): Promise<void> => {
    const res = await request(`${apiBase()}/api/mediatek/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    });
    if (!res.ok) throw await failed(res, "move");
  },

  newFolder: async (path: string): Promise<void> => {
    const res = await request(`${apiBase()}/api/mediatek/folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw await failed(res, "mkdir");
  },

  /** A whole subtree, on its own route so no caller removes a folder while meaning to remove one entry. */
  removeTree: async (path: string): Promise<void> => {
    const res = await request(
      `${apiBase()}/api/mediatek/folder?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw await failed(res, "delete");
  },

  /** Write one file back. The library replaces — there is no fork. */
  writeFile: async (path: string, content: string): Promise<void> => {
    const res = await request(
      `${apiBase()}/api/mediatek/file?path=${encodeURIComponent(path)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: content,
      },
    );
    if (!res.ok) throw await failed(res, "write");
  },
};
