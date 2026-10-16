// pathMap.ts — the engine names files by LOCAL path and the server by its own; this rewrites
// every string under a shared root as a frame crosses, and moves the file first: downloaded
// before a frame naming it reaches the engine, uploaded before a frame naming a file the engine
// wrote reaches the server. Only whole JSON strings are rewritten, never substrings. A channel
// the server syncs itself (`sync`) is only rewritten. See docs/tunnel.md.

import { mkdir, rename, rm, stat, utimes } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { TargetInUse } from "./agentFiles.ts";
import type { RemoteStat } from "./frames.ts";
import { safeSegment } from "./segments.ts";

export interface MappedRoot {
  /** The server's absolute POSIX path. */
  remote: string;
  /** Where the engine's machine keeps its copy, in the local path style. */
  local: string;
  writable: boolean;
}

/** The server side of moving files, as the agent reaches it. */
export interface RemoteFiles {
  stat(paths: string[]): Promise<RemoteStat[]>;
  download(remote: RemoteStat, local: string): Promise<void>;
  upload(local: string, remote: string): Promise<RemoteStat>;
}

interface Synced {
  size: number;
  localMtimeMs: number;
  remoteMtimeMs: number;
}

/** What is known to be the same on both sides, and the downloads in flight — one per agent, shared by its channels. */
export class SyncLedger {
  readonly synced = new Map<string, Synced>();
  readonly downloads = new Map<string, Promise<void>>();
  /** canonical → the copy beside it holding the current version, when the canonical one is held open. */
  readonly redirects = new Map<string, string>();

  canonicalOf(actual: string): string | null {
    for (const [canonical, at] of this.redirects)
      if (at === actual) return canonical;
    return null;
  }
}

/** How far a `sync` has got: only the files it had to copy count, not those already here. */
export interface SyncProgress {
  files: number;
  filesDone: number;
  bytes: number;
  bytesDone: number;
  /** One line per file that did not arrive: its name, then why — never a path, which the map would upload. */
  failures: string[];
}

/** `clip.wav` → `clip~<server mtime>.wav`: one name per version, so a version placed once is found again after a restart. */
function beside(local: string, remoteMtimeMs: number): string {
  const ext = extname(local);
  return `${local.slice(0, local.length - ext.length)}~${Math.trunc(remoteMtimeMs)}${ext}`;
}

/** Downloads a `sync` keeps in flight at once, as many as the C++ agent's. */
const SYNC_PARALLEL = 8;

/** Frames arriving at meter rate carry no path, and are passed through untouched. */
const UNMAPPED_TYPES = new Set(["state", "io-levels", "levels"]);

const jsonEscaped = (s: string): string => JSON.stringify(s).slice(1, -1);

const sameMtime = (a: number, b: number): boolean => Math.abs(a - b) < 2;

function mapStrings(v: unknown, f: (s: string) => string | null): unknown {
  if (typeof v === "string") return f(v) ?? v;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = mapStrings(x, f);
    return out;
  }
  return v;
}

function collect(
  v: unknown,
  keep: (s: string) => boolean,
  into: Set<string>,
): void {
  if (typeof v === "string") {
    if (keep(v)) into.add(v);
  } else if (Array.isArray(v)) for (const x of v) collect(x, keep, into);
  else if (v && typeof v === "object")
    for (const x of Object.values(v)) collect(x, keep, into);
}

export class PathMap {
  private readonly remoteNeedles: string[];
  private readonly localNeedles: string[];

  constructor(
    private readonly roots: MappedRoot[],
    private readonly files: RemoteFiles,
    private readonly ledger: SyncLedger,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.remoteNeedles = roots.map((r) => jsonEscaped(r.remote));
    this.localNeedles = roots.map((r) => jsonEscaped(r.local));
  }

  /** The local spelling of a server path under a shared root — the copy the engine should open — or null. */
  toLocal(remote: string): string | null {
    const c = this.canonical(remote);
    return c === null ? null : this.actual(c);
  }

  /** The fixed local spelling, which keys the ledger whatever copy is current. */
  private canonical(remote: string): string | null {
    for (const r of this.roots) {
      if (remote === r.remote) return r.local;
      if (!remote.startsWith(`${r.remote}/`)) continue;
      const rest = remote.slice(r.remote.length + 1).split("/");
      // Every segment the native agent would refuse, refused here too — segments.ts.
      if (!rest.every((s) => safeSegment(s))) return null;
      return join(r.local, ...rest);
    }
    return null;
  }

  private actual(canonical: string): string {
    return this.ledger.redirects.get(canonical) ?? canonical;
  }

