// projects.ts — which studio app owns a project folder, decided by the folder's NAME
// (`mysong.k7` in k7, `party.z0` in z0's editor), and the ADDRESS that names one:
// `/<repo>/<project>`. Both are contracts between the side that WRITES an address — k7's home
// page — and the apps that read one back, so they are stated here, browser-safe, and nowhere
// else. See apps/k7/frontend/docs/projects.md and packages/project-shell/docs/launch.md.

import { type StudioService, serviceUrl } from "./services.ts";

/** The apps a project folder can belong to. A subset of the services: k7 owns no projects. */
export type ProjectApp = Extract<StudioService, "k7" | "z0">;

/** The suffix each app claims — two, because everything an k7 project can BE is a shape INSIDE `.k7`. */
export const PROJECT_SUFFIXES: Record<ProjectApp, string> = {
  k7: ".k7",
  z0: ".z0",
};

/** The apps a project can be CREATED for, which owning a suffix does not make it — see docs/addresses.md. */
export const HAS_SCAFFOLD: Record<ProjectApp, boolean> = {
  k7: true,
  z0: false,
};

/** The apps pl8 may offer to create, in the order its menu shows them. */
export const SCAFFOLDED_APPS: ProjectApp[] = (
  Object.keys(PROJECT_SUFFIXES) as ProjectApp[]
).filter((a) => HAS_SCAFFOLD[a]);

/** Where inside its service each app is mounted — empty for k7, which IS its service; see docs/addresses.md. */
export const PROJECT_MOUNTS: Record<ProjectApp, string> = {
  k7: "",
  z0: "/editor",
};

/** The app that opens a folder with this NAME, which is not the question of whether it compiles — docs/addresses.md. */
export function projectApp(name: string): ProjectApp | null {
  for (const [app, suffix] of Object.entries(PROJECT_SUFFIXES))
    if (name.length > suffix.length && name.endsWith(suffix))
      return app as ProjectApp;
  return null;
}

/** The folder name with its suffix taken off — what a project is CALLED. */
export function projectLabel(name: string): string {
  const app = projectApp(name);
  return app ? name.slice(0, -PROJECT_SUFFIXES[app].length) : name;
}

// --- the address of a project -------------------------------------------------------------

/** Which project an editor was opened on, as its own address names it. */
export interface Launch {
  /** The repository's SHORT name, which pl8 resolves back to a git URI. Never the URI. */
  repo: string;
  /** The project folder inside the repository; "." when the repository IS the project. */
  project: string;
}

/** Split a path into segments, tolerating any number of slashes at either end. */
const segments = (p: string): string[] => p.split("/").filter(Boolean);

/** Read `/<repo>/<project…>[/<view…>]` into a target, or null — the rules are in docs/addresses.md. */
export function parseLaunch(
  pathname: string,
  app: ProjectApp,
  base: string,
): Launch | null {
  const segs = segments(pathname);
  const skip = segments(base);
  for (let i = 0; i < skip.length; i++) if (segs[i] !== skip[i]) return null;

  const [repo, ...tail] = segs.slice(skip.length);
  if (!repo) return null;

  const suffix = PROJECT_SUFFIXES[app];
  let last = -1;
  for (let i = 0; i < tail.length; i++)
    if (tail[i].length > suffix.length && tail[i].endsWith(suffix)) last = i;

  const decode = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s; // a hand-typed % that is not an escape — keep it rather than throwing
    }
  };
  return {
    repo: decode(repo),
    project:
      last < 0
        ? "."
        : tail
            .slice(0, last + 1)
            .map(decode)
            .join("/"),
  };
}

/** Percent-encode one path segment, leaving `@` alone: RFC 3986 allows it literally — see docs/addresses.md. */
const encodeSegment = (s: string): string =>
  encodeURIComponent(s).replace(/%40/g, "@");

/** The `<base>/<repo>/<project>` prefix of an address. `base` of "" gives the path alone. */
function launchPath(l: Launch, base: string): string {
  const parts = [
    ...segments(base),
    encodeSegment(l.repo),
    ...(l.project === "." ? [] : segments(l.project).map(encodeSegment)),
  ];
  return `/${parts.join("/")}`;
}

