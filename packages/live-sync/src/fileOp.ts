// fileOp.ts — one file's change, from its text before and after, as the op a replica replays.
// Path ops are sent only when replaying them reproduces `after` byte for byte; otherwise the whole text.
// Every op names what it replaced (`was`), so the room can set aside one that arrives after the value moved.

import { locate } from "./listKeys.ts";
import type { Conflict, FileOp, YamlOp } from "./ops.ts";
import { textHash } from "./textHash.ts";
import { mergeable, mergeTexts } from "./textMerge.ts";
import { applyYaml, diffYamlParsed, parse, valueAt } from "./yamlOps.ts";

export { textHash };

const isYaml = (file: string): boolean => /\.ya?ml$/i.test(file);

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

/** `current` (null = absent) after `op`; a yaml op on a file that is gone or unparseable throws. */
export function applyFileOp(current: string | null, op: FileOp): string | null {
  if (op.kind === "remove") return null;
  if (op.kind === "text") return op.text;
  if (current === null)
    throw new Error(`${op.file}: yaml ops on a missing file`);
  return applyYaml(current, op.ops);
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
  if (op.kind !== "yaml") {
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
  const one = (o: YamlOp): FileOp => ({
    kind: "yaml",
    file: op.file,
    ops: [o],
  });
  const doc = current === null ? null : parse(current);
  if (current === null || !doc || doc.errors.length)
    return { apply: null, aside: op.ops.map((o) => ({ op: one(o) })) };
  const keep: YamlOp[] = [];
  const aside: SetAside[] = [];
  for (const o of op.ops) {
    if (o.was === undefined) {
      keep.push(o);
      continue;
    }
    const now = valueAt(doc, current, o.path);
    // Already what the op makes it: nothing to apply, and nothing lost.
    if (now === (o.op === "set" ? o.yaml : null)) continue;
    // An edit inside a list item someone removed has nothing to land on.
    if (now === o.was && !locate(doc, o.path).gone) keep.push(o);
    else aside.push({ op: one(o), kept: now });
  }
  return { apply: keep.length ? { ...op, ops: keep } : null, aside };
}