  /** Point `canonical` at `actual` (itself to clear), removing the copy it replaces once nothing holds it. */
  private async place(canonical: string, actual: string): Promise<void> {
    const before = this.ledger.redirects.get(canonical);
    if (actual === canonical) this.ledger.redirects.delete(canonical);
    else this.ledger.redirects.set(canonical, actual);
    if (before && before !== actual)
      await rm(before, { force: true }).catch(() => {});
  }

  /** The server spelling of a local path under a shared root, or null. */
  toRemote(named: string): { remote: string; root: MappedRoot } | null {
    // A version placed beside a held file stands for the canonical path, which is what the server knows.
    const local = this.ledger.canonicalOf(named) ?? named;
    for (const r of this.roots) {
      if (local === r.local) return { remote: r.remote, root: r };
      if (!local.startsWith(r.local + sep)) continue;
      const rel = relative(r.local, local);
      if (!rel || rel.startsWith("..")) continue;
      return { remote: `${r.remote}/${rel.split(sep).join("/")}`, root: r };
    }
    return null;
  }

  /** Bring ONE file down by its local path, for a handler that fetches as it goes; false when the server has no such file. */
  async ensureLocal(local: string): Promise<boolean> {
    const mapped = this.toRemote(local);
    if (!mapped) return false;
    const [entry] = await this.files.stat([mapped.remote]);
    if (entry?.kind !== "file") return false;
    await this.ensureFile(entry, this.ledger.canonicalOf(local) ?? local);
    return true;
  }

