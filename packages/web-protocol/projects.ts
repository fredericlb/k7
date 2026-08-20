// projects.ts — which studio app owns a project folder, decided by the folder's NAME
// (`mysong.st0` in st0, `party.z0` in z0's editor), and the ADDRESS that names one:
// `/<repo>/<project>`. Both are contracts between pl8, which writes them,
// and the apps, which read them back — so they are stated here, browser-safe, and nowhere else.
// See apps/pl8/docs/projects.md and packages/project-shell/docs/launch.md.

import { type StudioService, serviceUrl } from "./services.ts";

/** The apps a project folder can belong to. A subset of the services: k7 owns no projects. */
export type ProjectApp = Extract<StudioService, "st0" | "z0">;

/**
 * The suffix each app claims.
 *
 * Two of them, because two apps open a project. Everything an st0 project can BE is a shape
 * inside `.st0` rather than a folder kind of its own: a song carries `video_tracks/` and a
 * `viewport` surface, and a set carries `songs.yaml` and a `turntables` surface
 * (`PROJECT_SHAPES` in `@studio/song`). See packages/song/docs/picture.md and setProject.md.
 */
export const PROJECT_SUFFIXES: Record<ProjectApp, string> = {
  st0: ".st0",
  z0: ".z0",
};

/**
 * The apps a project can be CREATED for, which is not the same set as the apps that own one.
 *
 * Owning a folder kind is a naming rule; creating one needs a **scaffold** — a file map the
 * file service can write (`createProjectIn`, and `@studio/song`'s three `scaffold*` modules).
 * z0 owns `.z0` and has none, so offering it in pl8's "Nouveau projet" menu produced a folder
 * with an st0 song inside it: the suffix said z0, the contents said otherwise, and nothing
 * complained until the app that opened it found nothing it could read.
 *
 * Stated HERE, beside the suffixes, because it is the same kind of fact and the same contract
 * between the side that OFFERS a kind and the side that writes it. A `Record<ProjectApp,
 * boolean>` rather than a list, so adding an app to `ProjectApp` fails to compile until
 * someone answers the question for it.
 */
export const HAS_SCAFFOLD: Record<ProjectApp, boolean> = {
  st0: true,
  z0: false,
};

/** The apps pl8 may offer to create, in the order its menu shows them. */
export const SCAFFOLDED_APPS: ProjectApp[] = (
  Object.keys(PROJECT_SUFFIXES) as ProjectApp[]
).filter((a) => HAS_SCAFFOLD[a]);

/**
 * Where inside its service the app that opens a project is mounted.
 *
 * Empty for st0, which IS its service: `st0.priv.frediver.se/<repo>/<project>`. z0 is six
 * SPAs behind one prefix and only one of them opens a project, so its address has to name the
 * SPA too — `st0.priv.frediver.se/z0/editor-v2/<repo>/<project.z0>`.
 *
 * It belongs here rather than in pl8's link builder for the reason the suffixes do: the
 * address is a contract between the side that WRITES it and the side that parses it back, and
 * a mount known to only one of them is a 404 nobody can attribute.
 */
export const PROJECT_MOUNTS: Record<ProjectApp, string> = {
  st0: "",
  z0: "/editor-v2",
};

/**
 * The app that opens a folder with this name, or null when the name claims none.
 *
 * The NAME, not the contents. That is what lets pl8 answer the question from a git tree it
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
  /** The repository's SHORT name, which pl8 resolves back to a git URI. Never the URI. */
  repo: string;
  /** The project folder inside the repository; "." when the repository IS the project. */
  project: string;
}

/** Split a path into segments, tolerating any number of slashes at either end. */
const segments = (p: string): string[] => p.split("/").filter(Boolean);

