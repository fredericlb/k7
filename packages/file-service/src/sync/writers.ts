// writers.ts — the one seam between a `file://` target and an `ftp://` one. A writer answers
// three questions and nothing more: does this path already hold that many bytes, put this stream
// there, and is there a folder by that name. The sync itself knows no protocol.
// See ../../docs/playlistSync.md.

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ParsedTarget } from "@studio/song-schema/syncTarget";
import { Client as FtpClient } from "basic-ftp";

/** What the sync drives. Target-relative POSIX paths throughout — the writer maps them. */
export interface TargetWriter {
  /** The size on the target, or null when nothing is there. Null is "copy it". */
  sizeOf(path: string): Promise<number | null>;
  /** Put the stream at `path`, creating the folders above it. */
  put(path: string, body: Readable): Promise<void>;
  /** Is there a FOLDER by this name? The m3u is written only where one already exists. */
  hasDir(path: string): Promise<boolean>;
  close(): Promise<void>;
}

/** A local folder, a mounted stick, a network share the OS already holds — anything with a path. */
class FileWriter implements TargetWriter {
  constructor(private readonly root: string) {}

  private abs(path: string): string {
    return join(this.root, ...path.split("/"));
  }

  async sizeOf(path: string): Promise<number | null> {
    try {
      const s = await stat(this.abs(path));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  }

  async put(path: string, body: Readable): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    // Through a `.part`, so an interrupted copy is never mistaken for a complete file next
    // run — a random suffix too, so two syncs racing the same path never share this name.
    const part = `${abs}.${randomUUID()}.part`;
    await pipeline(body, createWriteStream(part));
    const { rename } = await import("node:fs/promises");
    await rename(part, abs);
  }

  async hasDir(path: string): Promise<boolean> {
    try {
      return (await stat(this.abs(path))).isDirectory();
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {}
}

/** One connection, reused for the whole run: a login per track is most of the time of a sync. */
class FtpWriter implements TargetWriter {
  private client: FtpClient | null = null;

  constructor(private readonly t: ParsedTarget) {}

  private async conn(): Promise<FtpClient> {
    if (this.client && !this.client.closed) return this.client;
    const c = new FtpClient(30_000);
    await c.access({
      host: this.t.host,
      ...(this.t.port ? { port: this.t.port } : {}),
      ...(this.t.user ? { user: this.t.user } : {}),
      ...(this.t.password ? { password: this.t.password } : {}),
      // Plain FTP: `ftps://` is not a scheme this accepts, so promoting silently would be a lie.
      secure: false,
    });
    this.client = c;
    return c;
  }

  /** The target root prefixed on, since basic-ftp is driven by paths from the login's own cwd. */
  private at(path: string): string {
    return this.t.root ? `${this.t.root}/${path}` : path;
  }

  async sizeOf(path: string): Promise<number | null> {
    const c = await this.conn();
    try {
      return await c.size(this.at(path));
    } catch {
      // A server answers 550 for "no such file" and for "SIZE is off in ASCII mode" alike.
      return null;
    }
  }

  async put(path: string, body: Readable): Promise<void> {
    const c = await this.conn();
    const full = this.at(path);
    const dir = full.split("/").slice(0, -1).join("/");
    // `ensureDir` walks and creates, and leaves the cwd there — so the upload is by full path after it.
    if (dir) {
      await c.ensureDir(dir);
      await c.cd("/");
    }
    await c.uploadFrom(body, full);
  }

  async hasDir(path: string): Promise<boolean> {
    const c = await this.conn();
    const full = this.at(path);
    try {
      // The cheapest probe that does not create anything: go there, and come back.
      await c.cd(full);
      await c.cd("/");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.client?.close();
    this.client = null;
  }
}

/** The writer for a parsed target — the only place a scheme becomes an implementation. */
export function writerFor(t: ParsedTarget): TargetWriter {
  return t.scheme === "file" ? new FileWriter(t.root) : new FtpWriter(t);
}

/** A `file://` target's root, so a caller can say "that folder is not there" before starting. */
export function fileRootOf(t: ParsedTarget): string | null {
  return t.scheme === "file" ? t.root.split("/").join(sep) : null;
}
