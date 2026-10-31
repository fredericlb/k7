// api.ts — the typed client. Three destinations now:
//   • the hosted backend (same-origin at the ROOT, cookie): the origin's OIDC flow at
//     /auth/* — k7 is the service with no prefix — and this app's own preferences.
//   • the engine-side file service (cross-origin, header-auth): all file/workspace ops.
//   • pl8's routes (this origin now, cookie): the ONE engine registry, and the songs a playlist names.
// The file service base + the identity/workspace/engine-token headers are set by
// configureFileApi once an engine is chosen and the workspace is resolved (see ProjectGate).

import { engineAccess } from "@studio/engine-browser/access";
import type { Compatibility, PluginNeed } from "@studio/engine-browser/compat";
import type { EnginePrefs } from "@studio/engine-browser/registry";
import type { ParamMeta } from "@studio/engine-protocol";
import { FAUST_FILE, JSDSP_FILE } from "@studio/engine-protocol/build";
// The reader `@studio/engine-browser` wants: it owns the routes, this app owns the errors.
import { readJson as json } from "@studio/http-client/call";
import type { FamilyListing, MediatekEntry } from "@studio/mediatek/types";
import { cfg, fget, fileHeaders, fsend } from "@studio/project-shell/fileApi";
import { projectApi } from "@studio/project-shell/project";
import { WIDGETS_SCRIPT } from "@studio/song-schema/moduleFiles";
import type { NodePresets } from "@studio/song-schema/presets";
import type { ReferenceTrack } from "@studio/song-schema/reference";
import type {
  AiOrganizeEvent,
  AiOrganizeRequest,
  AiOrganizeResult,
  AiSettingsView,
} from "@studio/ui-module-builder/ai-organize";
import type { ModuleStore } from "@studio/ui-module-builder/store";
import {
  ENGINE_CONNECT_DEADLINE_MS,
  MAX_UPLOAD_BYTES,
  type ModelDownloadJob,
  SERVER_ENGINES_PATH,
  type SeparateJob,
  type ServerEngines,
  type ShareProgress,
  type StemsReply,
} from "@studio/web-protocol";
import type { PlaylistInfo } from "@studio/web-protocol/playlists";
import type { ProjectResource } from "@studio/web-protocol/resources";
import type { CommandPrefs } from "./commandPrefs";
import { localApp } from "./localApp";
import { pl8Url } from "./projects/api";
import type {
  PreviewReq,
  PublicEngine,
  WaveformStatus,
  WebWaveform,
} from "./types";

// The app is mounted at the ORIGIN ROOT, so BASE is the empty string — kept as a derived constant, this app's mount being the one that can still change.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Where pl8's routes answer — this origin now. It holds the media library AND the one engine registry. */
const PL8 = pl8Url();

// ── The hosted backend (same-origin): auth + preferences ────────────────────────

// The registry's five routes are `engines` below — pl8's — and auth is three bare fetches, so there is no `get`/`send` helper here.

/** k7's own preference document — the remembered engine plus the command prefs; widening it is HALF of adding a field, the backend's zod schema deciding the rest. */
export interface K7Prefs extends EnginePrefs {
  commands?: CommandPrefs;
}
/** A machine's own backend's forward to the account's main server (backend/src/remote/forward.ts). */
export const SERVER_BASE = `${BASE}/api/server`;

/** The main server's engines, on a machine's own backend only; empty on a server, or when the server is away. */
async function serverEngines(): Promise<PublicEngine[]> {
  if (!(await localApp())) return [];
  const res = await fetch(`${BASE}${SERVER_ENGINES_PATH}`, {
    credentials: "include",
    signal: AbortSignal.timeout(ENGINE_CONNECT_DEADLINE_MS),
  });
  return res.ok ? ((await res.json()) as ServerEngines).engines : [];
}

/** The registry, the probe and the relay are pl8's — k7 holds no registry of its own — while the preferences, the remembered engine among them, stay k7's. */
export const engines = engineAccess<PublicEngine, K7Prefs>(PL8, json, {
  prefsBase: BASE,
  // A workspace the server hosts is opened there, whichever engine plays it — packages/file-hub/docs/fileHub.md.
  hostedFiles: true,
  // On a machine's own backend, its main server's engines too, driven through that server (../docs/serverEngines.md).
  server: { base: SERVER_BASE, list: serverEngines },
});