/**
 * Read `/<repo>/<project…>[/<view…>]` into a target, or null.
 *
 * st0 is mounted at the ORIGIN ROOT, so its `base` is `/` and the repository is the FIRST path
 * segment. Which makes every prefix the origin claims above st0 — `/pl8`, `/k7`, `/z0`, `/api`,
 * `/auth`, and in dev `/dev`, `/console`, `/dev-status` — a repository short name that can never
 * be opened: the request never reaches this app. Nothing here can detect that, and nothing
 * should try; it is the edge's routing table, and `apps/studio/docker/nginx.conf` is where it is
 * written down. z0's editor keeps a prefix (`/z0/editor-v2`) and is unaffected.
 *
 * **Where the project ends** is decided by the folder's own name — the same rule as
 * `projectApp` above: the project is everything up to and including the LAST segment claiming
 * THIS app. That is what lets a project sit at a depth (`songs/winter.st0`), lets the app's own
 * route follow it (`…/winter.st0/timeline`), and lets a `.m9` set nested inside a `.st0` song be
 * addressed by m9 without st0's suffix winning.
 *
 * With no such segment the repository itself is the project (`"."`) and everything after the
 * repo is the app's route — a view segment never ends in `.st0` or `.m9`, so the two cannot be
 * confused.
 *
 * `base` is where the app is mounted, as vite's `BASE_URL` spells it — `/` for st0, `/z0/editor-v2/`
 * for z0's. An address outside it names something else: null.
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

/**
 * Percent-encode one path segment, leaving `@` alone.
 *
 * `encodeURIComponent` escapes it, and RFC 3986 does not: `@` is a `pchar`, legal literally in a
 * path segment, and a browser keeps it that way in the address bar. So encoding it produced an
 * address that did not match the one the person was looking at — which is how `@shares` and
 * `@banc`, the two sentinels this file mints, were the only names it could get wrong.
 */
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
 * it has always been and lets its gate send you to pl8.
 *
 * **A SLICE of the given path, never a rebuild of it.** React Router compares this string against
 * `window.location.pathname` verbatim and renders NOTHING when it does not prefix it — so any
 * re-encoding here is a chance to disagree with the address the browser actually holds, over a
 * character that has two legal spellings. `%40shares` and `@shares` are the same address and this
 * function must answer with whichever one it was handed, which slicing does by construction and
 * spelling it out again cannot.
 */
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
 * The bench's reserved repository name — the first half of `/@banc/chains/<path>.st0`.
 *
 * A reserved REPOSITORY name, and that is the whole trick. Every other project resolves through
 * pl8 (`GET /api/projects/by-name/:name` → a git URI → a clone on the machine); the bench has no
 * repository and wants none — it is generated from the médiathèque's catalogue and regenerated
 * whenever it is opened, so putting it under version control would version a cache.
 *
 * `@` cannot begin a git short name, which is the last path segment of an SSH URI without
 * `.git`, so this can never collide with a real repository. `ProjectGate` sees the sentinel and
 * takes the other road: no lookup, no clone, one call to the machine that makes the folder.
 *
 * Here rather than in pl8 because BOTH ends need it spelled the same — pl8 writes the link and
 * the gate reads it — which is the same argument that put the rest of this vocabulary here.
 *
 * There was a second bench under this name, `@banc/modules.st0`: the whole catalogue mirrored
 * into one generated project, which was where a shared module was edited. A shared module is
 * edited from the Libraries tab of whatever project you already have open now
 * (apps/st0/frontend/docs/sharedModules.md), so only the CHAIN bench is left — the address below
 * is what says which chain.
 */
export const BENCH_REPO = "@banc";
/** Whether an address names the bench rather than a repository. */
export function isBench(repo: string): boolean {
  return repo === BENCH_REPO;
}

/**
 * A CHAIN on the bench: `/@banc/chains/blindtest/assourdissant/…​.st0`.
 *
 * The only thing the bench opens on now, and the address's project part is what says which. The
 * catalogue path IS the project path with `.st0` on the end,
 * which is why there is no lookup table and no marker file: pl8 writes the link from the chain
 * it is showing, the file service reads the chain back out of it, and neither can drift from
 * the other. Same argument that put `@banc` itself here.
 *
 * `chains/` is the family folder in the médiathèque, so a chain's path always begins with it and
 * nothing else can be mistaken for one.
 */
const CHAIN_FAMILY = "chains/";
const ST0 = PROJECT_SUFFIXES.st0;

/**
 * Which médiathèque chain a bench project is a view of — null when it names no chain, which
 * under `@banc` is now an address that opens nothing.
 *
 * The path comes off an ADDRESS anyone can type, and it is then joined onto two roots — the
 * médiathèque and the workspace. So it is checked here rather than trusted and checked later:
 * every segment must be an ordinary name, which is what stops `chains/../../…` from naming a
 * folder outside either. Null, not an exception — it is the same answer as "this is not a chain".
 */
export function benchChainPath(project: string): string | null {
  if (!project.startsWith(CHAIN_FAMILY) || !project.endsWith(ST0)) return null;
  const path = project.slice(0, -ST0.length);
  if (path.length <= CHAIN_FAMILY.length) return null;
  const segs = path.split("/");
  if (segs.some((s) => !s || s === "." || s === ".." || s.includes("\\")))
    return null;
  return path;
}

