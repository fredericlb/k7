// hubFiles.ts — the hub's half of moving files: stat, download and upload, each confined to the
// roots the channel was opened with. Confinement is checked on the REAL path, since a cloned
// repository may carry a symlink pointing anywhere on the server. See docs/tunnel.md.

import { randomBytes } from "node:crypto";
import { createReadStream, type WriteStream } from "node:fs";
import { mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { isDotSegment, isWithin } from "@studio/web-protocol/paths";
import { CHUNK_BYTES, type RemoteStat, type TunnelRoot } from "./frames.ts";

/** At most this many paths per stat request — a document names dozens, never thousands. */
const MAX_STAT_PATHS = 2000;

// `realpath` answers in backslashes on Windows; elsewhere a backslash is a name character and must not pass.
const WIN = process.platform === "win32";
const P = WIN ? win32 : posix;

// Absolute, with no `.` or `..` segment; a Windows root is `C:\…` and its paths mix both separators.
const isPlain = (p: string): boolean =>
  WIN
    ? win32.isAbsolute(p) && !p.split(/[\\/]/).some(isDotSegment)
    : posix.isAbsolute(p) && posix.normalize(p) === p;

/** The root `p` lies in, lexically, or null; a relative or non-normal path is refused outright. */
function rootOf(roots: TunnelRoot[], p: string): TunnelRoot | null {
  if (!isPlain(p)) return null;
  return roots.find((r) => isWithin(r.remote, p)) ?? null;
}

/** Whether the REAL path of `p` (or of its nearest existing ancestor) stays inside `root` — or, for a `perChild` root, inside its top-level folder. */
async function stillInside(root: TunnelRoot, p: string): Promise<boolean> {
  // A library's clone may itself be a link (a dev's checkout); what it holds is still kept inside that clone.
  const base =
    root.perChild && p !== root.remote
      ? P.join(root.remote, p.slice(root.remote.length + 1).split(/[\\/]/)[0])
      : root.remote;
  let realRoot: string;
  try {
    realRoot = await realpath(base);
  } catch {
    return false;
  }
  let probe = p;
  for (;;) {
    try {
      return isWithin(realRoot, await realpath(probe));
    } catch {
      const up = P.dirname(probe);
      if (up === probe) return false;
      probe = up;
    }
  }
}

export async function statPaths(
  roots: TunnelRoot[],
  paths: string[],
): Promise<RemoteStat[]> {
  const out: RemoteStat[] = [];
  for (const path of paths.slice(0, MAX_STAT_PATHS)) {
    const root = rootOf(roots, path);
    if (!root || !(await stillInside(root, path))) {
      out.push({ path, kind: "missing" });
      continue;
    }
    try {
      const s = await stat(path);
      out.push(
        s.isDirectory()
          ? { path, kind: "dir" }
          : { path, kind: "file", size: s.size, mtimeMs: s.mtimeMs },
      );
    } catch {
      out.push({ path, kind: "missing" });
    }
  }
  return out;
}

/** Stream one file as chunks; `send` is told the last one. Throws before sending when it may not be read. */
export async function readFileChunks(
  roots: TunnelRoot[],
  path: string,
  send: (chunk: Buffer, last: boolean) => Promise<void>,
): Promise<void> {
  const root = rootOf(roots, path);
  if (!root || !(await stillInside(root, path)))
    throw new Error(`not shared with this channel: ${path}`);
  const size = (await stat(path)).size;
  if (size === 0) return send(Buffer.alloc(0), true);
  let sent = 0;
  for await (const chunk of createReadStream(path, {
    highWaterMark: CHUNK_BYTES,
  })) {
    sent += (chunk as Buffer).length;
    await send(chunk as Buffer, sent >= size);
  }
  if (sent < size) await send(Buffer.alloc(0), true);
}

/** What one tunnel may upload: open at once, per upload, per hour, and how long an upload may go without a chunk. */
export interface UploadLimits {
  maxOpen: number;
  maxBytes: number;
  bytesPerHour: number;
  idleMs: number;
}

const GIB = 1024 * 1024 * 1024;

/** Bytes from the environment, or `fallback` when unset or not a positive number. */
function envBytes(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The defaults, two of them configurable: `STUDIO_TUNNEL_MAX_UPLOAD_BYTES` and `STUDIO_TUNNEL_UPLOAD_BYTES_PER_HOUR`. */
export function uploadLimits(over: Partial<UploadLimits> = {}): UploadLimits {
  return {
    maxOpen: 16,
    maxBytes: envBytes("STUDIO_TUNNEL_MAX_UPLOAD_BYTES", 2 * GIB),
    bytesPerHour: envBytes("STUDIO_TUNNEL_UPLOAD_BYTES_PER_HOUR", 20 * GIB),
    idleMs: 60_000,
    ...over,
  };
}

/** One upload in progress, written beside its target under a name nobody else holds, and renamed over it only when complete. */
export class Upload {
  private error: Error | null = null;

  private constructor(
    readonly path: string,
    private readonly tmp: string,
    private readonly out: WriteStream,
  ) {
    // Heard, so a failed write is a rejected `write` rather than an `error` event nobody listens to.
    out.on("error", (e) => {
      this.error = e;
    });
  }

  static async start(roots: TunnelRoot[], path: string): Promise<Upload> {
    const root = rootOf(roots, path);
    if (!root?.writable)
      throw new Error(`not writable from the engine: ${path}`);
    if (!(await stillInside(root, P.dirname(path))))
      throw new Error(`outside the shared tree: ${path}`);
    await mkdir(P.dirname(path), { recursive: true });
    const tmp = `${path}.tunnel-${randomBytes(8).toString("hex")}.part`;
    const fh = await open(tmp, "wx");
    return new Upload(path, tmp, fh.createWriteStream());
  }

  write(chunk: Buffer): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    return new Promise((res, rej) =>
      this.out.write(chunk, (e) => (e ? rej(e) : res())),
    );
  }

  async finish(): Promise<RemoteStat> {
    await new Promise<void>((res, rej) =>
      this.out.end((e?: Error | null) => (e ? rej(e) : res())),
    );
    await rename(this.tmp, this.path);
    const s = await stat(this.path);
    return { path: this.path, kind: "file", size: s.size, mtimeMs: s.mtimeMs };
  }

  async abort(): Promise<void> {
    this.out.destroy();
    await rm(this.tmp, { force: true });
  }
}
