// fileOp.ts — one file's change, from its text before and after, as the op a replica replays.
// Path ops are sent only when replaying them reproduces `after` byte for byte; otherwise the whole text.
// Every op names what it replaced (`was`), so the room can set aside one that arrives after the value moved.

import type { Conflict, FileOp, YamlOp } from "./ops.ts";
import { applyYaml, diffYamlParsed, parse, valueAt } from "./yamlOps.ts";

const isYaml = (file: string): boolean => /\.ya?ml$/i.test(file);

/** A 53-bit hash of a text, as hex; pure JS, so the room computes the same one a capture did. */
export function textHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

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
  if (before !== null && isYaml(file)) {
    const diff = diffYamlParsed(before, after);
    if (diff?.ops.length && replays(before, diff, after))
      return { kind: "yaml", file, ops: diff.ops };
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

/** Split `op` against the room's `current` text: what still finds the value it replaced, and what is set aside. */
export function settleFileOp(
  current: string | null,
  op: FileOp,
): { apply: FileOp | null; aside: SetAside[] } {
  if (op.kind !== "yaml") {
    const target = op.kind === "text" ? op.text : null;
    if (op.was === undefined || current === target)
      return { apply: op, aside: [] };
    const now = current === null ? null : textHash(current);
    return now === op.was
      ? { apply: op, aside: [] }
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
    if (now === o.was) keep.push(o);
    else aside.push({ op: one(o), kept: now });
  }
  return { apply: keep.length ? { ...op, ops: keep } : null, aside };
}
