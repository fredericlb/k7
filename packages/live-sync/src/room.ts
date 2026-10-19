// room.ts — the server's side of one workspace: the order every replica applies in, and the canonical text.
// An op is applied HERE before it is relayed; one whose value moved meanwhile is SET ASIDE as a conflict, so every relayed op applies.
// See ../docs/sync.md.

import { ConflictSet } from "./conflicts.ts";
import { applyFileOp, settleFileOp } from "./fileOp.ts";
import type { Batch, Conflict, FileOp, Sequenced } from "./ops.ts";
import { assertSyncPath } from "./path.ts";
import { TextBases } from "./textMerge.ts";

/** How many sequenced batches a room keeps for catch-up; a replica further behind gets the whole state. */
const LOG_KEEP = 2000;

/** What a replica saying hello at `since` must do to be current. */
export type CatchUp =
  | { mode: "seed" }
  | { mode: "entries"; entries: Sequenced[]; conflicts: Conflict[] }
  | {
      mode: "snapshot";
      head: number;
      files: Record<string, string>;
      conflicts: Conflict[];
    };

/** A room as it is saved: the canonical files at `head`, the entries before it, and what is still in conflict. */
export interface RoomState {
  head: number;
  files: Record<string, string>;
  log: Sequenced[];
  conflicts?: Conflict[];
  /** Recent versions of each text that is not k7x, the bases a late whole text merges against. */
  bases?: Record<string, string[]>;
}

export class Room {
  head = 0;
  readonly files = new Map<string, string>();
  private log: Sequenced[] = [];
  readonly conflicts = new ConflictSet();
  private bases = new TextBases();

  /** A room restored from what `state()` saved. */
  static from(saved: RoomState): Room {
    const room = new Room();
    room.head = saved.head;
    for (const [f, t] of Object.entries(saved.files)) room.files.set(f, t);
    room.log = saved.log;
    room.conflicts.reset(saved.conflicts ?? []);
    room.bases = TextBases.from(saved.bases);
    return room;
  }

  state(): RoomState {
    return {
      head: this.head,
      files: Object.fromEntries(this.files),
      log: this.log,
      conflicts: this.conflicts.list(),
      bases: this.bases.toJSON(),
    };
  }

  /** Order `batch`, applying it to the canonical files; a batch seen before answers its first ordering, one naming a path outside the workspace throws. */
  submit(batch: Batch): { entry: Sequenced; fresh: boolean } {
    for (const op of batch.ops) assertSyncPath(op.file);
    const known = this.log.find((e) => e.batch.id === batch.id);
    if (known) return { entry: known, fresh: false };
    const seq = this.head + 1;
    const applied: FileOp[] = [];
    const parked: Conflict[] = [];
    const park = (op: FileOp, kept?: string | null) =>
      parked.push({
        id: `${seq}.${parked.length}`,
        seq,
        replica: batch.replica,
        ts: batch.ts,
        label: batch.label,
        op,
        ...(kept === undefined ? {} : { kept }),
      });
    for (const op of batch.ops) {
      const current = this.files.get(op.file) ?? null;
      const { apply, aside } = settleFileOp(current, op, (f, h) =>
        this.bases.find(f, h),
      );
      for (const a of aside) park(a.op, a.kept);
      if (!apply) continue;
      try {
        this.write(op.file, applyFileOp(current, apply));
        applied.push(apply);
      } catch {
        park(apply);
      }
    }
    const entry: Sequenced = { seq, batch: { ...batch, ops: applied }, parked };
    this.record(entry);
    return { entry, fresh: true };
  }

  /** Re-apply an entry this room ordered before a restart, from the log written beside its saved state. */
  replay(entry: Sequenced): void {
    if (entry.seq <= this.head) return;
    for (const op of entry.batch.ops)
      this.write(op.file, applyFileOp(this.files.get(op.file) ?? null, op));
    this.record(entry);
  }

  private write(file: string, text: string | null): void {
    if (text === null) this.files.delete(file);
    else this.files.set(file, text);
    this.bases.record(file, text);
  }

  private record(entry: Sequenced): void {
    this.head = entry.seq;
    this.conflicts.record(entry);
    this.log.push(entry);
    if (this.log.length > LOG_KEEP)
      this.log.splice(0, this.log.length - LOG_KEEP);
  }

  /** What a replica last current at `since` needs; an empty room asks its first replica for everything. */
  catchUp(since: number): CatchUp {
    if (this.head === 0 && this.files.size === 0) return { mode: "seed" };
    const oldest = this.log.length ? this.log[0].seq : this.head + 1;
    // A replica with no history gets the whole state even when the log reaches back to 1: only that lets it back up what differs.
    if (since > 0 && since <= this.head && since >= oldest - 1)
      return {
        mode: "entries",
        entries: this.log.filter((e) => e.seq > since),
        conflicts: this.conflicts.list(),
      };
    return {
      mode: "snapshot",
      head: this.head,
      files: Object.fromEntries(this.files),
      conflicts: this.conflicts.list(),
    };
  }
}
