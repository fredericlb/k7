// liveLog.ts — where a replica keeps the batches it captured: the account's state, never the workspace.
// One JSON line per batch, rotated once at a ceiling; the replica's own id lives beside the logs.
// See docs/liveCapture.md.

import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Batch } from "@studio/live-sync/ops";
import { studioHome } from "@studio/song/studioHome";

export type { Batch };

const LOG_CEILING = 20 * 1024 * 1024;

const syncHome = (): string => join(studioHome(), ".sync");

/** This replica's id, made once and kept for the life of the account's state. */
export function replicaId(): string {
  const file = join(syncHome(), "replica-id");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(syncHome(), { recursive: true });
  const id = randomUUID();
  writeFileSync(file, id);
  return id;
}

/** The log folder of the workspace at `root`: its name for a reader, a hash of its path for uniqueness. */
export function liveLogFor(root: string): string {
  const abs = resolve(root);
  const name = basename(abs).replace(/[^\w.-]+/g, "_") || "workspace";
  const hash = createHash("sha256").update(abs).digest("hex").slice(0, 12);
  return join(syncHome(), `${name}-${hash}`);
}

/** Append-only log of one workspace's captured batches. */
export class LiveLog {
  private readonly file: string;

  constructor(readonly dir: string) {
    this.file = join(dir, "batches.jsonl");
  }

  append(batch: Batch): void {
    mkdirSync(this.dir, { recursive: true });
    if (existsSync(this.file) && statSync(this.file).size > LOG_CEILING)
      renameSync(this.file, join(this.dir, "batches.1.jsonl"));
    appendFileSync(this.file, `${JSON.stringify(batch)}\n`);
  }

  /** The last `n` batches of the current log, oldest first. */
  tail(n: number): Batch[] {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
    return lines.slice(-n).map((l) => JSON.parse(l) as Batch);
  }
}
