// liveCapture.ts — every change to a workspace's files, whoever made it, as batches of ops.
// A ledger holds each YAML file's last known text, the only kind diffed (fileOpFor); others, a hash.
// A file written for ANOTHER replica is recorded in the ledger first, so the watcher never echoes it back.
// See docs/liveCapture.md.

import { randomUUID } from "node:crypto";
import {
  existsSync,
  type FSWatcher,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileOpFor, textHash } from "@studio/live-sync/file-op";
import type { FileOp } from "@studio/live-sync/ops";
import { SETTLE_MS } from "@studio/song/moduleCache";
import type { Batch } from "./liveLog.ts";

/** What the ledger knows of one file: its stamp, its `textHash` unless opaque, the text of a YAML file. */
interface Known {
  stamp: string;
  hash: string | null;
  text: string | null;
}

/** A text file past this travels as an opaque file, like audio. */
const TEXT_CEILING = 5 * 1024 * 1024;

const isYaml = (rel: string): boolean => /\.ya?ml$/i.test(rel);

/** Git's own test: a NUL byte in the first 8000 bytes makes a file binary, whatever its extension. */
const looksBinary = (buf: Buffer): boolean => buf.subarray(0, 8000).includes(0);

export interface CaptureOptions {
  root: string;
  replica: string;
  /** Hidden from capture, by NAME of any path segment — the workspace's own `skip`. */
  skip: (name: string) => boolean;
  /** Not diffed as text; binaries travel in a later phase. */
  isBinary: (name: string) => boolean;
  onBatch: (batch: Batch) => void;
  /** Quiet period that closes a batch; a mutation window closes one too. */
  quietMs?: number;
  /** Full re-scan every so often, the safety net for events a watcher dropped; 0 disables it. */
  reconcileMs?: number;
}

const stampOf = (size: number, mtimeMs: number): string => `${size}:${mtimeMs}`;

export class LiveCapture {
  private readonly ledger = new Map<string, Known>();
  private readonly dirty = new Set<string>();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private sweep: NodeJS.Timeout | null = null;
  private startup: NodeJS.Timeout | null = null;
  private holds = 0;
  /** A window closed since the last flush: the next one sweeps everything rather than trust the watcher. */
  private windowClosed = false;
  private labels: string[] = [];
  private local = 0;
  private readonly quietMs: number;

  constructor(private readonly o: CaptureOptions) {
    this.quietMs = o.quietMs ?? 100;
  }

  /** Read the workspace into the ledger WITHOUT emitting, or from `baseline` and emit what differs; then watch it. */
  start(baseline?: {
    files(): string[];
    get(file: string): string | null;
  }): void {
    if (baseline) this.learnBaseline(baseline);
    else for (const rel of this.walk("")) this.learn(rel);
    try {
      this.watcher = watch(
        this.o.root,
        { recursive: true, persistent: false },
        (_e, name) => {
          if (name) this.touch(String(name).split(sep).join("/"));
        },
      );
      this.watcher.on("error", () => this.closeWatcher());
    } catch {
      // A platform without recursive watching is left to the periodic re-scan.
      this.watcher = null;
    }
    // Against a baseline, everything that moved while this service was down is a batch NOW.
    if (baseline) this.flushNow({ full: true });
    // A watcher misses writes made while it starts beside another (measured on macOS): sweep once it is up.
    this.startup = setTimeout(() => this.sweepUnlessHeld(), 1000);
    this.startup.unref();
    const every = this.o.reconcileMs ?? 5000;
    if (every > 0) {
      this.sweep = setInterval(() => this.sweepUnlessHeld(), every);
      this.sweep.unref();
    }
  }

  stop(): void {
    this.closeWatcher();
    if (this.timer) clearTimeout(this.timer);
    if (this.sweep) clearInterval(this.sweep);
    if (this.startup) clearTimeout(this.startup);
    this.timer = this.sweep = this.startup = null;
  }

  /** A mutation window opens: nothing is emitted until every window has closed. */
  hold(): void {
    this.holds++;
  }

  /** A mutation window closes; its label names the batch the next quiet period emits. */
  release(label: string): void {
    this.holds = Math.max(0, this.holds - 1);
    if (label) this.labels.push(label);
    this.windowClosed = true;
    this.schedule();
  }

  /** Emit now whatever changed in `files`: a remote batch is about to write them, and would absorb it. */
  captureFiles(files: string[]): Batch | null {
    const ops: FileOp[] = [];
    const seen = new Set<string>();
    for (const file of new Set(files)) this.diffScope(file, ops, seen);
    return ops.length ? this.emit(ops) : null;
  }

  /** Write a file for another replica's batch, recording it in the ledger first so it is not echoed back. */
  writeKnown(file: string, text: string | null): void {
    const abs = this.abs(file);
    if (text === null) rmSync(abs, { force: true });
    else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
    this.learn(file);
  }

  /** The file's text now, or null when it is absent. */
  read(file: string): string | null {
    const abs = this.abs(file);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  }

  /** Every file the ledger holds as text: what a seed sends, and what a snapshot may replace. */
  textFiles(): string[] {
    return [...this.ledger].filter(([, k]) => k.hash !== null).map(([f]) => f);
  }

