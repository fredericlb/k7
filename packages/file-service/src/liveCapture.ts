// liveCapture.ts — every change to a workspace's files, whoever made it, as batches of ops.
// A ledger holds each k7x file's last known text, the only kind diffed (fileOpFor); others, a hash.
// An opaque file (binary, or too big) is known by its blob REF, which is the text its ops carry.
// A file written for ANOTHER replica is recorded in the ledger first, so the watcher never echoes it back.
// Every path seen is also a ChangeFeed event, which the strudel and module watchers subscribe to.
// See docs/liveCapture.md and ../../file-hub/docs/blobs.md.

import { randomUUID } from "node:crypto";
import {
  existsSync,
  type FSWatcher,
  mkdirSync,
  readFileSync,
  rmSync,
  type Stats,
  statSync,
  watch,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { type BlobId, blobRef, parseBlobRef } from "@studio/live-sync/blob";
import { fileOpFor, textHash } from "@studio/live-sync/file-op";
import type { FileOp } from "@studio/live-sync/ops";
import { writeFileAtomic } from "@studio/song/atomicWrite";
import { SETTLE_MS } from "@studio/song/moduleCache";
import { BlobCache, cloneFile, sha256Buffer, sha256File } from "./liveBlobs.ts";
import {
  BlobIndex,
  type Known,
  keepsText,
  looksBinary,
  stampOf,
  textCeiling,
} from "./liveLedger.ts";
import type { Batch } from "./liveLog.ts";
import { confinedPath } from "./livePath.ts";
import { filesUnder } from "./workspaceFilter.ts";

/** The text each file had as the room last confirmed it: what a restart diffs the workspace against. */
interface Baseline {
  files(): string[];
  get(file: string): string | null;
}

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
  /** The same net for a workspace idle for `activeMs`: a whole walk of every account's every workspace each 5 s is real disk work. */
  idleReconcileMs?: number;
  /** How long after its last change, write or start a workspace counts as active, and keeps the fast net. */
  activeMs?: number;
}

/** Every path that moved under a capture's root, whoever moved it — what the other watchers subscribe to (docs/liveCapture.md). */
export interface ChangeFeed {
  /** The folder the paths are relative to, slash-separated. */
  readonly root: string;
  /** Bumped by every reported path: only its changes matter, never its value. */
  readonly generation: number;
  /** Hear each path (a file, or a folder moved whole) as it is seen; answers the unsubscribe. */
  onChange(fn: (rel: string, generation: number) => void): () => void;
}

/** The re-scan of an active workspace, of an idle one, and what active means — docs/liveCapture.md. */
const RECONCILE_MS = 5000;
const IDLE_RECONCILE_MS = 60_000;
/** …and of an idle one whose watcher is up: it is the net, not the feed (docs/liveCapture.md). */
const IDLE_WATCHED_MS = 5 * 60_000;
const ACTIVE_MS = 2 * 60_000;

export class LiveCapture implements ChangeFeed {
  private readonly ledger = new Map<string, Known>();
  private readonly dirty = new Set<string>();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private sweep: NodeJS.Timeout | null = null;
  private startup: NodeJS.Timeout | null = null;
  private holds = 0;
  /** When the whole tree was last diffed, which the idle re-scan counts from. */
  private lastFull = 0;
  /** When the workspace last changed, was written, or started: what keeps it on the fast re-scan. */
  private lastActive = Date.now();
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
  private readonly listeners = new Set<(rel: string, gen: number) => void>();
  private gen = 0;
  /** The ledger was built by `prepare`; `start` goes straight to watching. */
  private prepared = false;
  private halted = false;
  /** What the room last confirmed, where a k7x file the ledger knows only by hash finds its text (docs/liveCapture.md). */
  private baseline: Baseline | null = null;

  constructor(private readonly o: CaptureOptions) {
    this.quietMs = o.quietMs ?? 100;
    this.cache = o.blobDir ? new BlobCache(o.blobDir) : null;
    const indexFile =
      o.indexFile ??
      (o.blobDir ? join(dirname(o.blobDir), "blob-index.json") : null);
    this.index = indexFile ? new BlobIndex(indexFile) : null;
  }

  /** Build the ledger in slices that yield to the event loop, so a large workspace never stalls the process; false once stopped meanwhile. */
  async prepare(baseline?: Baseline, sliceMs = 10): Promise<boolean> {
    const steps = this.learning(baseline);
    let since = performance.now();
    while (!steps.next().done) {
      if (performance.now() - since < sliceMs) continue;
      await new Promise((res) => setImmediate(res));
      if (this.halted) return false;
      since = performance.now();
    }
    this.prepared = true;
    return !this.halted;
  }

  /** Read the workspace into the ledger WITHOUT emitting (unless `prepare` did), or from `baseline` and emit what differs; then watch it. */
  start(baseline?: Baseline): void {
    if (!this.prepared) for (const _ of this.learning(baseline));
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
    this.startup = setTimeout(() => this.sweepUnlessHeld(true), 1000);
    this.startup.unref();
    const every = this.o.reconcileMs ?? RECONCILE_MS;
    if (every > 0) {
      this.sweep = setInterval(() => this.sweepUnlessHeld(), every);
      this.sweep.unref();
    }
  }

  get root(): string {
    return this.o.root;
  }

  get generation(): number {
    return this.gen;
  }

