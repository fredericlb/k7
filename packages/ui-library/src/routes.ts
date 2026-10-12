// routes.ts — the URL <-> screen mapping, in one place. The address is what you are looking at,
// BELOW the host's prefix (`/media` in st0): the section is the first segment (which is also the
// family folder's name), and the rest is the file the screen has open, if any.
// Pure functions, so both directions can be tested as a sequence; the hook is useLibraryRoute.

/** The four families and zones, plus the hunt — every one an entry of the host's nav. */
export const SECTION_IDS = [
  "songs",
  "samples",
  "recordings",
  "playlists",
  "find",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The sections whose address carries a second half — a LIST, one entry deep (../docs/routing.md). */
const CARRIES: readonly string[] = ["songs", "playlists"];

const isSection = (s: string): s is SectionId =>
  (SECTION_IDS as readonly string[]).includes(s);

/** What the URL carries. */
export interface RouteState {
  section: SectionId;
  /** The open file, SECTION-relative so the address does not repeat the section (../docs/routing.md). */
  file: string | null;
}

/** Where the app opens with no address to go on: the catalogue's first family (../docs/routing.md). */
export const DEFAULT_SECTION: SectionId = "songs";

/** Percent-encoding, per SEGMENT — `encodeURI` leaves `#` and `?` alone (../docs/routing.md). */
const encodePath = (rel: string): string =>
  rel.split("/").map(encodeURIComponent).join("/");

/** …and back: a hand-typed `%zz` throws, so the raw segment is the best remaining guess. */
const decodeSegment = (seg: string): string => {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
};

/** The path for a screen, under `prefix` ("" at the router's root). */
export function toPath(s: RouteState, prefix = ""): string {
  return s.file
    ? `${prefix}/${s.section}/${encodePath(s.file)}`
    : `${prefix}/${s.section}`;
}

/** The pathname with `prefix` cut off its head, or the pathname itself when it is not under it. */
function below(pathname: string, prefix: string): string {
  if (!prefix) return pathname;
  if (pathname === prefix) return "/";
  return pathname.startsWith(`${prefix}/`)
    ? pathname.slice(prefix.length)
    : pathname;
}

/** Read a location back into a screen, falling back rather than 404ing inside the app. */
export function fromLocation(pathname: string, prefix = ""): RouteState {
  const segs = below(pathname, prefix).split("/").filter(Boolean);
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

/** The ENTRY folder a route's file sits in, which is what a tree row and an entry are keyed by. */
export function folderOf(file: string | null): string | null {
  if (!file) return null;
  const cut = file.lastIndexOf("/");
  return cut > 0 ? file.slice(0, cut) : null;
}

/** …and the file's own name, which is what says WHICH of the module's panes is showing. */
export function fileOf(file: string | null): string | null {
  return file ? (file.split("/").pop() ?? null) : null;
}
