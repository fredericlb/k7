// routes.ts — the URL <-> screen mapping, in one place. `full` (a fullscreened pane) owns the
// PATH, while `panel` is a modifier on whichever screen you're on and rides as a query
// parameter. There is one LAYOUT and it is not addressable: which panes it holds is what the
// project declares. See docs/shellRouting.md.

export type Pane =
  | "editor"
  | "viewport"
  | "timeline"
  | "turntables"
  | "mastering"
  | "chains";
// No `View` and no `docs` panel: there is ONE layout, and which panes it holds is `viewPanes`' answer (docs/shellRouting.md).
export type Panel = "event" | "graph" | "logs";

/** The part of the shell's state the URL carries. */
export interface RouteState {
  full: Pane | null;
  panel: Panel | null;
  help: boolean;
  /** The CHAIN BUILDER: a library chain by its ref, or null — a screen over the layout, and `""` is the LIST (docs/chainsBuilder.md). */
  builder: string | null;
}

const PANES: Pane[] = [
  "editor",
  "viewport",
  "timeline",
  "turntables",
  "mastering",
  "chains",
];
const PANELS: Panel[] = ["event", "graph", "logs"];

/** What a layout does with the panes: the `ring` it cycles, and what `full` may fullscreen. */
export interface Layout {
  ring: Pane[];
  fullscreen: Pane[];
}

/** What the open project DECLARES, which is the whole of what decides the layout — an object, three booleans saying nothing positionally. */
export interface Declared {
  /** A `split` surface of type `timeline` — the arrangement. */
  timeline?: boolean;
  /** A `split` surface of type `viewport` — the frame. */
  viewport?: boolean;
  /** A `split` surface of type `turntables` — the desk. */
  turntables?: boolean;
  /** A `split` surface of type `mastering` — the master strip over one quick-master node. */
  mastering?: boolean;
  /** A shared SNAPSHOT: no source behind it, so no editor. Not about the project. */
  frozen?: boolean;
}

/** What the layout does with the panes, given what the PROJECT declares — a FUNCTION, four of the six panes not being the shell's to assume (docs/shellRouting.md). */
export function viewPanes({
  timeline = false,
  viewport = false,
  turntables = false,
  mastering = false,
  frozen = false,
}: Declared): Layout {
  const picture: Pane[] = viewport ? ["viewport"] : [];
  const arrangement: Pane[] = timeline ? ["timeline"] : [];
  const desk: Pane[] = turntables ? ["turntables"] : [];
  // Directly over the graph and below everything else: the master strip is the LAST thing the signal meets.
  const master: Pane[] = mastering ? ["mastering"] : [];
  const ring: Pane[] = [
    ...picture,
    ...arrangement,
    ...desk,
    ...master,
    "chains",
  ];
  return { ring, fullscreen: frozen ? ring : ["editor", ...ring] };
}

const isPane = (s: string): s is Pane => (PANES as string[]).includes(s);
const isPanel = (s: string): s is Panel => (PANELS as string[]).includes(s);

/** The path + search for a screen — with one layout there is nothing to name but a fullscreened pane, the chain builder and the docs. */
export function toPath(s: RouteState, search = ""): string {
  // Help wins, then the chain builder, then a fullscreened pane: the order is the stacking order on screen.
  const path = s.help
    ? "/docs"
    : s.builder !== null
      ? s.builder
        ? `/chains-builder/${s.builder.split("/").map(encodeURIComponent).join("/")}`
        : "/chains-builder"
      : s.full
        ? `/${s.full}`
        : "/";
  // `panel` is the ONE parameter this router owns; every other one belongs to somebody else — an
  // instrument's `?profile=1`, a link someone pasted — and rebuilding the address from the state
  // alone silently ate them all. See docs/shellRouting.md.
  const q = new URLSearchParams(search);
  q.delete("panel");
  if (s.panel) q.set("panel", s.panel);
  const rest = q.toString();
  return rest ? `${path}?${rest}` : path;
}

/** Read a location back into state — an unknown path, or one naming a pane the project has not got, falls through to the layout. */
export function fromLocation(
  pathname: string,
  search: string,
  /** What the project declares: `timeline` defaults TRUE here and false in `viewPanes`, so a caller without the surface list reads addresses as before. */
  declared: Declared = {},
): RouteState {
  const seg = pathname.replace(/^\/+|\/+$/g, "");
  const panelParam = new URLSearchParams(search).get("panel") ?? "";
  const panel = isPanel(panelParam) ? panelParam : null;
  const base = {
    full: null,
    panel,
    help: false,
    builder: null,
  };

  // `/help` is an alias of `/docs`: a bookmark on either address lands on the documentation rather than elsewhere.
  if (seg === "docs" || seg === "help") return { ...base, help: true };
  // `/chains-builder` is the LIST and `/chains-builder/<ref>` one chain — the tail taken whole, a ref having slashes of its own.
  if (seg === "chains-builder") return { ...base, builder: "" };
  if (seg.startsWith("chains-builder/")) {
    const ref = seg.slice("chains-builder/".length);
    let decoded = ref;
    try {
      decoded = decodeURIComponent(ref);
    } catch {
      // A hand-typed % that is not an escape — kept rather than thrown, as parseLaunch does.
    }
    return { ...base, builder: decoded };
  }
  // `??`, not a spread over a literal: an explicit `timeline: undefined` would win the spread and land on `viewPanes`' own `false`.
  const layout = viewPanes({
    ...declared,
    timeline: declared.timeline ?? true,
  });
  // A pane the layout cannot fullscreen is not an address here; it falls through to the layout's own screen rather than 404ing.
  if (isPane(seg) && layout.fullscreen.includes(seg))
    return { ...base, full: seg };
  // `/video` is an alias for `/viewport`, subject to the same check as any other address.
  if (seg === "video" && layout.fullscreen.includes("viewport"))
    return { ...base, full: "viewport" };
  return base;
}

/** Do two route states describe the same URL? What breaks the state⇄URL feedback loop, neither side acting when the other agrees. */
export const sameRoute = (a: RouteState, b: RouteState): boolean =>
  toPath(a) === toPath(b);
