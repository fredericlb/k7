// modeIcons.tsx — one drawing per MODE, read twice: by the strip's button and by the CURSOR over
// the surface. From the same string on purpose — two pictures for one mode is a pointer that can
// come to lie about what a click will do. Bodies are inlined SVG, as trackIcons.tsx's are, and
// every one of them paints with `fill="currentColor"` so the cursor's halo pass can recolour it.
// See docs/timeline.md and docs/clipEditors.md.

import type { ReactNode } from "react";

export interface ModeGlyph {
  vb: string;
  body: string;
  /** Where the POINT of the cursor is, in the viewBox's own units — what a click actually lands on. */
  hot: [number, number];
}

/** Every mode that has a picture: the timeline's four tools, then the waveform's three views. */
export const MODE_GLYPHS: Record<string, ModeGlyph> = {
  // An arrow, and the one glyph that is never used as a cursor: the system's own already is one.
  pointer: {
    vb: "0 0 24 24",
    hot: [5, 3],
    body: '<path fill="currentColor" d="M5 3 L5 19.5 L9.4 15.3 L11.9 21 L14.6 19.8 L12.1 14.2 L18 13.8 Z"/>',
  },
  // A razor over the line it cuts on — the point is the blade's tip, which is where the split lands.
  cut: {
    vb: "0 0 24 24",
    hot: [12, 9],
    body: '<path fill="currentColor" d="M8 2 H16 L12 9 Z"/><path fill="currentColor" d="M11.15 9 H12.85 V22 H11.15 Z"/>',
  },
  // A cross, centred: what it removes is what is under it, not what is beside it.
  erase: {
    vb: "0 0 24 24",
    hot: [12, 12],
    body: '<path fill="currentColor" d="M7.05 5.64 L5.64 7.05 L10.59 12 L5.64 16.95 L7.05 18.36 L12 13.41 L16.95 18.36 L18.36 16.95 L13.41 12 L18.36 7.05 L16.95 5.64 L12 10.59 Z"/>',
  },
  // A speaker with the cross beside it, rather than a slash across it: a slash at 24px reads as a scratch.
  mute: {
    vb: "0 0 24 24",
    hot: [12, 12],
    body: '<path fill="currentColor" d="M3 9 H6.5 L11 4.5 V19.5 L6.5 15 H3 Z"/><path fill="currentColor" d="M14.4 8.6 L15.8 7.2 L18.2 9.6 L20.6 7.2 L22 8.6 L19.6 11 L22 13.4 L20.6 14.8 L18.2 12.4 L15.8 14.8 L14.4 13.4 L16.8 11 Z"/>',
  },
  // Two brackets: the WINDOW, which is the one thing this view's pointer sets.
  standard: {
    vb: "0 0 24 24",
    hot: [12, 12],
    body: '<path fill="currentColor" d="M3 4 H9 V6.4 H5.4 V17.6 H9 V20 H3 Z"/><path fill="currentColor" d="M21 4 H15 V6.4 H18.6 V17.6 H15 V20 H21 Z"/>',
  },
  // Three transients, the tall one centred — and the point sits on it, since that is where a click lands.
  onsets: {
    vb: "0 0 24 24",
    hot: [12, 12],
    body: '<path fill="currentColor" d="M4 7.5 H6 V16.5 H4 Z"/><path fill="currentColor" d="M11 3 H13 V21 H11 Z"/><path fill="currentColor" d="M18 6.5 H20 V17.5 H18 Z"/>',
  },
  // Pulled both ways: a stretch point is a moment told to land somewhere else.
  warp: {
    vb: "0 0 24 24",
    hot: [12, 12],
    body: '<path fill="currentColor" d="M2 12 L7.5 6.5 V9.6 H16.5 V6.5 L22 12 L16.5 17.5 V14.4 H7.5 V17.5 Z"/>',
  },
  // The roll's three. A dashed BOX rather than the timeline's arrow: here the neutral act is framing notes, not pointing at one.
  select: {
    vb: "0 0 24 24",
    hot: [12, 12],
    body: '<path fill="currentColor" d="M3 3 H9 V5 H5 V9 H3 Z"/><path fill="currentColor" d="M21 3 H15 V5 H19 V9 H21 Z"/><path fill="currentColor" d="M3 21 H9 V19 H5 V15 H3 Z"/><path fill="currentColor" d="M21 21 H15 V19 H19 V15 H21 Z"/><path fill="currentColor" d="M8.5 11 H15.5 V13 H8.5 Z"/>',
  },
  // A pencil, and its POINT is the hotspot — where a note starts is where the nib is, not where the body sits.
  create: {
    vb: "0 0 24 24",
    hot: [4, 20],
    body: '<path fill="currentColor" d="M3 21 L4.6 15.6 L8.4 19.4 Z"/><path fill="currentColor" d="M5.6 14.3 L14.9 5 L19 9.1 L9.7 18.4 Z"/><path fill="currentColor" d="M16.3 3.6 L18.1 1.8 A2.5 2.5 0 0 1 22.2 5.9 L20.4 7.7 Z"/>',
  },
  // The cross again, and deliberately the same drawing as the timeline's eraser: one act, one picture.
  remove: {
    vb: "0 0 24 24",
    hot: [12, 12],
    body: '<path fill="currentColor" d="M7.05 5.64 L5.64 7.05 L10.59 12 L5.64 16.95 L7.05 18.36 L12 13.41 L16.95 18.36 L18.36 16.95 L13.41 12 L18.36 7.05 L16.95 5.64 L12 10.59 Z"/>',
  },
  // Two fades crossing: one event going down as the next comes up — the timeline's and the takes view's.
  crossfade: {
    vb: "0 0 24 24",
    hot: [12, 12],
    body: '<path fill="currentColor" d="M2 5.2 L3.4 3.8 L22 19.2 L20.6 20.6 Z"/><path fill="currentColor" d="M22 5.2 L20.6 3.8 L2 19.2 L3.4 20.6 Z"/><path fill="currentColor" d="M2 20 H22 V22 H2 Z" opacity="0.5"/>',
  },
  // TAKES, in both panels: three performances stacked, the middle one picked for a span.
  takes: {
    vb: "0 0 24 24",
    hot: [12, 12],
    body: '<path fill="currentColor" d="M3 4 H21 V7.5 H3 Z" opacity="0.45"/><path fill="currentColor" d="M3 10.25 H21 V13.75 H3 Z" opacity="0.45"/><path fill="currentColor" d="M3 16.5 H21 V20 H3 Z" opacity="0.45"/><path fill="currentColor" d="M8 10.25 H16 V13.75 H8 Z"/>',
  },
};

