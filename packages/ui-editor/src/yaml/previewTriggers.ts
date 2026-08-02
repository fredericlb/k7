// previewTriggers.ts (yaml) — which lines get a ▶ to audition a sample: a clip's own
// `source:`, a samples symbol's `clip:`, or a slice symbol's [from,to) window. A second
// pass resolves the slice windows, since a slice symbol carries no source of its own and
// the one it belongs to may appear later in the document.

import type { EditorState } from "@codemirror/state";
import type { PreviewReq } from "@studio/web-protocol";
import { parsedTree } from "./parseTree";

export interface PreviewTrigger {
  /** A document offset on the line the ▶ belongs to. */
  pos: number;
  req: PreviewReq;
}

const unquote = (s: string): string =>
  (s.startsWith('"') && s.endsWith('"')) ||
  (s.startsWith("'") && s.endsWith("'"))
    ? s.slice(1, -1)
    : s;

/** The fields of one mapping, as text, plus where it starts. */
interface Entry {
  from: number;
  fields: Map<string, string>;
}

/** Read a mapping node into its scalar fields — nested collections are ignored. */
function entryOf(
  state: EditorState,
  node: {
    from: number;
    firstChild: unknown;
    getChildren(n: string): unknown[];
  },
): Entry {
  const fields = new Map<string, string>();
  for (const raw of node.getChildren("Pair") as {
    getChild(n: string): { from: number; to: number } | null;
  }[]) {
    const k = raw.getChild("Key");
    if (!k) continue;
    const key = unquote(state.sliceDoc(k.from, k.to).trim());
    // The value is the pair's last child; a scalar one is all we can use here.
    const lit =
      raw.getChild("Literal") ?? raw.getChild("QuotedLiteral") ?? null;
    if (lit) fields.set(key, unquote(state.sliceDoc(lit.from, lit.to).trim()));
  }
  return { from: node.from, fields };
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Every ▶ the document earns.
 *
 * `sharedSource` is the rack's own `source:` — the file's, whether it sits at the top level
 * (a bare rack fragment) or inside `rack: { … }` (a module). Slice symbols are resolved
 * against it after the walk, since it may be declared below them.
 */
export function previewTriggers(state: EditorState): PreviewTrigger[] {
  const out: PreviewTrigger[] = [];
  const slices: { pos: number; from: number; to: number }[] = [];
  let sharedSource: string | undefined;
  // The whole document: a ▶ that only appears in the first 3000 characters is worse than none,
  // since the file looks like it has no playable lines further down. See parseTree.ts.
  const tree = parsedTree(state);

  tree.iterate({
    enter(node) {
      if (node.name === "Pair") {
        // `source: …` anywhere: the line plays the whole file, and doubles as the rack's shared source when one is needed.
        const keyNode = node.node.getChild("Key");
        if (!keyNode) return;
        const key = unquote(state.sliceDoc(keyNode.from, keyNode.to).trim());
        if (key !== "source") return;
        const lit =
          node.node.getChild("Literal") ?? node.node.getChild("QuotedLiteral");
        if (!lit) return;
        const source = unquote(state.sliceDoc(lit.from, lit.to).trim());
        if (!source) return;
        sharedSource ??= source;
        out.push({ pos: node.from, req: { kind: "source", source } });
        return;
      }
      if (node.name !== "BlockMapping" && node.name !== "FlowMapping") return;
      const e = entryOf(state, node.node as never);
      // A rack symbol answers to a note and plays its own clip or a window of the source; without `note` it is not one.
      if (!e.fields.has("note")) return;
      const clip = e.fields.get("clip");
      if (clip) {
        out.push({ pos: e.from, req: { kind: "clip", clip } });
        return;
      }
      const from = num(e.fields.get("from"));
      const to = num(e.fields.get("to"));
      if (from !== undefined && to !== undefined)
        slices.push({ pos: e.from, from, to });
    },
  });

  // The second pass: a slice symbol is playable only once the shared source is known.
  if (sharedSource)
    for (const s of slices)
      out.push({
        pos: s.pos,
        req: { kind: "slice", source: sharedSource, from: s.from, to: s.to },
      });

  return out;
}
