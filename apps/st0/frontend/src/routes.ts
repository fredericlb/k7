// routes.ts — the URL <-> screen mapping, in one place. The address is the origin-relative
// path of what you are looking at: the section is the first segment (which is also the family
// folder's name), and the rest is the file the builder has open, if any.
// Pure functions, so both directions can be tested as a sequence; the hook is useLibraryRoute.

/** The seven things the header offers, plus two sections with NO TAB, each reached by a button
 *  on the section it belongs to: `engine` (the cog's engine-status page) and `find` (« Trouver
 *  des morceaux », opened from Morceaux). `recordings` and `projects` are sections and not
 *  families — see Library.tsx. A section id may not collide with a path the proxy claims above
 *  st0's catch-all (`/l8`, `/m9`, `/k7`, `/z0`, `/dev`, `/console`, `/dev-status`); see
 *  docs/routing.md. */
export const SECTION_IDS = [
  "songs",
  "samples",
  "modules",
  "chains",
  "playlists",
  "recordings",
  "projects",
  "engine",
  "find",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** Named, like `RECORDINGS_DIR` is, so the section that is not a family reads as one thing. */
export const PROJECTS_SECTION = "projects";

/**
 * The sections whose address carries a second half — everything else is a listing, and a path
 * under one of those names nothing.
 *
 * A LIST rather than four `head === …` tests, because it stopped being two: `chains` opened an
 * editor and pushed `/chains/x/chains.yaml`, which read back as the bare section and shut the
 * editor a tick later — the loop useLibraryRoute exists to avoid, entered through the one door
 * it does not guard, a URL the app writes and cannot read. `songs` now opens one too.
 */
const CARRIES: readonly string[] = [
  "songs",
  "modules",
  "chains",
  "playlists",
  "projects",
];

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
   *
   * Under `projects` it is not a file but a REPOSITORY id — the section has no builder, and
   * what the address has to carry is which repository is open. Same slot, because it is the
   * same question ("what, inside this section, are you looking at") and a second field would
   * be empty for most of the sections.
   */
  file: string | null;
}

/**
 * Where the app opens with no address to go on.
 *
 * Projets, not Morceaux: the médiathèque is the studio's front door, and the first thing you
 * want at a front door is your own work. The catalogue is what a project DRAWS ON, so it is
 * one tab away rather than in the way. Note the consequence for `fromLocation` — an unknown
 * address now lands on the repositories too.
 */
export const DEFAULT_SECTION: SectionId = PROJECTS_SECTION;

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
