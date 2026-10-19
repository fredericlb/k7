// previewTriggers.ts (k7x) — which lines get a ▶ to audition a sample: a clip's own `source`, a samples symbol's `clip`,
// or a slice symbol's [from, to) window. A slice is resolved after the walk, since it carries no source of its own
// and the one it belongs to may sit further down the file.

import type { EditorState } from "@codemirror/state";
import { type K7MapNode, walk } from "@studio/k7x/ast";
import type { PreviewReq } from "@studio/web-protocol";
import { mapSpan, treeOf } from "./tree";

export interface PreviewTrigger {
  /** A document offset on the line the ▶ belongs to. */
  pos: number;
  req: PreviewReq;
}

/** A map's scalar fields by key; nested values are left out. */
function fieldsOf(map: K7MapNode): Map<string, string | number> {
  const out = new Map<string, string | number>();
  for (const e of map.entries)
    if (
      e.value.kind === "scalar" &&
      (typeof e.value.value === "string" || typeof e.value.value === "number")
    )
      out.set(e.key, e.value.value);
  return out;
}

const num = (v: string | number | undefined): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Every ▶ the document earns; the rack's shared source is resolved after the walk, since it may sit below. */
export function previewTriggers(state: EditorState): PreviewTrigger[] {
  const tree = treeOf(state);
  if (!tree.root) return [];
  const text = state.doc.toString();
  const at = (start: number, end: number) =>
    mapSpan(tree, start, end, text)?.from;
  const out: PreviewTrigger[] = [];
  const slices: { pos: number; from: number; to: number }[] = [];
  let sharedSource: string | undefined;

  walk(tree.root, (node, _path, entry) => {
    // `source` anywhere: the line plays the whole file, and doubles as the rack's shared source.
    if (entry?.key === "source" && node.kind === "scalar") {
      const source = node.value;
      if (typeof source !== "string" || !source) return;
      sharedSource ??= source;
      const pos = at(entry.start, entry.end);
      if (pos !== undefined) out.push({ pos, req: { kind: "source", source } });
      return;
    }
    if (node.kind !== "map" || node.form === "root") return;
    const fields = fieldsOf(node);
    // A rack symbol answers to a note and plays its own clip or a window of the source; without `note` it is not one.
    if (!fields.has("note")) return;
    const pos = at(node.start, node.end);
    if (pos === undefined) return;
    const clip = fields.get("clip");
    if (typeof clip === "string" && clip) {
      out.push({ pos, req: { kind: "clip", clip } });
      return;
    }
    const from = num(fields.get("from"));
    const to = num(fields.get("to"));
    if (from !== undefined && to !== undefined) slices.push({ pos, from, to });
  });

  if (sharedSource)
    for (const s of slices)
      out.push({
        pos: s.pos,
        req: { kind: "slice", source: sharedSource, from: s.from, to: s.to },
      });
  return out;
}
