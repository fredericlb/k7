// remove.ts — deleting an entry or a list item: its whole line when it had one to itself, else just it and its separator.
// A reader would get wrong what a chain's last call leaves: `{}`, since a value cannot be written as nothing.

import {
  childAt,
  indexOf,
  type K7Entry,
  type K7Node,
  type K7Path,
  toJS,
} from "./ast.ts";
import { type Host, headBlank, lineStart, tailEnd } from "./layout.ts";
import { fromJS, print } from "./print.ts";

/** Removes `parent`'s entry or item at `seg`; false when there was nothing there. */
export function removeAt(
  h: Host,
  parent: K7Node,
  seg: string | number,
): boolean {
  if (childAt(parent, seg) === undefined) return false;
  if (parent.kind === "list") {
    const i = indexOf(seg) as number;
    if (parent.form === "args" && parent.items.length <= 2) {
      const rest = (toJS(parent) as unknown[]).filter((_, j) => j !== i);
      const text = print(fromJS(rest), 0, "entry", 0).text;
      h.splice(parent.start, parent.end, text);
    } else emptied(h, parent, () => removeListed(h, parent.items, i));
    return true;
  }
  if (parent.kind !== "map") return false;
  const i = parent.entries.findIndex((e) => e.key === seg);
  if (parent.form === "object")
    emptied(h, parent, () => removeListed(h, parent.entries, i));
  else if (parent.form === "chain" && parent.entries.length === 1)
    h.splice(parent.start, parent.end, "{}");
  else {
    const [a, b] = parent.groups.find(([s, e]) => i >= s && i < e) ?? [
      0,
      parent.entries.length,
    ];
    removeChained(h, parent.entries.slice(a, b), i - a);
  }
  return true;
}

/** Runs a removal from a list or an object, then writes it `[]` or `{}` when that left only blanks between its brackets. */
function emptied(h: Host, node: K7Node, remove: () => void): void {
  const size =
    node.kind === "list"
      ? node.items.length
      : node.kind === "map"
        ? node.entries.length
        : 0;
  const before = h.text().length;
  remove();
  if (size !== 1) return;
  const t = h.text();
  const end = node.end + t.length - before;
  if (t.slice(node.start + 1, end - 1).trim() !== "") return;
  h.splice(node.start, end, node.kind === "list" ? "[]" : "{}");
}

/** After a deletion at `path`, removes each ancestor map it left empty, up to a list item or the root. */
export function prune(
  h: Host,
  path: K7Path,
  getNode: (path: K7Path) => K7Node | undefined,
): void {
  for (let n = path.length - 1; n >= 1; n--) {
    const node = getNode(path.slice(0, n));
    const parent = getNode(path.slice(0, n - 1));
    if (node?.kind !== "map" || node.entries.length > 0) return;
    if (parent?.kind !== "map") return;
    removeAt(h, parent, path[n - 1]);
  }
}

/** Removes one item or object entry with its comma; a whole line when it had one to itself. */
function removeListed(
  h: Host,
  items: { start: number; end: number }[],
  i: number,
): void {
  const t = h.text();
  const e = items[i];
  const tail = tailEnd(t, e.end, true);
  if (headBlank(t, e.start) && tail !== null) {
    const next = /^[ \t]*,/.test(t.slice(e.end)) ? -1 : commaAfter(t, e.end);
    // Written comma-first, the separator is on a later line: it goes too, and what sits before it stays.
    const keep = next < 0 ? "" : t.slice(tail + 1, next);
    const end = next < 0 ? Math.min(tail + 1, t.length) : pastComma(t, next);
    h.splice(lineStart(t, e.start), end, keep);
    return;
  }
  const oneLine = (a: number, b: number) => !t.slice(a, b).includes("\n");
  if (i < items.length - 1 && oneLine(e.end, items[i + 1].start)) {
    h.splice(e.start, items[i + 1].start, "");
    return;
  }
  if (i > 0 && oneLine(items[i - 1].end, e.start)) {
    h.splice(items[i - 1].end, e.end, "");
    return;
  }
  // A line break on both sides may carry a comment: only the item and its comma go, the trivia between them kept.
  const comma = commaAfter(t, e.end);
  if (comma < 0) {
    h.splice(e.start, e.end, "");
    return;
  }
  const kept = t.slice(e.end, comma).replace(/^[ \t]+/, " ");
  h.splice(e.start, pastComma(t, comma), kept);
}

/** Just past the comma at `at` and the blanks that follow it on its line. */
const pastComma = (t: string, at: number): number =>
  at + (/^,[ \t]*/.exec(t.slice(at))?.[0].length ?? 1);

/** The offset of the comma after `pos` past blanks and comments, or -1 when something else comes first. */
function commaAfter(t: string, pos: number): number {
  const m = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/.exec(t.slice(pos));
  const at = pos + (m?.[0].length ?? 0);
  return t[at] === "," ? at : -1;
}

/** Removes one call of a chain: its line when it had one, the call and its dot otherwise. */
function removeChained(h: Host, group: K7Entry[], i: number): void {
  const t = h.text();
  const e = group[i];
  const tail = tailEnd(t, e.end);
  if (group.length === 1) {
    if (headBlank(t, e.start) && tail !== null) {
      h.splice(lineStart(t, e.start), Math.min(tail + 1, t.length), "");
      return;
    }
    h.splice(e.start, e.end, "");
    return;
  }
  if (i === 0) {
    h.splice(e.start, group[1].keyStart, "");
    return;
  }
  if (e.dot !== null && headBlank(t, e.dot) && tail !== null) {
    h.splice(lineStart(t, e.dot), Math.min(tail + 1, t.length), "");
    return;
  }
  h.splice(e.start, e.end, "");
}