  /** A server→engine frame, rewritten; with `fetch`, every file it names present locally first. */
  async outbound(text: string, fetch = true): Promise<string> {
    if (!this.remoteNeedles.some((n) => text.includes(n))) return text;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return text;
    }
    const type = (msg as { type?: unknown })?.type;
    if (typeof type === "string" && UNMAPPED_TYPES.has(type)) return text;
    // A `sync` request names the files it is about to copy itself, reporting as it goes.
    if (fetch && type !== "sync") {
      const named = new Set<string>();
      collect(msg, (s) => this.canonical(s) !== null, named);
      // A whole document is checked against the server; a delta trusts what an earlier one settled.
      const recheck = type === "project";
      const ask = [...named].filter(
        (p) => recheck || !this.ledger.synced.has(this.canonical(p) as string),
      );
      if (ask.length) await this.bringDown(await this.files.stat(ask));
    }
    return JSON.stringify(mapStrings(msg, (s) => this.toLocal(s)));
  }

  /** Bring every listed LOCAL path up to date, reporting after each copy; resolves the last report. */
  async sync(
    locals: string[],
    progress: (p: SyncProgress) => void,
  ): Promise<SyncProgress> {
    const ask = locals.flatMap((l) => this.toRemote(l)?.remote ?? []);
    const p: SyncProgress = {
      files: 0,
      filesDone: 0,
      bytes: 0,
      bytesDone: 0,
      failures: [],
    };
    const todo: { e: RemoteStat; local: string }[] = [];
    for (const e of ask.length ? await this.files.stat(ask) : []) {
      const local = this.canonical(e.path);
      if (!local) continue;
      if (e.kind !== "file")
        await mkdir(e.kind === "dir" ? local : dirname(local), {
          recursive: true,
        }).catch(() => {});
      else if (!(await this.upToDate(e, local))) {
        todo.push({ e, local });
        p.bytes += e.size ?? 0;
      }
    }
    p.files = todo.length;
    progress({ ...p, failures: [...p.failures] });
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let i = next++; i < todo.length; i = next++) {
        const { e, local } = todo[i];
        try {
          await this.ensureFile(e, local);
        } catch (err) {
          const why = (err as Error).message;
          this.log(`could not bring down ${e.path}: ${why}`);
          p.failures.push(
            `${e.path.slice(e.path.lastIndexOf("/") + 1)} — ${why}`,
          );
        }
        p.filesDone++;
        p.bytesDone += e.size ?? 0;
        progress({ ...p, failures: [...p.failures] });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SYNC_PARALLEL, todo.length) }, worker),
    );
    return p;
  }

  /** An engine→server frame, rewritten, with every file the engine changed uploaded first. */
  async inbound(text: string): Promise<string> {
    if (!this.localNeedles.some((n) => text.includes(n))) return text;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return text;
    }
    // A reply's `raw` is delivered as the machine wrote it: its caller needs the machine's own spelling.
    const { raw, ...rest } =
      msg && typeof msg === "object" && !Array.isArray(msg)
        ? (msg as Record<string, unknown>)
        : { raw: undefined };
    const named = new Set<string>();
    collect(rest, (s) => this.toRemote(s) !== null, named);
    for (const local of named) await this.sendUp(local);
    const mapped = mapStrings(rest, (s) => this.toRemote(s)?.remote ?? null);
    return JSON.stringify(
      raw === undefined ? mapped : { ...(mapped as object), raw },
    );
  }

  private async bringDown(entries: RemoteStat[]): Promise<void> {
    await Promise.all(
      entries.map(async (e) => {
        const local = this.canonical(e.path);
        if (!local) return;
        try {
          if (e.kind === "dir") await mkdir(local, { recursive: true });
          else if (e.kind === "missing")
            await mkdir(dirname(local), { recursive: true });
          else await this.ensureFile(e, local);
        } catch (err) {
          this.log(`could not bring down ${e.path}: ${(err as Error).message}`);
        }
      }),
    );
  }

  private async upToDate(e: RemoteStat, local: string): Promise<boolean> {
    const size = e.size ?? 0;
    const remoteMtimeMs = e.mtimeMs ?? 0;
    const have = await stat(this.actual(local)).catch(() => null);
    const known = this.ledger.synced.get(local);
    const same = known
      ? known.size === size &&
        sameMtime(known.remoteMtimeMs, remoteMtimeMs) &&
        !!have &&
        have.size === size &&
        sameMtime(have.mtimeMs, known.localMtimeMs)
      : !!have && have.size === size && sameMtime(have.mtimeMs, remoteMtimeMs);
    if (same && !known && have)
      this.ledger.synced.set(local, {
        size,
        localMtimeMs: have.mtimeMs,
        remoteMtimeMs,
      });
    return same;
  }

  private async ensureFile(e: RemoteStat, local: string): Promise<void> {
    const size = e.size ?? 0;
    const remoteMtimeMs = e.mtimeMs ?? 0;
    if (await this.upToDate(e, local)) return;
    const aside = beside(local, remoteMtimeMs);
    // A version already placed beside a held file — before a restart, say — is adopted rather than fetched again.
    const there = await stat(aside).catch(() => null);
    if (
      there &&
      there.size === size &&
      sameMtime(there.mtimeMs, remoteMtimeMs)
    ) {
      await this.place(local, aside);
      this.ledger.synced.set(local, {
        size,
        localMtimeMs: there.mtimeMs,
        remoteMtimeMs,
      });
      return;
    }
    let pending = this.ledger.downloads.get(local);
    if (!pending) {
      this.log(`fetching ${e.path} (${size} bytes)`);
      pending = this.fetchInto(e, local, aside).finally(() =>
        this.ledger.downloads.delete(local),
      );
      this.ledger.downloads.set(local, pending);
    }
    await pending;
    const now = await stat(this.actual(local));
    this.ledger.synced.set(local, {
      size: now.size,
      localMtimeMs: now.mtimeMs,
      remoteMtimeMs,
    });
  }

  /** Download over `local`, or beside it at `aside` when the engine holds the old version open. */
  private async fetchInto(
    e: RemoteStat,
    local: string,
    aside: string,
  ): Promise<void> {
    try {
      await this.files.download(e, local);
      await this.place(local, local);
    } catch (err) {
      if (!(err instanceof TargetInUse)) throw err;
      try {
        await rename(err.part, aside);
      } catch {
        await rm(err.part, { force: true });
        throw new Error(
          `${err.message}, and the new version could not be put beside it`,
        );
      }
      const when = new Date(e.mtimeMs ?? Date.now());
      await utimes(aside, when, when);
      this.log(`${local} is held open; its new version is ${aside}`);
      await this.place(local, aside);
    }
  }

  private async sendUp(named: string): Promise<void> {
    const mapped = this.toRemote(named);
    if (!mapped?.root.writable) return;
    const have = await stat(named).catch(() => null);
    if (!have?.isFile()) return;
    // The ledger is keyed by the canonical path, which a version placed beside a held file stands for.
    const local = this.ledger.canonicalOf(named) ?? named;
    const known = this.ledger.synced.get(local);
    if (
      known &&
      known.size === have.size &&
      sameMtime(known.localMtimeMs, have.mtimeMs)
    )
      return;
    try {
      this.log(`sending ${mapped.remote} (${have.size} bytes)`);
      const back = await this.files.upload(named, mapped.remote);
      this.ledger.synced.set(local, {
        size: have.size,
        localMtimeMs: have.mtimeMs,
        remoteMtimeMs: back.mtimeMs ?? 0,
      });
    } catch (err) {
      this.log(`could not send ${local}: ${(err as Error).message}`);
    }
  }
}
