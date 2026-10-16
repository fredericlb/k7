// ast.ts — the tree a k7x file parses to: every node carries its source span, so an edit can rewrite one value only.
// A reader would get wrong that a chain and an object are different data: both are maps, the form is only how it was written.

export type K7Scalar = string | number | boolean | null;

export interface K7ScalarNode {
  kind: "scalar";
  value: K7Scalar;
  start: number;
  end: number;
}

export interface K7ListNode {
  kind: "list";
  items: K7Node[];
  /** `brackets` is `[a, b]`; `args` is a call's own argument list, `key(a, b)`. */
  form: "brackets" | "args";
  start: number;
  end: number;
}

export interface K7Entry {
  key: string;
  value: K7Node;
  /** From the key (or the `.` before it, in a chain) to the end of the value (or the `)` of the call). */
  start: number;
  end: number;
  /** Offset of the `.` that introduces a chained call; null for a chain's head and for an object entry. */
  dot: number | null;
  keyStart: number;
}

export interface K7MapNode {
  kind: "map";
  entries: K7Entry[];
  /** `root` is the file itself, `chain` is `a(1).b(2)`, `object` is `{ a: 1 }`. */
  form: "root" | "chain" | "object";
  /** For the root, each statement's entries as [first, end) indices: a statement is one chain. */
  groups: [number, number][];
  start: number;
  end: number;
}

export type K7Node = K7ScalarNode | K7ListNode | K7MapNode;
export type K7Path = readonly (string | number)[];

export const isMap = (n: unknown): n is K7MapNode =>
  (n as K7Node | undefined)?.kind === "map";
export const isScalar = (n: unknown): n is K7ScalarNode =>
  (n as K7Node | undefined)?.kind === "scalar";

/** The plain value a node stands for: what zod reads, exactly as YAML's toJS would give it. */
export function toJS(node: K7Node): unknown {
  if (node.kind === "scalar") return node.value;
  if (node.kind === "list") return node.items.map(toJS);
  const out: Record<string, unknown> = {};
  for (const e of node.entries)
    Object.defineProperty(out, e.key, {
      value: toJS(e.value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return out;
}

/** The node at a path, or undefined: a string segment names a map entry, a number a list item. */
export function nodeAt(root: K7Node, path: K7Path): K7Node | undefined {
  let node: K7Node | undefined = root;
  for (const seg of path) {
    if (node?.kind === "map" && typeof seg === "string")
      node = node.entries.find((e) => e.key === seg)?.value;
    else if (node?.kind === "list" && typeof seg === "number")
      node = node.items[seg];
    else return undefined;
  }
  return node;
}