  /** Diff everything the watcher reported (or the whole tree) and emit it as one batch now. */
  flushNow(opts: { full?: boolean } = {}): Batch | null {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ops: FileOp[] = [];
    const seen = new Set<string>();
    const scopes = opts.full ? [""] : [...this.dirty];
    this.dirty.clear();
    if (opts.full) this.windowClosed = false;
    for (const scope of scopes) this.diffScope(scope, ops, seen);
    return ops.length ? this.emit(ops) : null;
  }

  private emit(ops: FileOp[]): Batch {
    const batch: Batch = {
      id: randomUUID(),
      replica: this.o.replica,
      local: ++this.local,
      ts: Date.now(),
      label: this.labels.join(" + ") || "edit",
      ops,
    };
    this.labels = [];
    this.o.onBatch(batch);
    return batch;
  }

  /** A sweep inside a mutation window would emit half of it; the window's own release covers it. */
  private sweepUnlessHeld(): void {
    if (this.holds === 0) this.flushNow({ full: true });
  }

  private touch(rel: string): void {
    if (rel.split("/").some((s) => this.o.skip(s))) return;
    this.dirty.add(rel);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.holds === 0) this.flushNow({ full: this.windowClosed });
    }, this.quietMs);
  }

  /** One reported path: a file, a folder (created, renamed or removed whole), or something gone. */
  private diffScope(scope: string, ops: FileOp[], seen: Set<string>): void {
    const onDisk = new Set(this.walk(scope));
    const prefix = scope ? `${scope}/` : "";
    for (const rel of [...this.ledger.keys()])
      if ((rel === scope || rel.startsWith(prefix)) && !onDisk.has(rel)) {
        const hash = this.ledger.get(rel)?.hash;
        if (!seen.has(rel))
          ops.push({
            kind: "remove",
            file: rel,
            ...(hash ? { was: hash } : {}),
          });
        seen.add(rel);
        this.ledger.delete(rel);
      }
    for (const rel of onDisk) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      const op = this.change(rel);
      if (op) ops.push(op);
    }
  }

  /** The op for one file present on disk, the ledger updated; null when unchanged or binary. */
  private change(rel: string): FileOp | null {
    const known = this.ledger.get(rel);
    const st = statSync(this.abs(rel));
    // A same-size rewrite inside one timestamp tick keeps the stamp, so an unsettled file is re-read (docs/history.md).
    const settled = Date.now() - st.mtimeMs > SETTLE_MS;
    if (known && known.stamp === stampOf(st.size, st.mtimeMs) && settled)
      return null;
    const { now, text } = this.probe(rel);
    this.ledger.set(rel, now);
    if (text === null || known?.hash === now.hash) return null;
    const op = fileOpFor(
      rel,
      known?.text ?? null,
      text,
      known ? known.hash : null,
    );
    // A file that was opaque has no hash to check against: its text goes unchecked.
    if (op && op.kind !== "yaml" && known && known.hash === null) delete op.was;
    return op;
  }

  /** The file as it is: its ledger entry, and its text unless it is opaque (binary, or too big). */
  private probe(rel: string): { now: Known; text: string | null } {
    const abs = this.abs(rel);
    const st = statSync(abs);
    const stamp = stampOf(st.size, st.mtimeMs);
    const opaque = { now: { stamp, hash: null, text: null }, text: null };
    if (this.o.isBinary(rel) || st.size > TEXT_CEILING) return opaque;
    const buf = readFileSync(abs);
    if (looksBinary(buf)) return opaque;
    const text = buf.toString("utf8");
    const hash = textHash(text);
    return { now: { stamp, hash, text: isYaml(rel) ? text : null }, text };
  }

  /** The ledger as the baseline says the text files were, opaque files as they are on disk. */
  private learnBaseline(baseline: {
    files(): string[];
    get(file: string): string | null;
  }): void {
    for (const rel of this.walk("")) {
      const { now, text } = this.probe(rel);
      if (text === null) this.ledger.set(rel, now);
    }
    for (const rel of baseline.files()) {
      const text = baseline.get(rel);
      if (text === null || rel.split("/").some((s) => this.o.skip(s))) continue;
      const hash = textHash(text);
      // An empty stamp never matches the disk's, so the first sweep compares by hash and text.
      this.ledger.set(rel, {
        stamp: "",
        hash,
        text: isYaml(rel) ? text : null,
      });
    }
  }

  private learn(rel: string): void {
    if (existsSync(this.abs(rel))) this.ledger.set(rel, this.probe(rel).now);
    else this.ledger.delete(rel);
  }

  /** Every file under `scope` (a file or a folder, workspace-relative), minus what `skip` hides. */
  private walk(scope: string): string[] {
    const abs = this.abs(scope);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch {
      return [];
    }
    if (st.isFile()) return [scope];
    if (!st.isDirectory()) return [];
    const out: string[] = [];
    const visit = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (this.o.skip(e.name)) continue;
        const child = join(dir, e.name);
        if (e.isDirectory()) visit(child);
        else if (e.isFile())
          out.push(relative(this.o.root, child).split(sep).join("/"));
      }
    };
    visit(abs);
    return out;
  }

  private abs(rel: string): string {
    return rel ? join(this.o.root, ...rel.split("/")) : this.o.root;
  }

  private closeWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
