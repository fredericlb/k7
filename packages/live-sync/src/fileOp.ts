// fileOp.ts — one file's change, from its text before and after, as the op a replica replays.
// Path ops are sent only when replaying them reproduces `after` byte for byte; otherwise the whole text.
// Every op names what it replaced (`was`), so the room can set aside one that arrives after the value moved.

import { applyK7x, diffK7x, goneAt, valueAt as k7xValueAt } from "./k7xOps.ts";
import { locate } from "./listKeys.ts";
import { type Conflict, type FileOp, NeedsUpdate, type PathOp } from "./ops.ts";
import { textHash } from "./textHash.ts";
import { mergeable, mergeTexts } from "./textMerge.ts";
import { applyYaml, diffYamlParsed, parse, valueAt } from "./yamlOps.ts";

export { textHash };

const isYaml = (file: string): boolean => /\.ya?ml$/i.test(file);
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
  if (before !== null && isYaml(file))
    for (const lists of [true, false]) {
      const diff = diffYamlParsed(before, after, lists);
      if (diff?.ops.length && replays(before, diff, after))
        return { kind: "yaml", file, ops: diff.ops };
      if (!diff?.keyed) break;
    }
  if (before !== null && isK7x(file))
    for (const lists of [true, false]) {
      const diff = diffK7x(before, after, lists);
      if (diff?.ops.length && replaysK7x(before, diff.ops, after))
        return { kind: "k7x", file, ops: diff.ops };
      if (!diff?.keyed) break;
    }
  if (beforeHash === textHash(after)) return null;
  return { kind: "text", file, text: after, was: beforeHash };
}

function replays(
  before: string,
  diff: NonNullable<ReturnType<typeof diffYamlParsed>>,
  after: string,
): boolean {
  try {
    return applyYaml(before, diff.ops, diff.parsed) === after;
  } catch {
    return false;
  }
}

function replaysK7x(
  before: string,
  ops: Parameters<typeof applyK7x>[1],
  after: string,
): boolean {
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
    case "yaml":
    case "k7x":
      if (current === null)
        throw new Error(`${op.file}: ${op.kind} ops on a missing file`);
      return op.kind === "k7x"
        ? applyK7x(current, op.ops)
        : applyYaml(current, op.ops);
    default:
      throw new NeedsUpdate(
        `${(op as { file?: unknown }).file}: op kind "${(op as { kind?: unknown }).kind}" unknown here: update k7`,
      );
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

/** Split `op` against the room's `current` text: what still finds the value it replaced, and what is set aside. */
export function settleFileOp(
  current: string | null,
  op: FileOp,
  baseOf?: BaseOf,
): { apply: FileOp | null; aside: SetAside[] } {
  if (op.kind !== "yaml" && op.kind !== "k7x") {
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
  const one = (o: PathOp): FileOp => ({ ...op, ops: [o] }) as FileOp;
  const reader = current === null ? null : pathReader(op.kind, current);
  if (current === null || !reader)
    return {
      apply: null,
      aside: (op.ops as PathOp[]).map((o) => ({ op: one(o) })),
    };
  const keep: PathOp[] = [];
  const aside: SetAside[] = [];
  for (const o of op.ops as PathOp[]) {
    if (o.was === undefined) {
      keep.push(o);
      continue;
    }
    const now = reader.valueAt(o.path);
    // Already what the op makes it: nothing to apply, and nothing lost.
    if (now === (o.op === "set" ? ("k7x" in o ? o.k7x : o.yaml) : null))
      continue;
    // An edit inside a list item someone removed has nothing to land on.
    if (now === o.was && !reader.gone(o.path)) keep.push(o);
    else aside.push({ op: one(o), kept: now });
  }
  return {
    apply: keep.length ? ({ ...op, ops: keep } as FileOp) : null,
    aside,
  };
}

/** How settleFileOp reads values in the current text, by format; null when the text does not read. */
function pathReader(
  kind: "yaml" | "k7x",
  current: string,
): {
  valueAt: (path: string[]) => string | null;
  gone: (path: string[]) => boolean;
} | null {
  if (kind === "k7x") {
    try {
      k7xValueAt(current, []);
    } catch {
      return null;
    }
    return {
      valueAt: (path) => k7xValueAt(current, path),
      gone: (path) => goneAt(current, path),
    };
  }
  const doc = parse(current);
  if (doc.errors.length) return null;
  return {
    valueAt: (path) => valueAt(doc, current, path),
    gone: (path) => locate(doc, path).gone,
  };
}
