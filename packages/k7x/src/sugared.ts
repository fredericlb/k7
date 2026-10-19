// sugared.ts — new data applied to a document that may hold short forms, each kept while its expansion is unchanged.
// A reader would get wrong that a short form is written back: one whose expansion changed goes, written in full (docs/bridge.md).

import { applyData, isRecord, same } from "./applyData.ts";
import type { K7Document } from "./edit.ts";

type Data = Record<string, unknown>;

/** A kind's short forms, as song-schema's sugar.ts states them: what reads them, and which keys they live in. */
export interface Sugar {
  parts: { key: string; target: string; present: (raw: Data) => boolean }[];
  expand: (raw: Data) => Data;
}

/** Makes the document's expanded data equal `after` with the fewest edits, keeping every short form whose expansion holds. */
export function applySugared(
  doc: K7Document,
  after: unknown,
  sugar?: Sugar | null,
): void {
  if (!isRecord(after)) throw new Error("k7x: a k7x file is a map at its root");
  const raw = doc.toJS();
  if (!sugar) {
    applyData(doc, raw, after);
    return;
  }
  const expanded = sugar.expand(raw);
  if (same(expanded, after)) return;
  let base: Data = raw;
  const target: Data = { ...after };
  for (const part of sugar.parts) {
    if (!part.present(raw)) continue;
    if (same(expanded[part.target], after[part.target])) {
      // Still what the write wants: the short form stays, and its target as written beside it.
      target[part.key] = raw[part.key];
      if (part.target !== part.key) {
        if (part.target in raw) target[part.target] = raw[part.target];
        else delete target[part.target];
      }
    } else if (part.target !== part.key) {
      // Its expansion changed: the short form goes and its target is written in full, or a stale form would undo the edit.
      doc.deleteIn([part.key]);
      const { [part.key]: _gone, ...rest } = base;
      base = rest;
    }
  }
  applyData(doc, base, target);
}