// ── The engine-side file service (cross-origin, header-auth) ─────────────────────

// The transport and the shared routes live in @studio/project-shell; what callers reach through here is the media URL.
export { mediaUrl } from "@studio/project-shell/fileApi";

import { m } from "./paraglide/messages.js";

/** The current session's user, or null if unauthenticated (the shared OIDC /auth/me). */
export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string | null;
  groups?: string[];
}

/** The sentence for a file over the upload limit — said before sending, and again if the service refuses it. */
const tooBigMessage = (name: string) =>
  m["upload.tooBig"]({ name, mb: String(MAX_UPLOAD_BYTES / (1024 * 1024)) });

/** Refuse a file over the limit BEFORE it is sent: a 4K clip would otherwise climb to 100% and fail with no reason. */
function tooBig(name: string, bytes: Blob | ArrayBuffer): void {
  const size = bytes instanceof Blob ? bytes.size : bytes.byteLength;
  if (size <= MAX_UPLOAD_BYTES) return;
  throw Object.assign(new Error(tooBigMessage(name)), { status: 413 });
}

/** How long a signed-in answer to /auth/me is reused: long enough for a start's several askers, short enough to notice a session gone. */
const ME_FRESH_MS = 60_000;
let me: { at: number; p: Promise<AuthUser | null> } | null = null;

