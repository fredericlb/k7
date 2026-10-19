// k7xIssues.ts — a .k7x buffer read for a parser, and its findings placed on the k7x text's own lines.
// A reader would get wrong that a syntax error throws: readK7x answers it as an issue, located, and no data.

import { K7Document } from "@studio/k7x/document";
import { K7SyntaxError, parseTree } from "@studio/k7x/parse";
import type { ZodType } from "zod";
import { issueSegments, k7xPosition, k7xSchemaIssues } from "./k7xPosition";
import type { ModuleIssue } from "./moduleFile";

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

/** A syntax error as a finding at its own line and column, the position dropped from the message. */
const syntaxFinding = (e: K7SyntaxError): ModuleIssue => ({
  path: "",
  message: e.message.replace(/ \(\d+:\d+\)$/, ""),
  line: e.line,
  col: e.column,
});

/** A document's syntax error as its one finding, or no finding when it reads. */
export const k7xSyntaxIssues = (doc: K7Document): ModuleIssue[] =>
  doc.errors.map(syntaxFinding);

/** A k7x buffer's syntax error as a finding, or null when it reads. */
export function k7xSyntaxIssue(text: string): ModuleIssue | null {
  try {
    parseTree(text);
    return null;
  } catch (e) {
    if (!(e instanceof K7SyntaxError)) throw e;
    return syntaxFinding(e);
  }
}

/** A k7x buffer as a parser starts from: the document and its data, or the syntax error as the one issue. */
export type K7Read =
  | { doc: K7Document; data: Record<string, unknown>; issues: [] }
  | { doc: null; data: null; issues: ModuleIssue[] };

/** Read a k7x buffer once, for a parser that then validates `data` and locates findings on `doc`. */
export function readK7x(text: string): K7Read {
  const doc = new K7Document(text);
  const err = doc.errors[0];
  if (err) return { doc: null, data: null, issues: k7xSyntaxIssues(doc) };
  return { doc, data: doc.toJS(), issues: [] };
}

/** A schema's verdict on a k7x buffer: its value, or every finding located on the k7x text. */
export function parseK7xWith<T>(
  schema: ZodType<T>,
  text: string,
  expand?: (raw: Record<string, unknown>) => Record<string, unknown>,
): { value: T | null; issues: ModuleIssue[] } {
  const read = readK7x(text);
  if (!read.doc) return { value: null, issues: read.issues };
  let data: Record<string, unknown>;
  try {
    data = expand ? expand(read.data) : read.data;
  } catch (e) {
    // A short form that does not read names its key first ("notes: …"), which is where it is placed.
    const message = (e as Error).message;
    const key = /^(\w+): /.exec(message)?.[1] ?? "";
    return {
      value: null,
      issues: relocateIssues(text, [{ path: key, message }]),
    };
  }
  const result = schema.safeParse(data);
  if (result.success) return { value: result.data, issues: [] };
  return {
    value: null,
    issues: k7xSchemaIssues(read.doc, result.error.issues),
  };
}
