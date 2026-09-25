// pathMap.ts — the engine names files by LOCAL path and the server by its own; this rewrites
// every string under a shared root as a frame crosses, and moves the file first: downloaded
// before a frame naming it reaches the engine, uploaded before a frame naming a file the engine
// wrote reaches the server. Only whole JSON strings are rewritten, never substrings.
// See docs/tunnel.md.

import { mkdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { RemoteStat } from "./frames.ts";

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
}

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

  /** The local spelling of a server path under a shared root, or null. */
  toLocal(remote: string): string | null {
    for (const r of this.roots) {
      if (remote === r.remote) return r.local;
      if (!remote.startsWith(`${r.remote}/`)) continue;
      const rest = remote.slice(r.remote.length + 1).split("/");
      if (rest.some((s) => s === ".." || s === "")) return null;
      return join(r.local, ...rest);
    }
    return null;
  }

  /** The server spelling of a local path under a shared root, or null. */
  toRemote(local: string): { remote: string; root: MappedRoot } | null {
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
    await this.ensureFile(entry, local);
    return true;
  }

  /** A server→engine frame, rewritten, with every file it names present locally first. */
  async outbound(text: string): Promise<string> {
    if (!this.remoteNeedles.some((n) => text.includes(n))) return text;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return text;
    }
    const type = (msg as { type?: unknown })?.type;
    if (typeof type === "string" && UNMAPPED_TYPES.has(type)) return text;
    const named = new Set<string>();
    collect(msg, (s) => this.toLocal(s) !== null, named);
    // A whole document is checked against the server; a delta trusts what an earlier one settled.
    const recheck = type === "project";
    const ask = [...named].filter(
      (p) => recheck || !this.ledger.synced.has(this.toLocal(p) as string),
    );
    if (ask.length) await this.bringDown(await this.files.stat(ask));
    return JSON.stringify(mapStrings(msg, (s) => this.toLocal(s)));
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
    const named = new Set<string>();
    collect(msg, (s) => this.toRemote(s) !== null, named);
    for (const local of named) await this.sendUp(local);
    return JSON.stringify(
      mapStrings(msg, (s) => this.toRemote(s)?.remote ?? null),
    );
  }

  private async bringDown(entries: RemoteStat[]): Promise<void> {
    await Promise.all(
      entries.map(async (e) => {
        const local = this.toLocal(e.path);
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

  private async ensureFile(e: RemoteStat, local: string): Promise<void> {
    const size = e.size ?? 0;
    const remoteMtimeMs = e.mtimeMs ?? 0;
    const have = await stat(local).catch(() => null);
    const known = this.ledger.synced.get(local);
    const upToDate = known
      ? known.size === size &&
        sameMtime(known.remoteMtimeMs, remoteMtimeMs) &&
        !!have &&
        have.size === size &&
        sameMtime(have.mtimeMs, known.localMtimeMs)
      : !!have && have.size === size && sameMtime(have.mtimeMs, remoteMtimeMs);
    if (upToDate) {
      if (!known && have)
        this.ledger.synced.set(local, {
          size,
          localMtimeMs: have.mtimeMs,
          remoteMtimeMs,
        });
      return;
    }
    let pending = this.ledger.downloads.get(local);
    if (!pending) {
      this.log(`fetching ${e.path} (${size} bytes)`);
      pending = this.files
        .download(e, local)
        .finally(() => this.ledger.downloads.delete(local));
      this.ledger.downloads.set(local, pending);
    }
    await pending;
    const now = await stat(local);
    this.ledger.synced.set(local, {
      size: now.size,
      localMtimeMs: now.mtimeMs,
      remoteMtimeMs,
    });
  }

  private async sendUp(local: string): Promise<void> {
    const mapped = this.toRemote(local);
    if (!mapped?.root.writable) return;
    const have = await stat(local).catch(() => null);
    if (!have?.isFile()) return;
    const known = this.ledger.synced.get(local);
    if (
      known &&
      known.size === have.size &&
      sameMtime(known.localMtimeMs, have.mtimeMs)
    )
      return;
    try {
      this.log(`sending ${mapped.remote} (${have.size} bytes)`);
      const back = await this.files.upload(local, mapped.remote);
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
