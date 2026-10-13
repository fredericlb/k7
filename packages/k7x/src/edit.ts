// edit.ts — a k7x file as a document whose values are set, added and deleted by key path, every other byte kept.
// The contract song's YAML writers rely on: a knob drag is a one-line diff and a comment survives every edit.

import {
  type K7Entry,
  type K7MapNode,
  type K7Node,
  type K7Path,
  nodeAt,
  toJS,
} from "./ast.ts";
import { K7SyntaxError, parseTree } from "./parse.ts";
import { type Ctx, fromJS, print, printKey, stringify } from "./print.ts";

const pad = (n: number): string => " ".repeat(n);

export class K7Document {
  text: string;
  contents: K7MapNode | null = null;
  errors: K7SyntaxError[] = [];

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

  /** Sets the value at a path, creating the maps on the way; a value equal to the one there changes nothing. */
  setIn(path: K7Path, value: unknown): void {
    if (path.length === 0) {
      this.text = stringify(value);
      this.reparse();
      return;
    }
    let node: K7Node = this.root();
    let ctx: Ctx = "entry";
    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      const child = childOf(node, seg);
      if (child === undefined) {
        this.insert(node, ctx, seg, nest(path.slice(i + 1), value));
        return;
      }
      if (i === path.length - 1) {
        this.replace(node, child, value);
        return;
      }
      if (child.kind === "scalar")
        throw new Error(
          `k7x: ${path.slice(0, i + 1).join(".")} is not a collection`,
        );
      ctx = node.kind === "list" ? "item" : "entry";
      node = child;
    }
  }

  /** Appends to the list at a path, creating it when it is missing. */
  addIn(path: K7Path, value: unknown): void {
    const node = this.getNode(path);
    if (node === undefined) {
      this.setIn(path, [value]);
      return;
    }
    if (node.kind !== "list")
      throw new Error(`k7x: ${path.join(".")} is not a list`);
    this.setIn([...path, node.items.length], value);
  }

  /** Replaces the value at a path with `source` as written, k7x text that must read back; throws when nothing is there. */
  replaceSource(path: K7Path, source: string): void {
    const node = this.getNode(path);
    if (node === undefined || path.length === 0)
      throw new Error(`k7x: no value at ${path.join(".")} to replace`);
    this.splice(node.start, node.end, source);
  }

  /** Inserts into the list at a path before item `index`, on a line of its own when that item has one. */
  insertIn(path: K7Path, index: number, value: unknown): void {
    const node = this.getNode(path);
    if (node?.kind !== "list")
      throw new Error(`k7x: ${path.join(".")} is not a list`);
    if (index >= node.items.length) {
      this.setIn([...path, node.items.length], value);
      return;
    }
    const t = this.text;
    const at = node.items[index].start;
    const ind = indentOf(t, at);
    if (node.form === "brackets" && headBlank(t, at)) {
      const text = print(fromJS(value), ind, "item", ind).text;
      this.splice(at, at, `${text},\n${pad(ind)}`);
      return;
    }
    const used = at - lineStart(t, at);
    this.splice(at, at, `${print(fromJS(value), ind, "item", used).text}, `);
  }

  /** Removes the entry or item at a path; false when there was nothing there. */
  deleteIn(path: K7Path): boolean {
    const parent = this.getNode(path.slice(0, -1));
    const seg = path[path.length - 1];
    if (parent === undefined || childOf(parent, seg) === undefined)
      return false;
    if (parent.kind === "list") {
      const i = seg as number;
      if (parent.form === "args" && parent.items.length <= 2) {
        const rest = (toJS(parent) as unknown[]).filter((_, j) => j !== i);
        this.splice(
          parent.start,
          parent.end,
          print(fromJS(rest), 0, "entry", 0).text,
        );
      } else this.removeListed(parent.items, i);
      return true;
    }
    if (parent.kind !== "map") return false;
    const i = parent.entries.findIndex((e) => e.key === seg);
    if (parent.form === "object") this.removeListed(parent.entries, i);
    else if (parent.form === "chain" && parent.entries.length === 1)
      this.splice(parent.start, parent.end, "{}");
    else {
      const [a, b] = parent.groups.find(([s, e]) => i >= s && i < e) ?? [
        0,
        parent.entries.length,
      ];
      this.removeChained(parent.entries.slice(a, b), i - a);
    }
    return true;
  }

  private splice(start: number, end: number, insert: string): void {
    const before = this.text;
    this.text = before.slice(0, start) + insert + before.slice(end);
    this.reparse();
    if (this.contents) return;
    const err = this.errors[0];
    this.text = before;
    this.reparse();
    throw new Error(`k7x: an edit produced unreadable text (${err.message})`);
  }

  private replace(parent: K7Node, child: K7Node, value: unknown): void {
    if (sameValue(toJS(child), value)) return;
    const asArgs =
      child.kind === "list" &&
      child.form === "args" &&
      Array.isArray(value) &&
      value.length >= 2;
    const ctx: Ctx = asArgs
      ? "args"
      : parent.kind === "list"
        ? "item"
        : "entry";
    const used = child.start - lineStart(this.text, child.start);
    const out = print(
      fromJS(value),
      indentOf(this.text, child.start),
      ctx,
      used,
    );
    this.splice(child.start, child.end, out.text);
  }

  private insert(
    parent: K7Node,
    ctx: Ctx,
    seg: string | number,
    value: unknown,
  ): void {
    const t = this.text;
    if (parent.kind === "scalar")
      throw new Error("k7x: cannot insert into a scalar");
    if (parent.kind === "list") {
      if (seg !== parent.items.length)
        throw new Error(`k7x: no item ${seg} to set`);
      if (parent.items.length === 0) {
        this.splice(
          parent.start,
          parent.end,
          print(fromJS([value]), indentOf(t, parent.start), ctx, 0).text,
        );
        return;
      }
      if (parent.form === "args") {
        const last = parent.items[parent.items.length - 1];
        this.splice(
          last.end,
          last.end,
          `, ${print(fromJS(value), indentOf(t, last.end), "item", 0).text}`,
        );
        return;
      }
      this.appendListed(
        parent,
        parent.items,
        (ind, used) => print(fromJS(value), ind, "item", used).text,
      );
      return;
    }
    const key = String(seg);
    const entries = parent.entries;
    if (parent.form === "object") {
      if (entries.length === 0) {
        const whole = fromJS({ [key]: value });
        this.splice(
          parent.start,
          parent.end,
          print(whole, indentOf(t, parent.start), ctx, 0).text,
        );
        return;
      }
      const head = `${printKey(key)}: `;
      this.appendListed(
        parent,
        entries,
        (ind, used) =>
          head + print(fromJS(value), ind, "entry", used + head.length).text,
      );
      return;
    }
    const last = entries[entries.length - 1];
    if (parent.form === "root") {
      const head = `${printKey(key)}(`;
      const line = `${head}${print(fromJS(value), 0, "entry", head.length).text})`;
      if (!last) {
        this.splice(
          t.length,
          t.length,
          `${t === "" || t.endsWith("\n") ? "" : "\n"}${line}\n`,
        );
        return;
      }
      const at = tailEnd(t, last.end) ?? last.end;
      this.splice(at, at, `\n${line}`);
      return;
    }
    const broken = entries.some((e) => e.dot !== null && headBlank(t, e.dot));
    if (!broken) {
      const head = `.${printKey(key)}(`;
      const used = last.end - lineStart(t, last.end) + head.length;
      this.splice(
        last.end,
        last.end,
        `${head}${print(fromJS(value), indentOf(t, last.end), "entry", used).text})`,
      );
      return;
    }
    const ind =
      last.dot !== null && headBlank(t, last.dot)
        ? indentOf(t, last.dot)
        : indentOf(t, parent.start) + 2;
    const head = `.${printKey(key)}(`;
    const at = tailEnd(t, last.end) ?? last.end;
    this.splice(
      at,
      at,
      `\n${pad(ind)}${head}${print(fromJS(value), ind, "entry", ind + head.length).text})`,
    );
  }

  /** Appends to a bracketed list or an object, on a line of its own when the closing bracket has one. */
  private appendListed(
    node: K7Node,
    items: { start: number; end: number }[],
    text: (indent: number, used: number) => string,
  ): void {
    const t = this.text;
    const last = items[items.length - 1];
    const close = node.end - 1;
    if (!t.slice(last.end, close).includes("\n") || !headBlank(t, close)) {
      const used = last.end - lineStart(t, last.end) + 2;
      this.splice(last.end, last.end, `, ${text(indentOf(t, last.end), used)}`);
      return;
    }
    const ind = headBlank(t, last.start)
      ? indentOf(t, last.start)
      : indentOf(t, node.start) + 2;
    const line = `${pad(ind)}${text(ind, ind)},\n`;
    const comma = t.slice(last.end).match(/^[ \t]*,/) !== null;
    const at = lineStart(t, close);
    this.text = t.slice(0, at) + line + t.slice(at);
    this.splice(last.end, last.end, comma ? "" : ",");
  }

  /** Removes one item or object entry with its comma; a whole line when it had one to itself. */
  private removeListed(
    items: { start: number; end: number }[],
    i: number,
  ): void {
    const t = this.text;
    const e = items[i];
    const tail = tailEnd(t, e.end, true);
    if (headBlank(t, e.start) && tail !== null) {
      this.splice(lineStart(t, e.start), Math.min(tail + 1, t.length), "");
      return;
    }
    if (i < items.length - 1) {
      this.splice(e.start, items[i + 1].start, "");
      return;
    }
    if (i > 0) {
      this.splice(items[i - 1].end, e.end, "");
      return;
    }
    const comma = t.slice(e.end).match(/^[ \t]*,/);
    this.splice(e.start, e.end + (comma ? comma[0].length : 0), "");
  }

  /** Removes one call of a chain: its line when it had one, the call and its dot otherwise. */
  private removeChained(group: K7Entry[], i: number): void {
    const t = this.text;
    const e = group[i];
    const tail = tailEnd(t, e.end);
    if (group.length === 1) {
      if (headBlank(t, e.start) && tail !== null) {
        this.splice(lineStart(t, e.start), Math.min(tail + 1, t.length), "");
        return;
      }
      this.splice(e.start, e.end, "");
      return;
    }
    if (i === 0) {
      this.splice(e.start, group[1].keyStart, "");
      return;
    }
    if (e.dot !== null && headBlank(t, e.dot) && tail !== null) {
      this.splice(lineStart(t, e.dot), Math.min(tail + 1, t.length), "");
      return;
    }
    this.splice(e.start, e.end, "");
  }
}

