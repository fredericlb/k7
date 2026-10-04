// hubFiles.ts — the hub's half of moving files: stat, download and upload, each confined to the
// roots the channel was opened with. Confinement is checked on the REAL path, since a cloned
// repository may carry a symlink pointing anywhere on the server. See docs/tunnel.md.

import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { CHUNK_BYTES, type RemoteStat, type TunnelRoot } from "./frames.ts";

/** At most this many paths per stat request — a document names dozens, never thousands. */
export const MAX_STAT_PATHS = 2000;

// `realpath` answers in backslashes on Windows; elsewhere a backslash is a name character and must not pass.
const WIN = process.platform === "win32";
const SEPS = WIN ? ["/", "\\"] : ["/"];
const P = WIN ? win32 : posix;

// Absolute, with no `.` or `..` segment; a Windows root is `C:\…` and its paths mix both separators.
const isPlain = (p: string): boolean =>
  WIN
    ? win32.isAbsolute(p) &&
      !p.split(/[\\/]/).some((s) => s === "." || s === "..")
    : posix.isAbsolute(p) && posix.normalize(p) === p;

const within = (root: string, p: string): boolean =>
  p === root ||
  SEPS.some((s) => p.startsWith(root.endsWith(s) ? root : `${root}${s}`));

/** The root `p` lies in, lexically, or null; a relative or non-normal path is refused outright. */
export function rootOf(roots: TunnelRoot[], p: string): TunnelRoot | null {
  if (!isPlain(p)) return null;
  return roots.find((r) => within(r.remote, p)) ?? null;
}

/** Whether the REAL path of `p` (or of its nearest existing ancestor) stays inside `root`. */
async function stillInside(root: TunnelRoot, p: string): Promise<boolean> {
  let realRoot: string;
  try {
    realRoot = await realpath(root.remote);
  } catch {
    return false;
  }
  let probe = p;
  for (;;) {
    try {
      return within(realRoot, await realpath(probe));
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

/** One upload in progress, written beside its target and renamed over it only when complete. */
export class Upload {
  private readonly tmp: string;
  private readonly out: WriteStream;

  private constructor(readonly path: string) {
    this.tmp = `${path}.tunnel-${process.pid}-${Date.now()}.part`;
    this.out = createWriteStream(this.tmp);
  }

  static async start(roots: TunnelRoot[], path: string): Promise<Upload> {
    const root = rootOf(roots, path);
    if (!root?.writable)
      throw new Error(`not writable from the engine: ${path}`);
    if (!(await stillInside(root, P.dirname(path))))
      throw new Error(`outside the shared tree: ${path}`);
    await mkdir(P.dirname(path), { recursive: true });
    return new Upload(path);
  }

  write(chunk: Buffer): Promise<void> {
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
