// routes.ts — the URL <-> screen mapping, in one place. `full` (a fullscreened pane) owns the
// PATH, while `panel` is a modifier on whichever screen you're on and rides as a query
// parameter. There is one LAYOUT and it is not addressable: which panes it holds is what the
// project declares. See docs/shellRouting.md.

export type Pane = "editor" | "viewport" | "timeline" | "chains";
// `View` was here: `global` (the timeline over the graph) or `live` (the graph alone), derived
// from `project.yaml`'s `project_type`. Both are gone. There is ONE layout now, and which panes
// it holds is what the project DECLARES in `surfaces/` -- so the layout list collapsed into
// `viewPanes`' arguments, which is where the answer already came from. See docs/shellRouting.md
// and packages/song/docs/surfaces.md.
// `docs` was a third panel — a project's notes and to-dos, listed in one place. It is gone:
// a note is a doc module IN the graph now, toggled beside the mixer. See
// packages/song/docs/docModules.md.
export type Panel = "graph" | "logs";

/** The part of the shell's state the URL carries. */
export interface RouteState {
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
  /**
   * The CHAIN BUILDER: a library chain being edited, by its ref (`process/normalize`), or null.
   *
   * A screen over the layout, like `help` and a surface — not a `Pane`, because the four panes
   * are the shell's own and this one edits a document that is not the open project. What it
   * draws is the ordinary graph editor pointed at a chain's `chains.yaml` instead of the
   * project's `graph.yaml`; that the two are the same document under two names is
   * `graphFileOf`'s doing, in @studio/song. See docs/chainsBuilder.md.
   *
   * The empty string is the LIST — the builder open on no chain yet — which is a real state and
   * not "closed": `/chains-builder` is an address you can bookmark before picking one.
   */
  builder: string | null;
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
 * A project that declares NEITHER is left with the graph alone, and it keeps its editor: it
 * is a song whose arrangement has not been written down, and the pane you would write it in
 * is the editor. This used to be two cases -- a `live` project fullscreened nothing at all,
 * while a `global` one with no timeline landed here -- and the difference was the editor. One
 * of them had to go when the mode did, and this is the half that leaves you somewhere to work.
 *
 * `frozen` is the third of these, and the only one that is not about the project: a SHARED
 * snapshot has no source at all — no `/tree`, no `/file` — so the editor is not a pane whose
 * document happens to be read-only, it is a pane with nothing behind it. Dropping it here rather
 * than hiding a button is the point: this list is what the number keys, the mobile tabs, `ui
 * editor` and every address all read, so one omission closes them together.
 */
export function viewPanes(
  timeline: boolean,
  viewport = false,
  frozen = false,
): Layout {
  const picture: Pane[] = viewport ? ["viewport"] : [];
  const arrangement: Pane[] = timeline ? ["timeline"] : [];
  const ring: Pane[] = [...picture, ...arrangement, "chains"];
  return { ring, fullscreen: frozen ? ring : ["editor", ...ring] };
}

const isPane = (s: string): s is Pane => (PANES as string[]).includes(s);
const isPanel = (s: string): s is Panel => (PANELS as string[]).includes(s);

/**
 * The path + search for a screen. With one layout there is nothing to name but a fullscreened
 * pane, a surface, the chain builder and the docs -- so those are the only paths there are.
 */
export function toPath(s: RouteState): string {
  // Help wins, then the chain builder, then a surface, then a fullscreened pane. The order is the
  // stacking order on screen — each of these covers the one after it, so the URL names the topmost.
  const path = s.help
    ? "/docs"
    : s.builder !== null
      ? s.builder
        ? `/chains-builder/${s.builder.split("/").map(encodeURIComponent).join("/")}`
        : "/chains-builder"
      : s.surface
        ? `/surface/${encodeURIComponent(s.surface)}`
        : s.full
          ? `/${s.full}`
          : "/";
  return s.panel ? `${path}?panel=${s.panel}` : path;
}

/**
 * Read a location back into state. Unknown paths fall back to the layout rather
 * than 404ing inside the app — the URL bar is user-editable, and a typo should land
 * somewhere usable.
 *
 * There is no layout to infer: `viewPanes` answers from what the project declares, and this
 * reads an address against that answer -- an address naming a pane the project has not got
 * falls through to the layout rather than parsing into a screen nothing will draw.
 */
export function fromLocation(
  pathname: string,
  search: string,
  // Whether the project declares a timeline, for the same reason `viewPanes` takes it: `/timeline`
  // must not parse into a pane nothing will mount. Defaulted, so a caller that has not got the
  // surface list yet reads addresses exactly as it did before.
  timeline = true,
  // The same, for the frame. NOT defaulted to true: a timeline is what almost every project has,
  // while picture is the exception — so the optimistic default that keeps `/timeline` working on
  // the first frame would make `/viewport` briefly parse for every song that has no picture at all.
  viewport = false,
  // A shared snapshot, which has no source to edit — so `/editor` must not parse into one either.
  frozen = false,
): RouteState {
  const seg = pathname.replace(/^\/+|\/+$/g, "");
  const panelParam = new URLSearchParams(search).get("panel") ?? "";
  const panel = isPanel(panelParam) ? panelParam : null;
  const base = {
    full: null,
    panel,
    help: false,
    surface: null,
    builder: null,
  };

  // `/help` still lands here: it was the docs' address for a while, and a bookmark shouldn't drop you elsewhere.
  if (seg === "docs" || seg === "help") return { ...base, help: true };
  // `/chains-builder` is the LIST, `/chains-builder/<ref>` one chain. A ref has slashes of its
  // own (`process/normalize`), so the tail is taken whole rather than split — the same reason a
  // surface id is. Not checked against the library: the chains arrive after the shell, exactly
  // as the surfaces do, and an address that named one would parse to "no chain" on every deep link.
  if (seg === "chains-builder") return { ...base, builder: "" };
  if (seg.startsWith("chains-builder/")) {
    const ref = seg.slice("chains-builder/".length);
    let decoded = ref;
    try {
      decoded = decodeURIComponent(ref);
    } catch {
      // A hand-typed % that is not an escape — kept, as the surface branch keeps it.
    }
    return { ...base, builder: decoded };
  }
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
  const layout = viewPanes(timeline, viewport, frozen);
  // A pane the layout cannot fullscreen is not an address here: `/timeline` at a project that
  // declares no timeline surface names a pane that project hasn't got. It falls through to the
  // layout's own screen rather than 404ing, for the same reason an unknown segment does.
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
