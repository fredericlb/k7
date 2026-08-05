// projects.ts — which studio app owns a project folder, decided by the folder's NAME
// (`mysong.l8` opens in l8, `myset.m9` in m9, `party.z0` in z0's editor), and the ADDRESS
// that names one: `/l8/<repo>/<project>`. Both are contracts between st0, which writes them,
// and the apps, which read them back — so they are stated here, browser-safe, and nowhere else.
// See apps/st0/docs/projects.md and packages/project-shell/docs/launch.md.

import { type StudioService, serviceUrl } from "./services.ts";

/** The apps a project folder can belong to. A subset of the services: k7 owns no projects. */
export type ProjectApp = Extract<StudioService, "l8" | "m9" | "z0">;

/** The suffix each app claims, longest-first is irrelevant here — they are the same length. */
export const PROJECT_SUFFIXES: Record<ProjectApp, string> = {
  l8: ".l8",
  m9: ".m9",
  z0: ".z0",
};

/**
 * Where inside its service the app that opens a project is mounted.
 *
 * Empty for l8 and m9, which ARE their service: `studio.test/l8/<repo>/<project>`. z0 is six
 * SPAs behind one prefix and only one of them opens a project, so its address has to name the
 * SPA too — `studio.test/z0/editor-v2/<repo>/<project.z0>`.
 *
 * It belongs here rather than in st0's link builder for the reason the suffixes do: the
 * address is a contract between the side that WRITES it and the side that parses it back, and
 * a mount known to only one of them is a 404 nobody can attribute.
 */
export const PROJECT_MOUNTS: Record<ProjectApp, string> = {
  l8: "",
  m9: "",
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
