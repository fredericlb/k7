// layout.ts — the questions an edit asks of the text around a span: where its line starts, how deep it is indented, what trails it.
// A reader would get wrong that these look at the tree: they read the raw text, so they see comments the tree drops.

import type { K7MapNode } from "./ast.ts";

/** What the editing modules need of a document: its text, its tree, and the one way to change it. */
export interface Host {
  text(): string;
  root(): K7MapNode;
  splice(start: number, end: number, insert: string): void;
}

/** The byte-order mark a file may start with, which the header comes after. */
export const BOM = String.fromCharCode(0xfeff);

export const pad = (n: number): string => " ".repeat(n);

export const lineStart = (t: string, pos: number): number =>
  t.lastIndexOf("\n", pos - 1) + 1;

export const headBlank = (t: string, pos: number): boolean =>
  /^[ \t]*$/.test(t.slice(lineStart(t, pos), pos));

export const indentOf = (t: string, pos: number): number =>
  /^[ \t]*/.exec(t.slice(lineStart(t, pos)))?.[0].length ?? 0;

/** The file's header: the `//` lines it starts with, each without `//` and one space, and the offset past the last one's newline. */
export function readHeader(t: string): { lines: string[]; end: number } {
  const lines: string[] = [];
  let pos = t.startsWith(BOM) ? 1 : 0;
  while (t.startsWith("//", pos)) {
    const nl = t.indexOf("\n", pos);
    const end = nl < 0 ? t.length : nl;
    lines.push(
      t
        .slice(pos + 2, end)
        .replace(/\r$/, "")
        .replace(/^ /, ""),
    );
    pos = nl < 0 ? t.length : nl + 1;
  }
  return { lines, end: pos };
}

/** The offset of the newline ending the line after `pos`, when only blanks, a comma (if allowed) and a comment follow; else null. */
export function tailEnd(t: string, pos: number, comma = false): number | null {
  const m = (
    comma
      ? /^[ \t]*,?[ \t\r]*(\/\/[^\n]*)?(\n|$)/
      : /^[ \t\r]*(\/\/[^\n]*)?(\n|$)/
  ).exec(t.slice(pos));
  if (!m) return null;
  return pos + m[0].length - m[m.length - 1].length;
}
