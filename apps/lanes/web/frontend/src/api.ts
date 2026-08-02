// api.ts — the typed client. Two destinations now:
//   • the hosted backend (same-origin, cookie): auth (/auth/*) + the engine registry.
//   • the engine-side file service (cross-origin, header-auth): all file/workspace ops.
// The file service base + the identity/workspace/engine-token headers are set by
// configureFileApi once an engine + workspace are chosen (see WorkspaceGate).

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
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => ({}))).error ?? `GET ${path} failed`,
    );
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
  loginUrl: "/auth/login",
  getMe: async (): Promise<AuthUser | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`auth/me ${res.status}`);
    return (await res.json()).user as AuthUser;
  },
  logout: () => fetch("/auth/logout", { method: "POST" }).then(() => undefined),

  // --- Engine registry (hosted backend, same-origin) ---
  engines: () => get<PublicEngine[]>("/api/engines"),
  selectEngine: (id: string, token: string, tier: number) =>
    send<{ ok: true }>("POST", "/api/engine/select", { id, token, tier }),
  // The assignment's goodbye, fired on pagehide as a beacon so it survives the tab closing.
  releaseEngine: (id: string) =>
    navigator.sendBeacon(
      "/api/engine/release",
      new Blob([JSON.stringify({ id })], { type: "application/json" }),
    ),

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
  // Scaffold a project at the workspace root (the same scaffold `lanes create` runs) and return its path.
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
  // `editShared` opts out — the module builder edits the catalogue in place, which is what it is FOR.
  write: (path: string, content: string, editShared = false) =>
    fsend<{ ok: true; forked?: ForkedModule }>("PUT", "/file", {
      path,
      content,
      ...(editShared ? { editShared } : {}),
    }),
  // The `_ui` panel file a module file's grid edits — existing, or scaffolded at the path it would take.
  moduleUi: (path: string) =>
    fget<ModuleUiFile>(`/module-ui?path=${encodeURIComponent(path)}`),
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
  // Publish to radiok7. A song radiok7 doesn't know answers { needsMeta }, and the caller calls again with them.
  shareRadiok7: (meta?: { artist?: string; title?: string }) =>
    fsend<{
      ok: boolean;
      needsMeta?: boolean;
      defaultTitle?: string;
      created?: boolean;
      releaseId?: string;
      title?: string;
      stems?: number;
    }>("POST", "/share/radiok7", meta ?? {}),
  prewarmWaveforms: () =>
    fsend<WaveformStatus>("POST", "/waveforms/prewarm", {}),
  waveformStatus: () => fget<WaveformStatus>("/waveforms/status"),
  commands: () => fget<CommandInfo[]>("/commands"),
  complete: (line: string) =>
    fget<string[]>(`/complete?line=${encodeURIComponent(line)}`),
  command: (line: string) =>
    fsend<{ output: string[] }>("POST", "/command", { line }),

  // --- user presets (project-local, per module) ---
  // The user's own presets for a module, discovered in the song — the factory ones ride the WebSocket.
  listUserPresets: (ref: string) =>
    fget<{ presets: PresetInfo[] }>(`/presets?ref=${encodeURIComponent(ref)}`),
  // Snapshot a module's current state as a new named preset in its own preset library.
  savePreset: (module: string, name: string) =>
    fsend<{ path: string }>("POST", "/presets/save", { module, name }),
  // Apply a user preset onto a module; the brain writes it and reloads the project so the engine hears it.
  applyPreset: (module: string, path: string) =>
    fsend<{ ok: true }>("POST", "/presets/apply", { module, path }),
};