async function askMe(): Promise<AuthUser | null> {
  const res = await fetch("/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`auth/me ${res.status}`);
  return (await res.json()).user as AuthUser;
}

export const api = {
  // --- Auth (hosted backend, same-origin) ---

  // A GETTER, not a constant: it must capture where you are when you click, and `return_to` is the name the OIDC package reads.
  get loginUrl(): string {
    const here = window.location.pathname + window.location.search;
    return `/auth/login?return_to=${encodeURIComponent(here)}`;
  },
  // Shared while in flight and for a minute after a signed-in answer; nobody signed in, or a failure, is asked again.
  getMe: (): Promise<AuthUser | null> => {
    if (me && Date.now() - me.at < ME_FRESH_MS) return me.p;
    const asked = { at: Date.now(), p: askMe() };
    me = asked;
    const forget = () => {
      if (me === asked) me = null;
    };
    asked.p.then((u) => {
      if (!u) forget();
    }, forget);
    return asked.p;
  },
  logout: () => {
    me = null;
    return fetch("/auth/logout", { method: "POST" }).then(() => undefined);
  },

  // --- Engine registry (hosted backend, same-origin) ---

  // What this service remembers about YOU is among them, and is the ACCOUNT's — never `preferences` below, which is the RIG's.

  // --- Workspaces + file ops (engine-side file service, cross-origin) ---

  // The shared half, spread rather than re-listed, so this app and @studio/project-shell cannot drift on a route name.
  ...projectApi,

  importProject: (path: string) =>
    fsend<{ project: string; log: string[] }>("POST", "/import-project", {
      path,
    }),

  // --- The workspace's playlists (`_playlists/`, see @studio/song/docs/playlists.md) ---

  // Only the LISTING is its own route: `read`/`write` above already serve any workspace path, and `playlist new` is a command.
  playlists: () => fget<{ playlists: PlaylistInfo[] }>("/playlists"),

  // --- The workspace's reference tracks (`_references/`, see @studio/song-schema/docs/references.md) ---

  // The LISTING only: a track goes up with `upload` and is played over `mediaUrl`, both of which already take any workspace path.
  references: () => fget<{ references: ReferenceTrack[] }>("/references"),

  // The active project's imported audio and video clips, played over `mediaUrl` (../docs/resources.md).
  resources: () => fget<{ resources: ProjectResource[] }>("/resources"),

  // --- What a project asks of its engine (engineCompat.ts) ---

  projectPlugins: (project: string) =>
    fget<{ plugins: PluginNeed[] }>(
      `/project-plugins?project=${encodeURIComponent(project)}`,
    ),
  // Copy the project to the engine's machine again after a copy failed — packages/file-service/docs/engineSync.md.
  retryEngineSync: () => fsend<{ ok: true }>("POST", "/engine/sync/retry", {}),
  // Leave an automatically frozen VST live while it is edited — packages/song/docs/autoFreeze.md.
  thawAutoFreeze: (module: string, on = true) =>
    fsend<{ ok: true }>("POST", "/auto-freeze/thaw", { module, on }),
  // …scored by the file service itself against its engine's scan: only meaningful beside the engine, not on the server.
  projectCompat: (project: string) =>
    fget<{ compat: Compatibility | null }>(
      `/project-compat?project=${encodeURIComponent(project)}`,
    ),

  // --- A node's model, fetched onto this machine (the right-click's "Download model") ---

  /** Start fetching the model a NODE names from its module's `model_url`; `job: null` is "already here". */
  downloadModel: (node: string) =>
    fsend<{ job: ModelDownloadJob | null }>("POST", "/models/download", {
      node,
    }),
  /** …and how far it is — account-level on the service, polled by the settings too. */
  modelDownload: (id: string) =>
    fget<ModelDownloadJob>(`/account/models/${encodeURIComponent(id)}`),
  // Upload raw bytes (octet-stream, not fsend). A 409 rides through with `.status` so a skip can be reported.
  upload: async (
    dir: string,
    name: string,
    bytes: Blob | ArrayBuffer,
  ): Promise<{ path: string }> => {
    tooBig(name, bytes);
    const q = `dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`;
    const res = await fetch(cfg().base + `/upload?${q}`, {
      method: "POST",
      headers: fileHeaders({ "Content-Type": "application/octet-stream" }),
      body: bytes,
    });
    if (!res.ok) {
      const msg =
        res.status === 413
          ? tooBigMessage(name)
          : ((await res.json().catch(() => ({}))).error ??
            `upload ${name} failed`);
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
    bytes: Blob | ArrayBuffer,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<{ path: string }> => {
    try {
      tooBig(name, bytes);
    } catch (e) {
      return Promise.reject(e);
    }
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
          // A 2xx that is not JSON (a proxy's page) must still settle, or the drop's progress stays up for good.
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error(`upload ${name} — the answer was not readable`));
          }
        } else {
          let msg = `upload ${name} failed`;
          try {
            msg = JSON.parse(xhr.responseText).error ?? msg;
          } catch {}
          if (xhr.status === 413) msg = tooBigMessage(name);
          const err = new Error(msg) as Error & { status?: number };
          err.status = xhr.status;
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error(`upload ${name} — network error`));
      xhr.onabort = () => reject(new Error(`upload ${name} — cancelled`));
      xhr.ontimeout = () => reject(new Error(`upload ${name} — timed out`));
      xhr.send(bytes);
    });
  },
  // `whole` spans the source file rather than the placement, and `sensitivity` re-detects the SOURCE's transients, writing the threshold into the sidecar.
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
  // Audition one sample: the file service resolves it to a file and window, fires it at the engine, and answers the window it sent.
  preview: (req: PreviewReq) =>
    fsend<{ ok: true; start: number; length: number }>("POST", "/preview", req),
  // Render the mixdown and hand back blob + filename. "mp3" needs ffmpeg on the engine host; "wav" always works.
  exportMix: async (
    format: "wav" | "mp3",
    // One timeline alone, as it is auditioned; absent, Main.
    timeline?: string,
  ): Promise<{ blob: Blob; filename: string }> => {
    const tl = timeline ? `&timeline=${encodeURIComponent(timeline)}` : "";
    const res = await fetch(cfg().base + `/export?format=${format}${tl}`, {
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
  /** Start sharing the open project at a checkpoint; `shareLinkProgress` says where it is, and answers the SECRET at the end. */
  shareLinkStart: () => fsend<ShareProgress | null>("POST", "/share/link", {}),
  shareLinkProgress: () => fget<ShareProgress | null>("/share/link"),
  prewarmWaveforms: () =>
    fsend<WaveformStatus>("POST", "/waveforms/prewarm", {}, { fence: false }),
  waveformStatus: () => fget<WaveformStatus>("/waveforms/status"),
  // Stop the batch: it decodes audio in a second engine process, which is not what the machine should be doing while the transport plays.
  cancelWaveformPrewarm: () =>
    fsend<WaveformStatus>("POST", "/waveforms/cancel", {}, { fence: false }),

  /** Ask the MACHINE what an `@engine/…` plugin has, by loading one on purpose — SECONDS, and `null` is 'cannot load', not an empty list. */
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

  /** …and that same plugin's own WINDOW, on an ORPHAN instance: nothing touched in it is saved, and it opens on the ENGINE's machine. */
  showPluginNativeUI: (ref: string) =>
    fget<{ opened: string }>(
      `/plugin-native-ui?ref=${encodeURIComponent(ref)}`,
    ),

  /** The bases this module may be set to — its own and its ancestors'; the SERVER derives the folder from the module path it is given. */
  moduleBases: (path: string) =>
    fget<{ bases: string[] }>(`/module-base?path=${encodeURIComponent(path)}`),

  snapshotModuleBase: (path: string, name: string, ref: string) =>
    fsend<{ path: string }>("POST", "/module-base/snapshot", {
      path,
      name,
      ref,
    }),

  // A node's presets, files under a presets tree; applying and saving are `node preset` verbs — @studio/song/docs/userPresets.md.
  nodePresets: (node: string) =>
    fget<NodePresets>(`/presets?node=${encodeURIComponent(node)}`),
};

/** The MÉDIATHÈQUE — pl8's hosted catalogue, reached through `PL8` (declared at the top) — and pl8's API root, for the one caller outside this file: the DESK, a package with three hosts, which takes its base as a prop. */
export const PL8_API = `${PL8}/api`;

export const mediatek = {
  /** The whole songs family, in one call and no paging: a few hundred entries, searched in the browser. */
  listSongs: async (): Promise<MediatekEntry[]> => {
    const res = await fetch(`${PL8}/api/mediatek/list?family=songs`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(m["api.library"]({ status: res.status }));
    return ((await res.json()) as FamilyListing).entries;
  },

  /** One file, as an address rather than a fetch — a FLAC as the Opus copy beside it, since a browser plays this (backend/docs/media/derivedStream.md). */
  songUrl: (path: string) =>
    `${PL8}/api/mediatek/stream?path=${encodeURIComponent(path)}`,

  /** Separate one song of the library — the backend's, since it holds the master, on the best-rated engine it finds (apps/k7/backend/docs/media/stems.md). */
  prepareStems: async (song: string): Promise<StemsReply> => {
    const res = await fetch(`${PL8}/api/stems`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ song }),
    });
    if (!res.ok) {
      const said = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(said.error ?? `stems ${res.status}`);
    }
    return (await res.json()) as StemsReply;
  },

  /** How one is getting on; a 404 once pl8 has swept a finished job, which the caller reads as 'ask the disk' rather than as a failure. */
  separation: async (id: string): Promise<SeparateJob> => {
    const res = await fetch(`${PL8}/api/stems/${encodeURIComponent(id)}`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`separation ${res.status}`);
    return (await res.json()) as SeparateJob;
  },
};

