// api.ts — one server now: pl8's own backend, same-origin. The catalogue lives
// there, so browsing it needs no engine and no local service. The LOCAL cache is what the
// moteur plays from, and nothing on this screen reads it.

import { engineAccess } from "@studio/engine-browser/access";
import type { RecordingDay } from "@studio/mediatek/recordings";
import type { FamilyListing } from "@studio/mediatek/types";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import {
  type CloneJob,
  ENGINE_TOKEN_HEADER,
  type PublicEngine,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import type { HuntList, HuntRecord } from "@studio/web-protocol/hunt";
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
  get loginUrl(): string {
    const here = window.location.pathname + window.location.search;
    return `/auth/login?return_to=${encodeURIComponent(here)}`;
  },

  /** The session's user, or null when anonymous. */
  me: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    const user = (await json<{ user: AuthUser }>(res, "auth/me")).user;
    // The one place this is learned, so the one place it is recorded.
    signedInAs = user.email ?? user.sub ?? "";
    return user;
  },

  /** Ends the session for the WHOLE origin — studio.sid is shared. See apps/st0/AGENTS.md. */
  logout: async (): Promise<void> => {
    await fetch("/auth/logout", { method: "POST" });
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

/** What the file service's gate wants on every call: who is asking, and the machine's token. */
const machineHeaders = (token: string): Record<string, string> => ({
  [USER_HEADER]: currentUser(),
  [ENGINE_TOKEN_HEADER]: token,
});

/** The engine MACHINE's own file service, cross-origin and the only side that knows a disk (../docs/api.md). */
export const engineMachine = {
  /** Ask that machine to analyse a library file, and CANCEL when the tab moves on (../docs/api.md). */
  analyse: async (
    fileBase: string,
    token: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<{ bpm: number; bpmSet: boolean; transients: number }> => {
    const res = await fetch(`${fileBase}/mediatek/analyse`, {
      method: "POST",
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path }),
      signal,
    });
    return json(res, "analyse");
  },

  /** Wipe that machine's waveform cache — the tray's « Clear waveform cache ». Returns how many went. */
  clearWaveforms: async (fileBase: string, token: string): Promise<number> => {
    const res = await fetch(`${fileBase}/waveforms/clear`, {
      method: "POST",
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
      },
    });
    const { removed } = await json<{ removed: number }>(res, "waveforms");
    return removed ?? 0;
  },

  /** Which interface that machine is REMEMBERING, with null for "(system default)" (../docs/api.md). */
  audioDevicePref: async (
    fileBase: string,
    token: string,
  ): Promise<string | null> => {
    const res = await fetch(`${fileBase}/preferences`, {
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
      },
    });
    const { audioDevice } = await json<{ audioDevice: string | null }>(
      res,
      "preferences",
    );
    return audioDevice ?? null;
  },

  setAudioDevice: async (
    fileBase: string,
    token: string,
    name: string,
    type?: string,
  ): Promise<string | null> => {
    const res = await fetch(`${fileBase}/preferences/audio-device`, {
      method: "PUT",
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, ...(type ? { type } : {}) }),
    });
    const { audioDevice } = await json<{ audioDevice: string | null }>(
      res,
      "audio-device",
    );
    return audioDevice ?? null;
  },

  /** The tail of that machine's merged log — what the tray's « Show logs » opens, minus the editor. */
  logs: async (
    fileBase: string,
    token: string,
    tail = 300,
  ): Promise<string[]> => {
    const res = await fetch(`${fileBase}/logs?tail=${tail}`, {
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
      },
    });
    const { lines } = await json<{ lines: string[] }>(res, "logs");
    return lines ?? [];
  },

  // The machine's channel LABELS and its `plugins` scan were read here, for the builder (../docs/api.md).

  /** Which of this machine's workspaces already holds that repository, or `null` — pl8 names it by URI. */
  workspaceForRepo: async (
    fileBase: string,
    token: string,
    uri: string,
  ): Promise<string | null> => {
    const res = await fetch(
      `${fileBase}/workspaces/by-repo?uri=${encodeURIComponent(uri)}`,
      { headers: machineHeaders(token) },
    );
    const { workspace } = await json<{ workspace: string | null }>(
      res,
      "workspace",
    );
    return workspace ?? null;
  },

  /** Start the clone and return the job to poll: a real repository outlasts a request (../docs/api.md). */
  startClone: async (
    fileBase: string,
    token: string,
    uri: string,
  ): Promise<CloneJob> =>
    json(
      await fetch(`${fileBase}/workspaces/clone`, {
        method: "POST",
        headers: {
          ...machineHeaders(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({ uri }),
      }),
      "clone",
    ),

  /** …and poll it. `null` for a job the machine has forgotten: nothing can wait on state nobody holds. */
  cloneJob: async (
    fileBase: string,
    token: string,
    id: string,
  ): Promise<CloneJob | null> => {
    const res = await fetch(
      `${fileBase}/workspaces/clone/${encodeURIComponent(id)}`,
      { headers: machineHeaders(token) },
    );
    if (res.status === 404) return null;
    return json(res, "clone");
  },

  /** Create a project: `name` carries its suffix, and `shape` is a field of its own (../docs/api.md). */
  createProject: async (
    fileBase: string,
    token: string,
    workspace: string,
    name: string,
    shape: ProjectShape,
  ): Promise<string> => {
    const { project } = await json<{ project: string }>(
      await fetch(`${fileBase}/project/create`, {
        method: "POST",
        headers: {
          ...machineHeaders(token),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ shape, name }),
      }),
      "création",
    );
    return project;
  },

  /** Unload the project and BIN its folder — the commit that follows is what removes it from the repository. */
  deleteProject: async (
    fileBase: string,
    token: string,
    workspace: string,
    path: string,
  ): Promise<void> => {
    await json(
      await fetch(`${fileBase}/project/delete`, {
        method: "POST",
        headers: {
          ...machineHeaders(token),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ path }),
      }),
      "suppression",
    );
  },

  /** THIS machine's player: mpv on its own outputs, without the engine (packages/file-service/docs/machinePlayer.md). */
  player: {
    state: async (
      fileBase: string,
      token: string,
    ): Promise<MachinePlayerState> =>
      json(
        await fetch(`${fileBase}/player`, { headers: machineHeaders(token) }),
        "lecteur",
      ),

    play: async (
      fileBase: string,
      token: string,
      path: string,
      from = 0,
    ): Promise<MachinePlayerState> =>
      json(
        await fetch(`${fileBase}/player/play`, {
          method: "POST",
          headers: {
            ...machineHeaders(token),
            "content-type": "application/json",
          },
          body: JSON.stringify({ path, from }),
        }),
        "lecteur",
      ),

    pause: async (
      fileBase: string,
      token: string,
      paused: boolean,
    ): Promise<MachinePlayerState> =>
      json(
        await fetch(`${fileBase}/player/pause`, {
          method: "POST",
          headers: {
            ...machineHeaders(token),
            "content-type": "application/json",
          },
          body: JSON.stringify({ paused }),
        }),
        "lecteur",
      ),

    seek: async (
      fileBase: string,
      token: string,
      to: number,
    ): Promise<MachinePlayerState> =>
      json(
        await fetch(`${fileBase}/player/seek`, {
          method: "POST",
          headers: {
            ...machineHeaders(token),
            "content-type": "application/json",
          },
          body: JSON.stringify({ to }),
        }),
        "lecteur",
      ),

    stop: async (fileBase: string, token: string): Promise<void> => {
      await fetch(`${fileBase}/player/stop`, {
        method: "POST",
        headers: machineHeaders(token),
      }).catch(() => {});
    },
  },

  /** This machine's command line, for the one verb needed here: `commit`, which pushes with the deploy key. */
  command: async (
    fileBase: string,
    token: string,
    workspace: string,
    line: string,
  ): Promise<string[]> => {
    const { output } = await json<{ output: string[] }>(
      await fetch(`${fileBase}/command`, {
        method: "POST",
        headers: {
          ...machineHeaders(token),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ line }),
      }),
      "commande",
    );
    return output ?? [];
  },
};

/** This service's OWN registry, bound to its prefix and typed on the host's prefs (../docs/api.md). */
export const engines = engineAccess<PublicEngine, Pl8Prefs>(BASE, json);

// `/api/projects` and `/api/shares` were clients here; the routes stayed, the drawing went (../docs/api.md).

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

  // `baseModules` and `addEngineFaces` stood here; both went with the `modules` family (../docs/api.md).

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

  // The three module sidecars and `hints` were derived here, for the builder (../docs/api.md).

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

// `moduleStore` stood here, handing this backend's three calls to the shared builder (../docs/api.md).
