// applyData.ts — turning the data at a path into new data with the fewest path edits, so comments and layout around them stay.
// A reader would get wrong what a changed list costs: its common head and tail stay, and only the middle is touched.

import type { K7Path } from "./ast.ts";

/** The edits applyData needs, which K7Document provides. */
export interface PathEditor {
  setIn(path: K7Path, value: unknown): void;
  deleteIn(path: K7Path): boolean;
  insertIn(path: K7Path, index: number, value: unknown): void;
  /** The source at a path, so a list emptied around a comment loses only its items. */
  getSource?(path: K7Path): string | undefined;
}

/** Turns `before` into `after` inside the document with the fewest path edits: changed leaves, added and removed keys, list splices. */
export function applyData(
  doc: PathEditor,
  before: unknown,
  after: unknown,
  path: K7Path = [],
): void {
  if (same(before, after)) return;
  if (isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(before))
      if (!has(after, key)) doc.deleteIn([...path, key]);
    for (const [key, value] of Object.entries(after)) {
      if (value === undefined) continue;
      if (has(before, key)) applyData(doc, before[key], value, [...path, key]);
      else doc.setIn([...path, key], value);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && path.length > 0) {
    applyList(doc, before, after, path);
    return;
  }
  doc.setIn(path, after);
}

/** A list edited at its middle: the common head and tail stay, an equal-length middle is edited item by item, else spliced around the items it keeps. */
function applyList(
  doc: PathEditor,
  before: unknown[],
  after: unknown[],
  path: K7Path,
): void {
  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    same(before[head], after[head])
  )
    head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    same(before[before.length - 1 - tail], after[after.length - 1 - tail])
  )
    tail++;
  const oldMid = before.slice(head, before.length - tail);
  const newMid = after.slice(head, after.length - tail);
  if (oldMid.length === newMid.length) {
    oldMid.forEach((v, i) => {
      applyData(doc, v, newMid[i], [...path, head + i]);
    });
    return;
  }
  if (after.length === 0 && !commented(doc.getSource?.(path))) {
    doc.setIn(path, []);
    return;
  }
  const anchors = commonItems(oldMid, newMid);
  // From the last stretch to the first, so an edit never shifts the index of one still to come.
  for (let s = anchors.length - 1; s >= 0; s--) {
    const [a0, b0] =
      s === 0 ? [0, 0] : [anchors[s - 1][0] + 1, anchors[s - 1][1] + 1];
    const [a1, b1] = anchors[s];
    applyStretch(
      doc,
      oldMid.slice(a0, a1),
      newMid.slice(b0, b1),
      path,
      head + a0,
    );
  }
}

/** One stretch between kept items: edited item by item when its length holds, else its old items deleted and the new inserted. */
function applyStretch(
  doc: PathEditor,
  before: unknown[],
  after: unknown[],
  path: K7Path,
  at: number,
): void {
  if (before.length === after.length) {
    before.forEach((v, i) => {
      applyData(doc, v, after[i], [...path, at + i]);
    });
    return;
  }
  for (let i = before.length - 1; i >= 0; i--) doc.deleteIn([...path, at + i]);
  after.forEach((v, i) => {
    doc.insertIn(path, at + i, v);
  });
}

// Past this many comparisons a middle is spliced whole rather than matched.
const MATCH_BUDGET = 1_000_000;

/** The index pairs of the longest run of items both lists hold in order, ending with the pair one past both ends. */
function commonItems(before: unknown[], after: unknown[]): [number, number][] {
  const n = before.length;
  const m = after.length;
  const end: [number, number] = [n, m];
  if (!n || !m || n * m > MATCH_BUDGET) return [end];
  const len: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      len[i][j] = same(before[i], after[j])
        ? len[i + 1][j + 1] + 1
        : Math.max(len[i + 1][j], len[i][j + 1]);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(before[i], after[j])) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  pairs.push(end);
  return pairs;
}

const STRINGS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

/** Whether source text holds a comment outside its strings: a list emptied item by item keeps it. */
const commented = (source: string | undefined): boolean =>
  /\/[/*]/.test((source ?? "").replace(STRINGS, ""));

/** An own key holding a value: an undefined one counts as missing, and so does a key only the prototype has (`toString`). */
const has = (o: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(o, key) && o[key] !== undefined;

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Deep equality of plain data, an undefined value counting as a missing key. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return (
      ka.length === kb.length && ka.every((k) => has(b, k) && same(a[k], b[k]))
    );
  }
  return false;
}
