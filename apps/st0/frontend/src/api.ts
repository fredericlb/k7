// api.ts — the typed client. Three destinations now:
//   • the hosted backend (same-origin at the ROOT, cookie): the engine registry AND the
//     origin's OIDC flow at /auth/* — st0 is the service with no prefix, so both are its.
//   • the engine-side file service (cross-origin, header-auth): all file/workspace ops.
//   • pl8's médiathèque (same-origin under /pl8, cookie): the songs a playlist names.
// The file service base + the identity/workspace/engine-token headers are set by
// configureFileApi once an engine is chosen and the repository is resolved (see ProjectGate).

import { engineAccess } from "@studio/engine-browser/access";
import type { EnginePrefs } from "@studio/engine-browser/registry";
import type { ParamMeta } from "@studio/engine-protocol";
import { FAUST_FILE, JSDSP_FILE } from "@studio/engine-protocol/build";
import type { FamilyListing, MediatekEntry } from "@studio/mediatek/types";
import { cfg, fget, fileHeaders, fsend } from "@studio/project-shell/fileApi";
import { projectApi } from "@studio/project-shell/project";
import type { ModuleStore } from "@studio/ui-module-builder/store";
import { serviceUrl } from "@studio/web-protocol/services";
import type { CommandPrefs } from "./commandPrefs";
import { libraryModuleRef } from "./libraryTree";
import type {
  PlaylistInfo,
  PresetInfo,
  PreviewReq,
  PublicEngine,
  WaveformStatus,
  WebTrack,
  WebWaveform,
} from "./types";

// The app is mounted at the ORIGIN ROOT (st0.priv.frediver.se), so BASE is the empty string and
// every backend path below is simply what it reads as. BASE_URL is vite's `base`; it ends in a
// slash, trimmed here so the literals keep reading as paths — and `/` trims to "".
//
// Kept as a derived constant rather than deleted now that it is empty: it was `/st0` until the
// médiathèque moved to `/pl8`, this app is the one whose mount can still change, and a prefix
// spelled into thirty routes is not something to have to find again. The engine probe imports
// it for the same reason — the relay answers under this same prefix, whatever it is.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── The hosted backend (same-origin): auth + registry ───────────────────────────
// The registry's own five routes are `engines` below and are not spelled here; auth is three
// bare fetches. This app's own `get`/`send` went with them — the registry was their only
// caller once the workspace routes moved to the file service.

/** The reader `@studio/engine-browser` wants: it owns the routes, this app owns the errors. */
async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok)
    throw new Error(
      ((await res.json().catch(() => ({}))) as { error?: string }).error ??
        `${what} ${res.status}`,
    );
  return res.json() as Promise<T>;
}

/**
 * Everything this browser does to reach an engine: the registry's five routes, the probe, the
 * choice and the lease — bound to this app's own prefix once (`BASE`, now the origin root).
 * One object rather than five hand-spelled routes,
 * which is the drift `@studio/engine-browser/registry` exists to stop. See that package's
 * docs/access.md.
 */
/**
 * st0's own preference document: the engine every service remembers, plus what this person has made
 * of the command catalogue (names, icons, menu order — see commandPrefs.ts).
 *
 * Widening `P` is how a host adds a field, exactly as `EnginePrefs`' own comment says: the schema
 * belongs to the host, and a union of every service's fields would be a shape no service has.
 *
 * It is HALF of adding one, though, and this comment used to stop here. The zod schema in
 * `backend/src/server.ts` is what actually decides — a zod object strips what it does not
 * declare — so `commands` was saved, answered `{ok:true}` and dropped for as long as that schema
 * said "one field so far". Widening this type does not widen it. The router refuses such a write
 * out loud now (`droppedKeys` in `@studio/user-prefs/router`), which is how the next one will be
 * found in a second rather than on the next reload.
 */
export interface St0Prefs extends EnginePrefs {
  commands?: CommandPrefs;
}
export const engines = engineAccess<PublicEngine, St0Prefs>(BASE, json);

