// scaffoldNeeds.ts — which SHARED modules a scaffolded project will not be able to resolve.
//
// A fresh libraries repository is empty on purpose (apps/k7/frontend/docs/projects.md), and a
// `mix` scaffold writes nodes extending `@k7-core/…`. Both are right; together they make a brand-new
// account's first set open with every module missing, which reads as a broken song rather than as
// a setup nobody finished. Nothing here SEEDS anything — it only says what is owed, and early.

import { parse } from "@studio/k7x/document";

/** The LIBRARIES namespace, and only it — the other four need no repository (apps/k7/frontend/docs/projects.md). */
const LIBRARY = /^@k7-core\//;

/** Every `extends` a set of scaffolded k7x FILES names — read off the files, so there is no second list to drift. */
export function neededRefs(files: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const text of Object.values(files)) {
    let ref: unknown;
    try {
      ref = parse(text).extends;
    } catch {
      continue; // not k7x (a pattern, a sample): it names no module
    }
    if (typeof ref === "string" && LIBRARY.test(ref)) out.add(ref);
  }
  return [...out].sort();
}

/** Of those, the ones the workspace cannot resolve — `known` is the ref map a compile would use. */
export function missingRefs(
  needed: readonly string[],
  known: Readonly<Record<string, unknown>>,
): string[] {
  return needed.filter((r) => !(r in known));
}

/** One sentence for a set of missing refs, or null when nothing is owed — the wording the screens share. */
export function missingRefsReport(missing: readonly string[]): string | null {
  if (!missing.length) return null;
  const head =
    missing.length === 1
      ? "1 shared module this project uses is not in your libraries repository yet"
      : `${missing.length} shared modules this project uses are not in your libraries repository yet`;
  return `${head}: ${missing.join(", ")} — author them in k7 and save; nothing copies a catalogue in for you.`;
}
