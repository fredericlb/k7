// routes.ts — the URL <-> view mapping, in one place. The screen is three ORTHOGONAL
// pieces: `view` (the layout) and `full` (a fullscreened pane) own the PATH, while
// `panel` is a modifier on whichever screen you're on and rides as a query parameter.
// See docs/shellRouting.md.

export type Pane = "editor" | "timeline" | "chains" | "viewport";
export type View = "global" | "video";
export type Panel = "editor" | "mixer" | "graph" | "docs" | "logs";

/** The part of the shell's state the URL carries. */
export interface RouteState {
  view: View;
  full: Pane | null;
  panel: Panel | null;
  help: boolean;
}

const PANES: Pane[] = ["editor", "timeline", "chains", "viewport"];
const PANELS: Panel[] = ["editor", "mixer", "graph", "docs", "logs"];

const isPane = (s: string): s is Pane => (PANES as string[]).includes(s);
const isPanel = (s: string): s is Panel => (PANELS as string[]).includes(s);

/**
 * The path + search for a screen. `view` only reaches the URL when nothing is
 * fullscreened: `/video` names the LAYOUT, and once a pane is expanded the layout under
 * it is not what you are looking at.
 */
export function toPath(s: RouteState): string {
  const path = s.help
    ? "/docs"
    : s.full
      ? `/${s.full}`
      : s.view === "video"
        ? "/video"
        : "/";
  return s.panel ? `${path}?panel=${s.panel}` : path;
}

/**
 * Read a location back into state. Unknown paths fall back to the global view rather
 * than 404ing inside the app — the URL bar is user-editable, and a typo should land
 * somewhere usable.
 *
 * `view` is deliberately NOT inferred for a fullscreen path: the caller keeps whatever
 * layout it had, so leaving `/timeline` returns you to the video layout if that is where
 * you came from.
 */
export function fromLocation(
  pathname: string,
  search: string,
  current: View,
): RouteState {
  const seg = pathname.replace(/^\/+|\/+$/g, "");
  const panelParam = new URLSearchParams(search).get("panel") ?? "";
  const panel = isPanel(panelParam) ? panelParam : null;

  // `/help` still lands here: it was the docs' address for a while, and a bookmark shouldn't drop you elsewhere.
  if (seg === "docs" || seg === "help")
    return { view: current, full: null, panel, help: true };
  if (isPane(seg)) return { view: current, full: seg, panel, help: false };
  if (seg === "video") return { view: "video", full: null, panel, help: false };
  return { view: "global", full: null, panel, help: false };
}

/** Do two route states describe the same URL? Used to break the state⇄URL feedback
 *  loop: neither side acts when the other already agrees. */
export const sameRoute = (a: RouteState, b: RouteState): boolean =>
  toPath(a) === toPath(b);