// ── The engine-side file service (cross-origin, header-auth) ─────────────────────
// The transport and the shared routes live in @studio/project-shell — a workspace is resolved
// the same way by every app that opens one, and a divergence there would be a duplicate clone
// or a 404. Re-exported here so every call site in this app keeps importing from one place.
export {
  cfg,
  configureFileApi,
  diagnoseFileService,
  type FileCfg,
  type FileServiceFault,
  fileHeaders,
  mediaUrl,
} from "@studio/project-shell/fileApi";

/** The current session's user, or null if unauthenticated (the shared OIDC /auth/me). */
export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string | null;
  groups?: string[];
}

export const api = {
  // --- Auth (hosted backend, same-origin) ---
  // A GETTER, not a constant: it must capture where you are when you click, and
  // `return_to` is the name the OIDC package reads (a `redirect` param is ignored).
  // Without it login falls back to APP_ROOT — which used to be this app because it
  // owned the origin, and owns it again — so the fallback is this app's home page. Left in
  // place all the same: it lands you on the projects list rather than back where you clicked.
  get loginUrl(): string {
    const here = window.location.pathname + window.location.search;
    return `/auth/login?return_to=${encodeURIComponent(here)}`;
  },
  getMe: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`auth/me ${res.status}`);
    return (await res.json()).user as AuthUser;
  },
  logout: () => fetch("/auth/logout", { method: "POST" }).then(() => undefined),

  // --- Engine registry (hosted backend, same-origin) ---
  // The five routes are `engines` above, shared. What this service remembers about YOU is
  // among them (`prefs`/`savePrefs`) and must never be confused with `preferences` below:
  // that one is the RIG's (~/.studio/preferences.yaml on the engine's machine, shared by
  // everyone who selects it), this one is the account's, on the hosted volume, and follows
  // you to another browser. It stores the engine ID and not its address — an engine's IP
  // moves between networks while its identity does not, and the browser re-probes on load.

  // --- Workspaces + file ops (engine-side file service, cross-origin) ---
  // The shared half — resolving pl8's repository to a folder here, the tree, the files, the
  // derived views, the repo's git, the CLI's verbs. Spread rather than re-listed, so this app
  // and z0's editor cannot drift on a route name. See @studio/project-shell.
  ...projectApi,

  importProject: (path: string) =>
    fsend<{ project: string; log: string[] }>("POST", "/import-project", {
      path,
    }),

  // --- The workspace's playlists (`_playlists/`, see @studio/song/docs/playlists.md) ---
  // Only the LISTING is its own route: `read`/`write` above already serve any workspace path,
  // and a second pair spelling `_playlists` into their URLs would be two ways to write one file
  // — with the autosave this screen runs on built on the pair that is already there.
  // Making one is not here either, for the same reason one step further on: `playlist new` is a
  // command, so it travels the `/command` road with every other act on that screen.
  playlists: () => fget<{ playlists: PlaylistInfo[] }>("/playlists"),
  // `createProject` and `deleteProject` were here, for the two verbs this app has stopped
  // carrying. The routes are the file service's and pl8 calls them — see apps/pl8/docs/projects.md.
  // Scaffold a project at the workspace root (the same scaffold `st0 create` runs) and return its
  // path. One `shape` where there were a `type` and a `mode`: every project is an `.st0` folder
  // now, so "which app opens it" has no answers left. See @studio/song's PROJECT_SHAPES.
  // Delete a project: unload it and move it to _recycle_bin. Reversible, but it can no longer be started.
  // Only st0 has a timeline, so only st0 asks for the tracks a Strudel pattern drives.
  strudelTracks: () => fget<WebTrack[]>("/strudel-tracks"),
  // Upload raw bytes (octet-stream, not fsend). A 409 rides through with `.status` so a skip can be reported.
  upload: async (
    dir: string,
    name: string,
    bytes: ArrayBuffer,
  ): Promise<{ path: string }> => {
    const q = `dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`;
    const res = await fetch(cfg().base + `/upload?${q}`, {
      method: "POST",
      headers: fileHeaders({ "Content-Type": "application/octet-stream" }),
      body: bytes,
    });
    if (!res.ok) {
      const msg =
        (await res.json().catch(() => ({}))).error ?? `upload ${name} failed`;
      const err = new Error(msg) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return res.json() as Promise<{ path: string }>;
  },
  // XMLHttpRequest, because fetch exposes no upload progress; resolves and rejects like `upload`.
  uploadWithProgress: (
    dir: string,
    name: string,
    bytes: ArrayBuffer,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<{ path: string }> => {
    const q = `dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`;
    const url = cfg().base + `/upload?${q}`;
    const headers = fileHeaders({ "Content-Type": "application/octet-stream" });
    return new Promise<{ path: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      for (const [k, v] of Object.entries(headers))
        xhr.setRequestHeader(k, String(v));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          let msg = `upload ${name} failed`;
          try {
            msg = JSON.parse(xhr.responseText).error ?? msg;
          } catch {}
          const err = new Error(msg) as Error & { status?: number };
          err.status = xhr.status;
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error(`upload ${name} — network error`));
      xhr.send(bytes);
    });
  },
  // `whole` spans the source file rather than the placement — the view a clips/*.yaml wants, where you are
  // editing the material and `from`/`to` can only be judged against the whole of it.
  //
  // `sensitivity` re-detects the SOURCE's transients at that threshold and makes it stick: it is written into the
  // file's sidecar, so every other view of the same audio agrees from then on. Omit it to read what is there.
  waveform: (
    clip: string,
    buckets = 1000,
    whole = false,
    sensitivity?: number,
  ) =>
    fget<WebWaveform>(
      `/waveform?clip=${encodeURIComponent(clip)}&buckets=${buckets}${whole ? "&whole=1" : ""}${
        sensitivity === undefined ? "" : `&sensitivity=${sensitivity}`
      }`,
    ),
  // Audition one sample: the file service resolves it to an absolute file + window and fires it at
  // the engine, answering the window it sent so a caller can draw a playhead over the right span.
  // `length: 0` means "to the end of the file" — a duration only the decoded audio knows.
  preview: (req: PreviewReq) =>
    fsend<{ ok: true; start: number; length: number }>("POST", "/preview", req),
  // Render the mixdown and hand back blob + filename. "mp3" needs ffmpeg on the engine host; "wav" always works.
  exportMix: async (
    format: "wav" | "mp3",
  ): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(cfg().base + `/export?format=${format}`, {
      headers: fileHeaders(),
    });
    if (!res.ok)
      throw new Error(
        (await res.json().catch(() => ({}))).error ?? "export failed",
      );
    const cd = res.headers.get("Content-Disposition") || "";
    const mn = /filename="?([^"]+)"?/.exec(cd);
    return {
      blob: await res.blob(),
      filename: mn ? mn[1] : `mixdown.${format}`,
    };
  },
  // Publish to k7. A song k7 doesn't know answers { needsMeta }, and the caller calls again with them.
  shareK7: (meta?: { artist?: string; title?: string }) =>
    fsend<{
      ok: boolean;
      needsMeta?: boolean;
      defaultTitle?: string;
      created?: boolean;
      releaseId?: string;
      title?: string;
      stems?: number;
    }>("POST", "/share/k7", meta ?? {}),
  /**
   * Freeze this project and send it to pl8. Answers the SECRET, not the address.
   *
   * The link is built in the browser (`shareUrl`), because the machine that renders has no idea
   * which origin you are reading this on — a checkout, the LAN proxy and the public host are
   * three different answers to that, and only the tab knows which one it is.
   */
  shareLink: () =>
    fsend<{ ok: true; token: string; bytes: number }>(
      "POST",
      "/share/link",
      {},
    ),
  prewarmWaveforms: () =>
    fsend<WaveformStatus>("POST", "/waveforms/prewarm", {}),
  waveformStatus: () => fget<WaveformStatus>("/waveforms/status"),
  // Stop the batch: it decodes audio in a second engine process, which is not what the machine
  // should be doing while the transport plays. See useWarmWaveforms.
  cancelWaveformPrewarm: () =>
    fsend<WaveformStatus>("POST", "/waveforms/cancel", {}),

  /**
   * Ask the MACHINE what an `@engine/…` plugin has, by loading one on purpose.
   *
   * The builder's parameter list is normally what the OPEN PROJECT instantiates, which is the
   * right default (`docs/moduleBuilder.md`) and leaves a hole: a module the project does not wire
   * has no live plugin, so an external one shows nothing to bind to. This is that hole's exit,
   * and it is the same plugin read the same way — one instance, on an offline engine that opens
   * no device, so it cannot disturb what is playing.
   *
   * SECONDS, because it loads a binary. `null` is "this machine cannot find or LOAD it" — a
   * licence, an installation — and is deliberately not the same answer as an empty list, which
   * means the plugin loaded and publishes nothing.
   */
  scanPluginParams: async (
    ref: string,
  ): Promise<{ names: string[]; meta: Record<string, ParamMeta> } | null> => {
    const { found, params } = await fget<{
      found?: boolean;
      params?: { name: string; min: number; max: number; def?: number }[];
    }>(`/plugin-params?ref=${encodeURIComponent(ref)}`);
    if (found === false) return null;
    const list = params ?? [];
    return {
      names: list.map((p) => p.name),
      meta: Object.fromEntries(
        list.map((p) => [p.name, { min: p.min, max: p.max, def: p.def }]),
      ),
    };
  },

  /**
   * …and that same plugin's own WINDOW, on an instance belonging to no project.
   *
   * The other half of `scanPluginParams`. That one answers what the parameters are CALLED, which
   * is what a bind list needs; this opens what the plugin itself draws, which is how you find out
   * what one of those names does before binding a widget to it.
   *
   * ORPHAN, and the limit matters more than the feature: the engine loads the plugin on its
   * offline edit, on no track and no session, so NOTHING TOUCHED IN THAT WINDOW IS SAVED. It is
   * for looking, and the module's text is still where a value is set.
   *
   * The window opens on the ENGINE's machine. Same seconds as the scan, since it is the same
   * binary being loaded, so a caller has to say it is working.
   */
  showPluginNativeUI: (ref: string) =>
    fget<{ opened: string }>(
      `/plugin-native-ui?ref=${encodeURIComponent(ref)}`,
    ),

  /**
   * …and keeping what is in that window: the plugin's state as a named base in the module's own
   * `base/` folder.
   *
   * `path` is the module file being edited — the SERVER derives the folder from it, because a
   * base is a file the browser has no business locating. The error bodies are worth passing
   * through verbatim: the common failure is "no window opened yet", which is the user's to fix
   * and reads as nonsense if flattened to "could not save".
   */
  /** The bases this module may be set to — its own and its ancestors'. See moduleBases below. */
  moduleBases: (path: string) =>
    fget<{ bases: string[] }>(`/module-base?path=${encodeURIComponent(path)}`),

  snapshotModuleBase: (path: string, name: string, ref: string) =>
    fsend<{ path: string }>("POST", "/module-base/snapshot", {
      path,
      name,
      ref,
    }),

  // --- presets (a file in the module's folder, see @studio/song/docs/userPresets.md) ---
  // A module's own presets, from the `presets.yaml` in its folder — the factory ones ride the WebSocket.
  listUserPresets: (ref: string) =>
    fget<{ presets: PresetInfo[] }>(`/presets?ref=${encodeURIComponent(ref)}`),
  // Snapshot a module's current params as a new named preset on its shelf.
  savePreset: (module: string, name: string) =>
    fsend<{ path: string }>("POST", "/presets/save", { module, name }),
  // Apply one BY NAME; the brain writes its values and reloads the project so the engine hears it.
  applyPreset: (module: string, name: string) =>
    fsend<{ ok: true }>("POST", "/presets/apply", { module, name }),

  /** Commit and push the LIBRARY repository — what a Save in the module builder does once the
   *  files have landed. The workspace's own repository is untouched: see libraries.ts. */
  publishLibraries: (message: string) =>
    fsend<{ committed: boolean; pushed: boolean; note: string }>(
      "POST",
      "/libraries/publish",
      { message },
    ),
};

