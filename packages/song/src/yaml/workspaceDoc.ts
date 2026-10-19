// workspaceDoc.ts — a workspace's .k7x file read and written as k7x: its text, its data, or a document edited by key path.
// A reader would get wrong what an edit sees in a file with short forms: their EXPANDED data, put back by sugar's rule (docs/k7xFiles.md).

import { existsSync, readFileSync } from "node:fs";
import { K7Document } from "@studio/k7x/document";
import { parseTree } from "@studio/k7x/parse";
import { type StringifyOptions, stringify } from "@studio/k7x/print";
import { applySugared, sugarFor } from "@studio/song-schema/yaml/sugar";
import { writeFileAtomic } from "../atomicWrite";
import { isK7xPath, k7xData } from "./workspaceFile";

export type { K7Document };

/** A path this door takes: a .k7x file named outright, never a YAML name to resolve. */
function k7xOnly(path: string): string {
  if (!isK7xPath(path)) throw new Error(`${path}: not a .k7x file`);
  return path;
}

/** Writes `text` atomically unless the file already holds it; says whether it wrote. */
function writeIfChanged(path: string, text: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  writeFileAtomic(path, text);
  return true;
}

/** The file's k7x text as it is on disk. */
export const wsText = (path: string): string =>
  readFileSync(k7xOnly(path), "utf8");

/** The file's data, its short forms expanded; throws K7SyntaxError on a broken file. */
export const wsData = (path: string): Record<string, unknown> =>
  k7xData(path, wsText(path));

/** Runs `edit` on the file as a document and writes it atomically when its text changed; an absent file is empty under `create`, and `raw` hands it the short forms as written. */
export function wsEdit(
  path: string,
  edit: (doc: K7Document) => void,
  opts: { create?: boolean; raw?: boolean } = {},
): boolean {
  k7xOnly(path);
  const exists = existsSync(path);
  if (!exists && !opts.create) throw new Error(`${path}: no such file`);
  const before = exists ? readFileSync(path, "utf8") : "";
  const doc = new K7Document(before);
  const sugar = opts.raw ? null : sugarFor(path);
  const raw = doc.toJS();
  // A file with no short form in it, or an edit that keeps them itself, edits the document as written.
  if (!sugar?.parts.some((p) => p.present(raw))) edit(doc);
  else {
    // The edit sees the expanded data; what it leaves is put back over the short forms by the one rule.
    const scratch = new K7Document(
      stringify(sugar.expand(raw), { header: doc.header }),
    );
    edit(scratch);
    applySugared(doc, scratch.toJS(), sugar);
    doc.setHeader(scratch.header);
  }
  const after = doc.toString();
  if (after === before) return false;
  writeFileAtomic(path, after);
  return true;
}

/** Writes the whole file canonically from data, with a header and the nodes to keep on one line; says whether it wrote. */
export function wsWriteData(
  path: string,
  value: Record<string, unknown>,
  opts: StringifyOptions = {},
): boolean {
  return writeIfChanged(k7xOnly(path), stringify(value, opts));
}

/** Writes k7x text as given once it reads, throwing K7SyntaxError when it does not; says whether it wrote. */
export function wsWriteText(path: string, text: string): boolean {
  k7xOnly(path);
  parseTree(text);
  return writeIfChanged(path, text);
}
