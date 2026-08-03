// api.ts — one server now: the mediatek's own backend, same-origin. The catalogue lives
// there, so browsing it needs no engine and no local service. The LOCAL cache is what the
// moteur plays from, and nothing on this screen reads it.

import type { MediatekEntry } from "@studio/mediatek/types";
import type { Hints, ModuleUiFile, PublicEngine } from "@studio/web-protocol";

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} ${res.status}`);
  return (await res.json()) as T;
}

const get = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`/api/mediatek${path}`), what);

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
  loginUrl: `/auth/login?redirect=${encodeURIComponent(window.location.pathname)}`,

  /** The session's user, or null when anonymous. */
  me: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    const user = (await json<{ user: AuthUser }>(res, "auth/me")).user;
    // The one place this is learned, so the one place it is recorded.
    signedInAs = user.email ?? user.sub ?? "";
    return user;
  },
};

/**
 * The engines this service knows about, and what it remembers about you.
 *
 * Its OWN registry, not lanes'. Each hosted service holds one — see
 * packages/engine-registry/docs/shared.md — so an engine appears here only once it has been
 * pointed at the médiathèque too.
 */
export const engines = {
  list: async () =>
    json<PublicEngine[]>(await fetch("/api/engines"), "engines"),
  /** Mark it in use, and verify the token server-side. Same lease lanes takes. */
  select: async (id: string, token: string, tier: number) =>
    json<{ ok: true }>(
      await fetch("/api/engine/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, token, tier }),
      }),
      "select",
    ),
  prefs: async () =>
    json<{ engineId?: string }>(await fetch("/api/preferences"), "preferences"),
  savePrefs: async (p: { engineId?: string }) =>
    json<{ ok: true }>(
      await fetch("/api/preferences", {
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
    get<{ family: string; rev: string; entries: MediatekEntry[] }>(
      `/list?family=${encodeURIComponent(family)}`,
      "list",
    ),

  /** A file's bytes, for an <audio>/<video> src. Served with Range, so seeking works. */
  fileUrl: (path: string) =>
    `/api/mediatek/file?path=${encodeURIComponent(path)}`,

  /** One file's text. The library serves bytes; a module is YAML, so this reads it back. */
  readFile: async (
    path: string,
  ): Promise<{ path: string; content: string }> => {
    const res = await fetch(
      `/api/mediatek/file?path=${encodeURIComponent(path)}`,
    );
    if (!res.ok) throw new Error(`file ${res.status}`);
    return { path, content: await res.text() };
  },

  /**
   * A module's panel file, read from the library's `ui/` folder.
   *
   * The path is derived, not asked for: a panel mirrors the module's own path under `ui/`,
   * which is the same filing rule `@studio/song`'s uiPathFor applies. Absent is NOT an
   * error — the editor is told where it WOULD go and shown a blank grid, so the first save
   * creates it through the ordinary write route.
   */
  moduleUi: async (modulePath: string): Promise<ModuleUiFile> => {
    // modules/<type>/<name>/module.yaml -> ui/<type>/<name>.yaml
    const parts = modulePath.split("/");
    const ref = parts.slice(1, -1).join("/");
    const path = `ui/${ref}.yaml`;
    try {
      const f = await library.readFile(path);
      return { ref, path, content: f.content, exists: true };
    } catch {
      return {
        ref,
        path,
        content: `ref: ${ref}\ncols: 4\nrows: 2\nwidgets: {}\n`,
        exists: false,
      };
    }
  },

  /**
   * What the editor can complete against.
   *
   * A shadow of lanes': most of `Hints` describes a SONG — its tracks, clips, chains — and
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

  /** Write one file back. The library replaces — there is no fork, see docs/ingest.md. */
  writeFile: async (path: string, content: string): Promise<void> => {
    const res = await fetch(
      `/api/mediatek/file?path=${encodeURIComponent(path)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: content,
      },
    );
    if (!res.ok) throw new Error(`write ${res.status}`);
  },
};
