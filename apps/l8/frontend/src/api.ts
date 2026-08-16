// api.ts — the typed client. Two destinations now:
//   • the hosted backend (same-origin, cookie): auth (/auth/*) + the engine registry.
//   • the engine-side file service (cross-origin, header-auth): all file/workspace ops.
// The file service base + the identity/workspace/engine-token headers are set by
// configureFileApi once an engine is chosen and the repository is resolved (see ProjectGate).

import { engineAccess } from "@studio/engine-browser/access";
import type { EnginePrefs } from "@studio/engine-browser/registry";
import { JSDSP_FILE } from "@studio/engine-protocol/build";
import { cfg, fget, fileHeaders, fsend } from "@studio/project-shell/fileApi";
import { projectApi } from "@studio/project-shell/project";
import type { ModuleStore } from "@studio/ui-module-builder/store";
import { serviceUrl } from "@studio/web-protocol/services";
import type { CommandPrefs } from "./commandPrefs";
import { libraryModuleRef } from "./libraryTree";
import type {
  PresetInfo,
  PreviewReq,
  PublicEngine,
  WaveformStatus,
  WebTrack,
  WebWaveform,
} from "./types";

// The app is mounted under a path (st0.priv.frediver.se/l8), so every backend path
// below carries it. BASE_URL is vite's `base`; it ends in a slash, trimmed here
// so the literals keep reading as paths.
// Exported because the engine probe needs it too: the relay answers under this same prefix.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * The médiathèque — st0, which is another service on the SAME origin, and now the one
 * serving its ROOT: `serviceUrl` returns the bare origin here, not a path under it.
 *
 * Modules are no longer edited here — only the library is editable, so the settings entry
 * that used to open a builder is a link out. Derived rather than declared: every studio
 * service sits at a fixed path under one origin (see `@studio/web-protocol/services`), so
 * dev and production differ by the origin the page was served from and nothing else. It used
 * to be a build-time branch naming a host of its own, which is the same fact written twice
 * and only true until a deployment moves.
 */
export const MEDIATEK_URL = serviceUrl(
  // `globalThis.location`, not `window`: this module is imported by tests that run in node,
  // where reading `window` at module scope is a ReferenceError before any test has started.
  // Under node that leaves this `""`, which no test renders — in a browser there is always
  // an origin, and st0's empty path means the origin is the whole answer.
  globalThis.location?.origin ?? "",
  "st0",
);

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
 * choice and the lease — bound to `/l8` once. One object rather than five hand-spelled routes,
 * which is the drift `@studio/engine-browser/registry` exists to stop. See that package's
 * docs/access.md.
 */
/**
 * l8's own preference document: the engine every service remembers, plus what this person has made
 * of the command catalogue (names, icons, menu order — see commandPrefs.ts).
 *
 * Widening `P` is how a host adds a field, exactly as `EnginePrefs`' own comment says: the schema
 * belongs to the host, and a union of every service's fields would be a shape no service has.
 */
export interface L8Prefs extends EnginePrefs {
  commands?: CommandPrefs;
}
export const engines = engineAccess<PublicEngine, L8Prefs>(BASE, json);

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
  // owned the origin, and is now the bare st0.priv.frediver.se that belongs to nobody.
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
  // The shared half — resolving st0's repository to a folder here, the tree, the files, the
  // derived views, the repo's git, the CLI's verbs. Spread rather than re-listed, so this app
  // and z0's editor cannot drift on a route name. See @studio/project-shell.
  ...projectApi,

  importProject: (path: string) =>
    fsend<{ project: string; log: string[] }>("POST", "/import-project", {
      path,
    }),
  // `createProject` and `deleteProject` were here, for the two verbs this app has stopped
  // carrying. The routes are the file service's and st0 calls them — see apps/st0/docs/projects.md.
  // Scaffold a project at the workspace root (the same scaffold `l8 create` runs) and return its
  // path. One `shape` where there were a `type` and a `mode`: every project is an `.l8` folder
  // now, so "which app opens it" has no answers left. See @studio/song's PROJECT_SHAPES.
  // Delete a project: unload it and move it to _recycle_bin. Reversible, but it can no longer be started.
  // Only l8 has a timeline, so only l8 asks for the tracks a Strudel pattern drives.
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
  // Audition one sample: the file service resolves it to an absolute file + window and fires it at the engine.
  preview: (req: PreviewReq) => fsend<{ ok: true }>("POST", "/preview", req),
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
  prewarmWaveforms: () =>
    fsend<WaveformStatus>("POST", "/waveforms/prewarm", {}),
  waveformStatus: () => fget<WaveformStatus>("/waveforms/status"),
  // Stop the batch: it decodes audio in a second engine process, which is not what the machine
  // should be doing while the transport plays. See useWarmWaveforms.
  cancelWaveformPrewarm: () =>
    fsend<WaveformStatus>("POST", "/waveforms/cancel", {}),

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
   * The module's `jsdsp.ts`. Derived HERE and not on the server, unlike the two sidecars above:
   * those have routes because the server also decides where a panel WOULD go for a shared
   * module; this one is always the plain sibling, and `/file` already reads any workspace path.
   *
   * Absent is not an error — a module can declare `plugin: {type: jsdsp}` before its source
   * exists, and the first save creates it through the ordinary write route.
   */
  jsdsp: async (path) => {
    const parts = path.split("/");
    const ref = parts.slice(0, -1).join("/");
    const at = [...parts.slice(0, -1), JSDSP_FILE].join("/");
    try {
      const f = await api.read(at);
      return { ref, path: at, content: f.content, exists: true };
    } catch {
      return {
        ref,
        path: at,
        // A stub that COMPILES: the loader RUNS this source to get the graph, so an empty file
        // fails on the first save rather than at some later, less obvious moment.
        content: `// ${ref} — the module's DSP. Export the graph the engine will host.\nexport default {};\n`,
        exists: false,
      };
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
