// moduleIcons.tsx — the glyph a module node wears, from its TYPE FOLDER, so a chain says
// what each node IS before you read its name: a keyboard makes sound, a MIDI plug
// transforms notes, a waveform processes audio, arrows are the way in or out. Video
// modules fall back to none rather than borrowing one that would read as audio.
// Same icon set and reasons as pistes' trackIcons.tsx, but keyed by CATEGORY rather than a
import type { WebModuleCategory } from "@studio/graph-model";

/** An inline SVG, as a viewBox and a body. Declared here rather than imported from pistes'
 *  trackIcons — which is where it started — because that file stayed in the app: its
 *  TrackIcon draws the same lanes in the mixer and the timeline, so a graph package owning
 *  it would have those two importing one. ModuleIcon has no such tie: it is keyed on
 *  WebModuleCategory, which is the GRAPH's vocabulary, and its only consumer anywhere was
 *  the chains icon table. Two fields is a cheaper duplication than that coupling. */
export interface Glyph {
  vb: string;
  body: string;
}

const GLYPHS: Record<string, Glyph> = {
  "piano-16": {
    vb: "0 0 16 16",
    body: '<path fill="currentColor" d="M2.5 14c-.663 0-1.3-.263-1.77-.732a2.5 2.5 0 0 1-.732-1.77v-7c0-.663.263-1.3.732-1.77a2.5 2.5 0 0 1 1.77-.732h11c.663 0 1.3.263 1.77.732c.469.469.732 1.1.732 1.77v7c0 .663-.263 1.3-.732 1.77c-.469.469-1.1.732-1.77.732zM4 3H2.5a1.5 1.5 0 0 0-1.499 1.499v7A1.5 1.5 0 0 0 2.5 12.998H5v-3a.997.997 0 0 1-1-1v-6zm5 0H7v6a.997.997 0 0 1-1 1v3h4v-3a.997.997 0 0 1-1-1zm4.5 0H12v6a.997.997 0 0 1-1 1v3h2.5a1.5 1.5 0 0 0 1.499-1.499v-7A1.5 1.5 0 0 0 13.5 3.002z"/>',
  },
  "midi-16": {
    vb: "0 0 16 16",
    body: '<path fill="currentColor" d="M13.5 14c.711-2.69 1.29-5.48.901-8.26c-.15-.946-.618-2.69-1.91-2.22c-1.62.593-2.78 2.36-3.68 3.77a31 31 0 0 1 2.7 6.7h-1.47c-.626-1.79-1.17-3.49-2.06-5.18c-.839 1.66-1.52 3.4-2.04 5.19h-1.48c.261-1.15 1.26-4.16 2.68-6.7c-.865-1.37-1.83-2.8-3.28-3.62c-1.68-.986-2.26 1.29-2.36 2.54c-.267 2.65.323 5.23.957 7.78H.988C.161 11.01-.672 6.37.78 3.5c.692-1.36 2.12-1.86 3.5-1.23c1.65.707 2.67 2.23 3.7 3.62c.62-.856 1.22-1.71 2-2.44c1.52-1.53 3.9-2.27 5.17-.042c1.51 2.82.678 7.61-.166 10.6l-1.48-.004z"/>',
  },
  "wave-16": {
    vb: "0 0 16 16",
    body: '<path fill="currentColor" d="M.5 6c-.275 0-.5.225-.5.5v3c0 .275.225.5.5.5s.5-.225.5-.5v-3C1 6.225.775 6 .5 6m14 0c-.275 0-.5.225-.5.5v3c0 .275.225.5.5.5s.5-.225.5-.5v-3c0-.275-.225-.5-.5-.5m-12-3c-.275 0-.5.225-.5.5v9c0 .275.225.5.5.5s.5-.225.5-.5v-9c0-.275-.225-.5-.5-.5m2 2c-.275 0-.5.225-.5.5v5c0 .275.225.5.5.5s.5-.225.5-.5v-5c0-.275-.225-.5-.5-.5m2 2c-.275 0-.5.225-.5.5v1c0 .275.225.5.5.5s.5-.225.5-.5v-1c0-.275-.225-.5-.5-.5m2-2c-.275 0-.5.225-.5.5v5c0 .275.225.5.5.5s.5-.225.5-.5v-5c0-.275-.225-.5-.5-.5m2-4c-.275 0-.5.225-.5.5v13c0 .275.225.5.5.5s.5-.225.5-.5v-13c0-.275-.225-.5-.5-.5m2 2c-.275 0-.5.225-.5.5v9c0 .275.225.5.5.5s.5-.225.5-.5v-9c0-.275-.225-.5-.5-.5"/>',
  },
  // The dangling step: a module with no module, so it is asked for by name rather than by category.
  "question-16": {
    vb: "0 0 16 16",
    body: '<path fill="currentColor" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M7 12a1 1 0 1 1 2 0a1 1 0 0 1-2 0m1.75-3.25v.5a.75.75 0 0 1-1.5 0V8a.75.75 0 0 1 .75-.75a1.5 1.5 0 1 0-1.5-1.5a.75.75 0 0 1-1.5 0a3 3 0 1 1 3.75 2.9z"/>',
  },
  "arrows-left-right-12": {
    vb: "0 0 12 12",
    body: '<path fill="currentColor" d="M12 5.68a.5.5 0 0 0-.109-.545l-3-3a.501.501 0 0 0-.707.707l2.15 2.15h-8.59l2.15-2.15a.501.501 0 0 0-.707-.707l-3 3a.5.5 0 0 0 0 .708l3 3a.5.5 0 0 0 .713.006a.5.5 0 0 0-.006-.713l-2.15-2.15h8.59l-2.15 2.15a.5.5 0 0 0-.007.713a.5.5 0 0 0 .713-.006l3-3A.5.5 0 0 0 12 5.68"/>',
  },
};

// category -> glyph. `midi` is the legacy alias of `transformers`; same midi→midi role, so they share the plug.
const FOR_CATEGORY: Partial<Record<WebModuleCategory, string>> = {
  instruments: "piano-16",
  transformers: "midi-16",
  midi: "midi-16",
  audio: "wave-16",
  io: "arrows-left-right-12",
};

// The glyph for a category, or null when it has none. A sink has no category of its own, so callers pass "io";
// `missing` wins over the category, the `?` being the whole point of drawing that node.
export function moduleGlyph(
  category?: WebModuleCategory,
  missing?: boolean,
): Glyph | null {
  if (missing) return GLYPHS["question-16"];
  const name = category ? FOR_CATEGORY[category] : undefined;
  return name ? GLYPHS[name] : null;
}

// The module glyph as inline <svg>, sized in em like a track's; white, since the node carries its own accent.
export function ModuleIcon({
  category,
  missing,
  className,
  style,
}: {
  category?: WebModuleCategory;
  missing?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const glyph = moduleGlyph(category, missing);
  if (!glyph) return null;
  return (
    <svg
      viewBox={glyph.vb}
      className={className}
      style={style}
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static, checked-in SVG
      dangerouslySetInnerHTML={{ __html: glyph.body }}
    />
  );
}