function childOf(node: K7Node, seg: string | number): K7Node | undefined {
  if (node.kind === "map" && typeof seg === "string")
    return node.entries.find((e) => e.key === seg)?.value;
  if (node.kind === "list" && typeof seg === "number") return node.items[seg];
  return undefined;
}

function nest(rest: K7Path, value: unknown): unknown {
  return rest.reduceRight<unknown>((v, seg) => {
    if (typeof seg === "string") return { [seg]: v };
    if (seg === 0) return [v];
    throw new Error(`k7x: no item ${seg} to create`);
  }, value);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b) && typeof a === typeof b;
}

const lineStart = (t: string, pos: number): number =>
  t.lastIndexOf("\n", pos - 1) + 1;
const headBlank = (t: string, pos: number): boolean =>
  /^[ \t]*$/.test(t.slice(lineStart(t, pos), pos));
const indentOf = (t: string, pos: number): number =>
  /^[ \t]*/.exec(t.slice(lineStart(t, pos)))?.[0].length ?? 0;

/** The offset of the newline ending the line after `pos`, when only blanks, a comma (if allowed) and a comment follow; else null. */
function tailEnd(t: string, pos: number, comma = false): number | null {
  const m = (
    comma
      ? /^[ \t]*,?[ \t\r]*(\/\/[^\n]*)?(\n|$)/
      : /^[ \t\r]*(\/\/[^\n]*)?(\n|$)/
  ).exec(t.slice(pos));
  if (!m) return null;
  return pos + m[0].length - m[m.length - 1].length;
}

export const parseDocument = (text: string): K7Document => new K7Document(text);

/** The plain value of a whole file; throws K7SyntaxError. */
export const parse = (text: string): Record<string, unknown> =>
  toJS(parseTree(text)) as Record<string, unknown>;
