// api.ts — one server now: the mediatek's own backend, same-origin. The catalogue lives
// there, so browsing it needs no engine and no local service. The LOCAL cache is what the
// moteur plays from, and nothing on this screen reads it.

import type { RecordingDay } from "@studio/mediatek/recordings";
import type { FamilyListing } from "@studio/mediatek/types";
import type { ModuleStore } from "@studio/ui-module-builder/store";
import {
  ENGINE_TOKEN_HEADER,
  type Hints,
  type ModulePresetsFile,
  type ModuleUiFile,
  type PublicEngine,
  USER_HEADER,
} from "@studio/web-protocol";

// The app is mounted under a path (studio.test/<service>), so every backend
// path below carries it. BASE_URL is vite's `base`; it ends in a slash, trimmed
// here so the literals keep reading as paths.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
}

/** The folder a morceau would land in already holds one. Its own type so the dialogue can
 *  offer to replace instead of showing a status code. */
export class MorceauExists extends Error {}

/**
 * The error a failed response carries, or a status code when it carries none.
 *
 * Every write route answers `{ error }` with a sentence that says WHAT was refused — a path
 * outside the library, a name that is the library's own. Throwing `mkdir 400` instead threw
 * that sentence away, which is how you end up staring at a number: the server knew, and the
 * client dropped it on the floor.
 */
async function failed(
  res: Response,
  what: string,
): Promise<Error & { status?: number }> {
  const detail = (await res.json().catch(() => ({}))) as { error?: string };
  const e: Error & { status?: number } = new Error(
    detail.error ?? `${what} ${res.status}`,
  );
  // Carried, because ONE caller has to tell "there is nothing there" from "it went wrong":
  // a module folder with no module.yaml yet is a state, a dead backend is not.
  e.status = res.status;
  return e;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw await failed(res, what);
  return (await res.json()) as T;
}

const get = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`${BASE}/api/mediatek${path}`), what);

/**
 * Who is signed in, held at module level for the SESSION id.
 *
 * Module state rather than a prop threaded through three components, because this SPA has
 * exactly one gate and therefore exactly one user for its whole life. It is set once, by
 * that gate, before anything below it renders.
 */
let signedInAs = "";
export const currentUser = (): string => signedInAs;

export const auth = {
  // `return_to` is the name the OIDC package reads; `redirect` was silently
  // ignored, which only looked fine while this app owned the origin root.
  loginUrl: `/auth/login?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`,

  /** The session's user, or null when anonymous. */
  me: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    const user = (await json<{ user: AuthUser }>(res, "auth/me")).user;
    // The one place this is learned, so the one place it is recorded.
    signedInAs = user.email ?? user.sub ?? "";
    return user;
  },

  /** Ends the session for the WHOLE origin — studio.sid is shared, so this signs
   *  you out of pistes and m9 too. See apps/pistes/AGENTS.md. */
  logout: async (): Promise<void> => {
    await fetch("/auth/logout", { method: "POST" });
    window.location.reload();
  },
};

/**
 * The engines this service knows about, and what it remembers about you.
 *
 * Its OWN registry, not pistes'. Each hosted service holds one — see
 * packages/engine-registry/docs/shared.md — so an engine appears here only once it has been
 * pointed at the médiathèque too.
 */
/**
 * The engine MACHINE's own file service, reached cross-origin and directly — the same seam
 * pistes uses, and the only way to learn a fact about that machine rather than about the
 * library. This app's backend is hosted: it has no scan cache and never will.
 *
 * The origin has to be trusted on that machine (`~/.studio/web-origins.json`, offered by the
 * tray), exactly as pistes' is; a refusal reads as a network error here, which is why the
 * caller treats an empty list as "cannot say" and not as "no plugins".
 */
