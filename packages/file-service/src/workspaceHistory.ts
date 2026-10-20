// workspaceHistory.ts — the undo/redo journal as a workspace drives it: a mutation run between two
// images of the project taken from ONE walk each, the difference pushed to the active project's
// ProjectHistory (history.ts). It reaches the workspace only through HistoryHost. See docs/workspace.md.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SETTLE_MS } from "@studio/song/moduleCache";
import type { ChangedFile } from "@studio/web-protocol";
import {
  type FileChange,
  type HistoryListEntry,
  type HistoryPeek,
  type HistoryState,
  historyStoreFor,
  ProjectHistory,
} from "./history.ts";
import { engineKeeper } from "./historyKeeper.ts";
import type { WalkedFile } from "./projectWalk.ts";

/** What a journalled mutation answers, tokens included — see docs/workspace.md. */
export interface Recorded<T> {
  value: T;
  /** Before the mutation. `after !== before` is what "this command changed the project" means. */
  before: string;
  after: string;
  /** …and WHICH files moved, project-relative; `null` when the diff could not be taken. */
  files: ChangedFile[] | null;
}

/** How a mutation lands in the journal: its own step (the default), or folded into the step on top — docs/history.md. */
export type JournalMode = "step" | "join";

/** The few members of the workspace the journal reads. */
export interface HistoryHost {
  readonly root: string;
  activeProject(): string | null;
  toRel(abs: string): string;
  revision(): { rev: string };
  withWalk<T>(dir: string, fn: (files: WalkedFile[]) => T): T;
  revisionOf(files: WalkedFile[]): string;
  invalidateProjectDoc(): void;
}

// Text files that differ between two snapshots — a null side means the file was absent then.
function diffText(
  before: Map<string, string>,
  after: Map<string, string>,
): FileChange[] {
  const changes: FileChange[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(path);
    const a = after.get(path);
    if (b !== a) changes.push({ path, before: b ?? null, after: a ?? null });
  }
  return changes;
}

/** The two diffs above, project-relative and said as appeared / edited / disappeared. */
function changedFiles(
  base: string,
  // Both diffs, read only for their SHAPE: a path, and which side was absent.
  ...diffs: { path: string; before: unknown; after: unknown }[][]
): ChangedFile[] {
  const head = base === "." || base === "" ? "" : `${base}/`;
  const out = new Map<string, ChangedFile>();
  for (const c of diffs.flat()) {
    // A prefix that did not match would otherwise be reported as an absolute-looking path.
    if (head && !c.path.startsWith(head)) continue;
    const path = head ? c.path.slice(head.length) : c.path;
    const kind =
      c.before === null ? "added" : c.after === null ? "removed" : "edited";
    // A file in both lists is one change, and appearing or disappearing outranks being rewritten.
    const seen = out.get(path);
    if (!seen || seen.kind === "edited") out.set(path, { path, kind });
  }
  return [...out.values()];
}

// Binary files created or overwritten, by presence and by the snapshotted pre-image — docs/workspace.md.
function diffBin(
  base: string, // the workspace root, since paths are root-relative
  before: Map<string, string>,
  after: Map<string, string>,
  pre: Map<string, Buffer>,
): { path: string; before: Buffer | null; after: Buffer | null }[] {
  const blobs: { path: string; before: Buffer | null; after: Buffer | null }[] =
    [];
  const readBytes = (path: string): Buffer | null => {
    try {
      return readFileSync(join(base, path));
    } catch {
      return null;
    }
  };
  for (const path of new Set([
    ...before.keys(),
    ...after.keys(),
    ...pre.keys(),
  ])) {
    const existedBefore = before.has(path);
    // Read the bytes only where they can end up in the journal — see docs/workspace.md.
    if (!existedBefore) {
      const afterBytes = after.has(path) ? readBytes(path) : null;
      if (afterBytes) blobs.push({ path, before: null, after: afterBytes }); // created
      continue;
    }
    const preBytes = pre.get(path);
    if (!preBytes) continue; // existed but no pre-image — nothing to restore to
    const afterBytes = after.has(path) ? readBytes(path) : null;
    if (afterBytes === null || !preBytes.equals(afterBytes))
      blobs.push({ path, before: preBytes, after: afterBytes });
  }
  return blobs;
}

export class WorkspaceHistory {
  // One ProjectHistory per active project, cached so the on-disk journal is read once.
  private cache: { dir: string; h: ProjectHistory } | null = null;
  // The last text image, so the next one only re-reads what moved. See textOf.
  private textCache = new Map<string, { stamp: string; text: string }>();

  constructor(private readonly host: HistoryHost) {}

  private history(dir: string): ProjectHistory {
    if (this.cache?.dir !== dir)
      this.cache = {
        dir,
        h: new ProjectHistory(
          historyStoreFor(dir),
          this.host.root,
          engineKeeper,
        ),
      };
    return this.cache.h;
  }

