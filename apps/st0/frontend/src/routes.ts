// routes.ts — the URL <-> screen mapping, in one place. The address is the origin-relative
// path of what you are looking at: the section is the first segment (which is also the family
// folder's name), and the rest is the file the builder has open, if any.
// Pure functions, so both directions can be tested as a sequence; the hook is useLibraryRoute.

/** The five things the header offers. `recordings` is a section and not a family — see Library.tsx. */
export const SECTION_IDS = [
  "songs",
  "samples",
  "modules",
  "chains",
  "recordings",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

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
   */
  file: string | null;
}

/** Where the app opens with no address to go on. */
export const DEFAULT_SECTION: SectionId = "songs";

/** The path for a screen. */
export function toPath(s: RouteState): string {
  return s.file ? `/${s.section}/${s.file}` : `/${s.section}`;
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
  // Only a module opens a file today; `recordings` and the two media families are listings.
  const file = head === "modules" && rest.length ? rest.join("/") : null;
  return { section: head, file };
}

/** Same screen? What both directions of the hook use to decide there is nothing to do. */
export const sameRoute = (a: RouteState, b: RouteState): boolean =>
  a.section === b.section && a.file === b.file;

/** The module folder a route's file sits in, section-relative, or null. `audio/reverb/ui.yaml`
 *  -> `audio/reverb`, which is the path a tree row and an entry are keyed by. */
export function moduleOf(file: string | null): string | null {
  if (!file) return null;
  const cut = file.lastIndexOf("/");
  return cut > 0 ? file.slice(0, cut) : null;
}

/** …and the file's own name, which is what says WHICH of the module's panes is showing. */
export function fileOf(file: string | null): string | null {
  return file ? (file.split("/").pop() ?? null) : null;
}
