// workspaceFile.ts — a workspace file by its YAML name, whichever format is on disk: `x.k7x` wins over `x.yaml`.
// Callers keep speaking YAML text; a .k7x file is read as YAML and a write is applied to it as edits (docs/k7xFiles.md).

import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fromYaml } from "@studio/k7x/from-yaml";
import { applyYaml, toYaml } from "@studio/k7x/yaml-bridge";
import { relocateIssues } from "@studio/song-schema/yaml/k7xIssues";
import type { ModuleIssue } from "@studio/song-schema/yaml/moduleFile";
import { convertChecked } from "../k7xMigrate";

export const K7X_EXT = ".k7x";
const YAML_NAME = /\.ya?ml$/i;
const K7X_NAME = /\.k7x$/i;
/** A name a workspace file of either format may have — what an extension test should accept. */
export const DOC_NAME = /\.(ya?ml|k7x)$/i;

export const isK7xPath = (path: string): boolean => K7X_NAME.test(path);

/** The `.k7x` spelling of a YAML-named path; any other path unchanged. */
export const k7xSibling = (path: string): string =>
  path.replace(YAML_NAME, K7X_EXT);

/** The YAML spelling of a `.k7x` path; any other path unchanged. */
export const yamlName = (path: string): string =>
  path.replace(K7X_NAME, ".yaml");

/** The file on disk a path names: a YAML name resolves to its `.k7x` sibling when that exists. */
export function realPath(path: string): string {
  if (!YAML_NAME.test(path)) return path;
  const k = k7xSibling(path);
  return existsSync(k) ? k : path;
}

export const wsExists = (path: string): boolean => existsSync(realPath(path));

/** A file's text, a .k7x one as YAML; throws like readFileSync when neither spelling exists. */
export function wsRead(path: string): string {
  const real = realPath(path);
  const text = readFileSync(real, "utf8");
  return isK7xPath(real) ? toYaml(text) : text;
}

/** True once the deployer says every device reads .k7x: a new file is then created as one (docs/k7xFiles.md). */
export const k7xEverywhere = (): boolean => process.env.STUDIO_K7X === "1";

/** Writes YAML text to the file a path names: a .k7x file takes it as edits, so its comments and layout stay. */
export function wsWrite(path: string, content: string | Uint8Array): void {
  const real = realPath(path);
  // A new file, when k7x is everywhere: k7x if the text converts with the same data, YAML as written otherwise.
  if (
    typeof content === "string" &&
    YAML_NAME.test(real) &&
    !existsSync(real) &&
    k7xEverywhere()
  ) {
    const converted = convertChecked(content);
    if ("k7x" in converted) {
      writeFileSync(k7xSibling(real), converted.k7x);
      return;
    }
  }
  if (!isK7xPath(real) || typeof content !== "string") {
    writeFileSync(real, content);
    return;
  }
  if (!existsSync(real)) {
    writeFileSync(real, fromYaml(content));
    return;
  }
  const before = readFileSync(real, "utf8");
  const after = applyYaml(before, content);
  if (after !== before) writeFileSync(real, after);
}

/** Removes the file a path names, whichever spelling is on disk. */
export function wsRemove(path: string): void {
  rmSync(realPath(path), { force: true });
}

/** Renames a file, keeping its format: a .k7x file moves to the .k7x spelling of the new name. */
export function wsRename(from: string, to: string): void {
  const real = realPath(from);
  renameSync(real, isK7xPath(real) ? k7xSibling(to) : to);
}

/** Copies a file, keeping its format: a .k7x file lands at the .k7x spelling of the destination. */
export function wsCopy(from: string, to: string): void {
  const real = realPath(from);
  copyFileSync(real, isK7xPath(real) ? k7xSibling(to) : to);
}

export const wsStat = (path: string) => statSync(realPath(path));

/** A parser's findings on a file read through wsRead, placed on the .k7x file's own lines when that is the file. */
export function wsIssues(path: string, issues: ModuleIssue[]): ModuleIssue[] {
  const real = realPath(path);
  if (!issues.length || !isK7xPath(real)) return issues;
  return relocateIssues(readFileSync(real, "utf8"), issues);
}

/** A folder's entry names with every .k7x file under its YAML name, so a `.yaml` filter keeps finding it. */
export function wsList(dir: string): string[] {
  const names = readdirSync(dir);
  const k7x = new Set(names.filter((n) => isK7xPath(n)).map(yamlName));
  const out = names.filter((n) => !(YAML_NAME.test(n) && k7x.has(k7xLike(n))));
  return out.map(yamlName);
}

/** `x.yml` and `x.yaml` both lose to `x.k7x`. */
const k7xLike = (name: string): string => name.replace(YAML_NAME, ".yaml");
