// history.ts — a per-project undo/redo journal. Records file-content diffs (text inline, binary as
// blobs) as a ring of up to 1000 entries with a cursor; undo/redo write the recorded before/after
// back over the project. The journal lives in the account's `.history/` cache, never in the project
// or its repository; a blob is handed to the bound ENGINE's machine and fetched back when an undo
// needs it, so an undo past a step kept by another engine fails rather than guessing. See docs/history.md.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { studioHome } from "@studio/song/studioHome";
import { HISTORY_HOME_DIR } from "@studio/song-schema/moduleTypes";
import { HISTORY_DIR } from "./workspaceFilter.ts";
import type {
  HistoryListEntry,
  HistoryPeek,
  HistoryState,
} from "@studio/web-protocol";

/** A journal folder inside a project: nothing writes one, and the tree and the walks still hide it. */
const MAX_ENTRIES = 1000;

// A text file's content before and after the change; null means the file was absent.
export interface FileChange {
  path: string; // project-relative, posix
  before: string | null;
  after: string | null;
}

// A binary file's change, keyed to blobs (a file name under blobs/, or null for absent).
export interface BlobChange {
  path: string;
  before: string | null;
  after: string | null;
}

/** The engine a step's blobs were handed to: its registry id, and the name an error shows. */
export interface EngineRef {
  id: string;
  name: string;
}

export interface HistoryEntry {
  id: number;
  ts: number;
  kind: "text" | "process"; // "process" iff it carries binary blobs
  label: string;
  changes: FileChange[];
  blobs: BlobChange[];
  /** Where the blobs are kept: an engine, or null when none was bound and they stayed here. */
  keptOn?: EngineRef | null;
}

export type {
  HistoryListEntry,
  HistoryPeek,
  HistoryState,
} from "@studio/web-protocol";

// One recorded change, with blob bytes still in memory — the journal persists them.
export interface NewEntry {
  label: string;
  changes: FileChange[];
  blobs: { path: string; before: Buffer | null; after: Buffer | null }[];
}

/** Where a blob goes once recorded — the bound engine's machine; injected, so a test needs no engine. */
export interface BlobKeeper {
  /** The engine bound now, or null. */
  engine(): EngineRef | null;
  /** Hand these files to that engine's machine; true once it holds every one. */
  keep(files: string[]): Promise<boolean>;
  /** Bring one file back from the bound engine's machine; true once it is on disk here. */
  fetch(file: string): Promise<boolean>;
}

/** No engine to keep anything on: every blob stays in the account's cache. */
export const LOCAL_KEEPER: BlobKeeper = {
  engine: () => null,
  keep: async () => false,
  fetch: async () => false,
};

interface Journal {
  nextId: number;
  cursor: number; // entries[0..cursor-1] are applied; entries[cursor..] are redoable
  entries: HistoryEntry[];
}

/** Where every project's journal lives: the account's cache, out of every workspace (docs/history.md). */
export function historyHome(): string {
  return join(studioHome(), HISTORY_HOME_DIR);
}

/** The journal folder of the project at `dir`: its name, for a reader, and a hash of its path, for uniqueness. */
export function historyStoreFor(dir: string): string {
  const abs = resolve(dir);
  const name = basename(abs).replace(/[^\w.-]+/g, "_") || "project";
  const hash = createHash("sha256").update(abs).digest("hex").slice(0, 12);
  return join(historyHome(), `${name}-${hash}`);
}

const filesOf = (e: HistoryEntry): string[] => [
  ...new Set([...e.changes.map((c) => c.path), ...e.blobs.map((b) => b.path)]),
];

const peek = (e: HistoryEntry): HistoryPeek => ({
  kind: e.kind,
  label: e.label,
  files: filesOf(e),
});

/** The undo/redo journal for one project folder, lazy until the first push — see docs/history.md. */
export class ProjectHistory {
  private loaded = false;
  private j: Journal = { nextId: 1, cursor: 0, entries: [] };
  /** One undo or redo at a time: each may wait on the engine, and both move the cursor. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Blobs on their way to the engine, so a caller (a test) can wait for them. */
  private keeping: Promise<unknown>[] = [];