export const engineMachine = {
  /** What this machine's engine has scanned, grouped by lowercased format. */
  plugins: async (
    fileBase: string,
    token: string,
  ): Promise<Record<string, string[]>> => {
    const res = await fetch(`${fileBase}/plugins`, {
      headers: {
        [USER_HEADER]: currentUser(),
        [ENGINE_TOKEN_HEADER]: token,
      },
    });
    const { pluginNames } = await json<{
      pluginNames: Record<string, string[]>;
    }>(res, "plugins");
    return pluginNames ?? {};
  },
};

export const engines = {
  list: async () =>
    json<PublicEngine[]>(await fetch(`${BASE}/api/engines`), "engines"),
  /** Take or RENEW the lease, verifying the token server-side. Idempotent by design — the
   *  holder re-POSTs it every ENGINE_ASSIGN_RENEW_MS, because "in use" expires on its own. */
  select: async (id: string, token: string, tier: number) =>
    json<{ ok: true }>(
      await fetch(`${BASE}/api/engine/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, token, tier }),
      }),
      "select",
    ),
  /** The lease's goodbye, as a BEACON so it survives the tab closing — a fetch there is
   *  cancelled with the page. Best-effort by nature, which is why the TTL exists behind it. */
  release: (id: string) =>
    navigator.sendBeacon(
      `${BASE}/api/engine/release`,
      new Blob([JSON.stringify({ id })], { type: "application/json" }),
    ),
  prefs: async () =>
    json<{ engineId?: string }>(
      await fetch(`${BASE}/api/preferences`),
      "preferences",
    ),
  savePrefs: async (p: { engineId?: string }) =>
    json<{ ok: true }>(
      await fetch(`${BASE}/api/preferences`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      }),
      "preferences",
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

  /**
   * A module's panel file — the `ui.yaml` in the module's own folder.
   *
   * The path is derived, not asked for, and the derivation is now `dirname`: the two files are
   * siblings (see `@studio/song`'s uiLibrary.ts). `modulePath` may name either of them, which is
   * what lets a click on the panel open the same builder. Absent is NOT an error — the editor is
   * told where it WOULD go and shown a blank grid, so the first save creates it through the
   * ordinary write route.
   */
  moduleUi: async (modulePath: string): Promise<ModuleUiFile> => {
    // modules/<type>/<name>/<file>.yaml -> modules/<type>/<name>/ui.yaml
    const parts = modulePath.split("/");
    const ref = parts.slice(1, -1).join("/");
    const path = [...parts.slice(0, -1), "ui.yaml"].join("/");
    try {
      const f = await library.readFile(path);
      return { ref, path, content: f.content, exists: true };
    } catch {
      return {
        ref,
        path,
        content: `# panel for ${ref}\ncols: 4\nrows: 2\nwidgets: {}\n`,
        exists: false,
      };
    }
  },

  /**
   * A module's presets file — the `presets.yaml` in the module's own folder. Same derivation as
   * the panel above, and absent is not an error for the same reason.
   */
  modulePresets: async (modulePath: string): Promise<ModulePresetsFile> => {
    const parts = modulePath.split("/");
    const ref = parts.slice(1, -1).join("/");
    const path = [...parts.slice(0, -1), "presets.yaml"].join("/");
    try {
      const f = await library.readFile(path);
      return { ref, path, content: f.content, exists: true };
    } catch {
      return {
        ref,
        path,
        content: `# presets for ${ref}
`,
        exists: false,
      };
    }
  },

  /**
   * What the editor can complete against.
   *
   * A shadow of pistes': most of `Hints` describes a SONG — its tracks, clips, chains — and
   * a library has none of those. What survives is the asset list a widget's library
   * dropdown offers. Parameter names used to come from here too; the engine reports them
   * now (see engine/useModuleEngine), which is a better source anyway — it is the loaded
   * plugin talking rather than a table about it.
   */
  hints: async (): Promise<Hints> => {
    let libraryFiles: string[] = [];
    try {
      const l = await library.list("modules");
      libraryFiles = l.entries.map((e) => e.path);
    } catch {
      /* an unreachable library just means an empty dropdown */
    }
    return {
      baseModules: [],
      ioSinks: [],
      modules: [],
      tracks: [],
      channels: [],
      clips: [],
      videoTracks: [],
      sequences: [],
      chains: [],
      libraryFiles,
      paramsByBase: {},
      paramMetaByBase: {},
      racks: {},
      keywords: [],
      pluginNames: {},
      paths: {},
      projectRoot: "",
      media: {},
    };
  },

  /** Drop OS files into `dir`. The File goes as the body: writeFile takes a string, which
   *  would corrupt every sample the moment one is dropped. */
  upload: async (dir: string, files: File[]): Promise<void> =>
    library.uploadTree(
      dir,
      files.map((file) => ({ path: file.name, file })),
    ),

  /**
   * Drop OS files into `dir`, FOLDERS INCLUDED — each carries the path it sat at.
   *
   * A module is a folder of three files now (`module.yaml`, `ui.yaml`, `presets.yaml`), so
   * "add a module" is a folder drop and a flat file list could not express it. The server
   * creates the intermediate directories (`putFile` in `@studio/mediatek/write`), so one PUT
   * per file is all this has to do; a path with a `..` in it is refused there, not here.
   */
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

  /**
   * The raw capture zone, day by day.
   *
   * Its own call and not a family listing: a capture enters no catalogue, so
   * `/list?family=morceaux` will never mention one. See packages/mediatek/docs/recordings.md.
   */
  recordings: () => get<{ days: RecordingDay[] }>("/recordings", "recordings"),

  /**
   * Push captures in, one request each.
   *
   * Every file carries its OWN moment — its mtime, which for a capture is when it was
   * recorded. A session dragged in the morning after would otherwise land under today,
   * whole, which is the one day it certainly does not belong to.
   */
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
   * File one audio file as a morceau. The THREE TAGS go up, never a path: the library
   * derives `morceaux/imported/<artiste>/<album>/<titre>/original.<ext>` itself. See
   * packages/mediatek/docs/upload.md.
   */
  addMorceau: async (
    file: File,
    tags: { artist: string; album: string; title: string },
    opts: { replace?: boolean } = {},
  ): Promise<{ path: string; master: string; replaced: boolean }> => {
    const q = new URLSearchParams({ filename: file.name, ...tags });
    if (opts.replace) q.set("replace", "1");
    const res = await fetch(`${BASE}/api/mediatek/morceau?${q}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as {
        error?: string;
        exists?: boolean;
      };
      // Told apart from every other refusal, because it is the one the UI can offer to
      // resolve rather than only report.
      if (res.status === 409) throw new MorceauExists(detail.error ?? "");
      throw new Error(detail.error ?? `morceau ${res.status}`);
    }
    return json(res, "morceau");
  },

  remove: async (path: string): Promise<void> => {
    const res = await fetch(
      `${BASE}/api/mediatek/file?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw await failed(res, "delete");
  },

  /** Move/rename — one server-side syscall, so it works on a folder and can never leave a
   *  duplicate. Replaced a read+write+delete dance that could do neither. */
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

  /** A whole subtree. Its own route, so removing a folder is never something a caller does
   *  by accident while meaning to remove one entry. */
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

/**
 * The shared builder's view of this backend (`@studio/ui-module-builder/store`).
 *
 * Four calls, all already here — the adapter is shapes, not behaviour. `write` never reports a
 * redirection because there is none to report: the library is one place, and the workspace a
 * copy used to land in is now somebody else's machine.
 */
export const moduleStore: ModuleStore = {
  // A file the library hasn't got is `null`, not a throw: a module folder with no module.yaml
  // yet is a real state here, and the builder opens on an empty buffer (see ModuleStore.read).
  read: async (path) => {
    try {
      return (await library.readFile(path)).content;
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  },
  moduleUi: (path) => library.moduleUi(path),
  presets: (path) => library.modulePresets(path),
  hints: () => library.hints(),
  write: async (path, content) => {
    await library.writeFile(path, content);
    return {};
  },
};