  onChange(fn: (rel: string, generation: number) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Tell every subscriber `rel` moved; a listener that throws costs only itself. */
  private publish(rel: string): void {
    this.gen++;
    for (const fn of this.listeners)
      try {
        fn(rel, this.gen);
      } catch (e) {
        console.error(`   ✗ change feed: ${(e as Error).message}`);
      }
  }

  stop(): void {
    this.halted = true;
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
      writeFileAtomic(abs, text);
    }
    this.lastActive = Date.now();
    this.learn(file);
    if (waited) this.savePending();
    this.publish(file);
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
    if (opts.full) {
      this.windowClosed = false;
      this.lastFull = Date.now();
    }
    for (const scope of scopes) this.diffScope(scope, ops, seen);
    this.recheckYoung();
    if (!ops.length) return null;
    this.lastActive = Date.now();
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
    this.publish(file);
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
    // A sweep finds what a dead or lossy watcher never reported, so its files are news too.
    for (const op of ops) this.publish(op.file);
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
  private sweepUnlessHeld(force = false): void {
    if (this.holds !== 0) return;
    const now = Date.now();
    // A watcher can miss a rewrite (Linux's recursive one does), so an ACTIVE workspace keeps the fast net.
    const idle = now - this.lastActive >= (this.o.activeMs ?? ACTIVE_MS);
    const spacing =
      this.o.idleReconcileMs ??
      (this.watcher ? IDLE_WATCHED_MS : IDLE_RECONCILE_MS);
    if (!force && idle && now - this.lastFull < spacing) return;
    this.flushNow({ full: true });
  }

  private touch(rel: string): void {
    if (rel.split("/").some((s) => this.o.skip(s))) return;
    this.lastActive = Date.now();
    this.dirty.add(rel);
    this.publish(rel);
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
    const before = known?.text ?? this.confirmedText(rel, known);
    return fileOpFor(rel, before, text, known ? known.hash : null);
  }

  private opaqueByName(rel: string, size: number): boolean {
    return this.o.isBinary(rel) || size > textCeiling(rel);
  }

  /** The file as it is: its ledger entry, and its text, or its blob ref when it is opaque (binary, or too big). */
  private probe(
    rel: string,
    keep = false,
    seen?: { abs: string; st: Stats },
  ): { now: Known; text: string | null; fresh?: boolean } {
    const abs = seen?.abs ?? this.pathOf(rel);
    const st = seen?.st ?? statSync(abs);
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
    // A stamp read unsettled may be reused by a same-size rewrite in its tick: empty, the next look compares by hash.
    const sure = Date.now() - st.mtimeMs > SETTLE_MS ? stamp : "";
    return {
      now: { stamp: sure, hash, text: keepsText(rel) ? text : null },
      text,
    };
  }

  /** The ledger built from the disk, or from `baseline`: one step per file, which `prepare` spreads over the event loop. */
  private *learning(baseline?: Baseline): Generator<void> {
    this.baseline = baseline ?? null;
    if (baseline) yield* this.learnBaseline(baseline);
    else
      for (const rel of this.walk("")) {
        this.learn(rel);
        yield;
      }
  }

  /** The ledger as the baseline says the files were; one the disk still holds as it was keeps the walk's entry. */
  private *learnBaseline(baseline: Baseline): Generator<void> {
    const walk = new Map<string, Known>();
    for (const rel of this.walk("")) {
      const k = this.look(rel);
      if (k) walk.set(rel, k);
      yield;
    }
    for (const rel of baseline.files()) {
      yield;
      const text = baseline.get(rel);
      if (text === null || rel.split("/").some((s) => this.o.skip(s))) continue;
      const hash = textHash(text);
      const ref = parseBlobRef(text) ? text : undefined;
      // The same content as on disk: the walk's entry, with its real stamp, spares the first sweep reading it again.
      const walked = walk.get(rel);
      if (
        walked &&
        walked.hash === hash &&
        (walked.ref ?? null) === (ref ?? null)
      ) {
        this.ledger.set(rel, walked);
        continue;
      }
      // An empty stamp never matches the disk's, so the first sweep compares by hash and text.
      this.ledger.set(rel, {
        stamp: "",
        hash,
        text: keepsText(rel) && !ref ? text : null,
        ...(ref ? { ref } : {}),
      });
    }
  }

  private learn(rel: string): void {
    const k = this.look(rel);
    if (k) this.ledger.set(rel, k);
    else this.ledger.delete(rel);
  }

  /** The text of a k7x file the ledger knows by hash alone, from the baseline when it holds those very bytes; null otherwise. */
  private confirmedText(rel: string, known: Known | undefined): string | null {
    if (!known || known.ref || !keepsText(rel) || !this.baseline) return null;
    const text = this.baseline.get(rel);
    return text !== null && textHash(text) === known.hash ? text : null;
  }

  /** The ledger entry for `rel` as it is, or null when absent; a text file whose stamp the index knows is not read (k7x ones are, for their text). */
  private look(rel: string): Known | null {
    const abs = this.pathOf(rel);
    const st = statSync(abs, { throwIfNoEntry: false });
    if (!st) return null;
    const stamp = stampOf(st.size, st.mtimeMs);
    // A k7x file's text is needed to diff its next change: known by hash only when the baseline can give it back.
    const byHash = !keepsText(rel) || this.baseline !== null;
    const hash =
      !byHash || this.opaqueByName(rel, st.size)
        ? null
        : this.index?.textHash(rel, stamp);
    if (hash) return { stamp, hash, text: null };
    return this.probe(rel, false, { abs, st }).now;
  }

  /** Every file under `scope` (a file or a folder, workspace-relative), minus what `skip` hides. */
  private walk(scope: string): string[] {
    return filesUnder(this.o.root, scope, this.o.skip);
  }

  /** The workspace file's absolute path; throws for a path that would leave the workspace (livePath.ts). */
  pathOf(rel: string): string {
    return rel ? confinedPath(this.o.root, rel) : this.o.root;
  }

  private closeWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
