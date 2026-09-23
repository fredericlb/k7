// api.ts — one server now: pl8's own backend, same-origin. The catalogue lives
// there, so browsing it needs no engine and no local service. The LOCAL cache is what the
// moteur plays from, and nothing on this screen reads it.

import { engineAccess } from "@studio/engine-browser/access";
import type { PlaylistSummary } from "@studio/mediatek/playlists";
import type { RecordingDay } from "@studio/mediatek/recordings";
import type { FamilyListing } from "@studio/mediatek/types";
import type { PublicEngine, SyncJob } from "@studio/web-protocol";
import type { HuntList, HuntRecord } from "@studio/web-protocol/hunt";
import { authOrigin } from "@studio/web-protocol/services";
import type {
  SlskdCheck,
  SlskdSettings,
  SlskdSettingsInput,
} from "@studio/web-protocol/settings";
// Type only, so the cycle with prefs.ts never reaches the bundle — see ../docs/api.md.
import type { Pl8Prefs } from "./prefs";

// This app's prefix, which every backend path below concatenates and `/auth/*` must not (../docs/api.md).
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
}

/** The folder a song would land in already holds one — its own type so the dialogue can offer to replace. */
export class SongExists extends Error {}

/** The sentence a failed response carries, or a status code when it carries none (../docs/api.md). */
async function failed(
  res: Response,
  what: string,
): Promise<Error & { status?: number }> {
  const detail = (await res.json().catch(() => ({}))) as { error?: string };
  const e: Error & { status?: number } = new Error(
    detail.error ?? `${what} ${res.status}`,
  );
  // Carried, because ONE caller has to tell "there is nothing there" from "it went wrong".
  e.status = res.status;
  return e;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw await failed(res, what);
  return (await res.json()) as T;
}

const get = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`${BASE}/api/mediatek${path}`), what);

/** Who is signed in, at module level because this SPA has exactly one gate (../docs/api.md). */
let signedInAs = "";
export const currentUser = (): string => signedInAs;

export const auth = {
  // A GETTER and not a constant, and `return_to` is the name the OIDC package reads (../docs/api.md).
  // Absolute, both the login URL and return_to: on pl8's own subdomain, the
  // account flow lives at the family root (authOrigin), a DIFFERENT origin —
  // and return_to has to survive that round trip back to THIS one.
  get loginUrl(): string {
    const origin = window.location.origin;
    const here = origin + window.location.pathname + window.location.search;
    return `${authOrigin(origin)}/auth/login?return_to=${encodeURIComponent(here)}`;
  },

  /**
   * The session's user, or null when anonymous. Absolute + credentials:
   * "include" — same reason as loginUrl: /auth/* only exists at the family
   * root, a DIFFERENT origin from pl8's own subdomain, and a cross-origin
   * fetch doesn't send cookies at all without this.
   */
  me: async (): Promise<AuthUser | null> => {
    const res = await fetch(`${authOrigin(window.location.origin)}/auth/me`, {
      credentials: "include",
    });
    if (res.status === 401) return null;
    const user = (await json<{ user: AuthUser }>(res, "auth/me")).user;
    // The one place this is learned, so the one place it is recorded.
    signedInAs = user.email ?? user.sub ?? "";
    return user;
  },

  /** Ends the session for the WHOLE origin — studio.sid is shared. See apps/st0/AGENTS.md. */
  logout: async (): Promise<void> => {
    await fetch(`${authOrigin(window.location.origin)}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    window.location.reload();
  },
};

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
  state: async (): Promise<MachinePlayerState> =>
    json(await fetch(`${BASE}/api/player`), "lecteur"),

  play: async (path: string, from = 0): Promise<MachinePlayerState> =>
    json(
      await fetch(`${BASE}/api/player/play`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, from }),
      }),
      "lecteur",
    ),

  pause: async (paused: boolean): Promise<MachinePlayerState> =>
    json(
      await fetch(`${BASE}/api/player/pause`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused }),
      }),
      "lecteur",
    ),

  seek: async (to: number): Promise<MachinePlayerState> =>
    json(
      await fetch(`${BASE}/api/player/seek`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      }),
      "lecteur",
    ),

  stop: async (): Promise<void> => {
    await fetch(`${BASE}/api/player/stop`, { method: "POST" }).catch(() => {});
  },
};

/** THE engine registry — st0 and z0 list theirs from here too — bound to this prefix and typed on the host's prefs (../docs/api.md). */
export const engines = engineAccess<PublicEngine, Pl8Prefs>(BASE, json);

// `/api/projects` and `/api/shares` are this service's routes, called from st0 (../docs/api.md).

/** `/api/hunt`, its own prefix: what answers is a daemon on another machine, not this volume. */
const hget = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`${BASE}/api/hunt${path}`), what);

/** Finding a song on Soulseek. Starting one ANSWERS AT ONCE with the row — see ../docs/hunt.md. */
export const hunt = {
  list: () => hget<HuntList>("", "hunt"),

  /** A hunt files the song into the médiathèque and stops there; a playlist is out of this service's reach. */
  start: async (query: string): Promise<HuntRecord> =>
    json(
      await fetch(`${BASE}/api/hunt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      }),
      "hunt",
    ),

  /** The fallback on a failed row: retry THAT hunt through YouTube, so the tags file it in the same place. */
  youtube: async (id: string): Promise<HuntRecord> =>
    json(
      await fetch(`${BASE}/api/hunt/${encodeURIComponent(id)}/youtube`, {
        method: "POST",
      }),
      "youtube",
    ),

  /** Cancels it if it is still running, and takes the row off the list either way. */
  forget: async (id: string): Promise<void> => {
    await json(
      await fetch(`${BASE}/api/hunt/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
      "hunt",
    );
  },
};

/** The instance's slskd settings — the secrets go in and never come back (../docs/settings.md). */
export const settings = {
  slskd: async (): Promise<SlskdSettings> =>
    json(await fetch(`${BASE}/api/settings/slskd`), "settings"),

  saveSlskd: async (input: SlskdSettingsInput): Promise<SlskdSettings> =>
    json(
      await fetch(`${BASE}/api/settings/slskd`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      "settings",
    ),

  /** Tests what is SAVED, not what is typed: the screen saves first. */
  checkSlskd: async (): Promise<SlskdCheck> =>
    json(
      await fetch(`${BASE}/api/settings/slskd/check`, { method: "POST" }),
      "settings",
    ),
};

/** One target as the machine offers it: the URI is already blanked, so this may be shown. */
export interface SyncTargetRow {
  name: string;
  uri: string;
  scheme: string | null;
}

/** Copying a set list onto a machine's target. The engine holds the URI; here it is a NAME. */
export const sync = {
  /** What that machine can copy to — its URIs already blanked of any password. */
  targets: async (engineId: string) =>
    json<{ targets: SyncTargetRow[] }>(
      await fetch(
        `${BASE}/api/sync/targets?engineId=${encodeURIComponent(engineId)}`,
      ),
      "targets",
    ),

  start: async (playlist: string, engineId: string, target: string) => {
    const res = await fetch(`${BASE}/api/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playlist, engineId, target }),
    });
    return json<{ job: SyncJob; skipped: string[] }>(res, "sync");
  },

  status: async (id: string, engineId: string) =>
    json<SyncJob>(
      await fetch(
        `${BASE}/api/sync/${encodeURIComponent(id)}?engineId=${encodeURIComponent(engineId)}`,
      ),
      "sync",
    ),
};

