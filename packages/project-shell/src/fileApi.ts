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
  /**
   * WHICH engine this is, by id — beside the token because it comes from the same probe.
   *
   * Not used to reach the file service, which is addressed by `base`: it is what a call to
   * ANOTHER service must name when it is going to borrow this machine. pl8's `/api/stems` is
   * the first — it holds the master and asks an engine to cut it (apps/pl8/docs/stems.md) — and
   * the desk had no other way to say which machine it was on.
   */
  engineId: string;
  /**
   * A FROZEN document — a shared snapshot pl8 serves, with no file service behind it at all.
   *
   * The whole read-only mode is this one field, and that is deliberate: `fsend` is the only way
   * anything in these apps writes (~25 call sites in project.ts alone), so refusing here refuses
   * everywhere, once, with a sentence — instead of neutering feature by feature and discovering
   * the twenty-sixth one in production.
   *
   * `canned` answers the routes a snapshot HAS no answer for. A share carries the three compiled
   * documents and nothing else: no `/tree`, no `/hints`, no `/git/status`. Without it every hook
   * that asks for one would draw an error banner about a file service that is not merely down but
   * absent by design. The values are JSON TEXT and not objects, for `fget`'s reason — several
   * components parse the same body and must not be handed one object to alias.
   */
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

/**
 * How many times this app has WRITTEN through `fsend` — the fence under the sharing below.
 *
 * A GET may only join one issued in the same epoch. Without it, a component asking a
 * millisecond after a command landed would be handed the answer to a question asked before it,
 * which is the one way sharing a request can lie.
 */
let epoch = 0;

/** GETs in flight, keyed `<epoch>\n<path>`, holding the BODY TEXT. Emptied as each settles. */
const inFlight = new Map<string, Promise<string>>();

/**
 * GET a file-service route — and if the same one is already in the air, wait on THAT.
 *
 * Not a cache: nothing is kept once a request settles, so two calls a second apart are two
 * requests. What it collapses is the burst — the derived views are asked for by several
 * components at once, every one of them on the same `reloadKey`, and each answer costs the
 * service a real compile or a real walk. In st0, four components re-fetch `/graph` on a reload
 * and five `/project-doc` — whichever of them are mounted. The service answered each
 * separately, with the same bytes, out of a memo they were all hitting: the revision walk in
 * front of that memo is ~5 ms every time.
 *
 * The epoch above is the safety: a write moves it, so nothing issued after a command can be
 * answered by a request issued before it. Everything else that changes the answer — another
 * tab, a `git pull` — is what `/revision` polling is for, and it is no worse off than when
 * every component asked separately: those two requests could always have straddled the change.
 *
 * What is shared is the BODY TEXT, and each caller parses it. That is deliberate and it is the
 * whole difference between this and a cache: handing several components one parsed object would
 * alias it, and a surface that fills its decks' clips into the document it was given would be
 * writing into another component's state. Each caller pays the parse it always paid; what it
 * stops paying is the round trip and the service's work behind it.
 */
export function fget<T>(path: string): Promise<T> {
  // A canned answer short-circuits before the request, and is parsed per caller exactly as a
  // real body is — same rule, so a component cannot tell which kind it got.
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

/** Thrown instead of writing when the open document is frozen. Its own type so a caller can tell
 *  "this cannot be done here" from "the service refused", which read the same as a plain Error. */
export class ReadOnlyDocument extends Error {}

export async function fsend<T>(
  method: string,
  path: string,
  body: unknown,
): Promise<T> {
  // THE choke point. Every write in every app that mounts this shell goes through here, so a
  // frozen document is enforced in one place rather than by hiding buttons — a hidden button is
  // still a keyboard shortcut, a command bar entry and a context menu away.
  const frozen = cfg().frozen;
  if (frozen) throw new ReadOnlyDocument(frozen.why);
  // Both edges, and both matter: the first stops a GET issued while the write is in the air
  // from joining one issued before it, the second covers the GET that follows the reply.
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

/** Absolute URL for a <video>/<audio> element. Everything rides in the query — including the
 *  engine token — because an element GET cannot send headers. */
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

/**
 * Why a file-service call failed, when fetch() won't say.
 *
 * A refused CORS preflight and a dead server are the SAME rejection in JS — an opaque
 * `TypeError: NetworkError`, with no status and no body, because letting a page read that
 * difference is precisely what CORS exists to prevent. But the difference is the whole of the
 * user's next action: "click allow in the tray" versus "start the engine".
 *
 * `mode: "no-cors"` is the way through: it sends a simple GET with no preflight and no ACAO
 * check, yielding an opaque response we cannot read but whose ARRIVAL proves something
 * answered. So:
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
