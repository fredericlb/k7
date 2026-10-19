// fileOp.ts — one file's change, from its text before and after, as the op a replica replays.
// Path ops are sent only when replaying them reproduces `after` byte for byte; otherwise the whole text.
// Every op names what it replaced (`was`), so the room can set aside one that arrives after the value moved.

import { applyK7x, diffK7x, goneAt, valueAt } from "./k7xOps.ts";
import {
  type Conflict,
  type FileOp,
  type K7xOp,
  NeedsUpdate,
  RETIRED_OP_KINDS,
} from "./ops.ts";
import { textHash } from "./textHash.ts";
import { mergeable, mergeTexts } from "./textMerge.ts";

export { textHash };

const isK7x = (file: string): boolean => /\.k7x$/i.test(file);

/** The op for `file` going from `before` to `after` (null = absent), or null when nothing changed; `beforeHash` stands in for a `before` not kept. */
export function fileOpFor(
  file: string,
  before: string | null,
  after: string | null,
  beforeHash: string | null = before === null ? null : textHash(before),
): FileOp | null {
  if (before === after && before !== null) return null;
  if (after === null)
    return beforeHash === null && before === null
      ? null
      : { kind: "remove", file, was: beforeHash };
  // Item ops first; when they do not replay, the same diff with every list one value.
  if (before !== null && isK7x(file))
    for (const lists of [true, false]) {
      const diff = diffK7x(before, after, lists);
      if (diff?.ops.length && replays(before, diff.ops, after))
        return { kind: "k7x", file, ops: diff.ops };
      if (!diff?.keyed) break;
    }
  if (beforeHash === textHash(after)) return null;
  return { kind: "text", file, text: after, was: beforeHash };
}

function replays(before: string, ops: K7xOp[], after: string): boolean {
  try {
    return applyK7x(before, ops) === after;
  } catch {
    return false;
  }
}

/** `current` (null = absent) after `op`; a path op on a file that is gone or unreadable throws, an unknown kind throws NeedsUpdate. */
export function applyFileOp(current: string | null, op: FileOp): string | null {
  switch (op.kind) {
    case "remove":
      return null;
    case "text":
      return op.text;
    case "k7x":
      if (current === null)
        throw new Error(`${op.file}: k7x ops on a missing file`);
      return applyK7x(current, op.ops);
    default: {
      const { file, kind } = op as { file?: unknown; kind?: unknown };
      // A retired kind predates this k7: updating would not help, so it is no NeedsUpdate.
      if (RETIRED_OP_KINDS.includes(kind as string))
        throw new Error(`${file}: op kind "${kind}" retired, never replayed`);
      throw new NeedsUpdate(
        `${file}: op kind "${kind}" unknown here: update k7`,
      );
    }
  }
}

/** What the room sets aside of an op: the op itself, and the value kept in its place. */
export type SetAside = Pick<Conflict, "op" | "kept">;

/** The text `file` had when its hash was `hash`, as far as the room still knows it. */
export type BaseOf = (file: string, hash: string) => string | null;

/** A whole text whose `was` moved: merged with what is in place when the room knows the base and the lines do not collide. */
function settleText(
  current: string | null,
  op: Extract<FileOp, { kind: "text" }>,
  baseOf?: BaseOf,
): FileOp | null {
  if (!baseOf || !op.was || !mergeable(op.file, current)) return null;
  if (!mergeable(op.file, op.text)) return null;
  const base = baseOf(op.file, op.was);
  const merged = base === null ? null : mergeTexts(base, current, op.text);
  return merged === null
    ? null
    : { kind: "text", file: op.file, text: merged, was: textHash(current) };
}

/** True when `text` reads as k7x, so its values can be checked. */
function reads(text: string): boolean {
  try {
    valueAt(text, []);
    return true;
  } catch {
    return false;
  }
}

/** Split `op` against the room's `current` text: what still finds the value it replaced, and what is set aside. */
export function settleFileOp(
  current: string | null,
  op: FileOp,
  baseOf?: BaseOf,
): { apply: FileOp | null; aside: SetAside[] } {
  if (op.kind !== "k7x") {
    const target = op.kind === "text" ? op.text : null;
    if (op.was === undefined || current === target)
      return { apply: op, aside: [] };
    const now = current === null ? null : textHash(current);
    if (now === op.was) return { apply: op, aside: [] };
    const merged = op.kind === "text" ? settleText(current, op, baseOf) : null;
    return merged
      ? { apply: merged, aside: [] }
      : { apply: null, aside: [{ op }] };
  }
  const one = (o: K7xOp): FileOp => ({ ...op, ops: [o] });
  if (current === null || !reads(current))
    return { apply: null, aside: op.ops.map((o) => ({ op: one(o) })) };
  const keep: K7xOp[] = [];
  const aside: SetAside[] = [];
  for (const o of op.ops) {
    if (o.was === undefined) {
      keep.push(o);
      continue;
    }
    const now = valueAt(current, o.path);
    // Already what the op makes it: nothing to apply, and nothing lost.
    if (now === (o.op === "set" ? o.k7x : null)) continue;
    // An edit inside a list item someone removed has nothing to land on.
    if (now === o.was && !goneAt(current, o.path)) keep.push(o);
    else aside.push({ op: one(o), kept: now });
  }
  return { apply: keep.length ? { ...op, ops: keep } : null, aside };
}
