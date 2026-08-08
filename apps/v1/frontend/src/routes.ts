// routes.ts — the URL <-> screen mapping, in one place. v1 shows one view at a time and the
// address says which. Pure functions, so both directions can be tested as a sequence; the hook
// is useViewRoute. Same shape as m9's routes.ts and l8's, for the same reason.

/** The two views. `cut` is the timeline plus the viewport — the app's actual work; `edit` is the
 *  YAML behind it, which is where a lane's geometry and a shape's fields are written. */
export const VIEW_IDS = ["cut", "edit"] as const;
export type ViewId = (typeof VIEW_IDS)[number];

const isView = (s: string): s is ViewId =>
  (VIEW_IDS as readonly string[]).includes(s);

/** What the URL carries. */
export interface RouteState {
  view: ViewId;
  /** The file the editor has open, or null. Only `edit` carries one.
   *  WORKSPACE-relative (`film.v1/video_tracks/main.yaml`) — that is what the tree hands out
   *  and what `read`/`write` take, so it travels to the address unchanged. */
  file: string | null;
}

/** Where the app opens with no address to go on. */
export const DEFAULT_VIEW: ViewId = "cut";

export function toPath(s: RouteState): string {
  return s.view === "edit" && s.file ? `/edit/${s.file}` : `/${s.view}`;
}

/**
 * Read a location back into a screen.
 *
 * An unknown first segment falls back to the default view rather than 404ing inside the app:
 * the URL bar is user-editable, and a typo should land somewhere usable. A file under a view
 * that cannot open one is dropped for the same reason — it names nothing.
 */
export function fromLocation(pathname: string): RouteState {
  const segs = pathname.split("/").filter(Boolean);
  const [head, ...rest] = segs;
  if (!head || !isView(head)) return { view: DEFAULT_VIEW, file: null };
  const file = head === "edit" && rest.length ? rest.join("/") : null;
  return { view: head, file };
}

/** Same screen? What both directions of the hook use to decide there is nothing to do. */
export const sameRoute = (a: RouteState, b: RouteState): boolean =>
  a.view === b.view && a.file === b.file;
