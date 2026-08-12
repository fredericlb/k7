// ModulePicker.tsx — "which module?", asked by the `+` on a graph arrow before the
// command bar sees anything. Browses namespace -> type -> category -> module (the
// catalogue's own shape), with a search field at the root for when you can already name
// it. Only BASE modules, and nothing is run — it pre-writes. See docs/commandBar.md.

import { fuzzyScore } from "../fuzzy";
import { type TreeNode, TreePicker } from "./TreePicker";

/**
 * What the picker BROWSES: a module's ref plus the type folder it belongs to.
 *
 * The category is carried, not parsed. A ref used to spell out its own filing —
 * `@engine/audio/delay/adt` — because the catalogue was a folder tree. The engine's
 * modules are not files and their refs are flat (`@engine/adt`), so the only thing that
 * knows an ADT is an audio effect is the module itself. Reading it out of the string
 * stopped working the day the string stopped saying it.
 */
export interface PickerModule {
  ref: string;
  /** Its type folder — the level the tree groups by. */
  category?: string;
}

/** What the picker hands back. */
export interface ModulePick {
  ref: string; // "instruments/synth" (this project) or "@engine/audio/delay/adt"
  /** null ⇒ a base module this project already defines. The caller needs to know: one
   *  already exists to instantiate, the other has to be created first. */
  namespace: string | null;
  type: string; // "audio" — the module type folder
  name: string; // "adt" — the module's own name
}

/**
 * Split a base ref into its levels.
 *
 * `@engine/audio/delay/adt` → ns "engine", type "audio", category "delay", name "adt"
 * `@engine/instruments/4osc` → ns "engine", type "instruments", no category
 * `audio/delay/tape`         → local (no ns), type "audio", category "delay"
 *
 * Anything that doesn't fit is returned with a null type and lands in a flat fallback
 * group, because dropping refs the parser doesn't recognise would hide real modules.
 */
export function parseBaseRef(ref: string): {
  namespace: string | null;
  type: string | null;
  category: string | null;
  name: string;
} {
  let rest = ref;
  let namespace: string | null = null;
  if (rest.startsWith("@")) {
    const cut = rest.indexOf("/");
    if (cut > 1) {
      namespace = rest.slice(1, cut);
      rest = rest.slice(cut + 1);
    }
  }
  const segs = rest.split("/").filter(Boolean);
  if (segs.length === 3)
    return { namespace, type: segs[0], category: segs[1], name: segs[2] };
  if (segs.length === 2)
    return { namespace, type: segs[0], category: null, name: segs[1] };
  return { namespace, type: null, category: null, name: segs.join("/") || ref };
}

/** The first level's label for a namespace. Local base modules — the ones this project
 *  defines itself — group under "current"; everything else keeps its `@ns`. */
const CURRENT = "current";

/**
 * Group base modules into namespace → type → category → module. Exported for the test.
 *
 * The first level is the source: "current" for what this project defines, then one entry
 * per `modules_from` namespace (`@engine` is there by default). Everything below is the
 * catalogue's own shape — see the file header.
 *
 * `baseModules` is already node-free: `loadModuleRefs` keys by module FOLDER, so a
 * node never becomes a ref of its own. That matters here, because instantiating is
 * what picking one of these leads to.
 */
export function buildTree(
  baseModules: (PickerModule | string)[],
): TreeNode<ModulePick>[] {
  // namespace -> type -> category -> leaves. A Map keeps insertion order and the source is already sorted.
  const byNs = new Map<
    string | null,
    Map<string, Map<string | null, TreeNode<ModulePick>[]>>
  >();
  for (const m of baseModules) {
    const ref = typeof m === "string" ? m : m.ref;
    const parsed = parseBaseRef(ref);
    const { namespace, category, name } = parsed;
    // The ref's own filing first — a local `audio/delay/tape` still says it — else what
    // the module declares. Only a ref that says neither is dropped.
    const type =
      parsed.type ?? (typeof m === "string" ? undefined : m.category);
    if (!type) continue;
    const leaf: TreeNode<ModulePick> = {
      key: `b:${ref}`,
      label: name,
      hint: ref,
      entry: { ref, namespace, type, name },
    };
    if (!byNs.has(namespace)) byNs.set(namespace, new Map());
    const types = byNs.get(namespace) as Map<
      string,
      Map<string | null, TreeNode<ModulePick>[]>
    >;
    if (!types.has(type)) types.set(type, new Map());
    const cats = types.get(type) as Map<string | null, TreeNode<ModulePick>[]>;
    if (!cats.has(category)) cats.set(category, []);
    (cats.get(category) as TreeNode<ModulePick>[]).push(leaf);
  }

  // "current" first — the project's own modules are the shortest reach — then namespaces as their refs arrived.
  const order = [...byNs.keys()].sort((a, b) =>
    a === null ? -1 : b === null ? 1 : 0,
  );
  return order.map((ns) => {
    const types = byNs.get(ns) as Map<
      string,
      Map<string | null, TreeNode<ModulePick>[]>
    >;
    const nsKey = ns ?? CURRENT;
    return {
      key: `ns:${nsKey}`,
      label: ns ? `@${ns}` : CURRENT,
      children: [...types].map(([type, cats]) => ({
        key: `ns:${nsKey}/t:${type}`,
        label: type,
        // Uncategorised modules sit beside the submenus: no "Other" folder for plugins that declared nothing.
        children: [
          ...(cats.get(null) ?? []),
          ...[...cats]
            .filter(([c]) => c !== null)
            .map(([cat, leaves]) => ({
              key: `ns:${nsKey}/t:${type}/c:${cat}`,
              label: cat as string,
              children: leaves,
            })),
        ],
      })),
    };
  });
}

