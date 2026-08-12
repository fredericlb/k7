// routes.ts — the URL <-> view mapping, in one place. The screen is three ORTHOGONAL
// pieces: `view` (the layout) and `full` (a fullscreened pane) own the PATH, while
// `panel` is a modifier on whichever screen you're on and rides as a query parameter.
// See docs/shellRouting.md.

export type Pane = "editor" | "timeline" | "chains";
/**
 * The layouts. `global` is the timeline over the graph; `live` is the graph and nothing else.
 *
 * A layout is the shell's own idea of which panes are on screen, and it is `viewPanes` below
 * that every pane ring and every fullscreen exit reads. That indirection was kept when picture
 * left for v1 and only `global` remained, precisely so a second layout could come back without
 * spreading the assumption across twenty call sites — this is it.
 *
 * `live` is NOT chosen from the header: it is what the open PROJECT is (project.yaml's
 * `project_type`), so it is derived rather than toggled, and the shell refuses to leave it.
 * See packages/song/docs/projectMode.md and docs/shellRouting.md.
 */
export type View = "global" | "live";
// `docs` was a third panel — a project's notes and to-dos, listed in one place. It is gone:
// a note is a doc module IN the graph now, toggled beside the mixer. See
// packages/song/docs/docModules.md.
export type Panel = "graph" | "logs";

/** The part of the shell's state the URL carries. */
export interface RouteState {
  view: View;
  full: Pane | null;
  panel: Panel | null;
  help: boolean;
  /**
   * The open SURFACE, by its filename, or null.
   *
   * Not a `Pane`, and that is the whole of why it is its own field. A pane is one of three the
   * shell has always had, and `viewPanes` says what each layout does with them; a surface is
   * declared by the PROJECT, so the list is not knowable until one is open and a union could
   * not name it. It behaves like `help` instead — a screen that comes over the layout, leaves
   * it untouched underneath, and is reached from the header. See
   * packages/song/docs/surfaces.md.
   */
  surface: string | null;
}

const PANES: Pane[] = ["editor", "timeline", "chains"];
const PANELS: Panel[] = ["graph", "logs"];

/** What a layout does with the panes: the `ring` it cycles, and what `full` may fullscreen. */
export interface Layout {
  ring: Pane[];
  fullscreen: Pane[];
}

/**
 * What each layout does with the panes, given what the PROJECT declares.
 *
 * A FUNCTION rather than the table it used to be, because one of the three panes is no longer
 * the shell's to assume: the timeline is a `split` surface now (`surfaces/`, `type: timeline`),
 * so a project that declares none has no arrangement to show and every list that named one was
 * naming a pane that will not be mounted. `timeline` is that declaration, passed down from the
 * one place that has the surface list. See packages/song/docs/surfaces.md.
 *
 * Here rather than in `shellMeta` beside the icons because `fromLocation` below reads it — an
 * address naming a pane the layout hasn't got must not parse into a screen that cannot be drawn.
 * The icons are presentation; this is the layout itself.
 *
 * `live` fullscreens NOTHING, and that is not an omission: its one pane already has the whole
 * window, so every `full` value would either be a no-op or hide the only thing on screen. The
 * editor is absent from both of its lists and still reachable — `ui file` brings it as a POPIN,
 * which is not a pane and belongs to no layout (docs/shell.md). A `global` view with no timeline
 * lands in the same place from the other side, and keeps its editor: it is a song whose
 * arrangement is simply not declared, not a rig.
 */
export function viewPanes(view: View, timeline: boolean): Layout {
  if (view === "live") return { ring: ["chains"], fullscreen: [] };
  return timeline
    ? {
        ring: ["timeline", "chains"],
        fullscreen: ["editor", "timeline", "chains"],
      }
    : { ring: ["chains"], fullscreen: ["editor", "chains"] };
}

const isPane = (s: string): s is Pane => (PANES as string[]).includes(s);
const isPanel = (s: string): s is Panel => (PANELS as string[]).includes(s);

/**
 * The path + search for a screen. `view` reaches the URL only when there is a second layout
 * to name — there is not, now that picture is v1's, so the only paths left are a fullscreened
 * pane and the root.
 */
export function toPath(s: RouteState): string {
  // Help wins, then a surface, then a fullscreened pane. The order is the stacking order on
  // screen — each of these covers the one after it, so the URL names the topmost.
  const path = s.help
    ? "/docs"
    : s.surface
      ? `/surface/${encodeURIComponent(s.surface)}`
      : s.full
        ? `/${s.full}`
        : "/";
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
  // Whether the project declares a timeline, for the same reason `viewPanes` takes it: `/timeline`
  // must not parse into a pane nothing will mount. Defaulted, so a caller that has not got the
  // surface list yet reads addresses exactly as it did before.
  timeline = true,
): RouteState {
  const seg = pathname.replace(/^\/+|\/+$/g, "");
  const panelParam = new URLSearchParams(search).get("panel") ?? "";
  const panel = isPanel(panelParam) ? panelParam : null;
  const base = { view: current, full: null, panel, help: false, surface: null };

  // `/help` still lands here: it was the docs' address for a while, and a bookmark shouldn't drop you elsewhere.
  if (seg === "docs" || seg === "help") return { ...base, help: true };
  // `/surface/<id>`. The id is NOT checked against the project's list: the surfaces arrive a
  // moment after the shell does, so an address that named one would parse to "no surface" on
  // every deep link and quietly drop you on the layout. The screen resolves it once they land,
  // and says so if there is no such file.
  if (seg.startsWith("surface/")) {
    const id = seg.slice("surface/".length);
    if (id) {
      let decoded = id;
      try {
        decoded = decodeURIComponent(id);
      } catch {
        // A hand-typed % that is not an escape — keep it rather than throwing, as parseLaunch does.
      }
      return { ...base, surface: decoded };
    }
  }
  // A pane the CURRENT layout cannot fullscreen is not an address here — `/timeline` typed at a
  // live project, or at one that declares no timeline surface, names a pane that project hasn't
  // got. It falls through to the layout's own screen rather than 404ing, for the same reason an
  // unknown segment does.
  if (isPane(seg) && viewPanes(current, timeline).fullscreen.includes(seg))
    return { ...base, full: seg };
  // `/video` still parses, to whichever layout is current: it was a real address for a year, and
  // a bookmark should land somewhere usable rather than nowhere.
  return base;
}

/** Do two route states describe the same URL? Used to break the state⇄URL feedback
 *  loop: neither side acts when the other already agrees. */
export const sameRoute = (a: RouteState, b: RouteState): boolean =>
  toPath(a) === toPath(b);
