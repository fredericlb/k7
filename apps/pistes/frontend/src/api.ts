// api.ts — the typed client. Two destinations now:
//   • the hosted backend (same-origin, cookie): auth (/auth/*) + the engine registry.
//   • the engine-side file service (cross-origin, header-auth): all file/workspace ops.
// The file service base + the identity/workspace/engine-token headers are set by
// configureFileApi once an engine + workspace are chosen (see WorkspaceGate).

import type { ModuleStore } from "@studio/ui-module-builder/store";
import {
  type Alternatives,
  type CatalogueModule,
  type CommandInfo,
  ENGINE_TOKEN_HEADER,
  type FileContent,
  type FileNode,
  type ForkedModule,
  type GitCommitResult,
  type GitPullResult,
  type GitStatus,
  type Hints,
  type IoPort,
  type ModulePresetsFile,
  type ModuleUiFile,
  type PresetInfo,
  type PreviewReq,
  type ProjectErrors,
  type ProjectInfo,
  type PublicEngine,
  type SshKeyInfo,
  USER_HEADER,
  type WaveformStatus,
  type WebGraph,
  type WebPreferences,
  type WebProject,
  type WebTrack,
  type WebWaveform,
  WORKSPACE_HEADER,
  type WorkspaceInfo,
  type WorkspaceList,
} from "./types";

// The app is mounted under a path (studio.test/pistes), so every backend path
// below carries it. BASE_URL is vite's `base`; it ends in a slash, trimmed here
// so the literals keep reading as paths.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * The médiathèque, which is somewhere else entirely.
 *
 * Modules are no longer edited here — only the library is editable, so the settings entry
 * that used to open a builder is a link out. Two hosts exist and both are known, so this
 * is a constant rather than a build-time variable; the day a third appears is the day to
 * make it configurable.
 */
export const MEDIATEK_URL = import.meta.env.PROD
  ? "https://media.studio.frediver.se"
  : "https://studio.test/mediatek";

// ── The hosted backend (same-origin): auth + registry ───────────────────────────
async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => ({}))).error ?? `GET ${path} failed`,
    );
  return res.json() as Promise<T>;
}
async function send<T>(
  method: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => ({}))).error ?? `${method} ${path} failed`,
    );
  return res.json() as Promise<T>;
}

// ── The engine-side file service (cross-origin, header-auth) ─────────────────────
interface FileCfg {
  base: string; // http://<engine-host>:<filePort>
  userEmail: string; // trusted (Phase-2 local trust)
  workspace: string; // the chosen workspace name
  engineToken: string; // the light LAN gate (from the whoami probe)
}
let fileCfg: FileCfg | null = null;

/** Point the file-op methods at a chosen engine + workspace. */
export function configureFileApi(cfg: FileCfg): void {
  fileCfg = cfg;
}
function cfg(): FileCfg {
  if (!fileCfg)
    throw new Error("file API not configured (pick a workspace first)");
  return fileCfg;
}
/**
 * Why a file-service call failed, when fetch() won't say.
 *
 * A refused CORS preflight and a dead server are the SAME rejection in JS — an opaque
 * `TypeError: NetworkError`, with no status and no body, because letting a page read
 * that difference is precisely what CORS exists to prevent. But the difference is the
 * whole of the user's next action: "click allow in the tray" versus "start the engine".
 *
 * `mode: "no-cors"` is the way through: it sends a simple GET with no preflight and no
 * ACAO check, yielding an opaque response we can't read but whose ARRIVAL proves
 * something answered. So:
 *   probe resolves -> the service is up and refused our origin  -> "blocked"
 *   probe rejects  -> nothing is listening at that address      -> "unreachable"
 */
export type FileServiceFault = "blocked" | "unreachable";

export async function diagnoseFileService(
  base?: string | null,
): Promise<FileServiceFault> {
  const target = base ?? fileCfg?.base;
  if (!target) return "unreachable";
  try {
    await fetch(`${target}/health`, { mode: "no-cors", cache: "no-store" });
    return "blocked";
  } catch {
    return "unreachable";
  }
}

