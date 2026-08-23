// localTargets.ts — turning the NAME a shell command was given into a path of this project.
// The `file …` verbs, `ui pin` and `ui builder` all take a thing the file tree draws, and a
// person types the short name they can see rather than the workspace-relative path. Pure, so
// the resolution is tested in a repo where nothing mounts a component.

import { fuzzyScore } from "./fuzzy";

/** The best fuzzy match in a pool, or null. Exported for the resolvers below and for tests. */
export function bestMatch(arg: string, pool: readonly string[]): string | null {
  if (!arg) return null;
  if (pool.includes(arg)) return arg;
  return (
    pool
      .map((p) => ({ p, score: fuzzyScore(arg, p) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p))[0]?.p ?? null
  );
}

/** The tree entry a name means, folders included — the right-click menu offers `fs file move` and `ui pin` on one. */
export const resolveEntry = (
  arg: string,
  entries: readonly string[],
): string | null => bestMatch(arg, entries);

/** A module folder's own `module.yaml` — what the builder opens on. */
const MODULE_FILE = /(^|\/)module\.ya?ml$/i;

/** The module file a name means — MODULES FIRST, then the whole project, so `ui builder ampli` cannot land on `clips/ampli`. */
export function resolveModuleFile(
  arg: string,
  files: readonly string[],
): string | null {
  return (
    bestMatch(
      arg,
      files.filter((f) => MODULE_FILE.test(f)),
    ) ?? bestMatch(arg, files)
  );
}

/** The folder a path sits in — "" at the root, which every file route reads as the workspace. */
export const parentDir = (path: string): string => {
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
};

/** The last segment of a path — the name a rename starts from. */
export const baseName = (path: string): string =>
  path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? path;

/** Split a line into its leading N tokens and the rest, so a name with spaces survives while the path before it stays one token. */
export function headTokens(rest: string, n: number): string[] {
  const out: string[] = [];
  let s = rest.trim();
  while (out.length < n - 1) {
    const i = s.search(/\s/);
    if (i < 0) break;
    out.push(s.slice(0, i));
    s = s.slice(i + 1).trim();
  }
  if (s) out.push(s);
  return out;
}
