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
  /** Just past the key's source, quotes included. */
  keyEnd: number;
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

/** The plain value a node stands for: what zod reads: plain objects, arrays and scalars. */
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

/** A list index from a path segment: a number, or a string of digits ("2" is 2); else undefined. */
export function indexOf(seg: string | number): number | undefined {
  if (typeof seg === "number") return seg;
  return /^(?:0|[1-9]\d*)$/.test(seg) ? Number(seg) : undefined;
}

/** A node's child at one path segment: a map entry's value by key, a list item by index. */
export function childAt(
  node: K7Node,
  seg: string | number,
): K7Node | undefined {
  if (node.kind === "map")
    return typeof seg === "string"
      ? node.entries.find((e) => e.key === seg)?.value
      : undefined;
  if (node.kind === "list") {
    const i = indexOf(seg);
    return i === undefined ? undefined : node.items[i];
  }
  return undefined;
}

/** The node at a path, or undefined: a string segment names a map entry, a number (or a string of digits) a list item. */
export function nodeAt(root: K7Node, path: K7Path): K7Node | undefined {
  let node: K7Node | undefined = root;
  for (const seg of path) {
    if (node === undefined) return undefined;
    node = childAt(node, seg);
  }
  return node;
}

/** Visits every node depth-first, parents first; `visit` returning false skips that node's children. */
export function walk(
  root: K7Node,
  // biome-ignore lint/suspicious/noConfusingVoidType: a visitor that returns nothing must type-check, and false is its one signal.
  visit: (node: K7Node, path: K7Path, entry?: K7Entry) => void | false,
): void {
  const go = (node: K7Node, path: K7Path, entry?: K7Entry): void => {
    if (visit(node, path, entry) === false) return;
    if (node.kind === "list")
      for (let i = 0; i < node.items.length; i++)
        go(node.items[i], [...path, i]);
    else if (node.kind === "map")
      for (const e of node.entries) go(e.value, [...path, e.key], e);
  };
  go(root, []);
}
