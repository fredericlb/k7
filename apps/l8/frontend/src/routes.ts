// routes.ts — the URL <-> view mapping, in one place. The screen is three ORTHOGONAL
// pieces: `view` (the layout) and `full` (a fullscreened pane) own the PATH, while
// `panel` is a modifier on whichever screen you're on and rides as a query parameter.
// See docs/shellRouting.md.

export type Pane = "editor" | "timeline" | "chains";
/**
 * The layouts. `global` is the timeline over the graph; `live` is the graph and nothing else.
 *
 * A layout is the shell's own idea of which panes are on screen, and it is `VIEW_META[view]`
 * that every pane ring and every fullscreen exit reads. That indirection was kept when picture
 * left for v1 and only `global` remained, precisely so a second layout could come back without
 * spreading the assumption across twenty call sites — this is it.
 *
 * `live` is NOT chosen from the header: it is what the open PROJECT is (project.yaml's
 * `project_type`), so it is derived rather than toggled, and the shell refuses to leave it.
 * See packages/song/docs/projectMode.md and docs/shellRouting.md.
 */
export type View = "global" | "live";
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

/**
 * What each layout does with the panes: the `ring` it shows, and what `full` may fullscreen.
 *
 * Here rather than in `shellMeta` beside the icons because `fromLocation` below reads it — an
 * address naming a pane the layout hasn't got must not parse into a screen that cannot be drawn.
 * The icons are presentation; this is the layout itself.
 *
 * `live` fullscreens NOTHING, and that is not an omission: its one pane already has the whole
 * window, so every `full` value would either be a no-op or hide the only thing on screen. The
 * editor is absent from both of its lists and still reachable — `ui file` brings it as a POPIN,
 * which is not a pane and belongs to no layout (docs/shell.md).
 */
export const VIEW_PANES: Record<View, { ring: Pane[]; fullscreen: Pane[] }> = {
  global: {
    ring: ["timeline", "chains"],
    fullscreen: ["editor", "timeline", "chains"],
  },
  live: { ring: ["chains"], fullscreen: [] },
};

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
  // A pane the CURRENT layout cannot fullscreen is not an address here — `/timeline` typed at a
  // live project names a pane that project hasn't got. It falls through to the layout's own
  // screen rather than 404ing, for the same reason an unknown segment does.
  if (isPane(seg) && VIEW_PANES[current].fullscreen.includes(seg))
    return { view: current, full: seg, panel, help: false };
  // `/video` still parses, to whichever layout is current: it was a real address for a year, and
  // a bookmark should land somewhere usable rather than nowhere.
  return { view: current, full: null, panel, help: false };
}

/** Do two route states describe the same URL? Used to break the state⇄URL feedback
 *  loop: neither side acts when the other already agrees. */
export const sameRoute = (a: RouteState, b: RouteState): boolean =>
  toPath(a) === toPath(b);