/** What an empty DSP source is pre-filled with, per language — a stub that LOADS, since an empty file fails later and less obviously. */
function dspStub(ref: string, file: string): string {
  const head = `// ${ref} — the module's DSP.`;
  // Keyed by FILE and not by a default, so a language nobody wrote a stub for gets a comment rather than the wrong language's boilerplate.
  if (file === JSDSP_FILE)
    return `${head} Export the graph the engine will host.\nexport default {};\n`;
  if (file === FAUST_FILE)
    return `${head} The engine compiles this.\nimport("stdfaust.lib");\n\nprocess = _, _;\n`;
  return `${head}\n`;
}

/** What an absent `widgets.js` opens on: one screen, drawn, so the contract is on the page. */
function widgetsStub(ref: string): string {
  return `// ${ref} — what the panel's lcdscreen widgets draw, keyed by widget id.
// lcd: { ctx, width, height, params, input, output, state, color, now } — see the LCD screen doc.
export default {
  screen(lcd) {
    lcd.ctx.fillStyle = lcd.color.ink;
    lcd.ctx.font = "10px ui-monospace, monospace";
    lcd.ctx.fillText("${ref.split("/").pop()}", 4, 12);
  },
};
`;
}

/** A module's sibling SOURCE by name, or where it would go plus a stub — absent is not an error. */
async function siblingSource(
  path: string,
  file: string,
  stub: (ref: string) => string,
) {
  const parts = path.split("/");
  const ref = parts.slice(0, -1).join("/");
  const at = [...parts.slice(0, -1), file].join("/");
  try {
    const f = await api.read(at);
    return { ref, path: at, content: f.content, exists: true };
  } catch {
    return { ref, path: at, content: stub(ref), exists: false };
  }
}

