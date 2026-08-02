// previewGutter.ts — the ▶ audition gutter: one marker per line naming something playable
// (see previewTriggers.ts, which reads the syntax tree). The first trigger on a line wins;
// onPreview(req) auditions it, wired to the file service's /preview in the app shell.

import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { PreviewReq } from "@studio/web-protocol";
import { previewTriggers } from "./previewTriggers";

// A trigger from the scan: the offset it sits at (resolved to a line later) and the request firing it sends.
export interface PreviewTrigger {
  pos: number;
  req: PreviewReq;
}

// One struct while scanning. A slice symbol is one that ends up with numeric from+to and no clip.
class PreviewMarker extends GutterMarker {
  constructor(
    readonly req: PreviewReq,
    readonly onPreview: (r: PreviewReq) => void,
  ) {
    super();
  }
  eq(other: PreviewMarker): boolean {
    return JSON.stringify(other.req) === JSON.stringify(this.req);
  }
  toDOM(): Node {
    const b = document.createElement("button");
    b.className = "preview-play";
    b.textContent = "▶";
    b.title = "play this sample";
    b.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onPreview(this.req);
    };
    return b;
  }
}

// One marker per qualifying line (first trigger wins), in a RangeSet keyed by line start so the gutter can place it.
function buildMarkers(
  view: EditorView,
  onPreview: (r: PreviewReq) => void,
): ReturnType<RangeSetBuilder<GutterMarker>["finish"]> {
  const doc = view.state.doc;
  const byLine = new Map<number, PreviewReq>();
  for (const t of previewTriggers(view.state)) {
    if (t.pos > doc.length) continue;
    const from = doc.lineAt(t.pos).from;
    if (!byLine.has(from)) byLine.set(from, t.req);
  }
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const from of [...byLine.keys()].sort((a, b) => a - b))
    builder.add(from, from, new PreviewMarker(byLine.get(from)!, onPreview));
  return builder.finish();
}

const previewTheme = EditorView.theme({
  ".cm-gutter.preview-gutter": { width: "1.4em" },
  ".preview-play": {
    background: "none",
    border: "none",
    padding: "0",
    margin: "0",
    cursor: "pointer",
    color: "var(--preview-fg, #6b7280)",
    font: "inherit",
    fontSize: "0.85em",
    lineHeight: "inherit",
  },
  ".preview-play:hover": { color: "var(--preview-fg-hover, #22c55e)" },
});

/** The audition gutter: one ▶ per playable line, wired to `onPreview`. */
export function projectPreviewGutter(
  onPreview: (req: PreviewReq) => void,
): Extension {
  // markers() needs the view, so the scan runs there; CodeMirror only calls it on refresh, and these files are small.
  return [
    gutter({
      class: "preview-gutter",
      markers: (view) => buildMarkers(view, onPreview),
    }),
    previewTheme,
  ];
}
