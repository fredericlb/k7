// projects.ts — which studio app owns a project folder, decided by the folder's NAME
// (`mysong.l8` in l8, `myset.m9` in m9, `myfilm.v1` in v1, `party.z0` in z0's editor), and the ADDRESS
// that names one: `/l8/<repo>/<project>`. Both are contracts between st0, which writes them,
// and the apps, which read them back — so they are stated here, browser-safe, and nowhere else.
// See apps/st0/docs/projects.md and packages/project-shell/docs/launch.md.

import { type StudioService, serviceUrl } from "./services.ts";

/** The apps a project folder can belong to. A subset of the services: k7 owns no projects. */
export type ProjectApp = Extract<StudioService, "l8" | "m9" | "v1" | "z0">;

/** The suffix each app claims, longest-first is irrelevant here — they are the same length. */
export const PROJECT_SUFFIXES: Record<ProjectApp, string> = {
  l8: ".l8",
  m9: ".m9",
  v1: ".v1",
  z0: ".z0",
};

/**
 * The apps a project can be CREATED for, which is not the same set as the apps that own one.
 *
 * Owning a folder kind is a naming rule; creating one needs a **scaffold** — a file map the
 * file service can write (`createProjectIn`, and `@studio/song`'s three `scaffold*` modules).
 * z0 owns `.z0` and has none, so offering it in st0's "Nouveau projet" menu produced a folder
 * with an l8 song inside it: the suffix said z0, the contents said otherwise, and nothing
 * complained until the app that opened it found nothing it could read.
 *
 * Stated HERE, beside the suffixes, because it is the same kind of fact and the same contract
 * between the side that OFFERS a kind and the side that writes it. A `Record<ProjectApp,
 * boolean>` rather than a list, so adding an app to `ProjectApp` fails to compile until
 * someone answers the question for it.
 */
export const HAS_SCAFFOLD: Record<ProjectApp, boolean> = {
  l8: true,
  m9: true,
  v1: true,
  z0: false,
};

/** The apps st0 may offer to create, in the order its menu shows them. */
export const SCAFFOLDED_APPS: ProjectApp[] = (
  Object.keys(PROJECT_SUFFIXES) as ProjectApp[]
).filter((a) => HAS_SCAFFOLD[a]);

/**
 * Where inside its service the app that opens a project is mounted.
 *
 * Empty for l8, m9 and v1, which ARE their service: `st0.priv.frediver.se/l8/<repo>/<project>`. z0 is six
 * SPAs behind one prefix and only one of them opens a project, so its address has to name the
 * SPA too — `st0.priv.frediver.se/z0/editor-v2/<repo>/<project.z0>`.
 *
 * It belongs here rather than in st0's link builder for the reason the suffixes do: the
 * address is a contract between the side that WRITES it and the side that parses it back, and
 * a mount known to only one of them is a 404 nobody can attribute.
 */
export const PROJECT_MOUNTS: Record<ProjectApp, string> = {
  l8: "",
  m9: "",
  v1: "",
  z0: "/editor-v2",
};

/**
 * The app that opens a folder with this name, or null when the name claims none.
 *
 * The NAME, not the contents. That is what lets st0 answer the question from a git tree it
 * has never checked out — a bare blobless mirror has every path and no file bodies, so any
 * rule that opened a file could not run there at all. See packages/git-repos/docs/mirror.md.
 *
 * A `project.yaml` is still what makes a project COMPILE, and `@studio/song` still asks that
 * question its own way. These two are not the same question: one is "who opens this", the
 * other is "can the engine be given it".
 */
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
  /** The repository's SHORT name, which st0 resolves back to a git URI. Never the URI. */
  repo: string;
  /** The project folder inside the repository; "." when the repository IS the project. */
  project: string;
}

/** Split a path into segments, tolerating any number of slashes at either end. */
const segments = (p: string): string[] => p.split("/").filter(Boolean);

/**
 * Read `/l8/<repo>/<project…>[/<view…>]` into a target, or null.
 *
 * **Where the project ends** is decided by the folder's own name — the same rule as
 * `projectApp` above: the project is everything up to and including the LAST segment claiming
 * THIS app. That is what lets a project sit at a depth (`songs/winter.l8`), lets the app's own
 * route follow it (`…/winter.l8/timeline`), and lets a `.m9` set nested inside a `.l8` song be
 * addressed by m9 without l8's suffix winning.
 *
 * With no such segment the repository itself is the project (`"."`) and everything after the
 * repo is the app's route — a view segment never ends in `.l8` or `.m9`, so the two cannot be
 * confused.
 *
 * `base` is where the app is mounted, as vite's `BASE_URL` spells it (`/l8/`, or `/` when it
 * is served from a bare origin in dev). An address outside it names something else: null.
 */
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