/** The router `basename`: a SLICE of the given path, never a rebuild of it — see docs/addresses.md. */
export function projectBasename(
  pathname: string,
  app: ProjectApp,
  base: string,
): string {
  const l = parseLaunch(pathname, app, base);
  if (!l) return base;
  // parseLaunch already decided where the project ends; count the same segments off the raw path.
  const depth =
    segments(base).length +
    1 +
    (l.project === "." ? 0 : l.project.split("/").length);
  return `/${segments(pathname).slice(0, depth).join("/")}`;
}

/**
 * The foreign project files a DROP may carry: the self-contained ones. A `.dawproject` has its
 * audio inside it, and a `.zip` is an Ableton project folder with its samples. A lone `.als` is
 * not: it reads its samples off the disk beside it, so it is imported from the tree, where it sits
 * with its folder. See packages/translator/docs/import.md.
 */
export const DROPPABLE_PROJECTS = [".dawproject", ".zip"] as const;

/** …asked of a file NAME, which is all either side has: the browser before it accepts, the service before it reads. */
export const isDroppableProject = (name: string): boolean =>
  DROPPABLE_PROJECTS.some((ext) => name.toLowerCase().endsWith(ext));

/** The bench's reserved repository name, which resolves through no pl8 lookup at all — docs/addresses.md. */
export const BENCH_REPO = "@banc";
/** Whether an address names the bench rather than a repository. */
export function isBench(repo: string): boolean {
  return repo === BENCH_REPO;
}

const K7 = PROJECT_SUFFIXES.k7;

/** The bench's ONE project — a live rig thrown away and rebuilt on every open, apps/k7/backend/docs/media/banc.md. */
export const BENCH_PROJECT = `live${K7}`;

/** The library chain a `@banc` address seeds the rig with (`<ref>/live.k7`), `null` for the bare rig, `undefined` for no bench — docs/addresses.md. */
export function benchChainOf(project: string): string | null | undefined {
  if (project === BENCH_PROJECT) return null;
  const tail = `/${BENCH_PROJECT}`;
  if (!project.endsWith(tail)) return undefined;
  const ref = project.slice(0, -tail.length);
  const segments = ref.split("/");
  // Folder names only: an empty or dotted segment, or one claiming a project, is not a chain ref.
  return segments.every((s) => s && s !== "." && s !== ".." && !s.endsWith(K7))
    ? ref
    : undefined;
}

/** Whether the project half of a `@banc` address names that rig, bare or seeded with a chain; nothing else under `@banc` names anything. */
export function isBenchProject(project: string): boolean {
  return benchChainOf(project) !== undefined;
}

/** Which of an account's engine sessions a claimed address plays in: the bench has its own, so it shares an engine with the song — docs/addresses.md. */
export function claimSlot(claim: string): "bench" | "project" {
  return claim.startsWith(`${BENCH_REPO}/`) ? "bench" : "project";
}

/** The project half of a bench address, seeded with `chain` when one is given. */
export function benchProject(chain?: string | null): string {
  return chain ? `${chain}/${BENCH_PROJECT}` : BENCH_PROJECT;
}

/** A SHARED project, `/@shares/<token>.k7` — the `.k7` is what makes it parse ordinarily; docs/addresses.md. */
export const SHARE_REPO = "@shares";

/** Whether an address names a shared snapshot rather than a repository. */
export function isShare(repo: string): boolean {
  return repo === SHARE_REPO;
}

/** The secret out of a share address: one segment, base64url and nothing else, checked not trusted. */
export function shareToken(project: string): string | null {
  if (!project.endsWith(K7)) return null;
  const token = project.slice(0, -K7.length);
  return /^[A-Za-z0-9_-]{22,}$/.test(token) ? token : null;
}

/** The link itself, built from the origin the TAB is on because no other side knows which it is. */
export function shareUrl(origin: string, token: string): string {
  // Through `launchUrl`: a second builder is a second place for the encoding to differ.
  return launchUrl(origin, SHARE_REPO, `${token}${K7}`, "k7");
}