/** The glyph as inline `<svg>`, sized in `em` — the same shape trackIcons.tsx's `TrackIcon` has. */
export function ModeIcon({
  mode,
  className,
}: {
  mode: string;
  className?: string;
}) {
  const g = MODE_GLYPHS[mode];
  if (!g) return null;
  return (
    <svg
      viewBox={g.vb}
      className={className}
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      // The bodies are checked in above and never come from project data — there is no untrusted markup here.

      // biome-ignore lint/security/noDangerouslySetInnerHtml: static, checked-in SVG
      dangerouslySetInnerHTML={{ __html: g.body }}
    />
  );
}

const paint = (body: string, colour: string) =>
  body.replaceAll("currentColor", colour);

/**
 * …and the SAME drawing as a CSS `cursor`. White over a heavy dark outline, because a cursor has to
 * read on a lit waveform and on a dark lane alike, and neither background is ours to choose.
 */
export function cursorOf(mode: string): string | undefined {
  const g = MODE_GLYPHS[mode];
  if (!g) return undefined;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="${g.vb}">` +
    `<g stroke="#000" stroke-width="3.5" stroke-linejoin="round">${paint(g.body, "#000")}</g>` +
    `<g>${paint(g.body, "#fff")}</g></svg>`;
  // Percent-encoded whole: a raw `#` would end the URL and a raw `"` would end the attribute.
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${g.hot[0]} ${g.hot[1]}, auto`;
}

/** One button in the column, mode or not: exported so a host's own control is the same object rather than a copy of it. */
export const stripButton = (active: boolean) =>
  `flex h-8 w-8 shrink-0 items-center justify-center rounded text-base ${
    active
      ? "bg-primary/20 text-primary"
      : "text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;

/**
 * The 32px column of modes down a panel's left edge — what makes a mode reachable by MOUSE and by
 * finger, the keys and the bar being the other two ways. Every button DISPATCHES a command rather
 * than setting state, which is the rule that keeps a control and its verb from drifting apart.
 */
export function ModeStrip<T extends string>({
  modes,
  current,
  onPick,
  title,
  className,
  footer,
}: {
  modes: readonly T[];
  current: T;
  onPick: (m: T) => void;
  /** What each mode does, for the tooltip and the accessible name — the key that reaches it belongs here too. */
  title: (m: T) => string;
  className?: string;
  /** Controls the host hangs at the BOTTOM of the column, under a rule — `stripButton` is the look they take. */
  footer?: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label="mode"
      className={`flex w-8 shrink-0 flex-col items-center gap-0.5 border-r border-border bg-background/60 py-1 ${className ?? ""}`}
    >
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onPick(m)}
          aria-pressed={m === current}
          title={title(m)}
          aria-label={title(m)}
          className={stripButton(m === current)}
        >
          <ModeIcon mode={m} />
        </button>
      ))}
      {/* `mt-auto` is what makes it the BOTTOM of the column rather than the end of the modes. */}
      {footer && (
        <div className="mt-auto flex flex-col items-center gap-0.5 border-border border-t pt-1">
          {footer}
        </div>
      )}
    </div>
  );
}
