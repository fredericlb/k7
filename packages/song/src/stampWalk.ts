// stampWalk.ts — the module stamp's walk: every entry's name mixed in order, and the newest mtime
// among the files that define a module. Run in parallel on a worker thread while the caller blocks
// on `Atomics.wait`, since every caller is synchronous; inline while the worker starts or where
// there is none. A reader would get wrong that the two can disagree: both mix the same names in the
// same order, so they answer the same stamp. See docs/moduleCache.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

/** A file whose CONTENT says what a module is. Everything else is named in the stamp, not stat'd. */
const DEFINITION = /\.(k7x|ts|js|vstpreset)$/i;

/** `<type>/<category>/<module>/assets/<sub>` is the deepest real tree; also a floor under a link loop. */
const MAX_DEPTH = 6;

/** A worker left without a walk this long is stopped, so an idle service does not hold its isolate. */
const IDLE_MS = 60_000;

/** Longer than any walk; past it the worker is held broken and every walk runs inline. */
const WAIT_MS = 5_000;

/** What a walk adds up to: the FNV-1a hash of the names, how many there were, the newest mtime. */
export interface Walked {
  hash: number;
  entries: number;
  newest: number;
}

/** The walk on this thread, one syscall at a time. */
export function walkInline(
  roots: readonly string[],
  files: readonly string[],
): Walked {
  let hash = 2166136261;
  let entries = 0;
  let newest = 0;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  };
  const stamp = (path: string): void => {
    try {
      const m = statSync(path).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      /* raced away between readdir and stat — the next call sees it */
    }
  };
  const walk = (abs: string, depth: number): void => {
    let found: Dirent[];
    try {
      found = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // not there, or unreadable — the loaders treat it as empty too
    }
    for (const e of found) {
      if (e.name.startsWith(".")) continue;
      entries++;
      mix(e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) walk(join(abs, e.name), depth + 1);
        continue;
      }
      if (DEFINITION.test(e.name)) stamp(join(abs, e.name));
    }
  };
  for (const root of roots) walk(root, 0);
  for (const file of files) stamp(file);
  return { hash, entries, newest };
}

// The worker's own source, plain CommonJS on node built-ins only, so no bundle has to ship a file for it.
const WORKER = `
const { parentPort } = require("node:worker_threads");
const { readdir, stat } = require("node:fs/promises");
const { join } = require("node:path");
parentPort.on("message", ({ sab, roots, files, maxDepth, definition }) => {
  const def = new RegExp(definition.source, definition.flags);
  let newest = 0;
  const stamp = (path) => stat(path).then((s) => { if (s.mtimeMs > newest) newest = s.mtimeMs; }, () => {});
  const list = async (abs, depth) => {
    let found;
    try { found = await readdir(abs, { withFileTypes: true }); } catch { return []; }
    const out = [];
    for (const e of found) {
      if (e.name.startsWith(".")) continue;
      out.push(e.name);
      if (e.isDirectory()) { if (depth < maxDepth) out.push(list(join(abs, e.name), depth + 1)); continue; }
      if (def.test(e.name)) out.push(stamp(join(abs, e.name)));
    }
    return Promise.all(out);
  };
  const done = (state, values) => {
    if (values) new Float64Array(sab, 8, 3).set(values);
    const flag = new Int32Array(sab, 0, 1);
    Atomics.store(flag, 0, state);
    Atomics.notify(flag, 0);
  };
  Promise.all([Promise.all(roots.map((r) => list(r, 0))), Promise.all(files.map(stamp))]).then(([trees]) => {
    let hash = 2166136261;
    let entries = 0;
    const mix = (item) => {
      if (Array.isArray(item)) { for (const x of item) mix(x); return; }
      if (typeof item !== "string") return;
      entries++;
      for (let i = 0; i < item.length; i++) { hash ^= item.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    };
    mix(trees);
    done(1, [hash, entries, newest]);
  }, () => done(2));
});
parentPort.postMessage("ready");
`;

let worker: Worker | null = null;
let ready = false;
let broken = false;
let idle: ReturnType<typeof setTimeout> | null = null;

function stop(): void {
  const w = worker;
  worker = null;
  ready = false;
  void w?.terminate();
}

/** Start the worker, resolved with whether it can take a walk; one that cannot start leaves walks inline. */
export function startStampWorker(): Promise<boolean> {
  if (broken) return Promise.resolve(false);
  if (ready) return Promise.resolve(true);
  return new Promise((resolve) => {
    let w: Worker;
    try {
      w = new Worker(WORKER, { eval: true });
    } catch {
      broken = true;
      resolve(false);
      return;
    }
    worker = w;
    w.on("message", (m) => {
      if (m !== "ready" || worker !== w) return;
      ready = true;
      // Held only while it starts: the ~40 ms someone may be awaiting, then never again.
      w.unref();
      resolve(true);
    });
    w.on("error", () => {
      broken = true;
      if (worker === w) stop();
      resolve(false);
    });
    w.on("exit", () => {
      if (worker === w) stop();
      resolve(false);
    });
  });
}

/** The walk on the worker, or null when it could not answer. */
function walkOnWorker(
  w: Worker,
  roots: readonly string[],
  files: readonly string[],
): Walked | null {
  const sab = new SharedArrayBuffer(32);
  const flag = new Int32Array(sab, 0, 1);
  const definition = { source: DEFINITION.source, flags: DEFINITION.flags };
  w.postMessage({ sab, roots, files, maxDepth: MAX_DEPTH, definition });
  if (Atomics.wait(flag, 0, 0, WAIT_MS) === "timed-out") {
    broken = true;
    stop();
    return null;
  }
  if (Atomics.load(flag, 0) !== 1) return null;
  const [hash, entries, newest] = new Float64Array(sab, 8, 3);
  return { hash, entries, newest };
}

/** The stamp walk over `roots`, plus the mtime of each of `files` — on the worker when it is up. */
export function walkStamp(
  roots: readonly string[],
  files: readonly string[],
): Walked {
  if (idle) idle.refresh();
  else
    idle = setTimeout(() => {
      idle = null;
      stop();
    }, IDLE_MS).unref();
  if (worker && ready) {
    const walked = walkOnWorker(worker, roots, files);
    if (walked) return walked;
  } else if (!worker) void startStampWorker();
  return walkInline(roots, files);
}