/**
 * The MÉDIATHÈQUE — pl8's hosted catalogue of songs, reached across the origin.
 *
 * A fourth data path, and the only one this app has that is neither the registry nor the
 * engine's machine. It exists because a playlist moved here and its songs did not: a set list
 * is the account's document and belongs in the repository, while a master is 40 MB of audio
 * that belongs on a volume somebody backs up. So the file naming songs is ours and the songs
 * themselves stay pl8's, and this is the seam between the two.
 *
 * **`PL8`, never `BASE`.** These calls are the other service's, and this app's own `BASE` is now
 * the EMPTY string — so a bare `/api/mediatek/list` would reach st0's own backend, which has no
 * such route, and 404 silently into an empty catalogue that reads as "you have no songs". That
 * bare spelling was correct for as long as the médiathèque answered the origin root; it stopped
 * being correct the day it moved to `/pl8`, and it would have gone on looking correct.
 *
 * DERIVED through `serviceUrl` rather than spelled `/pl8`, which is the same argument
 * `projects/api.ts` makes: the prefix belongs to one table, and this file has already been
 * wrong once by holding a copy of it.
 *
 * `/auth/*` at the top of this file stays bare, and is NOT an inconsistency: the OIDC flow is
 * pl8's backend's but answers at the origin root, because the IdP knows one prefixless
 * redirect_uri. See packages/web-protocol/services.ts.
 *
 * The session cookie carries the auth (`bearerOrSession` on pl8's side), which is also what
 * makes `songUrl` work as an `<audio src>`: a media element cannot set a header, and it does
 * not have to when the bytes are same-origin.
 */
