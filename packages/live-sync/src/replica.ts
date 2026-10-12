// replica.ts — a replica's side of the server's order: its own unconfirmed batches replayed over the rest.
// It keeps the CONFIRMED text of every file (the room's, as of the last seq it applied); what it shows is
// that text with its own pending ops replayed on top. See ../docs/sync.md.

import { ConflictSet } from "./conflicts.ts";
import { applyFileOp } from "./fileOp.ts";
import type { Batch, Sequenced } from "./ops.ts";

/** The files a replica reads and writes; `write` must also tell its capture, so nothing is echoed. */
export interface ReplicaHost {
  read(file: string): string | null;
  write(file: string, text: string | null): void;
}

/** The room's text as this replica last applied it; kept on disk, it is what a restart diffs against. */
export interface ConfirmedStore {
  get(file: string): string | null;
  set(file: string, text: string | null): void;
  files(): string[];
}

/** A ConfirmedStore that forgets on exit: tests, and replicas with nothing to restart from. */
export class MemoryConfirmed implements ConfirmedStore {
  private readonly map = new Map<string, string>();
  get(file: string): string | null {
    return this.map.get(file) ?? null;
  }
  set(file: string, text: string | null): void {
    if (text === null) this.map.delete(file);
    else this.map.set(file, text);
  }
  files(): string[] {
    return [...this.map.keys()];
  }
}

export class Replica {
  /** The last seq applied; what to ask from on reconnecting. */
  head: number;
  /** The room's open conflicts: a welcome hands them all, every later entry updates them. */
  readonly conflicts = new ConflictSet();
  private pending: Batch[] = [];

  constructor(
    readonly id: string,
    private readonly host: ReplicaHost,
    readonly confirmed: ConfirmedStore = new MemoryConfirmed(),
    head = 0,
  ) {
    this.head = head;
  }

  /** Batches sent and not yet confirmed, oldest first: what to send again after a reconnect. */
  unconfirmed(): Batch[] {
    return [...this.pending];
  }

  /** A batch this replica captured from its own files. */
  local(batch: Batch): void {
    this.pending.push(batch);
  }

  /** One server-ordered batch; answers the files whose confirmed text it could not apply to. */
  remote(entry: Sequenced): string[] {
    if (entry.seq <= this.head) {
      // Already in what this replica adopted, but still the answer that confirms its own batch.
      this.forget(entry.batch.id);
      return [];
    }
    this.head = entry.seq;
    this.conflicts.record(entry);
    const failed: string[] = [];
    const touched = new Set<string>();
    for (const op of entry.batch.ops) {
      touched.add(op.file);
      try {
        this.confirmed.set(
          op.file,
          applyFileOp(this.confirmed.get(op.file), op),
        );
      } catch {
        failed.push(op.file);
      }
    }
    const mine = this.pending.findIndex((b) => b.id === entry.batch.id);
    // The room may have set some of it aside: whatever this replica shows must be what it confirmed.
    if (mine >= 0)
      for (const op of this.pending.splice(mine, 1)[0].ops)
        touched.add(op.file);
    for (const file of touched) this.settle(file);
    return failed;
  }

  /** The room's whole state becomes the confirmed one; pending ops are replayed over it, not dropped. */
  adopt(head: number, files: Record<string, string>): void {
    const all = new Set([...this.confirmed.files(), ...Object.keys(files)]);
    for (const file of this.confirmed.files())
      if (!(file in files)) this.confirmed.set(file, null);
    for (const [file, text] of Object.entries(files))
      this.confirmed.set(file, text);
    for (const b of this.pending) for (const op of b.ops) all.add(op.file);
    this.head = head;
    for (const file of all) this.settle(file);
  }

  /** Drop a pending batch the room already holds, and show what that leaves. */
  private forget(id: string): void {
    const i = this.pending.findIndex((b) => b.id === id);
    if (i < 0) return;
    const [sent] = this.pending.splice(i, 1);
    for (const file of new Set(sent.ops.map((o) => o.file))) this.settle(file);
  }

  /** Make the file its confirmed text plus this replica's pending ops on it. */
  private settle(file: string): void {
    let text = this.confirmed.get(file);
    for (const b of this.pending)
      for (const op of b.ops) {
        if (op.file !== file) continue;
        try {
          text = applyFileOp(text, op);
        } catch {
          // The room will drop this op too: its text is the confirmed one here.
        }
      }
    if (this.host.read(file) !== text) this.host.write(file, text);
  }
}
