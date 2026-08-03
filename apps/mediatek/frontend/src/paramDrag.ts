// Copie de celle de lanes, et les deux sont desormais INDEPENDANTES : apres la scission
// chaque app possede les deux bouts de son glisser, et un glisser ne traverse pas deux
// origines. lanes garde la sienne pour que son depot de fichiers sache ignorer un
// parametre ; ici c'est la grille de widgets qui le recoit.

// paramDrag.ts — the payload dragged from the module editor's parameter list onto a widget
// in its grid. That gesture IS how a widget gets bound (there is no bind field to type
// into), so the two panes must agree on the wire format and it lives here rather than in
// either. The range travels WITH the name, so the drop target needs no engine knowledge.

import type { ParamMeta } from "@studio/engine-protocol";

// A private MIME type, so dragging text, a file or a link over the grid can never bind anything.
export const PARAM_MIME = "application/x-lanes-param";

export interface ParamDrag {
  name: string;
  meta?: ParamMeta;
}

export function setParamDrag(dt: DataTransfer, p: ParamDrag): void {
  dt.setData(PARAM_MIME, JSON.stringify(p));
  // A readable fallback, so dragging a param into a text field types its name instead of nothing.
  dt.setData("text/plain", p.name);
  dt.effectAllowed = "copy";
}

// The dragged parameter, or null. Never throws on malformed JSON: a drop handler ignores what it can't read.
export function readParamDrag(dt: DataTransfer): ParamDrag | null {
  const raw = dt.getData(PARAM_MIME);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as ParamDrag;
    return p && typeof p.name === "string" && p.name ? p : null;
  } catch {
    return null;
  }
}

// Whether a drag in flight is one of ours. dragover can't read data — the browser hides it — hence `types`.
export function isParamDrag(dt: DataTransfer): boolean {
  return dt.types.includes(PARAM_MIME);
}