export const library = {
  summary: () =>
    get<{ present: boolean; counts: Record<string, number> }>("", "mediatek"),

  revisions: () =>
    get<{ present: boolean; revisions: Record<string, string> }>(
      "/revision",
      "revision",
    ),

  list: (family: string) =>
    get<FamilyListing>(`/list?family=${encodeURIComponent(family)}`, "list"),

  /** A file's bytes, for an <audio>/<video> src. Served with Range, so seeking works. */
  fileUrl: (path: string) =>
    `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,

  /** Does the library hold this file? One BYTE, not the file, and a refusal reads as absent (../docs/api.md). */
  exists: async (path: string): Promise<boolean> => {
    try {
      const res = await fetch(library.fileUrl(path), {
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
    const res = await fetch(
      `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,
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
      const res = await fetch(
        `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        },
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
    const res = await fetch(`${BASE}/api/mediatek/playlists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw await failed(res, "playlist");
    return ((await res.json()) as { playlist: PlaylistSummary }).playlist;
  },

  /** Push captures in, one request each, so every file carries its OWN mtime (../docs/api.md). */
  addRecordings: async (files: File[]): Promise<void> => {
    for (const file of files) {
      const q = new URLSearchParams({
        filename: file.name,
        at: new Date(file.lastModified).toISOString(),
      });
      const res = await fetch(`${BASE}/api/mediatek/recording?${q}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      });
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
    const res = await fetch(`${BASE}/api/mediatek/analyse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
      signal,
    });
    return json(res, "analyse");
  },

  /** File one audio file as a song: the THREE TAGS go up and never a path (packages/mediatek/docs/songs.md). */
  addSong: async (
    file: File,
    tags: { artist: string; album: string; title: string },
    opts: { replace?: boolean } = {},
  ): Promise<{ path: string; master: string; replaced: boolean }> => {
    const q = new URLSearchParams({ filename: file.name, ...tags });
    if (opts.replace) q.set("replace", "1");
    const res = await fetch(`${BASE}/api/mediatek/song?${q}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
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
    const res = await fetch(`${BASE}/api/mediatek/variant?${q}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    if (!res.ok) throw await failed(res, `${file.name}:`);
    return json(res, "variant");
  },

  /** Un-declare a variant and remove the file it named (../../docs/api.md). */
  removeVariant: async (folder: string, name: string): Promise<void> => {
    const q = new URLSearchParams({ path: folder, name });
    const res = await fetch(`${BASE}/api/mediatek/variant?${q}`, {
      method: "DELETE",
    });
    if (!res.ok) throw await failed(res, "delete");
  },

  remove: async (path: string): Promise<void> => {
    const res = await fetch(
      `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw await failed(res, "delete");
  },

  /** Move/rename — one server-side syscall, so it works on a folder and can never leave a duplicate. */
  move: async (from: string, to: string): Promise<void> => {
    const res = await fetch(`${BASE}/api/mediatek/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    });
    if (!res.ok) throw await failed(res, "move");
  },

  newFolder: async (path: string): Promise<void> => {
    const res = await fetch(`${BASE}/api/mediatek/folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw await failed(res, "mkdir");
  },

  /** A whole subtree, on its own route so no caller removes a folder while meaning to remove one entry. */
  removeTree: async (path: string): Promise<void> => {
    const res = await fetch(
      `${BASE}/api/mediatek/folder?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw await failed(res, "delete");
  },

  /** Write one file back. The library replaces — there is no fork, see docs/ingest.md. */
  writeFile: async (path: string, content: string): Promise<void> => {
    const res = await fetch(
      `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: content,
      },
    );
    if (!res.ok) throw await failed(res, "write");
  },
};
