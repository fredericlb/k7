// downloads.ts — every download the page has going, in one list the sidebar's download manager draws and
// each row reads its spinner from: a queue for the copies a page starts, and the ones others run (a model job,
// the supervisor's instruments) mirrored in. A key names one thing: queuing it twice waits on the first.
// Framework-free; a screen reads it with useSyncExternalStore(subscribeDownloads, downloadsSnapshot). See ../docs/downloads.md.

export type DownloadKind = "song" | "songbook" | "engine";
export type DownloadPhase = "queued" | "running" | "done" | "failed";

export interface Download {
  /** What is downloaded, unique across kinds: `library:<path>`, `songbook:<id>`, `model:<job>`. */
  key: string;
  kind: DownloadKind;
  label: string;
  phase: DownloadPhase;
  /** Bytes, when whoever runs it counts them. */
  received?: number;
  total?: number;
  error?: string;
}

/** How many queued copies run at once: each is one POST the backend answers when the copy is whole. */
const CONCURRENCY = 2;
/** How long the finished rows stay once nothing runs, so the last one is seen landing. */
export const LINGER_MS = 4000;

interface Waiting {
  key: string;
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

let list: readonly Download[] = [];
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<unknown>>();
const waiting: Waiting[] = [];
let active = 0;
let linger: ReturnType<typeof setTimeout> | null = null;

const busy = (d: Download) => d.phase === "queued" || d.phase === "running";

const sameRow = (a: Download, b: Download) =>
  a.phase === b.phase &&
  a.label === b.label &&
  a.received === b.received &&
  a.total === b.total &&
  a.error === b.error;

function commit(next: readonly Download[]): void {
  list = next;
  if (linger) clearTimeout(linger);
  linger = null;
  if (list.length && !list.some(busy) && list.some((d) => d.phase === "done"))
    linger = setTimeout(() => {
      linger = null;
      commit(list.filter((d) => d.phase === "failed"));
    }, LINGER_MS);
  for (const l of listeners) l();
}

function put(d: Download): void {
  const at = list.findIndex((x) => x.key === d.key);
  commit(
    at < 0 ? [...list, d] : list.map((x, i) => (i === at ? { ...x, ...d } : x)),
  );
}

function patch(key: string, change: Partial<Download>): void {
  if (list.some((x) => x.key === key))
    commit(list.map((x) => (x.key === key ? { ...x, ...change } : x)));
}

export function subscribeDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function downloadsSnapshot(): readonly Download[] {
  return list;
}

/** Whether the thing under `key` is queued or coming down: what a row's spinner asks. */
export function isDownloading(all: readonly Download[], key: string): boolean {
  const d = all.find((x) => x.key === key);
  return !!d && busy(d);
}

function pump(): void {
  while (active < CONCURRENCY && waiting.length) {
    const w = waiting.shift() as Waiting;
    active++;
    patch(w.key, { phase: "running" });
    w.run()
      .then(
        (v) => {
          patch(w.key, { phase: "done" });
          w.resolve(v);
        },
        (e: unknown) => {
          patch(w.key, {
            phase: "failed",
            error: (e as Error)?.message ?? `${e}`,
          });
          w.reject(e);
        },
      )
      .finally(() => {
        active--;
        inFlight.delete(w.key);
        pump();
      });
  }
}

/** Queue `run` under `d.key`; answers what it answers. The same key while it waits or runs answers the same promise. */
export function queueDownload<T>(
  d: Pick<Download, "key" | "kind" | "label">,
  run: () => Promise<T>,
): Promise<T> {
  const known = inFlight.get(d.key);
  if (known) return known as Promise<T>;
  const p = new Promise<unknown>((resolve, reject) =>
    waiting.push({ key: d.key, run, resolve, reject }),
  );
  inFlight.set(d.key, p);
  put({
    ...d,
    phase: "queued",
    received: undefined,
    total: undefined,
    error: undefined,
  });
  pump();
  return p as Promise<T>;
}

/** One download someone else runs (a polled job): shown at once, told how far it is, then ended. */
export function trackDownload(d: Pick<Download, "key" | "kind" | "label">): {
  progress: (received: number, total?: number) => void;
  end: (error?: string) => void;
} {
  put({ ...d, phase: "running", error: undefined });
  return {
    progress: (received, total) => patch(d.key, { received, total }),
    end: (error) =>
      patch(d.key, error ? { phase: "failed", error } : { phase: "done" }),
  };
}

/** Mirror a whole list another process keeps (the supervisor's): what left it while running has landed. */
export function syncDownloads(prefix: string, now: readonly Download[]): void {
  const next = list.map((d): Download => {
    if (!d.key.startsWith(prefix)) return d;
    const n = now.find((x) => x.key === d.key);
    if (n) return sameRow(d, n) ? d : n;
    return busy(d) ? { ...d, phase: "done" } : d;
  });
  for (const n of now) if (!list.some((d) => d.key === n.key)) next.push(n);
  if (next.some((d, i) => d !== list[i]) || next.length !== list.length)
    commit(next);
}

/** Drop the finished and the failed rows, which is what the manager's Clear does. */
export function clearFinished(): void {
  commit(list.filter(busy));
}
