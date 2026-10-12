// liveCapture.ts — every change to a workspace's files, whoever made it, as batches of ops.
// A ledger holds each YAML file's last known text, the only kind diffed (fileOpFor); others, a hash.
// An opaque file (binary, or too big) is known by its blob REF, which is the text its ops carry.
// A file written for ANOTHER replica is recorded in the ledger first, so the watcher never echoes it back.
// See docs/liveCapture.md and ../../file-hub/docs/blobs.md.

import { randomUUID } from "node:crypto";
import {
  existsSync,
  type FSWatcher,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { type BlobId, blobRef, parseBlobRef } from "@studio/live-sync/blob";
import { fileOpFor, textHash } from "@studio/live-sync/file-op";
import type { FileOp } from "@studio/live-sync/ops";
import { SETTLE_MS } from "@studio/song/moduleCache";
import { BlobCache, cloneFile, sha256Buffer, sha256File } from "./liveBlobs.ts";
import {
  BlobIndex,
  isYaml,
  type Known,
  looksBinary,
  stampOf,
  TEXT_CEILING,
} from "./liveLedger.ts";
import type { Batch } from "./liveLog.ts";
import { filesUnder } from "./workspaceFilter.ts";

export interface CaptureOptions {
  root: string;
  replica: string;
  /** Hidden from capture, by NAME of any path segment — the workspace's own `skip`. */
  skip: (name: string) => boolean;
  /** Never read as text: known by its blob ref. */
  isBinary: (name: string) => boolean;
  onBatch: (batch: Batch) => void;
  /** The local blob cache; without one a binary still has a ref, but no bytes are kept to send or write. */
  blobDir?: string;
  /** Where the binaries' hashes are kept across restarts; beside the blob cache's folder by default. */
  indexFile?: string;
  /** A ref was written whose bytes this replica lacks: fetch them, then call `fetched`. */
  onMissingBlob?: (blob: BlobId) => void;
  /** A binary modified more recently than this is still being written: it waits rather than travel half-written. */
  binarySettleMs?: number;
  /** Quiet period that closes a batch; a mutation window closes one too. */
  quietMs?: number;
  /** Full re-scan every so often, the safety net for events a watcher dropped; 0 disables it. */
  reconcileMs?: number;
}

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
  private readonly cache: BlobCache | null;
  private readonly index: BlobIndex | null;
  /** Binaries still being written, looked at again once they have settled. */
  private readonly young = new Set<string>();
  private youngTimer: NodeJS.Timeout | null = null;

  constructor(private readonly o: CaptureOptions) {
    this.quietMs = o.quietMs ?? 100;
    this.cache = o.blobDir ? new BlobCache(o.blobDir) : null;
    const indexFile =
      o.indexFile ??
      (o.blobDir ? join(dirname(o.blobDir), "blob-index.json") : null);
    this.index = indexFile ? new BlobIndex(indexFile) : null;
  }

  /** Read the workspace into the ledger WITHOUT emitting, or from `baseline` and emit what differs; then watch it. */
  start(baseline?: {
    files(): string[];
    get(file: string): string | null;
  }): void {
    if (baseline) this.learnBaseline(baseline);
    else for (const rel of this.walk("")) this.learn(rel);
    // A fetch a restart interrupted: the file waits for its bytes again rather than read as removed.
    for (const [rel, ref] of Object.entries(this.cache?.pending() ?? {}))
      this.await(rel, ref);
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
    this.index?.save(this.ledger);
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
    this.index?.save(this.ledger);
    this.closeWatcher();
    if (this.timer) clearTimeout(this.timer);
    if (this.sweep) clearInterval(this.sweep);
    if (this.startup) clearTimeout(this.startup);
    if (this.youngTimer) clearTimeout(this.youngTimer);
    this.timer = this.sweep = this.startup = this.youngTimer = null;
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
    this.recheckYoung();
    return ops.length ? this.emit(ops) : null;
  }

  /** Write a file for another replica's batch, recording it in the ledger first so it is not echoed back. */
  writeKnown(file: string, text: string | null): void {
    const blob = parseBlobRef(text);
    if (blob && text !== null) {
      this.writeBlob(file, text, blob);
      return;
    }
    const waited = this.ledger.get(file)?.pending;
    const abs = this.pathOf(file);
    if (text === null) rmSync(abs, { force: true });
    else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
    this.learn(file);
    if (waited) this.savePending();
  }

  /** The file's text now, its blob ref when it is opaque, or null when it is absent. */
  read(file: string): string | null {
    const k = this.ledger.get(file);
    if (k?.pending) return k.ref ?? null;
    const abs = this.pathOf(file);
    if (!existsSync(abs)) return null;
    const st = statSync(abs);
    if (k?.ref && k.stamp === stampOf(st.size, st.mtimeMs)) return k.ref;
    return this.probe(file).text;
  }

  /** Every file the ledger knows, by text or by ref: what a seed sends, and what a snapshot may replace. */
  textFiles(): string[] {
    return [...this.ledger.keys()];
  }

  /** A path holding blob `hash`'s bytes, copied into the cache from a file that has them when needed; null when none does. */
  blobFile(hash: string): string | null {
    if (!this.cache) return null;
    const src = this.cache.has(hash) ? null : this.holder(hash);
    const copy = src ? this.cache.snapshot(src) : null;
    // The file moved on between its stamp and the copy: those bytes are not the blob asked for.
    if (copy && copy.hash !== hash && copy.fresh) this.cache.evict(copy.hash);
    return this.cache.has(hash) ? this.cache.path(hash) : null;
  }

  /** The cache's copy of `hash` reached the store: it no longer has to be kept. */
  uploaded(hash: string): void {
    if (!this.pendingOn(hash)) this.cache?.evict(hash);
  }

  /** True while some file waits for blob `hash`. */
  pendingOn(hash: string): boolean {
    for (const k of this.ledger.values())
      if (k.pending && parseBlobRef(k.ref ?? null)?.hash === hash) return true;
    return false;
  }

  /** The local blob cache, or null when this capture keeps none. */
  get blobs(): BlobCache | null {
    return this.cache;
  }

  /** The cache holds blob `hash` now: every file waiting for it is written, and the copy dropped; answers those files. */
  fetched(hash: string): string[] {
    if (!this.cache?.has(hash)) return [];
    const placed: string[] = [];
    for (const [rel, k] of [...this.ledger])
      if (k.pending && k.ref && parseBlobRef(k.ref)?.hash === hash) {
        this.place(rel, this.cache.path(hash), k.ref);
        placed.push(rel);
      }
    this.savePending();
    this.cache.evict(hash);
    return placed;
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
    this.recheckYoung();
    if (!ops.length) return null;
    this.index?.save(this.ledger);
    return this.emit(ops);
  }

  /** Binaries left waiting are reported again once they had time to settle. */
  private recheckYoung(): void {
    if (!this.young.size || this.youngTimer) return;
    this.youngTimer = setTimeout(() => {
      this.youngTimer = null;
      const files = [...this.young];
      this.young.clear();
      for (const rel of files) this.touch(rel);
    }, this.o.binarySettleMs ?? 1000);
    this.youngTimer.unref();
  }

  /** A ref written for another replica: the bytes from the cache or a local file, else the file waits for a fetch. */
  private writeBlob(file: string, ref: string, blob: BlobId): void {
    const k = this.ledger.get(file);
    if (k?.ref === ref && !k.pending && existsSync(this.pathOf(file))) return;
    const src = this.cache?.has(blob.hash)
      ? this.cache.path(blob.hash)
      : this.holder(blob.hash);
    if (src) {
      this.place(file, src, ref);
      this.savePending();
    } else this.await(file, ref);
  }

  /** `file` is known by `ref` and waits for its bytes; whatever is on disk there stays until they arrive. */
  private await(file: string, ref: string): void {
    const blob = parseBlobRef(ref);
    if (!blob) return;
    this.ledger.set(file, {
      stamp: "",
      hash: textHash(ref),
      text: null,
      ref,
      pending: true,
    });
    this.savePending();
    this.o.onMissingBlob?.(blob);
  }

  /** Copy `src` into place as `file`, and record it as `ref` before the watcher reports it. */
  private place(file: string, src: string, ref: string): void {
    const abs = this.pathOf(file);
    mkdirSync(dirname(abs), { recursive: true });
    cloneFile(src, abs);
    const st = statSync(abs);
    this.ledger.set(file, {
      stamp: stampOf(st.size, st.mtimeMs),
      hash: textHash(ref),
      text: null,
      ref,
    });
  }

  /** A workspace file whose ledger ref names `hash` and whose stamp has not moved since. */
  private holder(hash: string): string | null {
    for (const [rel, k] of this.ledger) {
      if (k.pending || !k.ref || parseBlobRef(k.ref)?.hash !== hash) continue;
      try {
        const st = statSync(this.pathOf(rel));
        if (k.stamp === stampOf(st.size, st.mtimeMs)) return this.pathOf(rel);
      } catch {
        // Gone since the ledger saw it: try another.
      }
    }
    return null;
  }

  private savePending(): void {
    if (!this.cache) return;
    const files: Record<string, string> = {};
    for (const [rel, k] of this.ledger)
      if (k.pending && k.ref) files[rel] = k.ref;
    this.cache.savePending(files);
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
        const known = this.ledger.get(rel);
        // A file waiting for its bytes is absent on purpose.
        if (known?.pending) continue;
        const hash = known?.hash;
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

  /** The op for one file present on disk, the ledger updated; null when unchanged, or still being written. */
  private change(rel: string): FileOp | null {
    const known = this.ledger.get(rel);
    // A file waiting for its bytes belongs to the fetch; what is on disk is the version it replaces.
    if (known?.pending) return null;
    const st = statSync(this.pathOf(rel));
    const stamp = stampOf(st.size, st.mtimeMs);
    // A same-size rewrite inside one timestamp tick keeps the stamp, so an unsettled file is re-read (docs/history.md).
    const settled = Date.now() - st.mtimeMs > SETTLE_MS;
    if (known && known.stamp === stamp && (settled || known.ref)) return null;
    const opaque = known?.ref || this.opaqueByName(rel, st.size);
    if (opaque && Date.now() - st.mtimeMs < (this.o.binarySettleMs ?? 1000)) {
      this.young.add(rel);
      return null;
    }
    const { now, text, fresh } = this.probe(rel, true);
    this.ledger.set(rel, now);
    if (text === null || known?.hash === now.hash) {
      const blob = parseBlobRef(now.ref ?? null);
      // The copy taken to send it is not needed: nothing changed.
      if (fresh && blob) this.cache?.evict(blob.hash);
      return null;
    }
    if (now.ref)
      return {
        kind: "text",
        file: rel,
        text: now.ref,
        was: known ? known.hash : null,
      };
    return fileOpFor(rel, known?.text ?? null, text, known ? known.hash : null);
  }

  private opaqueByName(rel: string, size: number): boolean {
    return this.o.isBinary(rel) || size > TEXT_CEILING;
  }

  /** The file as it is: its ledger entry, and its text, or its blob ref when it is opaque (binary, or too big). */
  private probe(
    rel: string,
    keep = false,
  ): { now: Known; text: string | null; fresh?: boolean } {
    const abs = this.pathOf(rel);
    const st = statSync(abs);
    const stamp = stampOf(st.size, st.mtimeMs);
    const opaque = (id: BlobId & { fresh?: boolean }) => {
      const ref = blobRef(id.hash, id.size);
      const now = { stamp, hash: textHash(ref), text: null, ref };
      return { now, text: ref, fresh: id.fresh };
    };
    // To be sent, the bytes are copied first and the COPY is hashed: the ref then names bytes nothing can change.
    const id = (buf?: Buffer) =>
      keep && this.cache
        ? this.cache.snapshot(abs)
        : buf
          ? sha256Buffer(buf)
          : sha256File(abs);
    // An unchanged binary is known by the hash it had: only one about to be sent is read.
    const indexed = keep ? null : this.index?.get(rel, stamp);
    if (indexed) return opaque(indexed);
    if (this.opaqueByName(rel, st.size)) return opaque(id());
    const buf = readFileSync(abs);
    if (looksBinary(buf)) return opaque(id(buf));
    const text = buf.toString("utf8");
    const hash = textHash(text);
    return { now: { stamp, hash, text: isYaml(rel) ? text : null }, text };
  }

  /** The ledger as the baseline says the text files were, opaque files as they are on disk. */
  private learnBaseline(baseline: {
    files(): string[];
    get(file: string): string | null;
  }): void {
    const opaque = new Map<string, Known>();
    for (const rel of this.walk("")) {
      const { now } = this.probe(rel);
      if (now.ref) opaque.set(rel, now);
    }
    for (const rel of baseline.files()) {
      const text = baseline.get(rel);
      if (text === null || rel.split("/").some((s) => this.o.skip(s))) continue;
      const hash = textHash(text);
      const ref = parseBlobRef(text) ? text : undefined;
      // The same bytes as on disk: the walk's entry, with its real stamp, spares hashing them again.
      const walked = opaque.get(rel);
      if (ref && walked?.ref === ref) {
        this.ledger.set(rel, walked);
        continue;
      }
      // An empty stamp never matches the disk's, so the first sweep compares by hash and text.
      this.ledger.set(rel, {
        stamp: "",
        hash,
        text: isYaml(rel) && !ref ? text : null,
        ...(ref ? { ref } : {}),
      });
    }
  }

  private learn(rel: string): void {
    if (existsSync(this.pathOf(rel))) this.ledger.set(rel, this.probe(rel).now);
    else this.ledger.delete(rel);
  }

  /** Every file under `scope` (a file or a folder, workspace-relative), minus what `skip` hides. */
  private walk(scope: string): string[] {
    return filesUnder(this.o.root, scope, this.o.skip);
  }

  /** The workspace file's absolute path. */
  pathOf(rel: string): string {
    return rel ? join(this.o.root, ...rel.split("/")) : this.o.root;
  }

  private closeWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
