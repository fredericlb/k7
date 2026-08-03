// fileDrop.ts — does this drag carry OS files we should accept? Its own module, and pure,
// because the answer decides whether `dragover` calls preventDefault — and a `dragover`
// that does NOT is a drop the browser silently refuses, with no error and no handler. That
// silent failure is exactly why it is worth a test.

import { PARAM_MIME } from "@studio/ui-module-builder/param-drag";

/** What a DataTransfer says it holds, as the two views a drag event exposes. */
export interface DragPayload {
  /** `dataTransfer.types` — "Files" for an OS file drag, plus any custom MIME types. */
  types: readonly string[];
  /** `dataTransfer.items` kinds, when the browser exposes them ("file" | "string"). */
  itemKinds?: readonly string[];
}

/**
 * True when the drag carries files from outside the page.
 *
 * Two ways to say yes, because browsers don't agree on which they populate during
 * `dragover`: the canonical "Files" entry in `types`, or an item whose kind is "file".
 * Requiring both — or only the first — refuses legitimate drags from some sources, and
 * the refusal is invisible.
 *
 * An INTERNAL drag (a parameter dragged onto a widget) is refused whatever else it says:
 * those are page-local and have nothing to upload.
 */
export function acceptsFileDrop(p: DragPayload): boolean {
  if (p.types.includes(PARAM_MIME)) return false;
  if (p.types.includes("Files")) return true;
  return (p.itemKinds ?? []).includes("file");
}

/** Read a drag event into the shape acceptsFileDrop takes. */
export function dragPayload(e: {
  dataTransfer: DataTransfer | null;
}): DragPayload {
  const dt = e.dataTransfer;
  if (!dt) return { types: [] };
  return {
    types: Array.from(dt.types ?? []),
    // `items` is live and empty on some platforms during dragover, hence the two-way test rather than one alone.
    itemKinds: Array.from(dt.items ?? []).map((i) => i.kind),
  };
}
