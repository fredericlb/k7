// routes.ts — the URL <-> view mapping, in one place. The screen is three ORTHOGONAL
// pieces: `view` (the layout) and `full` (a fullscreened pane) own the PATH, while
// `panel` is a modifier on whichever screen you're on and rides as a query parameter.
// See docs/shellRouting.md.

export type Pane = "editor" | "timeline" | "chains";
/**
 * The layouts. ONE of them, since picture left for v1 — `video` was the second, and it
 * put the renderer where the graph sits.
 *
 * Kept as a type rather than deleted along with `view`: a layout is the shell's own idea
 * (which pane fills the bottom-right slot), and it is `VIEW_META[view].third` that every
 * pane ring and every fullscreen exit reads. Collapsing that to a constant would spread
 * the assumption across twenty call sites for a saving of one field.
 */
export type View = "global";
export type Panel = "graph" | "docs" | "logs";

/** The part of the shell's state the URL carries. */
export interface RouteState {
  view: View;
  full: Pane | null;
  panel: Panel | null;
  help: boolean;
}

const PANES: Pane[] = ["editor", "timeline", "chains"];
const PANELS: Panel[] = ["graph", "docs", "logs"];

const isPane = (s: string): s is Pane => (PANES as string[]).includes(s);
const isPanel = (s: string): s is Panel => (PANELS as string[]).includes(s);

/**
 * The path + search for a screen. `view` reaches the URL only when there is a second layout
 * to name — there is not, now that picture is v1's, so the only paths left are a fullscreened
 * pane and the root.
 */
export function toPath(s: RouteState): string {
  const path = s.help ? "/docs" : s.full ? `/${s.full}` : "/";
  return s.panel ? `${path}?panel=${s.panel}` : path;
}

/**
 * Read a location back into state. Unknown paths fall back to the global view rather
 * than 404ing inside the app — the URL bar is user-editable, and a typo should land
 * somewhere usable.
 *
 * `view` is deliberately NOT inferred for a fullscreen path: the caller keeps whatever
 * layout it had. With one layout left that is a distinction without a difference, and it stays
 * because the rule is the routing's and not the layout list's.
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
  // `/video` still parses, to the only layout there is: it was a real address for a year, and a
  // bookmark should land somewhere usable rather than nowhere.
  return { view: "global", full: null, panel, help: false };
}

/** Do two route states describe the same URL? Used to break the state⇄URL feedback
 *  loop: neither side acts when the other already agrees. */
export const sameRoute = (a: RouteState, b: RouteState): boolean =>
  toPath(a) === toPath(b);
