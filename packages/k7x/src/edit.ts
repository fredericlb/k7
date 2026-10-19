// edit.ts — a k7x file as a document whose values are set, added, moved and deleted by key path, every other byte kept.
// The contract every writer relies on: a knob drag is a one-line diff and a comment survives every edit (write.ts, remove.ts).

import { applyData } from "./applyData.ts";
import {
  indexOf,
  type K7ListNode,
  type K7MapNode,
  type K7Node,
  type K7Path,
  nodeAt,
  toJS,
} from "./ast.ts";
import { BOM, type Host, headBlank, readHeader, tailEnd } from "./layout.ts";
import { nativeData } from "./native.ts";
import { K7SyntaxError, lineCol, parseTree, parseValue } from "./parse.ts";
import {
  fromJS,
  headerText,
  type PNode,
  printKey,
  stringify,
} from "./print.ts";
import { prune, removeAt } from "./remove.ts";
import { K7Scope } from "./scope.ts";
import { holds, insertAt, writeAt } from "./write.ts";

export { K7Scope };

/** How a written value is laid out: `inline` keeps it on one line whatever its width. */
export interface WriteOptions {
  inline?: boolean;
}

/** One splice, in the coordinates of the text as it was just before it. */
export interface K7Change {
  start: number;
  end: number;
  insert: string;
}

const leafOf = (value: unknown, opts?: WriteOptions): PNode => {
  const node = fromJS(value);
  return opts?.inline ? { ...node, inline: true } : node;
};
const rawLeaf = (source: string): PNode => {
  const node = parseValue(source);
  if (/\/\/[^\n]*$/.test(source.slice(node.end)))
    throw new Error(
      "k7x: source ending in a // comment would swallow what follows it",
    );
  return { kind: "scalar", value: null, raw: source };
};

export class K7Document {
  text: string;
  contents: K7MapNode | null = null;
  errors: K7SyntaxError[] = [];
  /** Every splice applied since construction, in order: what an editor dispatches to keep its undo history. */
  readonly changes: K7Change[] = [];
  private readonly host: Host = {
    text: () => this.text,
    root: () => this.root(),
    splice: (start, end, insert) => this.splice(start, end, insert),
  };

  constructor(text: string) {
    this.text = text;
    this.reparse();
  }

  private reparse(): void {
    try {
      this.contents = parseTree(this.text);
      this.errors = [];
    } catch (e) {
      if (!(e instanceof K7SyntaxError)) throw e;
      this.contents = null;
      this.errors = [e];
    }
  }

  private root(): K7MapNode {
    if (!this.contents) throw this.errors[0];
    return this.contents;
  }

  toString(): string {
    return this.text;
  }

  toJS(): Record<string, unknown> {
    return toJS(this.root()) as Record<string, unknown>;
  }

  getNode(path: K7Path): K7Node | undefined {
    return nodeAt(this.root(), path);
  }

  getIn(path: K7Path): unknown {
    const node = this.getNode(path);
    return node === undefined ? undefined : toJS(node);
  }

  hasIn(path: K7Path): boolean {
    return this.getNode(path) !== undefined;
  }

  /** The exact source of the node at a path; an empty call's flag, `key()`, has none and gives "". */
  getSource(path: K7Path): string | undefined {
    const node = this.getNode(path);
    return node && this.text.slice(node.start, node.end);
  }

  /** Where a path is written: a map entry's key, else the node's first character. */
  positionOf(path: K7Path): { line: number; col: number } | undefined {
    const parent = path.length > 0 ? this.getNode(path.slice(0, -1)) : null;
    const entry =
      parent?.kind === "map"
        ? parent.entries.find((e) => e.key === path[path.length - 1])
        : undefined;
    const at = entry?.keyStart ?? this.getNode(path)?.start;
    return at === undefined ? undefined : lineCol(this.text, at);
  }

  /** A view whose every path is relative to `base`. */
  at(base: K7Path): K7Scope {
    return new K7Scope(this, base);
  }

  /** Sets the value at a path, creating the maps on the way; a value equal to the one there changes nothing. */
  setIn(path: K7Path, value: unknown, opts?: WriteOptions): void {
    if (path.length === 0) {
      this.splice(0, this.text.length, stringify(value));
      return;
    }
    writeAt(this.host, path, leafOf(value, opts), (n) => holds(n, value));
  }

  /** Sets (or creates) the value at a path as k7x source, which must read as one value; throws when it does not. */
  setSourceIn(path: K7Path, source: string): void {
    if (path.length === 0) {
      parseTree(source);
      this.splice(0, this.text.length, source);
      return;
    }
    const same = (n: K7Node) => this.text.slice(n.start, n.end) === source;
    writeAt(this.host, path, rawLeaf(source), same);
  }

  /** Appends to the list at a path, creating it when it is missing. */
  addIn(path: K7Path, value: unknown, opts?: WriteOptions): void {
    const node = this.getNode(path);
    if (node === undefined) {
      this.setIn(path, [value], opts);
      return;
    }
    if (node.kind !== "list")
      throw new Error(`k7x: ${path.join(".")} is not a list`);
    this.setIn([...path, node.items.length], value, opts);
  }

  /** Replaces the value at a path with `source` as written, k7x text that must read back; throws when nothing is there. */
  replaceSource(path: K7Path, source: string): void {
    const node = this.getNode(path);
    if (node === undefined || path.length === 0)
      throw new Error(`k7x: no value at ${path.join(".")} to replace`);
    this.splice(node.start, node.end, source);
  }

