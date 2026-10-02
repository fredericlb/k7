// ModulePicker.tsx — "which module?", asked by the `+` on a graph arrow before the
// command bar sees anything. Browses namespace -> type -> category -> module (the
// catalogue's own shape), with a search field at the root for when you can already name
// it. Only BASE modules and never `@engine`, and nothing is run — it pre-writes. See
// docs/commandBar.md.

import { isEngineRef } from "@studio/song-schema/moduleTypes";
import { fuzzyScore } from "../fuzzy";
import type { PanelSize } from "../pendingNode";
import { type TreeNode, TreePicker } from "./TreePicker";

/** What the picker BROWSES: a module's ref plus its type folder — CARRIED, since a flat ref (`@ns/adt`) spells no folder. */
export interface PickerModule {
  ref: string;
  /** Its type folder — the level the tree groups by. */
  category?: string;
  /** Its panel grid, when it draws one — what the card is sized by before the node exists. */
  panel?: PanelSize;
}

/** What the picker hands back. */
export interface ModulePick {
  /** Not a module at all: the picker's one other offer, 'new curve…' — a curve is a node, so it belongs on this menu. */
  newCurve?: true;
  ref: string; // "instruments/synth" (this project) or "@engine/audio/delay/adt"
  /** null ⇒ a base module this project already defines: one exists to instantiate, the other has to be created first. */
  namespace: string | null;
  type: string; // "audio" — the module type folder
  name: string; // "adt" — the module's own name
  /** Its panel grid, when the listing said — the placeholder card's size. */
  panel?: PanelSize;
}

/** Split a base ref into its levels — anything that does not fit keeps a null type and lands in a flat fallback group. */
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

/** The first level's label for a namespace: local base modules group under 'current', everything else keeps its `@ns`. */
const CURRENT = "current";

/** The picker's non-module branch for curves: a curve that already exists is already ON the graph, so the only useful offer is a new one. */
const CURVE_BRANCH: TreeNode<ModulePick> = {
  key: "curves",
  label: "curves",
  children: [
    {
      key: "curves/new",
      label: "new curve…",
      hint: "an LFO, a drawn shape, or an envelope fired by note-ons",
      entry: { newCurve: true, ref: "", namespace: null, type: "", name: "" },
    },
  ],
};

/** The io SOURCES — the inputs a graph can start from. A sink takes no node: MIX, OUT, CUE, RENDER
 * and VIDEO_OUT are built into every project, which is why they are not on this menu (docs/moduleTypes.md). */
const INPUT_BRANCH: TreeNode<ModulePick> = {
  key: "inputs",
  label: "inputs",
  children: [
    {
      key: "inputs/in",
      label: "audio input",
      hint: "io: in — this machine's input, the live rig's IN",
      entry: { ref: "io/IN", namespace: null, type: "io", name: "IN" },
    },
    {
      key: "inputs/cam",
      label: "camera",
      hint: "io: camera — a live picture; the video input",
      entry: { ref: "io/CAM", namespace: null, type: "io", name: "CAM" },
    },
    {
      key: "inputs/file",
      label: "file source",
      hint: "io: file — audio off disk; the node carries which file",
      entry: { ref: "io/FILE", namespace: null, type: "io", name: "FILE" },
    },
    {
      key: "inputs/midi",
      label: "MIDI input",
      hint: "io: midi — a MIDI device; wired to a lane, it is what that lane records",
      entry: { ref: "io/MIDI", namespace: null, type: "io", name: "MIDI" },
    },
  ],
};

/** The `@engine` catalogue is not offered HERE: a built-in is what a module extends, not a node to drop — docs/commandBar.md. */
function offered(
  baseModules: (PickerModule | string)[],
): (PickerModule | string)[] {
  return baseModules.filter(
    (m) => !isEngineRef(typeof m === "string" ? m : m.ref),
  );
}

export function buildTree(
  modules: (PickerModule | string)[],
): TreeNode<ModulePick>[] {
  const baseModules = offered(modules);
  // namespace -> type -> category -> leaves. A Map keeps insertion order and the source is already sorted.
  const byNs = new Map<
    string | null,
    Map<string, Map<string | null, TreeNode<ModulePick>[]>>
  >();
  for (const m of baseModules) {
    const ref = typeof m === "string" ? m : m.ref;
    const parsed = parseBaseRef(ref);
    const { namespace, category, name } = parsed;
    // The ref's own filing first — a local `audio/delay/tape` still says it — else what the module declares.
    const type =
      parsed.type ?? (typeof m === "string" ? undefined : m.category);
    if (!type) continue;
    const leaf: TreeNode<ModulePick> = {
      key: `b:${ref}`,
      // The module's file name; `hint` keeps the whole ref, so what a row picks is still readable.
      label: name,
      hint: ref,
      entry: {
        ref,
        namespace,
        type,
        name,
        ...(typeof m !== "string" && m.panel ? { panel: m.panel } : {}),
      },
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

/** Score a query that carries a SLASH segment by segment, in order: plain subsequence matching spreads 'engine/dist' across 40 refs. */
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

/** Every module matching `query`, best first: scored against the NAME and the whole ref, a LITERAL substring outranking any fuzzy hit. */
export function searchModules(
  modules: (PickerModule | string)[],
  query: string,
): TreeNode<ModulePick>[] {
  // Filtered here too, and not only in buildTree: a search reaching what the tree refuses is the same leak.
  const baseModules = offered(modules);
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
      tree={[...buildTree(baseModules), INPUT_BRANCH, CURVE_BRANCH]}
      search={(q) => searchModules(baseModules, q)}
      searchLimit={SEARCH_LIMIT}
      placeholder="search modules…"
      emptyLabel="no module matches"
      onPick={onPick}
      onClose={onClose}
    />
  );
}
