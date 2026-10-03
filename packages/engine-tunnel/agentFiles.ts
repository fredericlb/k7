// agentFiles.ts — the agent's requests to the hub for one channel's files: stat, download,
// upload. A download lands beside its target and is renamed over it, stamped with the server's
// mtime, which is what lets the next comparison skip it. See docs/tunnel.md.

import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rename, rm, stat, utimes } from "node:fs/promises";
import { dirname } from "node:path";
import type { WebSocket } from "ws";
import { drained } from "./drain.ts";
import { CHUNK_BYTES, encodeBinary, type RemoteStat } from "./frames.ts";
import type { RemoteFiles } from "./pathMap.ts";

/** A download that arrived whole but whose target something holds open; `part` is left for the caller to place. */
export class TargetInUse extends Error {
  constructor(
    message: string,
    readonly part: string,
  ) {
    super(message);
  }
}

interface Download {
  out: WriteStream;
  tmp: string;
  written: Promise<void>;
  resolve: () => void;
  reject: (e: Error) => void;
}

/** The replies the agent's socket routes here, by request id; shared by every channel of one tunnel. */
export class FileRequests {
  private nextReq = 1;
  private readonly stats = new Map<number, (e: RemoteStat[]) => void>();
  private readonly puts = new Map<
    number,
    { ok: (s: RemoteStat) => void; ko: (e: Error) => void }
  >();
  private readonly gets = new Map<number, Download>();

  constructor(private readonly ws: () => WebSocket | null) {}

  /** A RemoteFiles bound to one channel, whose roots the hub checks every path against. */
  forChannel(ch: number): RemoteFiles {
    return {
      stat: (paths) => this.stat(ch, paths),
      download: (remote, local) => this.download(ch, remote, local),
      upload: (local, remote) => this.upload(ch, local, remote),
    };
  }

  private sock(): WebSocket {
    const ws = this.ws();
    if (ws?.readyState !== 1) throw new Error("tunnel is down");
    return ws;
  }

  private stat(ch: number, paths: string[]): Promise<RemoteStat[]> {
    const req = this.nextReq++;
    return new Promise((resolve, reject) => {
      this.stats.set(req, resolve);
      try {
        this.sock().send(JSON.stringify({ t: "stat", req, ch, paths }));
      } catch (e) {
        this.stats.delete(req);
        reject(e);
      }
    });
  }

  private async download(
    ch: number,
    remote: RemoteStat,
    local: string,
  ): Promise<void> {
    await mkdir(dirname(local), { recursive: true });
    const req = this.nextReq++;
    const tmp = `${local}.part-${req}`;
    const out = createWriteStream(tmp);
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const done = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.gets.set(req, {
      out,
      tmp,
      written: Promise.resolve(),
      resolve,
      reject,
    });
    try {
      this.sock().send(
        JSON.stringify({ t: "get", req, ch, path: remote.path }),
      );
      await done;
    } catch (e) {
      this.gets.delete(req);
      out.destroy();
      await rm(tmp, { force: true });
      throw e;
    }
    try {
      await rename(tmp, local);
    } catch (e) {
      // Held open (the engine, on Windows): the complete file goes back to the caller to place.
      throw new TargetInUse(`${local} is in use: ${(e as Error).message}`, tmp);
    }
    const when = new Date(remote.mtimeMs ?? Date.now());
    await utimes(local, when, when);
  }

  private async upload(
    ch: number,
    local: string,
    remote: string,
  ): Promise<RemoteStat> {
    const req = this.nextReq++;
    const reply = new Promise<RemoteStat>((ok, ko) =>
      this.puts.set(req, { ok, ko }),
    );
    const size = (await stat(local)).size;
    const send = async (chunk: Buffer, last: boolean): Promise<void> => {
      const ws = this.sock();
      await drained(ws);
      ws.send(encodeBinary({ t: "put", req, ch, path: remote, last }, chunk));
    };
    try {
      if (size === 0) await send(Buffer.alloc(0), true);
      else {
        let sent = 0;
        for await (const c of createReadStream(local, {
          highWaterMark: CHUNK_BYTES,
        })) {
          sent += (c as Buffer).length;
          await send(c as Buffer, sent >= size);
        }
        if (sent < size) await send(Buffer.alloc(0), true);
      }
    } catch (e) {
      this.puts.delete(req);
      throw e;
    }
    return reply;
  }

  onStatReply(req: number, entries: RemoteStat[]): void {
    this.stats.get(req)?.(entries);
    this.stats.delete(req);
  }

  onPutReply(req: number, stat?: RemoteStat, error?: string): void {
    const p = this.puts.get(req);
    this.puts.delete(req);
    if (!p) return;
    if (stat) p.ok(stat);
    else p.ko(new Error(error ?? "upload refused"));
  }

  onGetError(req: number, error: string): void {
    const g = this.gets.get(req);
    this.gets.delete(req);
    g?.reject(new Error(error));
  }

  /** Chunks are written in arrival order by chaining each on the one before. */
  onChunk(req: number, last: boolean, payload: Buffer): void {
    const g = this.gets.get(req);
    if (!g) return;
    const copy = Buffer.from(payload);
    g.written = g.written.then(
      () =>
        new Promise<void>((res, rej) =>
          g.out.write(copy, (e) => (e ? rej(e) : res())),
        ),
    );
    if (!last) return;
    this.gets.delete(req);
    g.written
      .then(() => new Promise<void>((res) => g.out.end(res)))
      .then(g.resolve, g.reject);
  }

  /** The tunnel dropped: nothing in flight will ever be answered. */
  failAll(): void {
    const gone = new Error("tunnel dropped");
    for (const g of this.gets.values()) g.reject(gone);
    for (const p of this.puts.values()) p.ko(gone);
    for (const r of this.stats.values()) r([]);
    this.gets.clear();
    this.puts.clear();
    this.stats.clear();
  }
}
