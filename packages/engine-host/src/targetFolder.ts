// targetFolder.ts — a sync target as the sync drives it: a local folder, a mounted stick, a share
// the OS already holds. Three questions and nothing more: does this path already hold that many
// bytes, put this stream there, and is there a folder by that name. See ../docs/playlistSync.md.

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Target-relative POSIX paths throughout, mapped onto the folder here. */
export class TargetFolder {
  constructor(private readonly root: string) {}

  private abs(path: string): string {
    return join(this.root, ...path.split("/"));
  }

  /** The size on the target, or null when nothing is there. Null is "copy it". */
  async sizeOf(path: string): Promise<number | null> {
    try {
      const s = await stat(this.abs(path));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  }

  /** Put the stream at `path`, creating the folders above it. */
  async put(path: string, body: Readable): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    // Through a randomly named `.part`: an interrupted copy never reads as complete, and two runs never share it.
    const part = `${abs}.${randomUUID()}.part`;
    await pipeline(body, createWriteStream(part));
    await rename(part, abs);
  }

  /** Is there a FOLDER by this name? The m3u is written only where one already exists. */
  async hasDir(path: string): Promise<boolean> {
    try {
      return (await stat(this.abs(path))).isDirectory();
    } catch {
      return false;
    }
  }
}
