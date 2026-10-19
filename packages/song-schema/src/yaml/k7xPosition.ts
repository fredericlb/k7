// k7xPosition.ts — where a schema finding's key path is written in k7x text, so a parser reports on the .k7x file itself.
// A reader would get wrong that a path must exist: it lands on the deepest entry or item that does, at its key when it has one.

import { K7Document } from "@studio/k7x/document";
import type { ModuleIssue } from "./moduleFile";

/** A finding's path: zod's segments, or the dotted string a ModuleIssue carries. */
export type IssuePath = readonly PropertyKey[] | string;

/** A zod issue as far as a position needs it; `keys` is what an unknown-key issue names inside its object. */
export interface SchemaIssue {
  path: readonly PropertyKey[];
  message: string;
  keys?: readonly string[];
}

/** The segments of a path, each a string: a map key as written, a list index as digits. */
export const issueSegments = (path: IssuePath): string[] =>
  typeof path === "string"
    ? path
      ? path.split(".")
      : []
    : path.map((s) => String(s));

const docOf = (source: string | K7Document): K7Document =>
  typeof source === "string" ? new K7Document(source) : source;

/** 1-based line and column of a path in k7x text, the deepest part of it that exists; undefined for the root or an unreadable text. */
export function k7xPosition(
  source: string | K7Document,
  path: IssuePath,
): { line: number; col: number } | undefined {
  const doc = docOf(source);
  if (!doc.contents) return undefined;
  const segs = issueSegments(path);
  for (let n = segs.length; n > 0; n--) {
    const at = doc.positionOf(segs.slice(0, n));
    if (at) return at;
  }
  return undefined;
}

/** Zod's findings on a k7x file's data as ModuleIssues, each on the k7x line of the key it is about. */
export function k7xSchemaIssues(
  source: string | K7Document,
  issues: readonly SchemaIssue[],
): ModuleIssue[] {
  const doc = docOf(source);
  return issues.map((issue) => {
    // An unknown key is reported against its CONTAINING object, so the key is added to give it a line.
    const path = [
      ...issue.path,
      ...(issue.keys?.length ? [issue.keys[0]] : []),
    ];
    const at = k7xPosition(doc, path);
    return {
      path: issueSegments(path).join("."),
      message: issue.message,
      ...(at ?? {}),
    };
  });
}
