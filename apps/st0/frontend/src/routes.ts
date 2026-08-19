// routes.ts — the URL <-> screen mapping, in one place. The address is the origin-relative
// path of what you are looking at: the section is the first segment (which is also the family
// folder's name), and the rest is the file the builder has open, if any.
// Pure functions, so both directions can be tested as a sequence; the hook is useLibraryRoute.

/** The four things the header offers, plus two sections with NO TAB, each reached by a button
 *  on the section it belongs to: `engine` (the cog's engine-status page) and `find` (« Trouver
 *  des morceaux », opened from Morceaux). `recordings` is a section and not a family — see
 *  Library.tsx. A section id may not collide with a path the proxy claims above st0's catch-all
 *  (`/l8`, `/m9`, `/k7`, `/z0`, `/dev`, `/console`, `/dev-status`); see docs/routing.md.
 *
 *  THREE sections left, and all three for one reason: they were about AUTHORING, and authoring
 *  happens in l8. `modules` and `chains` went with the editing — a module is written against a
 *  project where the plugin it names is actually LOADED, and committed to the account's library
 *  repository. `projects` went with the level above a project, which belongs to the editor that
 *  opens one: the repositories, the libraries, the deploy key and the shares, and this app's
 *  DEFAULT section at the time. What is left here is the catalogue, which is what a project
 *  draws ON.
 *
 *  What did NOT move is the backend: `/api/projects` and `/api/shares` are still this service's,
 *  and l8 calls them across the origin. An address under any of the three now falls through to
 *  the default like any other unknown path. See apps/l8/frontend/docs/projects.md. */
export const SECTION_IDS = [
  "songs",
  "samples",
  "playlists",
  "recordings",
  "engine",
  "find",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/**
 * The sections whose address carries a second half — everything else is a listing, and a path
 * under one of those names nothing.
 *
 * A LIST rather than two `head === …` tests, because it has changed size three times now:
 * `chains` once opened an editor and pushed `/chains/x/graph.yaml`, which read back as the bare
 * section and shut the editor a tick later — the loop useLibraryRoute exists to avoid, entered
 * through the one door it does not guard, a URL the app writes and cannot read. That section is
 * gone, and so are `modules` and `projects`; the shape of the mistake is why this is a list and
 * not a pair of tests that would have to be found and edited each time.
 */
const CARRIES: readonly string[] = ["songs", "playlists"];

const isSection = (s: string): s is SectionId =>
  (SECTION_IDS as readonly string[]).includes(s);

/** What the URL carries. */
export interface RouteState {
  section: SectionId;
  /**
   * The file the builder is showing, SECTION-relative ("audio/reverb/ui.yaml"), or null when
   * nothing is open.
   *
   * Section-relative rather than library-relative, so the two halves don't repeat the
   * section: the path in the address reads exactly like the path on disk, once.
   *
   * A song names its sidecar the way a chain names its `chains.yaml`: the folder IS the entry,
   * so the address ends at the file the left half of the screen is editing.
   *
   * A PLAYLIST is the one that needs no such pairing: its file IS the entry (see
   * packages/mediatek/docs/playlists.md), so the whole of this string is the entry's path and
   * `folderOf` has nothing to take off it. Same slot, same question, one level less of it.
   */
  file: string | null;
}

/**
 * Where the app opens with no address to go on.
 *
 * Morceaux again. It was Projets for as long as this app held the repositories — the argument
 * being that the first thing you want at a front door is your own work — and that argument did
 * not lose, it MOVED: the repositories are l8's home page now, so the front door for one's own
 * work is over there. What is left here is the catalogue, and its first family is the songs.
 */
export const DEFAULT_SECTION: SectionId = "songs";

/**
 * Percent-encoding, per segment.
 *
 * Songs are the reason. A module is a slug and survived a raw path, but a song folder is
 * `segment()`'d from tags and legitimately holds spaces, `&` and parentheses — "Back in Black".
 * The browser encodes those on its way into the URL bar, so `location.pathname` comes back
 * `Back%20in%20Black`, which matches no entry. Encode on the way out, decode on the way in, and
 * the two directions stay inverses — which is the whole contract this file is tested against.
 *
 * Per segment and not over the whole string: `encodeURI` leaves `#` and `?` alone, and a title
 * carrying either would cut the address in half.
 */
const encodePath = (rel: string): string =>
  rel.split("/").map(encodeURIComponent).join("/");

/** …and back. A hand-typed `%zz` throws rather than decoding; the raw segment is the best
 *  remaining guess, and it simply matches no entry, which is what a typo should do. */
const decodeSegment = (seg: string): string => {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
};

/** The path for a screen. */
export function toPath(s: RouteState): string {
  return s.file ? `/${s.section}/${encodePath(s.file)}` : `/${s.section}`;
}

/**
 * Read a location back into a screen.
 *
 * An unknown first segment falls back to the default section rather than 404ing inside the
 * app: the URL bar is user-editable, and a typo should land somewhere usable. A file under a
 * section that cannot open one is dropped for the same reason — it names nothing.
 */
export function fromLocation(pathname: string): RouteState {
  const segs = pathname.split("/").filter(Boolean);
  const [head, ...rest] = segs;
  if (!head || !isSection(head))
    return { section: DEFAULT_SECTION, file: null };
  const file =
    CARRIES.includes(head) && rest.length
      ? rest.map(decodeSegment).join("/")
      : null;
  return { section: head, file };
}

/** Same screen? What both directions of the hook use to decide there is nothing to do. */
export const sameRoute = (a: RouteState, b: RouteState): boolean =>
  a.section === b.section && a.file === b.file;

/** The ENTRY folder a route's file sits in, section-relative, or null. `audio/reverb/ui.yaml`
 *  -> `audio/reverb`, which is the path a tree row and an entry are keyed by. Named for the
 *  folder and not for the module: a chain and a song are addressed the same way. */
export function folderOf(file: string | null): string | null {
  if (!file) return null;
  const cut = file.lastIndexOf("/");
  return cut > 0 ? file.slice(0, cut) : null;
}

/** …and the file's own name, which is what says WHICH of the module's panes is showing. */
export function fileOf(file: string | null): string | null {
  return file ? (file.split("/").pop() ?? null) : null;
}
