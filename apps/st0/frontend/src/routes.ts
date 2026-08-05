// routes.ts — the URL <-> screen mapping, in one place. The address is the origin-relative
// path of what you are looking at: the section is the first segment (which is also the family
// folder's name), and the rest is the file the builder has open, if any.
// Pure functions, so both directions can be tested as a sequence; the hook is useLibraryRoute.

/** The six things the header offers, plus `engine` — the cog's engine-status page, a
 *  section with no tab. `recordings` and `projects` are sections and not families — see
 *  Library.tsx. A section id may not collide with a path Caddy claims above st0's
 *  catch-all (`/l8`, `/m9`, `/k7`, `/z0`, `/dev`, `/console`, `/dev-status`); see
 *  docs/routing.md. */
export const SECTION_IDS = [
  "songs",
  "samples",
  "modules",
  "chains",
  "recordings",
  "projects",
  "engine",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** Named, like `RECORDINGS_DIR` is, so the section that is not a family reads as one thing. */
export const PROJECTS_SECTION = "projects";

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
   * Under `projects` it is not a file but a REPOSITORY id — the section has no builder, and
   * what the address has to carry is which repository is open. Same slot, because it is the
   * same question ("what, inside this section, are you looking at") and a second field would
   * be empty for four of the six sections.
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
  // Two sections carry something after their name: a module's file, and a repository's id.
  // The other three are listings, and a path under one of them names nothing.
  const carries = head === "modules" || head === "projects";
  const file = carries && rest.length ? rest.join("/") : null;
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