const PL8 = serviceUrl(globalThis.location?.origin ?? "", "pl8");

export const mediatek = {
  /** The whole songs family. One call, no paging: the catalogue is a few hundred entries and
   *  the search over it is done in the browser, where a keystroke costs nothing. */
  listSongs: async (): Promise<MediatekEntry[]> => {
    const res = await fetch(`${PL8}/api/mediatek/list?family=songs`);
    if (!res.ok) throw new Error(`médiathèque ${res.status}`);
    return ((await res.json()) as FamilyListing).entries;
  },

  /** One file's bytes, as an address rather than a fetch — this is what a row plays. */
  songUrl: (path: string) =>
    `${PL8}/api/mediatek/file?path=${encodeURIComponent(path)}`,

  /**
   * File one audio file as a song. The THREE TAGS go up and never a path: the médiathèque
   * derives `songs/<artiste>/<album>/<titre>/original.<ext>` itself, which is what stops two
   * apps inventing two spellings of one folder. See packages/mediatek/docs/songs.md.
   *
   * A 409 rides through with `.exists` so the caller can offer the one thing that resolves it
   * — replacing what is there — rather than only reporting it.
   */
  addSong: async (
    file: File,
    tags: { artist: string; album: string; title: string },
    opts: { replace?: boolean } = {},
  ): Promise<{ path: string; master: string; replaced: boolean }> => {
    const q = new URLSearchParams({ filename: file.name, ...tags });
    if (opts.replace) q.set("replace", "1");
    const res = await fetch(`${PL8}/api/mediatek/song?${q}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as {
        error?: string;
        exists?: boolean;
      };
      const err = new Error(detail.error ?? `song ${res.status}`) as Error & {
        exists?: boolean;
      };
      err.exists = detail.exists;
      throw err;
    }
    return res.json();
  },
};

/**
 * What an empty DSP source is pre-filled with, per language.
 *
 * A stub that LOADS, in both cases and for the same reason: an empty file fails at some later,
 * less obvious moment than the first save. What "loads" means differs — the jsdsp loader RUNS
 * the source to get a graph, so it must export one; the Faust source is compiled by the engine,
 * so it must define `process`. Neither is a template anyone would keep, and both are the
 * shortest thing that is not an error.
 *
 * Here rather than in the builder because the builder does not know what a host's languages
 * are — it asks for a file by name and this is the side that answers (see ModuleStore.dspSource).
 */
function dspStub(ref: string, file: string): string {
  const head = `// ${ref} — the module's DSP.`;
  // Keyed by FILE and not by a default, so a language nobody wrote a stub for gets a comment
  // rather than the wrong language's boilerplate — which would look like a bug in the module.
  if (file === JSDSP_FILE)
    return `${head} Export the graph the engine will host.\nexport default {};\n`;
  if (file === FAUST_FILE)
    return `${head} The engine compiles this.\nimport("stdfaust.lib");\n\nprocess = _, _;\n`;
  return `${head}\n`;
}

/**
 * The shared module builder's view of the file service (`@studio/ui-module-builder/store`).
 *
 * Four calls, all already above — the adapter is shapes, not behaviour, except for `write`:
 * a save aimed at the shared `_modules` library is REDIRECTED onto a project copy, and the
 * builder has to be told, because the file it is editing has just moved (see moduleFork.ts).
 * A `ui.yaml` is the one thing that saves in place there, so it comes back unredirected.
 */
export const moduleStore: ModuleStore = {
  // Absent is `null`, not a throw — see ModuleStore.read. The file service answers 404 for a
  // path with nothing at it, and a module the project has yet to write is exactly that.
  read: async (path) => {
    try {
      return (await api.read(path)).content;
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  },
  moduleUi: (path) => api.moduleUi(path),
  presets: (path) => api.modulePresets(path),
  /**
   * The module's DSP source, whichever language it is written in. Derived HERE and not on the
   * server, unlike the two sidecars above: those have routes because the server also decides
   * where a panel WOULD go for a shared module; this one is always the plain sibling, and
   * `/file` already reads any workspace path.
   *
   * Absent is not an error — a module can declare `plugin: {type: jsdsp}` before its source
   * exists, and the first save creates it through the ordinary write route.
   */
  dspSource: async (path, file) => {
    const parts = path.split("/");
    const ref = parts.slice(0, -1).join("/");
    const at = [...parts.slice(0, -1), file].join("/");
    try {
      const f = await api.read(at);
      return { ref, path: at, content: f.content, exists: true };
    } catch {
      return { ref, path: at, content: dspStub(ref, file), exists: false };
    }
  },
  hints: () => api.hints(),
  /**
   * Publish a SHARED module: commit the library repository and push it.
   *
   * Only for one that lives in `_libraries` — a project's own module is already where it
   * belongs, and there is nothing to publish it to. That test is the path's, as everywhere
   * else in this app (see libraryTree.ts): the folder says which library a module is in, and
   * nothing else has to be remembered.
   *
   * The message names the module by its REF, which is what a chain writes and therefore what
   * somebody reading this history will recognise.
   */
  publish: async (path) => {
    const ref = libraryModuleRef(path);
    if (!ref) return {}; // the project's own — saved, and there is nowhere else for it to go
    return api.publishLibraries(`${ref}`);
  },
  /**
   * Keep the plugin's current state as a named base. Straight through to the route, which is the
   * only side that knows where `base/` is for this module — see `ModuleStore.snapshotBase`.
   */
  snapshotBase: (path, name, ref) => api.snapshotModuleBase(path, name, ref),
  /** …and what it may be set TO. The ancestry is the server's to walk — a thin local module has
   *  none of its own, and the shared one it extends is where the bases actually live. */
  bases: async (path) => (await api.moduleBases(path)).bases,
  write: async (path, content) => {
    const { forked } = await api.write(path, content);
    if (!forked) return {};
    return {
      path: forked.path,
      note:
        `${forked.ref} is shared — saved a project copy as ${forked.module}` +
        (forked.chains.length
          ? `, and repointed ${forked.chains.join(", ")}`
          : ""),
    };
  },
};