/** …and the address to open it on, from the catalogue path pl8 holds. */
export function benchProjectForChain(chainPath: string): string {
  return `${chainPath}${ST0}`;
}

/**
 * A SHARED project: `/@shares/<token>.st0`.
 *
 * The bench's sentinel again, for the bench's reason — `@` cannot begin a git short name, so this
 * can never collide with a real repository, and the gate sees it and takes another road: no pl8
 * lookup, no clone, no engine, no account. What it opens is a frozen snapshot pl8 holds.
 *
 * The `.st0` on the end is not decoration. `parseLaunch` ends a project at the last segment
 * claiming the app's suffix, so spelling the token this way makes it the PROJECT part of an
 * ordinary address — which means `parseLaunch`, `projectBasename` and every route below them
 * need no change at all, the token lands inside the router's basename, and a reload or a pasted
 * link simply re-reads it. The three other shapes considered all cost a special case somewhere.
 *
 * Here rather than in pl8 for the same reason as everything else in this file: pl8 writes the
 * link and st0 reads it back, and an address only one of them understands is a 404 nobody can
 * attribute.
 */
export const SHARE_REPO = "@shares";

/** Whether an address names a shared snapshot rather than a repository. */
export function isShare(repo: string): boolean {
  return repo === SHARE_REPO;
}

/**
 * The secret out of a share address, or null when the project part is not one.
 *
 * Checked rather than trusted, exactly as `benchChainPath` is: this comes off an address anyone
 * can type and is then put into a URL. One segment, base64url and nothing else — which is what
 * `randomBytes(32).toString("base64url")` produces and what a traversal is not.
 */
export function shareToken(project: string): string | null {
  if (!project.endsWith(ST0)) return null;
  const token = project.slice(0, -ST0.length);
  return /^[A-Za-z0-9_-]{22,}$/.test(token) ? token : null;
}

/**
 * The link itself, from the origin the browser is on and the secret pl8 answered with.
 *
 * Built HERE and not on the machine that rendered: that machine has no idea which origin you are
 * reading this on, and a checkout, the LAN proxy and the public host are three different answers.
 * Only the tab knows which one it is.
 */
export function shareUrl(origin: string, token: string): string {
  // Through `launchUrl`, not spelled out beside it: this address is read back by `parseLaunch`
  // and by `projectBasename`, and a second builder is a second place for the encoding to differ.
  return launchUrl(origin, SHARE_REPO, `${token}${ST0}`, "st0");
}

/**
 * The KEY a token addresses — `sha256(token)`, in hex, computed by whoever holds the link.
 *
 * pl8 stores the hash and names the directory with it, so the SECRET is never a path segment:
 * a path segment reaches every access log, every `Referer` and every proxy's error page, and the
 * link is the whole of the protection. The price is that the page has to do the hashing, and
 * `crypto.subtle` exists only in a SECURE CONTEXT — over plain http on something that is not
 * localhost there is no digest at all. That refusal is thrown with a sentence rather than left to
 * surface as `undefined is not a function`, because it is a real deployment and not a bug: the
 * fix is to serve the page over https, and nothing about the share is wrong.
 *
 * Here beside `shareUrl` because the two are one round trip — pl8 mints the token from the key
 * and the viewer gets back to the key from the token — and a hash spelled two ways is a 404
 * nobody can attribute.
 */
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

/**
 * Where a snapshot answers: pl8's ONE unauthenticated prefix, on the origin the page is on.
 *
 * `serviceUrl` and not the bare origin: pl8 sits under `/pl8` since st0 took the root, and this
 * route is its backend's like every other `/api/*` of its. It WAS the bare origin, and the
 * difference is invisible until a share is opened — which is exactly the kind of route that
 * gets tried last.
 *
 * `public` is IN the path on purpose: it is a comment that survives a refactor, and one nobody
 * confuses with `/api/shares`, which is the author's half and is behind the guard.
 */
export function shareApiBase(origin: string, key: string): string {
  return `${serviceUrl(origin, "pl8")}/api/public/share/${key}`;
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
 * No app prefix: which app opens a folder is decided by its SUFFIX, so `winter.st0` and
 * `winter.st0/live.m9` are already two different strings and cannot collide.
 */
export function projectClaimKey(l: Launch): string {
  return `${l.repo}/${l.project}`;
}

/**
 * Where a project opens — whichever app its folder name claims. This is the link pl8 writes.
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
