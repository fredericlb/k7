// history.ts — a per-project undo/redo journal on disk. Records file-content diffs
// (text inline, binary as backup blobs) as a ring of up to 1000 entries with a cursor;
// undo/redo write the recorded before/after back over the project. Stored under
// `_history/` beside the project (hidden by workspace skip()). See docs/history.md.

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { HistoryPeek, HistoryState } from "@studio/web-protocol";

const HISTORY_DIR = "_history";
const MAX_ENTRIES = 1000;

// A text file's content before and after the change; null means the file was absent.
export interface FileChange {
  path: string; // project-relative, posix
  before: string | null;
  after: string | null;
}

// A binary file's change, keyed to backup blobs on disk (filename under blobs/, or null for absent).
export interface BlobChange {
  path: string;
  before: string | null;
  after: string | null;
}

export interface HistoryEntry {
  id: number;
  ts: number;
  kind: "text" | "process"; // "process" iff it carries binary blobs
  label: string;
  changes: FileChange[];
  blobs: BlobChange[];
}

export type { HistoryPeek, HistoryState } from "@studio/web-protocol";

// One recorded change, with blob bytes still in memory — the journal persists them.
export interface NewEntry {
  label: string;
  changes: FileChange[];
  blobs: { path: string; before: Buffer | null; after: Buffer | null }[];
}

interface Journal {
  nextId: number;
  cursor: number; // entries[0..cursor-1] are applied; entries[cursor..] are redoable
  entries: HistoryEntry[];
}

const filesOf = (e: HistoryEntry): string[] => [
  ...new Set([...e.changes.map((c) => c.path), ...e.blobs.map((b) => b.path)]),
];

const peek = (e: HistoryEntry): HistoryPeek => ({
  kind: e.kind,
  label: e.label,
  files: filesOf(e),
});

/**
 * The undo/redo journal for one project folder. Lazy — nothing on disk until the first push.
 *
 * `storeDir` is where the journal lives (the project folder). `baseDir` is what recorded
 * paths resolve against — the workspace root, because the editor and the file API speak
 * root-relative paths, and undo must write the file the client navigated to.
 */
export class ProjectHistory {
  private loaded = false;
  private j: Journal = { nextId: 1, cursor: 0, entries: [] };
  private readonly baseDir: string;

  constructor(
    private readonly storeDir: string,
    baseDir?: string,
  ) {
    this.baseDir = baseDir ?? storeDir;
  }

  private get historyDir(): string {
    return join(this.storeDir, HISTORY_DIR);
  }
  private get blobsDir(): string {
    return join(this.historyDir, "blobs");
  }
  private get journalPath(): string {
    return join(this.historyDir, "journal.json");
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
    mkdirSync(this.historyDir, { recursive: true });
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
  private deleteBlob(name: string | null): void {
    if (name) rmSync(this.blobPath(name), { force: true });
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

  /** Record one change on top of the stack, dropping any redo tail it lands on. */
  push(e: NewEntry): void {
    this.load();
    if (!e.changes.length && !e.blobs.length) return;
    // Drop the redo tail — a fresh edit forks history.
    for (const dead of this.j.entries.slice(this.j.cursor)) {
      for (const b of dead.blobs) {
        this.deleteBlob(b.before);
        this.deleteBlob(b.after);
      }
    }
    this.j.entries.length = this.j.cursor;
    const id = this.j.nextId++;
    const blobs: BlobChange[] = e.blobs.map((b, n) => ({
      path: b.path,
      before: this.storeBlob(id, `b${n}`, b.before),
      after: this.storeBlob(id, `a${n}`, b.after),
    }));
    this.j.entries.push({
      id,
      ts: Date.now(),
      kind: blobs.length ? "process" : "text",
      label: e.label,
      changes: e.changes,
      blobs,
    });
    this.j.cursor = this.j.entries.length;
    // Evict from the front past the cap, discarding those entries' blobs.
    if (this.j.entries.length > MAX_ENTRIES) {
      const drop = this.j.entries.length - MAX_ENTRIES;
      for (const dead of this.j.entries.slice(0, drop))
        for (const b of dead.blobs) {
          this.deleteBlob(b.before);
          this.deleteBlob(b.after);
        }
      this.j.entries.splice(0, drop);
      this.j.cursor -= drop;
    }
    this.persist();
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

  /** Revert the last applied entry; returns what it touched, or null when there's nothing to undo. */
  undo(): HistoryPeek | null {
    this.load();
    if (this.j.cursor <= 0) return null;
    const e = this.j.entries[this.j.cursor - 1];
    for (const c of e.changes) this.writeText(c.path, c.before);
    for (const b of e.blobs) this.restoreBlob(b.path, b.before);
    this.j.cursor--;
    this.persist();
    return peek(e);
  }

  /** Re-apply the next undone entry; returns what it touched, or null when there's nothing to redo. */
  redo(): HistoryPeek | null {
    this.load();
    if (this.j.cursor >= this.j.entries.length) return null;
    const e = this.j.entries[this.j.cursor];
    for (const c of e.changes) this.writeText(c.path, c.after);
    for (const b of e.blobs) this.restoreBlob(b.path, b.after);
    this.j.cursor++;
    this.persist();
    return peek(e);
  }
}

// Whether a directory entry name is the history store — Workspace's skip() hides it.
export const isHistoryDir = (name: string): boolean => name === HISTORY_DIR;

export { HISTORY_DIR };