/** The `<base>/<repo>/<project>` prefix of an address. `base` of "" gives the path alone. */
function launchPath(l: Launch, base: string): string {
  const parts = [
    ...segments(base),
    encodeURIComponent(l.repo),
    ...(l.project === "."
      ? []
      : segments(l.project).map((s) => encodeURIComponent(s))),
  ];
  return `/${parts.join("/")}`;
}

/**
 * The router `basename` for this address: everything up to and including the project.
 *
 * This is what replaces the tab-local storage the launch used to need. React Router only ever
 * writes BELOW its basename, so the repo and project can no longer be rewritten away by an
 * app's own `routes.ts` — which is the single reason the memory existed. A reload re-reads the
 * same path, a bookmark works, and a wrong project is fixed by editing the address instead of
 * by clearing storage nobody can see.
 *
 * Falls back to `base` when the address names no project, which leaves the app mounted where
 * it has always been and lets its gate send you to st0.
 */
export function projectBasename(
  pathname: string,
  app: ProjectApp,
  base: string,
): string {
  const l = parseLaunch(pathname, app, base);
  return l ? launchPath(l, base) : base;
}

/**
 * The module bench's address: `/l8/@banc/modules.l8`.
 *
 * A reserved REPOSITORY name, and that is the whole trick. Every other project resolves through
 * st0 (`GET /api/projects/by-name/:name` → a git URI → a clone on the machine); the bench has no
 * repository and wants none — it is generated from the médiathèque's catalogue and regenerated
 * whenever it is opened, so putting it under version control would version a cache.
 *
 * `@` cannot begin a git short name, which is the last path segment of an SSH URI without
 * `.git`, so this can never collide with a real repository. `ProjectGate` sees the sentinel and
 * takes the other road: no lookup, no clone, one call to the machine that makes the folder.
 *
 * Here rather than in st0 because BOTH ends need it spelled the same — st0 writes the link and
 * the gate reads it — which is the same argument that put the rest of this vocabulary here.
 */
export const BENCH_REPO = "@banc";
/** The folder the bench is generated into, inside its reserved workspace. */
export const BENCH_PROJECT = "modules.l8";
/** Whether an address names the bench rather than a repository. */
export function isBench(repo: string): boolean {
  return repo === BENCH_REPO;
}

/**
 * A CHAIN on the bench: `/l8/@banc/chains/blindtest/assourdissant/…​.l8`.
 *
 * The same workbench, opened on something else — so it takes the same road, and the address's
 * project part is what says which. The catalogue path IS the project path with `.l8` on the end,
 * which is why there is no lookup table and no marker file: st0 writes the link from the chain
 * it is showing, the file service reads the chain back out of it, and neither can drift from
 * the other. Same argument that put `@banc` itself here.
 *
 * `chains/` is the family folder in the médiathèque, so a chain's path always begins with it and
 * nothing else can be mistaken for one.
 */
const CHAIN_FAMILY = "chains/";
const L8 = PROJECT_SUFFIXES.l8;

/**
 * Which médiathèque chain a bench project is a view of — null if it is the module bench.
 *
 * The path comes off an ADDRESS anyone can type, and it is then joined onto two roots — the
 * médiathèque and the workspace. So it is checked here rather than trusted and checked later:
 * every segment must be an ordinary name, which is what stops `chains/../../…` from naming a
 * folder outside either. Null, not an exception — it is the same answer as "this is not a chain".
 */
export function benchChainPath(project: string): string | null {
  if (!project.startsWith(CHAIN_FAMILY) || !project.endsWith(L8)) return null;
  const path = project.slice(0, -L8.length);
  if (path.length <= CHAIN_FAMILY.length) return null;
  const segs = path.split("/");
  if (segs.some((s) => !s || s === "." || s === ".." || s.includes("\\")))
    return null;
  return path;
}

/** …and the address to open it on, from the catalogue path st0 holds. */
export function benchProjectForChain(chainPath: string): string {
  return `${chainPath}${L8}`;
}

/**
 * How a project is NAMED in an engine claim — `<repo>/<projet>`.
 *
 * Here rather than in each gate, and beside the address it is derived from, for the same reason
 * the address itself is here: two surfaces that spell one project differently would each believe
 * they had it, and the rule "one engine per project" would hold for neither. The repository's
 * short name and the folder path inside it are exactly what identifies a project across machines
 * — a workspace path would not, since the same repository is cloned somewhere different on each.
 *
 * No app prefix: which app opens a folder is decided by its SUFFIX, so `winter.l8` and
 * `winter.l8/live.m9` are already two different strings and cannot collide.
 */
export function projectClaimKey(l: Launch): string {
  return `${l.repo}/${l.project}`;
}

/**
 * Where a project opens — whichever app its folder name claims. This is the link st0 writes.
 *
 * `origin` may be any URL on the studio origin; only its origin is kept, so a caller can pass
 * `window.location.href` without stripping anything first.
 */
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
