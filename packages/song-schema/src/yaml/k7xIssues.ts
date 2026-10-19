// k7xIssues.ts — a .k7x buffer checked by the same parsers as YAML, its findings placed on the k7x text's own lines.
// The parsers run on the YAML view (toYaml), so a finding's line is recomputed from its KEY PATH, never carried over.

import { K7Document } from "@studio/k7x/document";
import { K7SyntaxError, parseTree } from "@studio/k7x/parse";
import { toYaml } from "@studio/k7x/yaml-bridge";
import { issueSegments, k7xPosition } from "./k7xPosition";
import type { ModuleIssue } from "./moduleFile";
import { sugarFor } from "./sugar";

/** Where a key path points in k7x text: the deepest entry or item that exists, at its key when it has one. */
export function locateK7x(
  text: string | K7Document,
  path: readonly (string | number)[],
): { line?: number; col?: number } {
  return k7xPosition(text, path) ?? {};
}

/** The same findings, their line and column taken from the k7x text by each one's dotted path. */
export function relocateIssues(
  text: string,
  issues: ModuleIssue[],
): ModuleIssue[] {
  const doc = new K7Document(text);
  return issues.map((i) => {
    const { line, col } = locateK7x(doc, issueSegments(i.path ?? ""));
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

/** A YAML parser's verdict on a k7x buffer that reads, its short forms expanded, placed on its own lines. */
export function checkK7x(
  text: string,
  parse: (yaml: string) => { issues: ModuleIssue[] },
  path = "",
): ModuleIssue[] {
  let yaml: string;
  try {
    yaml = toYaml(text, sugarFor(path));
  } catch (e) {
    // A short form that does not read names its key first ("notes: …"), which is where it is placed.
    const message = (e as Error).message;
    const key = /^(\w+): /.exec(message)?.[1] ?? "";
    return relocateIssues(text, [{ path: key, message }]);
  }
  return relocateIssues(text, parse(yaml).issues);
}
