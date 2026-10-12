// ops.ts — the vocabulary of live sync: what one edit to one workspace file looks like on the wire.
// A path never holds a list INDEX: an item is named by its natural key (listKeys.ts), or its list is a leaf.
// See ../docs/ops.md.

/** A key path through maps, and through keyed lists by an item segment like `[t=1,k=60]`. */
export type KeyPath = string[];

/** One value set or removed in a YAML document; `yaml` is the value's own source, `was` the one it replaced (null: absent). */
export type YamlOp =
  | {
      op: "set";
      path: KeyPath;
      yaml: string;
      was?: string | null;
      /** A new list item goes after the item this segment names; null: first. */
      after?: string | null;
    }
  | { op: "delete"; path: KeyPath; was?: string | null };

/** One file's change, workspace-relative; `was` is the replaced text's `textHash` (null: absent, missing: unchecked). */
export type FileOp =
  | { kind: "yaml"; file: string; ops: YamlOp[] }
  | { kind: "text"; file: string; text: string; was?: string | null }
  | { kind: "remove"; file: string; was?: string | null };

/** One mutation window's changes, as captured by one replica. */
export interface Batch {
  id: string;
  replica: string;
  /** The capturing replica's own counter; the order every replica APPLIES in is the server's `seq`. */
  local: number;
  ts: number;
  label: string;
  ops: FileOp[];
  /** Conflicts this batch settles: taking an alternative is its op plus its id here, dismissing one is the id alone. */
  resolves?: string[];
}

/** An op the room set aside because the value it replaced had changed meanwhile: an alternative until resolved. */
export interface Conflict {
  /** `<seq>.<n>`, unique in its room: what a batch's `resolves` names. */
  id: string;
  seq: number;
  replica: string;
  ts: number;
  label: string;
  /** The op set aside: one YAML op, or a whole text or removal. */
  op: FileOp;
  /** For a YAML op, the value kept in its place as YAML source (null: absent). */
  kept?: string | null;
}

/** A batch as the server ordered it: `batch.ops` are the ops that APPLIED there, `parked` the ones set aside. */
export interface Sequenced {
  seq: number;
  batch: Batch;
  parked: Conflict[];
}

/** True when two paths name the same value or one contains the other — the only way two ops can collide. */
export function overlaps(a: KeyPath, b: KeyPath): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}
