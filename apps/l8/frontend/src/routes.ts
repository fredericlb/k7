// routes.ts — the URL <-> view mapping, in one place. The screen is three ORTHOGONAL
// pieces: `view` (the layout) and `full` (a fullscreened pane) own the PATH, while
// `panel` is a modifier on whichever screen you're on and rides as a query parameter.
// See docs/shellRouting.md.

export type Pane = "editor" | "viewport" | "timeline" | "chains";
/**
 * The layouts. `global` is the timeline over the graph; `live` is the graph and nothing else.
 *
 * A layout is the shell's own idea of which panes are on screen, and it is `viewPanes` below
 * that every pane ring and every fullscreen exit reads. Going through it rather than through a
 * table is what keeps "which panes are on screen" answerable in one place: whether a project
 * draws picture, or an arrangement, is a PANE and not a layout, so this list stays at two.
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

const PANES: Pane[] = ["editor", "viewport", "timeline", "chains"];
const PANELS: Panel[] = ["graph", "logs"];

/** What a layout does with the panes: the `ring` it cycles, and what `full` may fullscreen. */
export interface Layout {
  ring: Pane[];
  fullscreen: Pane[];
}

/**
 * What each layout does with the panes, given what the PROJECT declares.
 *
 * A FUNCTION rather than a table, because two of the four panes are not the shell's to assume:
 * the timeline and the viewport are both `split` surfaces (`surfaces/`, `type: timeline` /
 * `type: viewport`), so a project that declares neither has no arrangement and no frame to
 * show, and a list naming one would name a pane that will not be mounted. Both flags come down
 * from the one place that has the surface list. See packages/song/docs/surfaces.md.
 *
 * Here rather than in `shellMeta` beside the icons because `fromLocation` below reads it — an
 * address naming a pane the layout hasn't got must not parse into a screen that cannot be drawn.
 * The icons are presentation; this is the layout itself.
 *
 * The ring is built TOP-DOWN, in the order the panes are stacked on screen: the frame over the
 * arrangement over the graph. The number keys and the mobile tabs read it, so a ring that
 * disagreed with the column would make `2` land somewhere the eye did not expect.
 *
 * `live` with nothing declared fullscreens NOTHING, and that is not an omission: its one pane
 * already has the whole window, so every `full` value would either be a no-op or hide the only
 * thing on screen. A rig that declares a VIEWPORT has two panes and so has fullscreens — a rig
 * with picture is a real thing, and the declaration is what says so. The editor is absent from
 * live's lists either way and still reachable: `ui file` brings it as a POPIN, which is not a
 * pane and belongs to no layout (docs/shell.md). A `global` view with no timeline lands in the
 * same place from the other side, and keeps its editor: it is a song whose arrangement is
 * simply not declared, not a rig.
 */
export function viewPanes(
  view: View,
  timeline: boolean,
  viewport = false,
): Layout {
  const picture: Pane[] = viewport ? ["viewport"] : [];
  if (view === "live") {
    const ring: Pane[] = [...picture, "chains"];
    return { ring, fullscreen: viewport ? ring : [] };
  }
  const arrangement: Pane[] = timeline ? ["timeline"] : [];
  const ring: Pane[] = [...picture, ...arrangement, "chains"];
  return { ring, fullscreen: ["editor", ...ring] };
}

const isPane = (s: string): s is Pane => (PANES as string[]).includes(s);
const isPanel = (s: string): s is Panel => (PANELS as string[]).includes(s);

/**
 * The path + search for a screen. `view` reaches the URL only when there is a second layout to
 * name — `live` is derived from the project rather than chosen, so the only paths left are a
 * fullscreened pane and the root.
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
  // The same, for the frame. NOT defaulted to true: a timeline is what almost every project has,
  // while picture is the exception — so the optimistic default that keeps `/timeline` working on
  // the first frame would make `/viewport` briefly parse for every song that has no picture at all.
  viewport = false,
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
  const layout = viewPanes(current, timeline, viewport);
  // A pane the CURRENT layout cannot fullscreen is not an address here — `/timeline` typed at a
  // live project, or at one that declares no timeline surface, names a pane that project hasn't
  // got. It falls through to the layout's own screen rather than 404ing, for the same reason an
  // unknown segment does.
  if (isPane(seg) && layout.fullscreen.includes(seg))
    return { ...base, full: seg };
  // `/video` is an alias for `/viewport`, so an old bookmark lands on the frame rather than
  // nowhere — subject to the same check as any other address, so a song without picture still
  // falls through to its layout.
  if (seg === "video" && layout.fullscreen.includes("viewport"))
    return { ...base, full: "viewport" };
  return base;
}

/** Do two route states describe the same URL? Used to break the state⇄URL feedback
 *  loop: neither side acts when the other already agrees. */
export const sameRoute = (a: RouteState, b: RouteState): boolean =>
  toPath(a) === toPath(b);
