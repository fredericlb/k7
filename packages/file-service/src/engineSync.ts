// engineSync.ts — every file a document names is on the bound engine's MACHINE before that document
// is sent: copied by one `sync` job, whose progress the /workspace poll reports, so the engine's own
// channel never waits on a download while it plays. A failed copy is FATAL: nothing is sent until
// the person retries. A machine too old to know `sync` fetches on its own channel, as it always did.
// See docs/engineSync.md.

import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { JobError, requestJob } from "@studio/engine-tunnel/jobs-client";
import type { EngineSyncState } from "@studio/web-protocol";
import { WebSocket } from "ws";
import { boundJobsUrl } from "./boundMachine.ts";

interface Run<D> {
  doc: D;
  send: (doc: D) => void;
  state: EngineSyncState;
}

/** server path → `size:mtime` of the copy the bound machine is known to hold. */
const settled = new Map<string, string>();
/** The jobs path `settled` is about: another machine holds none of it. */
let settledFor: string | null = null;
/** A machine that refused `sync` by name — it still fetches on the engine channel by itself. */
let legacy: string | null = null;
/** One copy at a time per session; the document it holds back is the latest one asked for. */
const runs = new Map<string, Run<unknown>>();
/** The last copy that failed, per session, until a later one succeeds. */
const failures = new Map<string, EngineSyncState>();

/** What the poll shows for `session`: a copy in flight, the last one that failed, or null. */
export function engineSyncState(session: string): EngineSyncState | null {
  return runs.get(session)?.state ?? failures.get(session) ?? null;
}

/** Whether a copy, running or failed, is holding `session`'s document back — the engine not holding it is no fault of its own. */
export function isHeldBack(session: string): boolean {
  return runs.has(session) || failures.has(session);
}

/** Let the next document try again — what the browser's "Reload project" asks for. */
export function forgetSyncFailure(session: string): void {
  failures.delete(session);
}

function collect(v: unknown, into: Set<string>): void {
  if (typeof v === "string") {
    // An inline source (`faustDsp` opens on `//`) is not a path, and a path holds no line break.
    if (isAbsolute(v) && !v.includes("\n")) into.add(v);
  } else if (Array.isArray(v)) for (const x of v) collect(x, into);
  else if (v && typeof v === "object")
    for (const x of Object.values(v)) collect(x, into);
}

/** The files `doc` and `extra` name that the machine is not known to hold as they are here. */
function unsettled(
  doc: unknown,
  extra: string[],
): { path: string; key: string; size: number }[] {
  const named = new Set(extra);
  collect(doc, named);
  const out: { path: string; key: string; size: number }[] = [];
  for (const path of named) {
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(path, { throwIfNoEntry: false });
    } catch {
      continue; // ENAMETOOLONG and the like: a string shaped like a path that names no file
    }
    if (!st?.isFile()) continue;
    const key = `${st.size}:${Math.round(st.mtimeMs)}`;
    if (settled.get(path) !== key) out.push({ path, key, size: st.size });
  }
  return out;
}

/** Send `doc` once every file it (and `extra`) names is on the bound machine; at once when nothing is missing. */
export function sendWhenSynced<D>(
  session: string,
  doc: D,
  extra: () => string[],
  send: (doc: D) => void,
): void {
  const url = boundJobsUrl();
  if (!url || url === legacy) {
    send(doc);
    return;
  }
  if (url !== settledFor) {
    settled.clear();
    settledFor = url;
  }
  // Fatal until the person asks again: a project missing files would play with silent clips.
  if (failures.has(session)) return;
  const run = runs.get(session) as Run<D> | undefined;
  if (run) {
    run.doc = doc;
    run.send = send;
    return;
  }
  const todo = unsettled(doc, extra());
  if (todo.length) void copy(session, url, { doc, send }, todo, extra);
  else send(doc);
}

async function copy<D>(
  session: string,
  url: string,
  held: { doc: D; send: (doc: D) => void },
  todo: { path: string; key: string; size: number }[],
  extra: () => string[],
): Promise<void> {
  const state: EngineSyncState = {
    files: todo.length,
    filesDone: 0,
    bytes: todo.reduce((n, t) => n + t.size, 0),
    bytesDone: 0,
  };
  const run: Run<D> = { ...held, state };
  runs.set(session, run as Run<unknown>);
  const sock = new WebSocket(url);
  sock.on("error", () => {});
  try {
    const last = await requestJob(
      sock,
      { type: "sync", files: todo.map((t) => t.path) },
      (r) => r.type === "synced",
      (r) => {
        // The machine counts only what it had to copy, which is what the bar is about.
        if (r.type === "syncing")
          Object.assign(state, {
            files: Number(r.files) || 0,
            filesDone: Number(r.filesDone) || 0,
            bytes: Number(r.bytes) || 0,
            bytesDone: Number(r.bytesDone) || 0,
          });
      },
    );
    const failed = Number(last.failed) || 0;
    const why = Array.isArray(last.failures) ? last.failures.map(String) : [];
    // A file that did not arrive stays unsettled, so the retry asks for it again.
    if (failed) {
      console.error(
        `   ✗ ${failed} file(s) did not reach the engine's machine: ${why.join("; ")}`,
      );
      failures.set(session, { ...state, failed, failures: why });
    } else {
      for (const t of todo) settled.set(t.path, t.key);
      failures.delete(session);
    }
  } catch (e) {
    const message = e instanceof JobError ? e.message : String(e);
    if (message.includes("does not do 'sync'")) {
      legacy = url;
      failures.delete(session);
    } else {
      console.error(`   ✗ could not copy the project's files: ${message}`);
      failures.set(session, { ...state, error: message });
    }
  } finally {
    sock.close();
    runs.delete(session);
  }
  // A failed copy sends nothing; otherwise the latest document goes through the gate again, as it may name more files.
  if (!failures.has(session)) sendWhenSynced(session, run.doc, extra, run.send);
}
