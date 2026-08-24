// scaffoldNeeds.ts — which SHARED modules a scaffolded project will not be able to resolve.
//
// A fresh libraries repository is empty on purpose (apps/st0/frontend/docs/projects.md), and a
// `mix` scaffold writes nodes extending `@st0/…`. Both are right; together they make a brand-new
// account's first set open with every module missing, which reads as a broken song rather than as
// a setup nobody finished. Nothing here SEEDS anything — it only says what is owed, and early.

// The LIBRARIES repository's namespace, and only it: `@project` is the song's own folder,
// `@workspace` the workspace's `_modules`, `@engine` the plugin scan and `@studio` the built-ins.
// A new libraries repo is what starts empty, so it is the one that can owe anything.
const LIBRARY = /^@st0\//;

/** Every `extends:` a set of scaffolded FILES names — read off the text, so there is no second list to drift. */
export function neededRefs(files: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const text of Object.values(files))
    for (const m of text.matchAll(/^extends:\s*(.+)$/gm)) {
      const raw = (m[1] ?? "").trim();
      // A quoted ref is taken whole; an unquoted one ends at a trailing comment.
      const quoted = /^(["'])(.*?)\1/.exec(raw);
      const ref = (quoted ? (quoted[2] ?? "") : raw.split("#")[0]).trim();
      if (LIBRARY.test(ref)) out.add(ref);
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
  return `${head}: ${missing.join(", ")} — author them in st0 and save; nothing copies a catalogue in for you.`;
}
