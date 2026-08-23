// fileApi.ts — the transport to the engine-side file service: where it is, the three headers
// that identify the caller, and the two verbs everything else is built from. Cross-origin and
// header-authenticated, never same-origin — see apps/st0/AGENTS.md for the three servers a
// project app talks to and which is which.

import {
  ENGINE_TOKEN_HEADER,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";

export interface FileCfg {
  base: string; // http://<engine-host>:<filePort>
  userEmail: string; // trusted (Phase-2 local trust)
  workspace: string; // the folder on that machine holding the repository
  engineToken: string; // the light LAN gate (from the whoami probe)
  /** WHICH engine this is — not for reaching it, but for naming it to another service, docs/fileApi.md. */
  engineId: string;
  /** A FROZEN document — a shared snapshot, and the whole of read-only mode. See docs/fileApi.md. */
  frozen?: {
    /** What to say when something tries to write. Read by whatever catches the throw. */
    why: string;
    canned: Record<string, string>;
  };
}

let fileCfg: FileCfg | null = null;

/** Point every file op at a chosen engine + workspace. Called by the gate, once. */
export function configureFileApi(config: FileCfg): void {
  fileCfg = config;
}

export function cfg(): FileCfg {
  if (!fileCfg)
    throw new Error("file API not configured (no project opened yet)");
  return fileCfg;
}

export function fileHeaders(extra?: HeadersInit): HeadersInit {
  const c = cfg();
  return {
    ...extra,
    [USER_HEADER]: c.userEmail,
    [WORKSPACE_HEADER]: c.workspace,
    [ENGINE_TOKEN_HEADER]: c.engineToken,
  };
}

/** Writes through `fsend` — the fence under the sharing below, see docs/fileApi.md. */
let epoch = 0;

/** GETs in flight, keyed `<epoch>\n<path>`, holding the BODY TEXT. Emptied as each settles. */
const inFlight = new Map<string, Promise<string>>();

/** GET a route — and if the same one is in the air, wait on THAT. Not a cache: docs/fileApi.md. */
export function fget<T>(path: string): Promise<T> {
  // A canned answer short-circuits, and is parsed per caller exactly as a real body is.
  const stock = fileCfg?.frozen?.canned[path];
  if (stock !== undefined) return Promise.resolve(JSON.parse(stock) as T);
  const key = `${epoch}\n${path}`;
  let body = inFlight.get(key);
  if (!body) {
    body = getOnce(path).finally(() => {
      if (inFlight.get(key) === body) inFlight.delete(key);
    });
    inFlight.set(key, body);
  }
  return body.then((t) => JSON.parse(t) as T);
}

async function getOnce(path: string): Promise<string> {
  const res = await fetch(cfg().base + path, { headers: fileHeaders() });
  const text = await res.text();
  if (!res.ok) {
    let said: string | undefined;
    try {
      said = JSON.parse(text).error;
    } catch {
      /* not JSON — the service is not the one answering, or it fell over */
    }
    const e: Error & { status?: number } = new Error(
      said ?? `GET ${path} failed`,
    );
    // Carried for the callers that have to tell "nothing there" from "it went wrong".
    e.status = res.status;
    throw e;
  }
  return text;
}

/** Thrown instead of writing when the open document is frozen; its own type, docs/fileApi.md. */
export class ReadOnlyDocument extends Error {}

export async function fsend<T>(
  method: string,
  path: string,
  body: unknown,
): Promise<T> {
  // THE choke point: every write in every app that mounts this shell — see docs/fileApi.md.
  const frozen = cfg().frozen;
  if (frozen) throw new ReadOnlyDocument(frozen.why);
  // Both edges, and both matter — see docs/fileApi.md.
  epoch++;
  const res = await fetch(cfg().base + path, {
    method,
    headers: fileHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }).finally(() => {
    epoch++;
  });
  if (!res.ok) {
    const e: Error & { status?: number } = new Error(
      (await res.json().catch(() => ({}))).error ?? `${method} ${path} failed`,
    );
    e.status = res.status;
    throw e;
  }
  return res.json() as Promise<T>;
}

/** Absolute URL for a media element: everything rides in the query, since a GET sends no headers. */
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

/** Why a call failed, when fetch() won't say — the no-cors probe, see docs/fileApi.md. */
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