function fileHeaders(extra?: HeadersInit): HeadersInit {
  const c = cfg();
  return {
    ...extra,
    [USER_HEADER]: c.userEmail,
    [WORKSPACE_HEADER]: c.workspace,
    [ENGINE_TOKEN_HEADER]: c.engineToken,
  };
}
async function fget<T>(path: string): Promise<T> {
  const res = await fetch(cfg().base + path, { headers: fileHeaders() });
  if (!res.ok) {
    const e: Error & { status?: number } = new Error(
      (await res.json().catch(() => ({}))).error ?? `GET ${path} failed`,
    );
    // Carried for the one caller that has to tell "nothing there" from "it went wrong" —
    // fsend already did this for the upload's 409, and for the same kind of reason.
    e.status = res.status;
    throw e;
  }
  return res.json() as Promise<T>;
}
async function fsend<T>(
  method: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(cfg().base + path, {
    method,
    headers: fileHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => ({}))).error ?? `${method} ${path} failed`,
    );
  return res.json() as Promise<T>;
}

/** Absolute URL for a <video> element to stream media. Everything rides in the query —
 * including the engine token — because an element GET can't send headers. */
export function mediaUrl(path: string): string {
  const c = cfg();
  const q = new URLSearchParams({
    user: c.userEmail,
    workspace: c.workspace,
    path,
    token: c.engineToken,
  });
  return `${c.base}/media?${q.toString()}`;
}

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
  // owned the origin, and is now the bare studio.test that belongs to nobody.
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
  engines: () => get<PublicEngine[]>(`${BASE}/api/engines`),
  selectEngine: (id: string, token: string, tier: number) =>
    send<{ ok: true }>("POST", `${BASE}/api/engine/select`, {
      id,
      token,
      tier,
    }),
  // The assignment's goodbye, fired on pagehide as a beacon so it survives the tab closing.
  releaseEngine: (id: string) =>
    navigator.sendBeacon(
      `${BASE}/api/engine/release`,
      new Blob([JSON.stringify({ id })], { type: "application/json" }),
    ),

  // --- What this service remembers about YOU (hosted backend, same-origin) ---
  // NOT `preferences` below, and the two must never be confused: that one is the RIG's
  // (~/.studio/preferences.yaml on the engine's machine, shared by everyone who selects it),
  // this one is the account's, on the hosted volume, and follows you to another browser.
  //
  // The engine id and not its address: an engine's IP moves between networks while its
  // identity does not, and the browser re-probes the addresses on every load anyway.
  accountPrefs: () => get<{ engineId?: string }>(`${BASE}/api/preferences`),
  saveAccountPrefs: (p: { engineId?: string }) =>
    send<{ ok: true }>("PUT", `${BASE}/api/preferences`, p),

  // --- Workspaces + file ops (engine-side file service, cross-origin) ---
  listWorkspaces: () => fget<WorkspaceList>("/workspaces"),
  createWorkspace: (name: string) =>
    fsend<{ ok: true }>("POST", "/workspaces", { name }),
  cloneWorkspace: (name: string, uri: string) =>
    fsend<{ ok: true }>("POST", "/workspaces/clone", { name, uri }),
  sshKey: () => fget<SshKeyInfo>("/ssh-key"),
  generateSshKey: () => fsend<SshKeyInfo>("POST", "/ssh-key", {}),
  unloadEngine: () => fsend<{ ok: true }>("POST", "/engine/unload", {}),
  project: () => fget<ProjectInfo>("/project"),
  workspace: () => fget<WorkspaceInfo>("/workspace"),
  // Where the workspace repo stands vs upstream — the share badge. It fetches, so callers poll it rarely.
  gitStatus: () => fget<GitStatus>("/git/status"),
  alternatives: () => fget<Alternatives>("/git/alternatives"),
  // Commit+push and fast-forward pull on the WHOLE workspace repo — neither needs an active project.
  gitCommit: (message: string) =>
    fsend<GitCommitResult>("POST", "/git/commit", { message }),
  gitPull: () => fsend<GitPullResult>("POST", "/git/pull", {}),
  open: (path: string) => fsend<WorkspaceInfo>("POST", "/open", { path }),
  importDawproject: (path: string) =>
    fsend<{ project: string; log: string[] }>("POST", "/import-dawproject", {
      path,
    }),
  // Scaffold a project at the workspace root (the same scaffold `pistes create` runs) and return its path.
  createProject: (type: "audio" | "video", name: string) =>
    fsend<{ project: string }>("POST", "/project/create", { type, name }),
  // Delete a project: unload it and move it to _recycle_bin. Reversible, but it can no longer be started.
  deleteProject: (path: string) =>
    fsend<{ recycled: string }>("POST", "/project/delete", { path }),
  projectDoc: () => fget<WebProject>("/project-doc"),
  strudelTracks: () => fget<WebTrack[]>("/strudel-tracks"),
  graph: () => fget<WebGraph>("/graph"),
  projectErrors: () => fget<ProjectErrors>("/project-errors"),
  // A cheap token that changes when the project's files do — poll this instead of the expensive derivations.
  revision: () => fget<{ rev: string }>("/revision"),
  tree: () => fget<FileNode[]>("/tree"),
  hints: () => fget<Hints>("/hints"),
  // The graph picker's vocabulary on its own — /hints costs several times this for the same list.
  baseModules: () => fget<string[]>("/base-modules"),
  ioPorts: () => fget<IoPort[]>("/io-ports"),
  // The shared `_modules` catalogue — what the module builder lists.
  moduleCatalogue: () => fget<CatalogueModule[]>("/module-catalogue"),
  // The merged engine + file-service log: the first call seeds a tail, then poll with the returned offset.
  logs: (offset?: number, tail = 300) =>
    fget<{ offset: number; lines: string[] }>(
      offset != null ? `/logs?offset=${offset}` : `/logs?tail=${tail}`,
    ),
  preferences: () => fget<WebPreferences>("/preferences"),
  setVim: (vim: boolean) =>
    fsend<{ vim: boolean }>("PUT", "/preferences/vim", { vim }),
  read: (path: string) =>
    fget<FileContent>(`/file?path=${encodeURIComponent(path)}`),
  // Saving a file in the shared `_modules` library doesn't write there: it copies the module into the project
  // and repoints the chains at the copy, and `forked` says where the edit actually landed (see moduleFork.ts).
  // There is no opt-out any more — the catalogue is edited in the médiathèque, and nowhere else.
  write: (path: string, content: string) =>
    fsend<{ ok: true; forked?: ForkedModule }>("PUT", "/file", {
      path,
      content,
    }),
  // The `ui.yaml` beside a module file, which its grid edits — existing, or scaffolded at the path it would take.
  moduleUi: (path: string) =>
    fget<ModuleUiFile>(`/module-ui?path=${encodeURIComponent(path)}`),
  // …and its `presets.yaml`, the module's third file, answered the same way.
  modulePresets: (path: string) =>
    fget<ModulePresetsFile>(`/module-presets?path=${encodeURIComponent(path)}`),
  // Make an empty folder `name` inside `dir`. Returns its workspace-relative path.
  createFolder: (dir: string, name: string) =>
    fsend<{ path: string }>("POST", "/folder", { dir, name }),
  // Rename a tree entry (file or folder) to a new bare `name`, in place. Returns the new workspace-relative path.
  renameFile: (path: string, name: string) =>
    fsend<{ path: string }>("POST", "/rename", { path, name }),
  // Move a tree entry into another folder (the tree's drag-and-drop). Returns its new path.
  moveFile: (path: string, toDir: string) =>
    fsend<{ path: string }>("POST", "/move", { path, toDir }),
  // Delete a tree entry (file or folder) by recycling it (reversible). Returns the recycled path.
  deleteFile: (path: string) =>
    fsend<{ recycled: string }>("POST", "/entry/delete", { path }),
  // Clone a module folder in the same category with a new name. Returns the new path.
  cloneModule: (path: string, newName: string) =>
    fsend<{ path: string }>("POST", "/module/clone", { path, newName }),
  // Add an instance to a module folder — <instance>.yaml beside module.yaml, which it inherits.
  createModuleInstance: (path: string, instance: string) =>
    fsend<{ path: string }>("POST", "/module/instance", { path, instance }),
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
  fmt: (path: string) => fsend<FileContent>("POST", "/fmt", { path }),
  // `whole` spans the source file rather than the placement — the view a clips/*.yaml wants, where you are
  // editing the material and `from`/`to` can only be judged against the whole of it.
  waveform: (clip: string, buckets = 1000, whole = false) =>
    fget<WebWaveform>(
      `/waveform?clip=${encodeURIComponent(clip)}&buckets=${buckets}${whole ? "&whole=1" : ""}`,
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
  commands: () => fget<CommandInfo[]>("/commands"),
  complete: (line: string) =>
    fget<string[]>(`/complete?line=${encodeURIComponent(line)}`),
  command: (line: string) =>
    fsend<{ output: string[] }>("POST", "/command", { line }),

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
  hints: () => api.hints(),
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
