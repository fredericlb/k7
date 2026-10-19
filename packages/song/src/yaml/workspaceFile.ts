// workspaceFile.ts — a workspace file by its own name: plain I/O, a .k7x file's text as it is on disk.
// A reader would get wrong that this converts anything: it does not; workspaceDoc.ts reads data and edits documents (docs/k7xFiles.md).

import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { parse as parseK7x } from "@studio/k7x/document";
import { sugarFor } from "@studio/song-schema/yaml/sugar";
import { writeFileAtomic } from "../atomicWrite";

export const K7X_EXT = ".k7x";
const K7X_NAME = /\.k7x$/i;

/** Is `name` a workspace document: a .k7x file, the only format a workspace holds. */
export const isDocName = (name: string): boolean => K7X_NAME.test(name);

export const isK7xPath = (path: string): boolean => K7X_NAME.test(path);

/** The data of a .k7x file already read, its short forms expanded by the kind its path names. */
export function k7xData(real: string, raw: string): Record<string, unknown> {
  const data = parseK7x(raw);
  const sugar = sugarFor(real);
  return sugar ? sugar.expand(data) : data;
}

export const wsExists = (path: string): boolean => existsSync(path);

/** A file's text as it is on disk — k7x text for a workspace document; throws like readFileSync when absent. */
export const wsRead = (path: string): string => readFileSync(path, "utf8");

/** Writes a file whole or not at all — k7x text for a workspace document, written as given. */
export function wsWrite(path: string, content: string | Uint8Array): void {
  writeFileAtomic(path, content);
}

export function wsRemove(path: string): void {
  rmSync(path, { force: true });
}

export function wsRename(from: string, to: string): void {
  renameSync(from, to);
}

export function wsCopy(from: string, to: string): void {
  copyFileSync(from, to);
}

/** A folder's entry names, as readdir gives them. */
export const wsList = (dir: string): string[] => readdirSync(dir);
