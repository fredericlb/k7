// fileApi.ts — the transport to the file service behind pl8's file hub: where it is, the headers
// that identify the caller, and the two verbs everything else is built from. Header-authenticated
// by the hub's ticket, never by the cookie — see apps/k7/AGENTS.md for the three servers a
// project app talks to and which is which.

import {
  ENGINE_TOKEN_HEADER,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";

export interface FileCfg {
  base: string; // the file hub's URL, under pl8
  userEmail: string; // informative only — the hub stamps the user from the ticket
  workspace: string; // the folder on that machine holding the repository
  engineToken: string; // the hub's ticket, `<ticket>~<engineId>`
  /** WHICH engine this is — not for reaching it, but for naming it to another service, docs/fileApi.md. */
  engineId: string;
  /** A new hub ticket after a 401, for a session that outlives its twelve hours; absent where there is no hub. */
  renewTicket?: () => Promise<string | null>;
  /** A FROZEN document — a shared snapshot, and the whole of read-only mode. See docs/fileApi.md. */
  frozen?: {
    /** What to say when something tries to write. Read by whatever catches the throw. */
    why: string;
    canned: Record<string, string>;
  };
}

/**
 * Add up main-thread work by name, for a host that watches for stalls. Injected rather than
 * imported: this package draws no screen and must not reach into an app's instruments. Defaults to
 * doing nothing, so nobody has to set it — see apps/k7/frontend/docs/shell.md.
 */
export type Tally = (name: string, ms: number, bytes?: number) => void;
let tally: Tally = () => {};

/** Point the transport's reports at a host's tally. Off until somebody asks. */
export function setFileApiTally(fn: Tally): void {
  tally = fn;
}

let fileCfg: FileCfg | null = null;

/** Point every file op at a chosen engine + workspace. Called by the gate, once. */
export function configureFileApi(config: FileCfg): void {
  fileCfg = config;
}

// One renewal at a time, however many requests met the same expired ticket.
let renewing: Promise<boolean> | null = null;

/** Swap in a fresh ticket after a 401; true when there is one to retry with. */
function renewTicket(): Promise<boolean> {
  const c = fileCfg;
  if (!c?.renewTicket) return Promise.resolve(false);
  renewing ??= c
    .renewTicket()
    .then((ticket) => {
      if (!ticket || fileCfg !== c) return false;
      // The token is `<ticket>~<engineId>`: only the ticket ages.
      c.engineToken = `${ticket}~${c.engineId}`;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      renewing = null;
    });
  return renewing;
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
  if (stock !== undefined)
    return Promise.resolve(parse<T>(`GET ${route(path)}`, stock));
  const key = `${epoch}\n${path}`;
  let body = inFlight.get(key);
  if (!body) {
    body = getOnce(path).finally(() => {
      if (inFlight.get(key) === body) inFlight.delete(key);
    });
    inFlight.set(key, body);
  }
  return body.then((t) => parse<T>(`GET ${route(path)}`, t));
}

/**
 * The one place a response becomes objects, and the only part of a GET that blocks: the fetch is
 * awaited, the parse is not. Reported per ROUTE rather than per URL — a path carrying a file name
 * would make every read its own line and the busiest route unfindable.
 */
function parse<T>(label: string, text: string): T {
  const began = performance.now();
  let value: T;
  try {
    value = JSON.parse(text) as T;
  } catch {
    // A 200 whose body is not whole: the file service was restarted in the middle of answering.
    throw new Error(`${label}: the answer was cut off (${text.length} bytes)`);
  }
  tally(label, performance.now() - began, text.length);
  return value;
}

/** A path's first two segments, without the query: enough to name the route, short enough to group. */
function route(path: string): string {
  return path.split("?")[0].split("/").slice(0, 3).join("/");
}

/** What a read may take: past this it is dropped, and every caller waiting on it with it — docs/fileApi.md. */
export const READ_MS = 120_000;

/** A read whose answer broke off, asked once more before anyone is told: the service was most likely restarting (docs/fileApi.md). */
async function getOnce(
  path: string,
  retried = false,
  renewed = false,
): Promise<string> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(cfg().base + path, {
      headers: fileHeaders(),
      signal: AbortSignal.timeout(READ_MS),
      // Never the browser's copy: every route here answers from the files as they are now, and the revision decides when to ask.
      cache: "no-store",
    });
    text = await res.text();
  } catch (e) {
    if ((e as Error).name === "TimeoutError")
      throw new Error(`GET ${path}: no answer after ${READ_MS / 1000} s`);
    if (!retried) return getOnce(path, true, renewed);
    throw e;
  }
  // A 2xx with nothing in it is no answer either: every route here answers JSON.
  if (res.ok && text === "" && !retried) return getOnce(path, true, renewed);
  // An expired ticket, in a session that outlived it: renewed once, and the read asked again.
  if (res.status === 401 && !renewed && (await renewTicket()))
    return getOnce(path, retried, true);
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
  const post = () =>
    fetch(cfg().base + path, {
      method,
      headers: fileHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
  let res = await post().finally(() => {
    epoch++;
  });
  // A 401 is the hub refusing the ticket before the service saw anything, so asking again writes once.
  if (res.status === 401 && (await renewTicket()))
    res = await post().finally(() => {
      epoch++;
    });
  if (!res.ok) {
    const e: Error & { status?: number } = new Error(
      (await res.json().catch(() => ({}))).error ?? `${method} ${path} failed`,
    );
    e.status = res.status;
    throw e;
  }
  // Read as TEXT then parsed here, so the parse is timed: `res.json()` hides it inside the await.
  return parse<T>(`${method} ${route(path)}`, await res.text());
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