/** How many matches the search shows before it stops listing (see searchModules). */
export const SEARCH_LIMIT = 40;

/**
 * Score a query that carries a SLASH against a ref, segment by segment: each part must
 * hit a different segment of the ref, in order. "engine/dist" then reads as "the engine
 * namespace, then something distortion-ish", which is what it looks like it means —
 * plain subsequence matching spreads it across 40 refs of a 273-module catalogue because
 * the levels it skips are free to match anywhere.
 *
 * -1 when the query has no slash (nothing to narrow) or a part matches no segment.
 */
function pathScore(q: string, ref: string): number {
  const parts = q.toLowerCase().split("/").filter(Boolean);
  if (parts.length < 2) return -1;
  const segs = ref.toLowerCase().replace(/^@/, "").split("/").filter(Boolean);
  let si = 0;
  let score = 0;
  for (const part of parts) {
    while (si < segs.length && !segs[si].includes(part)) si++;
    if (si >= segs.length) return -1;
    // A segment the part STARTS is a stronger hit than one it merely sits inside.
    score += segs[si].startsWith(part) ? 3 : 1;
    si++;
  }
  return score;
}

/**
 * Every module matching `query`, best first — the flat answer to "where is X?".
 *
 * Scored twice and kept at its best: once against the module's NAME, once against its
 * whole ref. The name is worth more, so typing "adt" puts `adt` above the delays whose
 * path merely contains an a-d-t subsequence; the ref still matches, so "delay" finds a
 * whole category and "engine/dist" narrows by namespace and type at once.
 *
 * A LITERAL substring outranks any fuzzy hit, and a slashed query is also scored as a
 * PATH (see pathScore) — the two together are what make a typed-out query behave. In a
 * real 273-module catalogue "engine/dist" fuzzily matches 40 refs, and on fuzzy score
 * alone the distortions were not even in the first three.
 *
 * Exported for the test.
 */
export function searchModules(
  baseModules: (PickerModule | string)[],
  query: string,
): TreeNode<ModulePick>[] {
  const q = query.trim();
  if (!q) return [];
  const NAME_BONUS = 4;
  const SUBSTRING_BONUS = 50;
  const PATH_BONUS = 60;
  const ql = q.toLowerCase();
  const contains = (s: string) =>
    s.toLowerCase().includes(ql) ? SUBSTRING_BONUS : 0;
  const scored = baseModules
    .map((m) => {
      const ref = typeof m === "string" ? m : m.ref;
      const parsed = parseBaseRef(ref);
      const { namespace, name } = parsed;
      const type =
        parsed.type ?? (typeof m === "string" ? undefined : m.category);
      const byName = fuzzyScore(q, name);
      const byRef = fuzzyScore(q, ref);
      const byPath = pathScore(q, ref);
      const score = Math.max(
        byRef < 0 ? -1 : byRef + contains(ref),
        byName < 0 ? -1 : byName + NAME_BONUS + contains(name),
        byPath < 0 ? -1 : byPath + PATH_BONUS,
      );
      // Did the query appear as written, or only as a scattered subsequence? See below.
      const literal = byPath >= 0 || !!contains(ref) || !!contains(name);
      return { ref, namespace, type, name, score, literal };
    })
    // A ref shape the parser doesn't recognise has no type to instantiate under, the same reason buildTree drops it.
    .filter((m) => m.score >= 0 && m.type);

  // Fuzzy matching forgives a typo, it doesn't pad the list: once anything matches as written, scattered hits go.
  const anyLiteral = scored.some((m) => m.literal);
  return scored
    .filter((m) => m.literal || !anyLiteral)
    .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref))
    .slice(0, SEARCH_LIMIT)
    .map((m) => ({
      key: `s:${m.ref}`,
      label: m.name,
      hint: m.ref,
      entry: {
        ref: m.ref,
        namespace: m.namespace,
        type: m.type as string,
        name: m.name,
      },
    }));
}

/** The `+` on a graph arrow: browse namespace → type → category → module, or search. */
export function ModulePicker({
  x,
  y,
  baseModules,
  onPick,
  onClose,
}: {
  x: number; // viewport coords of the `+` that opened it
  y: number;
  baseModules: (PickerModule | string)[];
  onPick: (pick: ModulePick) => void;
  onClose: () => void;
}) {
  return (
    <TreePicker<ModulePick>
      x={x}
      y={y}
      tree={buildTree(baseModules)}
      search={(q) => searchModules(baseModules, q)}
      searchLimit={SEARCH_LIMIT}
      placeholder="search modules…"
      emptyLabel="no module matches"
      onPick={onPick}
      onClose={onClose}
    />
  );
}