  /** Run a project mutation and journal what it changed, so Ctrl+Z can undo it — docs/workspace.md. */
  async record<T>(
    label: string,
    mutate: (snapshot: (abs: string) => void) => T | Promise<T>,
    mode: JournalMode = "step",
  ): Promise<Recorded<T>> {
    const dir = this.host.activeProject();
    if (!dir) {
      // No project, no journal, no walk — and `files: null`, since nothing was diffed.
      const rev = this.host.revision().rev;
      return {
        value: await mutate(() => {}),
        before: rev,
        after: rev,
        files: null,
      };
    }
    const pre = new Map<string, Buffer>(); // rel -> pre-image bytes of a binary about to be overwritten
    const snapshot = (abs: string): void => {
      try {
        const rel = this.host.toRel(abs);
        if (!pre.has(rel) && existsSync(abs) && statSync(abs).isFile())
          pre.set(rel, readFileSync(abs));
      } catch {
        /* best effort — a missed pre-image just means that one file can't be undone */
      }
    };
    const before = this.treeShot(dir);
    const result = await mutate(snapshot);
    const after = this.treeShot(dir);
    // Null until the diff is taken: a throw below must never read as a false "nothing changed".
    let files: ChangedFile[] | null = null;
    try {
      const changes = diffText(before.text, after.text);
      const blobs = diffBin(this.host.root, before.bin, after.bin, pre);
      files = changedFiles(this.host.toRel(dir), changes, blobs);
      const h = this.history(dir);
      if (changes.length || blobs.length) {
        if (mode === "join") h.join({ label, changes, blobs });
        else h.push({ label, changes, blobs });
      }
    } catch {
      /* journaling must never break a good write */
    }
    return { value: result, before: before.rev, after: after.rev, files };
  }

  /** The project at one instant from ONE walk: two images and the token naming the moment. */
  private treeShot(dir: string): {
    text: Map<string, string>;
    bin: Map<string, string>;
    rev: string;
  } {
    return this.host.withWalk(dir, (files) => ({
      text: this.textOf(files),
      bin: this.binOf(files),
      rev: this.host.revisionOf(files),
    }));
  }

  /** Every text file's content, re-reading only what MOVED — see docs/workspace.md. */
  private textOf(files: WalkedFile[]): Map<string, string> {
    const out = new Map<string, string>();
    // Built fresh so a deleted file leaves the cache with it, rather than lingering for ever.
    const seen = new Map<string, { stamp: string; text: string }>();
    const now = Date.now();
    for (const f of files) {
      if (f.binary) continue;
      const rel = this.host.toRel(f.abs);
      const stamp = `${f.size}:${f.mtimeMs}`;
      // A file younger than a tick may be rewritten at the same size, so its stamp is not trusted for the undo image.
      const settled = now - f.mtimeMs > SETTLE_MS;
      const hit = this.textCache.get(rel);
      let text: string;
      if (settled && hit?.stamp === stamp) text = hit.text;
      else
        try {
          text = readFileSync(f.abs, "utf8");
        } catch {
          continue; // unreadable — treated as absent, as it always was
        }
      out.set(rel, text);
      // …and nothing young is KEPT either: the next call would find it under the same stamp.
      if (settled) seen.set(rel, { stamp, text });
    }
    this.textCache = seen;
    return out;
  }

  // Size+mtime of every binary file — enough to tell created/overwritten from untouched.
  private binOf(files: WalkedFile[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const f of files)
      if (f.binary) out.set(this.host.toRel(f.abs), `${f.size}:${f.mtimeMs}`);
    return out;
  }

  /** Undo the most recent journalled change on the active project. */
  async undo(): Promise<HistoryPeek | null> {
    const dir = this.host.activeProject();
    if (!dir) return null;
    const r = await this.history(dir).undo();
    if (r) this.host.invalidateProjectDoc();
    return r;
  }

  /** Redo the change undo just reverted. */
  async redo(): Promise<HistoryPeek | null> {
    const dir = this.host.activeProject();
    if (!dir) return null;
    const r = await this.history(dir).redo();
    if (r) this.host.invalidateProjectDoc();
    return r;
  }

  /** The open project's journal for the History panel, its paths PROJECT-relative like a commit's. */
  list(): HistoryListEntry[] {
    const dir = this.host.activeProject();
    if (!dir) return [];
    const prefix = `${this.host.toRel(dir)}/`;
    return this.history(dir)
      .list()
      .map((e) => ({
        ...e,
        paths: e.paths.map((p) =>
          p.startsWith(prefix) ? p.slice(prefix.length) : p,
        ),
      }));
  }

  peekUndo(): HistoryPeek | null {
    const dir = this.host.activeProject();
    return dir ? this.history(dir).peekUndo() : null;
  }

  peekRedo(): HistoryPeek | null {
    const dir = this.host.activeProject();
    return dir ? this.history(dir).peekRedo() : null;
  }

  state(): HistoryState {
    const dir = this.host.activeProject();
    return dir ? this.history(dir).state() : { canUndo: false, canRedo: false };
  }
}