/** The shared module builder's view of the file service — shapes, not behaviour, except `write`, which may be REDIRECTED onto a project copy (moduleFork.ts). */
export const moduleStore: ModuleStore = {
  // Absent is `null`, not a throw (see ModuleStore.read): a module the project has yet to write is exactly that.
  read: async (path) => {
    try {
      return (await api.read(path)).content;
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  },
  moduleUi: (path) => api.moduleUi(path),
  engines: (path) => api.moduleEngines(path),
  /** The module's DSP source, derived HERE rather than on the server: it is always the plain sibling, and absent is not an error. */
  dspSource: (path, file) =>
    siblingSource(path, file, (ref) => dspStub(ref, file)),
  /** …and the lcdscreen script, the same plain sibling of the same folder. */
  widgetsScript: (path) => siblingSource(path, WIDGETS_SCRIPT, widgetsStub),
  hints: () => api.hints(),
  /** Keep the plugin's current state as a named base — straight through to the route, the only side that knows where `base/` is. */
  snapshotBase: (path, name, ref) => api.snapshotModuleBase(path, name, ref),
  /** …and what it may be set TO: the ancestry is the server's to walk, a thin local module having none of its own. */
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

export type { AiSettingsView };

/** The module builder's "AI organize", on THIS backend — the one holding the account's key (backend/src/aiOrganize.ts). */
export const aiOrganize = {
  settings: async (): Promise<AiSettingsView> =>
    json(await fetch(`${BASE}/api/ai/settings`), "ai/settings"),
  /** A PATCH: an absent field is kept, null clears it — the key is never sent back to be kept. */
  saveSettings: async (patch: {
    apiKey?: string | null;
    model?: string | null;
  }): Promise<AiSettingsView> =>
    json(
      await fetch(`${BASE}/api/ai/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
      "ai/settings",
    ),
  /** Whether the button should exist at all; any failure reads as "no", since the button is optional. */
  enabled: async (): Promise<boolean> => {
    const res = await fetch(`${BASE}/api/ai/organize`).catch(() => null);
    if (!res?.ok) return false;
    return ((await res.json()) as { enabled?: boolean }).enabled === true;
  },
  /** One run: progress lines arrive as NDJSON, and the last one is the answer or the reason there is none. */
  run: async (
    req: AiOrganizeRequest,
    onStatus: (text: string) => void,
  ): Promise<AiOrganizeResult> => {
    const res = await fetch(`${BASE}/api/ai/organize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok || !res.body) return json<never>(res, "ai/organize");
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      buf += value ?? "";
      const lines = buf.split("\n");
      buf = done ? "" : (lines.pop() ?? "");
      for (const line of lines.filter((l) => l.trim())) {
        const e = JSON.parse(line) as AiOrganizeEvent;
        if (e.type === "status") onStatus(e.text);
        else if (e.type === "done") return e.result;
        else throw new Error([e.error, ...(e.issues ?? [])].join(" — "));
      }
      if (done) throw new Error("the answer stopped before it was complete");
    }
  },
};

/** The graph's thaw, fire-and-forget: a control on an automatically frozen VST asks, and the reload is the answer. */
export function thawAutoFreeze(module: string): void {
  api.thawAutoFreeze(module).catch(() => {});
}