  /** `storeDir` is the journal's own folder (`historyStoreFor`); `baseDir` the workspace root paths resolve against. */
  constructor(
    private readonly storeDir: string,
    private readonly baseDir: string,
    private readonly keeper: BlobKeeper = LOCAL_KEEPER,
  ) {}

  private get blobsDir(): string {
    return join(this.storeDir, "blobs");
  }
  private get journalPath(): string {
    return join(this.storeDir, "journal.json");
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.j = JSON.parse(readFileSync(this.journalPath, "utf8")) as Journal;
    } catch {
      this.j = { nextId: 1, cursor: 0, entries: [] };
    }
  }

  private persist(): void {
    mkdirSync(this.storeDir, { recursive: true });
    writeFileSync(this.journalPath, JSON.stringify(this.j), "utf8");
  }

  // A recorded path resolved against the workspace root, refusing anything that would escape.
  private abs(rel: string): string {
    if (rel.startsWith("/") || rel.split(/[\\/]/).includes(".."))
      throw new Error(`history: unsafe path ${rel}`);
    return join(this.baseDir, rel);
  }

  private blobPath(name: string): string {
    return join(this.blobsDir, name);
  }
  // Only the copy here: one an engine holds is that machine's to purge (docs/history.md).
  private deleteBlob(name: string | null): void {
    if (name) rmSync(this.blobPath(name), { force: true });
  }
  private dropBlobs(entries: HistoryEntry[]): void {
    for (const dead of entries)
      for (const b of dead.blobs) {
        this.deleteBlob(b.before);
        this.deleteBlob(b.after);
      }
  }
  private storeBlob(
    id: number,
    tag: string,
    bytes: Buffer | null,
  ): string | null {
    if (!bytes) return null;
    mkdirSync(this.blobsDir, { recursive: true });
    const name = `${id}-${tag}`;
    writeFileSync(this.blobPath(name), bytes);
    return name;
  }

  private writeText(rel: string, content: string | null): void {
    const abs = this.abs(rel);
    if (content === null) {
      rmSync(abs, { force: true });
      return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  private restoreBlob(rel: string, name: string | null): void {
    const abs = this.abs(rel);
    if (name === null) {
      rmSync(abs, { force: true });
      return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    copyFileSync(this.blobPath(name), abs);
  }

  /** Hand an entry's blobs to the engine, dropping the copies here once it holds them all. */
  private keepOnEngine(names: string[]): void {
    const files = names.map((n) => this.blobPath(n));
    const run = this.keeper
      .keep(files)
      .then((ok) => {
        if (ok) for (const f of files) rmSync(f, { force: true });
      })
      .catch(() => {
        // Not kept there: the copies here stay, and the entry is undone from them.
      });
    this.keeping.push(run);
  }

  /** Resolves once every blob handed to the engine so far has landed or failed. */
  async settled(): Promise<void> {
    await Promise.all(this.keeping);
  }

  /** Every blob `side` of `e` needs, on disk here — fetched back from its engine; throws before any write when not to be had. */
  private async ensureBlobs(
    e: HistoryEntry,
    side: "before" | "after",
  ): Promise<string[]> {
    const fetched: string[] = [];
    for (const b of e.blobs) {
      const name = b[side];
      if (!name || existsSync(this.blobPath(name))) continue;
      const kept = e.keptOn;
      if (!kept)
        throw new Error(
          `The audio of ${b.path} for this step is no longer kept.`,
        );
      const now = this.keeper.engine();
      if (now?.id !== kept.id)
        throw new Error(
          `The audio of ${b.path} for this step is kept by the engine "${kept.name}", not by the one in use. Switch back to "${kept.name}" to go past this step.`,
        );
      const file = this.blobPath(name);
      const ok = await this.keeper.fetch(file).catch(() => false);
      if (!ok || !existsSync(file))
        throw new Error(
          `The engine "${kept.name}" no longer has the audio of ${b.path} for this step: it keeps it for a month.`,
        );
      fetched.push(file);
    }
    return fetched;
  }

  /** Record one change on top of the stack, dropping any redo tail it lands on. */
  push(e: NewEntry): void {
    this.load();
    if (!e.changes.length && !e.blobs.length) return;
    // Drop the redo tail — a fresh edit forks history.
    this.dropBlobs(this.j.entries.slice(this.j.cursor));
    this.j.entries.length = this.j.cursor;
    const id = this.j.nextId++;
    const blobs: BlobChange[] = e.blobs.map((b, n) => ({
      path: b.path,
      before: this.storeBlob(id, `b${n}`, b.before),
      after: this.storeBlob(id, `a${n}`, b.after),
    }));
    const engine = blobs.length ? this.keeper.engine() : null;
    this.j.entries.push({
      id,
      ts: Date.now(),
      kind: blobs.length ? "process" : "text",
      label: e.label,
      changes: e.changes,
      blobs,
      ...(blobs.length ? { keptOn: engine } : {}),
    });
    this.j.cursor = this.j.entries.length;
    // Evict from the front past the cap, discarding those entries' blobs.
    if (this.j.entries.length > MAX_ENTRIES) {
      const drop = this.j.entries.length - MAX_ENTRIES;
      this.dropBlobs(this.j.entries.slice(0, drop));
      this.j.entries.splice(0, drop);
      this.j.cursor -= drop;
    }
    this.persist();
    const names = blobs
      .flatMap((b) => [b.before, b.after])
      .filter((n) => n !== null);
    if (engine && names.length) this.keepOnEngine(names);
  }

  /** Every entry oldest first, its paths and never its contents, `undone` past the cursor — the History panel. */
  list(): HistoryListEntry[] {
    this.load();
    return this.j.entries.map((e, i) => ({
      id: e.id,
      ts: e.ts,
      kind: e.kind,
      label: e.label,
      paths: [...e.changes, ...e.blobs].map((c) => c.path),
      undone: i >= this.j.cursor,
    }));
  }

  peekUndo(): HistoryPeek | null {
    this.load();
    return this.j.cursor > 0 ? peek(this.j.entries[this.j.cursor - 1]) : null;
  }
  peekRedo(): HistoryPeek | null {
    this.load();
    return this.j.cursor < this.j.entries.length
      ? peek(this.j.entries[this.j.cursor])
      : null;
  }
  state(): HistoryState {
    this.load();
    return {
      canUndo: this.j.cursor > 0,
      canRedo: this.j.cursor < this.j.entries.length,
      nextUndo: this.peekUndo() ?? undefined,
      nextRedo: this.peekRedo() ?? undefined,
    };
  }

  /** Apply one entry's `side`, all or nothing: a blob that cannot be had throws before any write. */
  private async apply(
    e: HistoryEntry,
    side: "before" | "after",
  ): Promise<void> {
    const fetched = await this.ensureBlobs(e, side);
    for (const c of e.changes) this.writeText(c.path, c[side]);
    for (const b of e.blobs) this.restoreBlob(b.path, b[side]);
    // The engine still holds what was fetched; the copy here was only for this write.
    for (const f of fetched) rmSync(f, { force: true });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Revert the last applied entry; returns what it touched, or null when there's nothing to undo. */
  undo(): Promise<HistoryPeek | null> {
    return this.serial(async () => {
      this.load();
      if (this.j.cursor <= 0) return null;
      const e = this.j.entries[this.j.cursor - 1];
      await this.apply(e, "before");
      this.j.cursor--;
      this.persist();
      return peek(e);
    });
  }

  /** Re-apply the next undone entry; returns what it touched, or null when there's nothing to redo. */
  redo(): Promise<HistoryPeek | null> {
    return this.serial(async () => {
      this.load();
      if (this.j.cursor >= this.j.entries.length) return null;
      const e = this.j.entries[this.j.cursor];
      await this.apply(e, "after");
      this.j.cursor++;
      this.persist();
      return peek(e);
    });
  }
}


export { HISTORY_DIR };
