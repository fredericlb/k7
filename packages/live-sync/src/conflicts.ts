// conflicts.ts — the alternatives a room set aside and nobody has settled yet, kept the same way by room and replica.
// A newer alternative from the same replica for the same value replaces the older one: a drag made offline is one.
// See ../docs/sync.md.

import type { Conflict, FileOp, Sequenced } from "./ops.ts";

/** How many open conflicts a workspace keeps; past that, the oldest go (they stay in the log). */
const OPEN_KEEP = 500;

/** The value a set-aside op is about: a file, or a path inside one. */
function valueKey(op: FileOp): string {
  return op.kind === "yaml" || op.kind === "k7x"
    ? [op.file, ...(op.ops[0]?.path ?? [])].join("\0")
    : op.file;
}

export class ConflictSet {
  private readonly open = new Map<string, Conflict>();

  /** The open conflicts, oldest first. */
  list(): Conflict[] {
    return [...this.open.values()];
  }

  get(id: string): Conflict | undefined {
    return this.open.get(id);
  }

  /** Replace every open conflict, as a welcome hands them. */
  reset(list: Conflict[]): void {
    this.open.clear();
    for (const c of list) this.open.set(c.id, c);
  }

  /** Follow one ordered entry: what it settles closes, what it set aside opens. */
  record(entry: Sequenced): void {
    for (const id of entry.batch.resolves ?? [])
      if (typeof id === "string") this.open.delete(id);
    for (const c of entry.parked ?? []) {
      const key = valueKey(c.op);
      for (const [id, o] of this.open)
        if (o.replica === c.replica && valueKey(o.op) === key)
          this.open.delete(id);
      this.open.set(c.id, c);
    }
    for (const id of this.open.keys()) {
      if (this.open.size <= OPEN_KEEP) break;
      this.open.delete(id);
    }
  }
}
