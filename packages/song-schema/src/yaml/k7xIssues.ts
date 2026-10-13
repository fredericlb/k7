// k7xIssues.ts — a .k7x buffer checked by the same parsers as YAML, its findings placed on the k7x text's own lines.
// The parsers run on the YAML view (toYaml), so a finding's line is recomputed from its KEY PATH, never carried over.

import type { K7Entry, K7Node } from "@studio/k7x/ast";
import { K7SyntaxError, parseTree } from "@studio/k7x/parse";
import { toYaml } from "@studio/k7x/yaml-bridge";
import type { ModuleIssue } from "./moduleFile";

/** 1-based line and column of an offset in `text`. */
function lineCol(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, col: offset - before.lastIndexOf("\n") };
}

/** Where a key path points in k7x text: the deepest entry or item that exists, at its key when it has one. */
export function locateK7x(
  text: string,
  path: readonly (string | number)[],
): { line?: number; col?: number } {
  let root: K7Node;
  try {
    root = parseTree(text);
  } catch {
    return {};
  }
  if (!path.length) return {};
  let node: K7Node = root;
  let at: number | null = null;
  for (const seg of path) {
    if (node.kind === "map") {
      const e: K7Entry | undefined = node.entries.find(
        (x) => x.key === String(seg),
      );
      if (!e) break;
      at = e.keyStart;
      node = e.value;
    } else if (node.kind === "list") {
      const item: K7Node | undefined = node.items[Number(seg)];
      if (!item) break;
      at = item.start;
      node = item;
    } else break;
  }
  return at === null ? {} : lineCol(text, at);
}

/** The same findings, their line and column taken from the k7x text by each one's dotted path. */
export function relocateIssues(
  text: string,
  issues: ModuleIssue[],
): ModuleIssue[] {
  return issues.map((i) => {
    const { line, col } = locateK7x(text, i.path ? i.path.split(".") : []);
    const { line: _l, col: _c, ...rest } = i;
    return line === undefined ? rest : { ...rest, line, col };
  });
}

/** A k7x buffer's syntax error as a finding, or null when it reads. */
export function k7xSyntaxIssue(text: string): ModuleIssue | null {
  try {
    parseTree(text);
    return null;
  } catch (e) {
    if (!(e instanceof K7SyntaxError)) throw e;
    return {
      path: "",
      message: e.message.replace(/ \(\d+:\d+\)$/, ""),
      line: e.line,
      col: e.column,
    };
  }
}

/** A YAML parser's verdict on a k7x buffer that reads, placed on its own lines. */
export function checkK7x(
  text: string,
  parse: (yaml: string) => { issues: ModuleIssue[] },
): ModuleIssue[] {
  return relocateIssues(text, parse(toYaml(text)).issues);
}
