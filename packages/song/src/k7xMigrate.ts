// k7xMigrate.ts — a folder's YAML files converted to .k7x, each one only when the k7x reads back to the same data.
// A file that cannot convert stays YAML and is reported; a converted original is moved to a backup, never deleted (docs/k7xFiles.md).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse as parseK7x } from "@studio/k7x/document";
import { fromYaml } from "@studio/k7x/from-yaml";
import { parse as parseYaml } from "yaml";

export interface MigrateOptions {
  /** Where converted originals go, under their own relative path; null removes them. */
  backup: string | null;
  /** Report what would happen, write nothing. */
  dryRun?: boolean;
  /** Entries never descended into or converted, by their path relative to the root. */
  skip?: (rel: string, isDir: boolean) => boolean;
}

export interface MigrateReport {
  converted: string[];
  /** A YAML file beside a .k7x one of the same name: the .k7x already wins, so the YAML is left alone. */
  shadowed: string[];
  /** Left as YAML, with the reason: a YAML error, an anchor, a root that is not a map, or data that read back different. */
  refused: { file: string; reason: string }[];
}

const YAML_FILE = /\.ya?ml$/i;

/** Where a workspace's converted originals are kept: hidden, so never shown, synced or converted again. */
export const K7X_BACKUP_DIR = ".k7x-backup";

/** Hidden entries and installed packages are no workspace's files. */
const defaultSkip = (rel: string): boolean =>
  rel.split("/").some((s) => s.startsWith(".") || s === "node_modules");

function walk(
  root: string,
  at: string,
  skip: MigrateOptions["skip"],
  out: string[],
): void {
  for (const name of readdirSync(at).sort()) {
    const abs = join(at, name);
    const rel = relative(root, abs).replace(/\\/g, "/");
    const dir = statSync(abs).isDirectory();
    if (defaultSkip(rel) || skip?.(rel, dir)) continue;
    if (dir) walk(root, abs, skip, out);
    else if (YAML_FILE.test(name)) out.push(rel);
  }
}

/** Equal as data: what a schema would read from either text. */
function sameData(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The k7x text for a YAML text, or the reason it cannot be one. */
export function convertChecked(
  yaml: string,
): { k7x: string } | { reason: string } {
  let k7x: string;
  try {
    k7x = fromYaml(yaml);
  } catch (e) {
    return { reason: (e as Error).message };
  }
  const want = parseYaml(yaml, { version: "1.2" }) ?? {};
  let got: unknown;
  try {
    got = parseK7x(k7x);
  } catch (e) {
    return { reason: `the k7x does not read back: ${(e as Error).message}` };
  }
  return sameData(got, want)
    ? { k7x }
    : { reason: "the k7x reads back different data" };
}

/** Convert every YAML file under `root`; see MigrateOptions for what is kept, skipped and written. */
export function migrateToK7x(
  root: string,
  opts: MigrateOptions,
): MigrateReport {
  const files: string[] = [];
  walk(root, root, opts.skip, files);
  const report: MigrateReport = { converted: [], shadowed: [], refused: [] };
  for (const rel of files) {
    const abs = join(root, rel);
    const target = abs.replace(YAML_FILE, ".k7x");
    if (existsSync(target)) {
      report.shadowed.push(rel);
      continue;
    }
    const result = convertChecked(readFileSync(abs, "utf8"));
    if ("reason" in result) {
      report.refused.push({ file: rel, reason: result.reason });
      continue;
    }
    report.converted.push(rel);
    if (opts.dryRun) continue;
    writeFileSync(target, result.k7x);
    if (opts.backup === null) rmSync(abs);
    else {
      const kept = join(opts.backup, rel);
      mkdirSync(dirname(kept), { recursive: true });
      renameSync(abs, kept);
    }
  }
  return report;
}