  /** Inserts into the list at a path before item `index`, on a line of its own when that item has one. */
  insertIn(
    path: K7Path,
    index: number,
    value: unknown,
    opts?: WriteOptions,
  ): void {
    const get = (p: K7Path) => this.getNode(p);
    insertAt(this.host, path, index, leafOf(value, opts), get);
  }

  /** Inserts k7x source into the list at a path before item `index`; throws when it does not read as one value. */
  insertSourceIn(path: K7Path, index: number, source: string): void {
    const get = (p: K7Path) => this.getNode(p);
    insertAt(this.host, path, index, rawLeaf(source), get);
  }

  /** Moves a list item so it ends up at index `to`, its source kept as written. */
  moveIn(path: K7Path, from: number, to: number): void {
    const list = this.getNode(path);
    if (list?.kind !== "list")
      throw new Error(`k7x: ${path.join(".")} is not a list`);
    const n = list.items.length;
    const ok = (i: number) => Number.isInteger(i) && i >= 0 && i < n;
    if (!ok(from) || !ok(to))
      throw new Error(`k7x: no move from ${from} to ${to} in ${n} items`);
    if (from === to) return;
    const sources = list.items.map((i) => this.text.slice(i.start, i.end));
    if (list.form === "args") {
      const [item] = sources.splice(from, 1);
      sources.splice(to, 0, item);
      this.splice(list.start, list.end, sources.join(", "));
      return;
    }
    const note = this.lineComment(list.items[from]);
    this.deleteIn([...path, from]);
    this.insertSourceIn(path, to, sources[from]);
    const moved = (this.getNode(path) as K7ListNode).items[to];
    if (note && this.lineComment(moved) === "") {
      const at =
        moved.end +
        (/^[ \t]*,?/.exec(this.text.slice(moved.end))?.[0].length ?? 0);
      this.splice(at, at, ` ${note}`);
    }
  }

  /** The `//` comment ending an item's line when the item has that line to itself: "" for none, null when it shares it. */
  private lineComment(item: K7Node): string | null {
    const t = this.text;
    const tail = tailEnd(t, item.end, true);
    if (tail === null || !headBlank(t, item.start)) return null;
    return /\/\/[^\n]*/.exec(t.slice(item.end, tail))?.[0].trimEnd() ?? "";
  }

  /** Renames the entry at a path, its value, comments and place kept; throws when the map already has `newKey`. */
  renameKey(path: K7Path, newKey: string): void {
    const parent = path.length > 0 ? this.getNode(path.slice(0, -1)) : null;
    const key = path[path.length - 1];
    const entry =
      parent?.kind === "map"
        ? parent.entries.find((e) => e.key === key)
        : undefined;
    if (parent?.kind !== "map" || !entry)
      throw new Error(`k7x: no entry at ${path.join(".")} to rename`);
    if (key === newKey) return;
    if (parent.entries.some((e) => e.key === newKey))
      throw new Error(`k7x: ${newKey} is already a key there`);
    this.splice(entry.keyStart, entry.keyEnd, printKey(newKey));
  }

  /** Makes the data at a path equal `value` with the fewest edits; [] is the whole file. */
  applyIn(path: K7Path, value: unknown): void {
    applyData(this, this.getIn(path), value, path);
  }

  /** Removes the entry or item at a path; `prune` also removes the maps that leaves empty, up to a list or the root. */
  deleteIn(path: K7Path, opts?: { prune?: boolean }): boolean {
    if (path.length === 0) return false;
    const parent = this.getNode(path.slice(0, -1));
    if (parent === undefined) return false;
    const seg = path[path.length - 1];
    const at = parent.kind === "list" ? (indexOf(seg) ?? seg) : seg;
    if (!removeAt(this.host, parent, at)) return false;
    if (opts?.prune) prune(this.host, path, (p) => this.getNode(p));
    return true;
  }

  /** The `//` lines the file starts with, each without `//` and one space. */
  get header(): string[] {
    return readHeader(this.text).lines;
  }

  /** Replaces the file's header with these lines; an empty array removes it. */
  setHeader(lines: readonly string[]): void {
    const { lines: old, end } = readHeader(this.text);
    const top = headerText(lines);
    if (headerText(old) === top) return;
    const start = this.text.startsWith(BOM) ? 1 : 0;
    const nl =
      end === this.text.length && end > start && !this.text.endsWith("\n");
    this.splice(start, end, nl ? top.slice(0, -1) : top);
  }

  private splice(start: number, end: number, insert: string): void {
    const before = this.text;
    if (insert === before.slice(start, end)) return;
    this.text = before.slice(0, start) + insert + before.slice(end);
    this.reparse();
    if (this.contents) {
      this.changes.push({ start, end, insert });
      return;
    }
    const err = this.errors[0];
    this.text = before;
    this.reparse();
    throw new Error(`k7x: an edit produced unreadable text (${err.message})`);
  }
}

export const parseDocument = (text: string): K7Document => new K7Document(text);

/** The plain value of a whole file, from the Rust reader where this runtime has one; throws K7SyntaxError. */
export const parse = (text: string): Record<string, unknown> =>
  nativeData(text) ?? (toJS(parseTree(text)) as Record<string, unknown>);