/** `sha256(token)` in hex, so the SECRET is never a path segment — and why https is required; docs/addresses.md. */
export async function shareKey(token: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    throw new Error(
      "opening a share needs a secure context (https), because the address is hashed in the browser",
    );
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Where a snapshot answers: the ONE unauthenticated prefix, on the origin `serviceUrl` gives pl8 — see docs/addresses.md. */
export function shareApiBase(origin: string, key: string): string {
  return `${serviceUrl(origin, "pl8")}/api/public/share/${key}`;
}

// --- a project that belongs to no repository ------------------------------------------------

/** A project in a workspace with no repository — and therefore NOT portable; see docs/addresses.md. */
export const LOCAL_REPO = "@local";

/** Whether an address names a workspace on the machine rather than a repository. */
export function isLocal(repo: string): boolean {
  return repo === LOCAL_REPO;
}

/** Split a `@local` project part into workspace and project, checked not trusted — see docs/addresses.md. */
export function localTarget(
  project: string,
): { workspace: string; project: string } | null {
  const segs = segments(project);
  const workspace = segs.shift();
  if (
    !workspace ||
    workspace === "." ||
    workspace === ".." ||
    workspace.includes("\\")
  )
    return null;
  return { workspace, project: segs.length ? segs.join("/") : "." };
}

/** …and the address itself; it takes an `app` because a `.z0` folder here opens under z0's own mount. */
export function localProjectUrl(
  origin: string,
  workspace: string,
  project: string,
  app: ProjectApp,
): string {
  // Through `launchUrl`, for the reason `shareUrl` is: one builder, one encoding.
  return launchUrl(
    origin,
    LOCAL_REPO,
    project === "." ? workspace : `${workspace}/${project}`,
    app,
  );
}

/** The desktop app's TAB STRIP: a sentinel, and chrome rather than a screen — apps/k7-standalone/docs/tabs.md. */
export const TABS_REPO = "@tabs";

export function isTabs(repo: string): boolean {
  return repo === TABS_REPO;
}

/** Where the strip is, on whatever origin the app is serving from. */
export function tabsUrl(origin: string): string {
  return `${serviceUrl(origin, "k7")}/${TABS_REPO}`;
}

/** How a project is NAMED in an engine claim — the one spelling "one engine per project" rests on; docs/addresses.md. */
export function projectClaimKey(l: Launch): string {
  return `${l.repo}/${l.project}`;
}

/** Where a project opens — the link pl8 writes; only the ORIGIN of `origin` is kept, so pass anything. */
export function launchUrl(
  origin: string,
  repo: string,
  project: string,
  app: ProjectApp,
): string {
  return (
    serviceUrl(origin, app) +
    PROJECT_MOUNTS[app] +
    launchPath({ repo, project }, "")
  );
}

// --- a surface, opened on its own -----------------------------------------------------------

/** `<project>/@external/<surface>` — BELOW the project, which is what makes it cost nothing; docs/addresses.md. */
export const EXTERNAL_SEGMENT = "@external";

/** Which surface this address opens on its own, off the address alone; null for a bare `@external`. */
export function parseExternal(
  pathname: string,
  app: ProjectApp,
  base: string,
): string | null {
  const at = parseLaunch(pathname, app, base);
  if (!at) return null;
  const segs = segments(pathname);
  const i = segs.indexOf(EXTERNAL_SEGMENT);
  // The LAST segment before it must be the project's, or this `@external` is a folder in a repository.
  if (i < 0 || i + 1 >= segs.length) return null;
  const name = segs[i + 1];
  try {
    return decodeURIComponent(name);
  } catch {
    return name; // a hand-typed % that is not an escape — keep it, as parseLaunch does
  }
}

/** The link to hand another device, from the origin the TAB is on — a tablet by the decks is on the LAN one. */
export function externalUrl(
  origin: string,
  l: Launch,
  surface: string,
  app: ProjectApp,
): string {
  return externalOf(launchUrl(origin, l.repo, l.project, app), surface);
}

/** …and the same segment hung off a project URL somebody else built — one encoder either way. */
export function externalOf(projectUrl: string, surface: string): string {
  return `${projectUrl}/${EXTERNAL_SEGMENT}/${encodeSegment(surface)}`;
}

/** The MENU of those addresses, `/external` — a RESERVED repository short name; see docs/addresses.md. */
export const EXTERNAL_INDEX = "external";

/** The LIBRARIES page, `/libraries` — the origin's list, and where an admin edits it; reserved like `external`, and a ROUTE of k7's home. */
export const LIBRARIES_PAGE = "libraries";

/** The SETTINGS page, `/settings` — what a browser may change; reserved and routed like the libraries. */
export const SETTINGS_PAGE = "settings";

/** The TASKS page, `/tasks` — every workspace's TODOS.md in one list; reserved and routed like the libraries. */
export const TASKS_PAGE = "tasks";

/** The MEDIA library, `/media/…` — reserved as a PREFIX, its sections and open files being segments below it. */
export const MEDIA_PAGE = "media";

/** The REHEARSAL pages, `/rehearsal/…` — reserved as a PREFIX like the media library: sessions, releases, songbook, exercises and the public pages below it. */
export const REHEARSAL_PAGE = "rehearsal";

/** The segments below the mount, or null when the address is not under it. */
function belowMount(pathname: string, base: string): string[] | null {
  const segs = segments(pathname);
  const skip = segments(base);
  for (let i = 0; i < skip.length; i++) if (segs[i] !== skip[i]) return null;
  return segs.slice(skip.length);
}

/** Is this address exactly `word`, one segment below the mount? */
function isReservedPage(pathname: string, base: string, word: string): boolean {
  const rest = belowMount(pathname, base);
  return rest?.length === 1 && rest[0] === word;
}

/** Does this address START with `word` below the mount, whatever follows it? */
function isReservedPrefix(
  pathname: string,
  base: string,
  word: string,
): boolean {
  return belowMount(pathname, base)?.[0] === word;
}

/** Is this address one of the pages that hang off k7's home — `/libraries`, `/settings`, `/tasks`, `/media/…`, `/rehearsal/…`? Read before `parseLaunch`, which would take the word for a workspace. */
export function isHomePage(pathname: string, base: string): boolean {
  return (
    isReservedPage(pathname, base, LIBRARIES_PAGE) ||
    isReservedPage(pathname, base, SETTINGS_PAGE) ||
    isReservedPage(pathname, base, TASKS_PAGE) ||
    isReservedPrefix(pathname, base, MEDIA_PAGE) ||
    isReservedPrefix(pathname, base, REHEARSAL_PAGE)
  );
}

/** Is this address that menu? Exactly one segment below the mount, and that word. */
export function isExternalIndex(pathname: string, base: string): boolean {
  return isReservedPage(pathname, base, EXTERNAL_INDEX);
}

/**
 * Does this ADDRESS open a project? Every screen on this origin that is not one is named here:
 * the home page has no segment at all, `@tabs` is chrome, `external` is the menu of surfaces,
 * `libraries`, `settings`, `tasks`, `media/…` and `rehearsal/…` the home's own pages. Everything else is `<repo>/<project>`, `@local/…` and `@shares/…` included.
 *
 * One definition because two sides ask it and would drift: the main process, to know what a
 * second window would open on, and the tab strip, to know which tabs wear a note.
 */
export function isProjectAddress(url: string): boolean {
  let head: string;
  try {
    head = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
  } catch {
    return false; // not an address we can reason about
  }
  return (
    head !== "" &&
    !isTabs(head) &&
    head !== EXTERNAL_INDEX &&
    head !== LIBRARIES_PAGE &&
    head !== SETTINGS_PAGE &&
    head !== TASKS_PAGE &&
    head !== MEDIA_PAGE &&
    head !== REHEARSAL_PAGE
  );
}

/** …and the whole URL of it: a surface cannot use the router, its basename ending at the project. */
export function externalIndexUrl(origin: string, app: ProjectApp): string {
  return `${serviceUrl(origin, app)}${PROJECT_MOUNTS[app]}/${EXTERNAL_INDEX}`;
}
