# The address of a project

`projects.ts` states two contracts: which studio app owns a folder, decided by the folder's NAME,
and the address that names one, `/@local/<workspace>/<project>`. Both sit between the side that
WRITES an address — st0's home page — and the apps that read one back, which is why they are stated
once, browser-safe, and nowhere else. See `apps/st0/frontend/docs/projects.md` and
`packages/project-shell/docs/launch.md`.

## Where each service answers

`services.ts` states where every service is, derived from ONE origin, st0's:

| service | where | dev | production |
|---|---|---|---|
| st0 | the origin itself | `priv.st0.app` | `st0.app` |
| z0 | a path under st0's origin, `SERVICE_PATHS.z0` | `priv.st0.app/z0` | `st0.app/z0` |
| pl8 | its own subdomain, `play.` in front of st0's host | `play.priv.st0.app` | `play.st0.app` |
| k7 | its own subdomain, `k7.` in front of st0's host | `k7.priv.st0.app` | `k7.st0.app` |

`serviceUrl(origin, service)` answers from any studio URL — st0's or a sibling's, whose label it
strips first — so a page never spells a host, and a deployment on a domain of its own needs nothing
configured. On a bare loopback host (`localhost`, a dev run) services are told apart by PORT instead.

**One session across them** is the shared `COOKIE_DOMAIN`: every `setupAuth` sets the cookie on the
parent domain and trusts the sibling origins (`TRUSTED_ORIGINS`), both from the same environment
(`docker/docker-compose.yml`).

What you land on is your own WORK: the editor's home page, at st0's origin, lists the workspaces,
the projects, the libraries and the shares. The catalogue is what a project draws ON, so it is
pl8, a link in that page's header. The shares and `/api/mediatek` are pl8's backend's; the
workspaces, the libraries and the deploy key are the file service's.

### `/auth/*` belongs to st0

`redirectUriFor` builds `<st0 origin>/auth/callback`, and that is the single `redirect_uri` the IdP
has registered, so the flow can only be served by st0. Every other service passes
`mountRoutes: []` and verifies the cookie — z0 included. A page on a sibling subdomain sends the
browser to `authOrigin(origin)`, which is st0's origin: its own `/auth/login` would look the same
and be wrong. Nothing is registered at the IdP per service.

### The ports are the other half of the same table

A SERVER calling another studio service uses `SERVICE_PORTS` rather than the public URL, and the
reason is not performance: in a checkout everything is behind a private CA, whose local CA node
does not trust, so `https://play.priv.st0.app` fails with `UNABLE_TO_GET_ISSUER_CERT` from
a backend while working perfectly in the browser beside it.

On a loopback host the same table is what a PAGE uses too, and a host may move it:
`STUDIO_PORTS=st0=18789,pl8=18795` in the environment for node — and for the supervisor, whose
`Url.cpp` reads the same variable — or `globalThis.__STUDIO_PORTS__` for a page, set before its
scripts run (`servicePorts`). The desktop app does, so it runs beside a dev session
(`apps/st0-standalone/docs/standalone.md`). Unset, the table is `SERVICE_PORTS`.

## Owning a suffix is not the same as being creatable

`PROJECT_SUFFIXES` has two entries, because two apps open a project. Everything an st0 project can
BE is a shape *inside* `.st0` rather than a folder kind of its own: a song carries `video_tracks/`
and a `viewport` surface, a set carries `songs.yaml` and a `turntables` surface (`PROJECT_SHAPES`
in `@studio/song`). See `packages/song-video/docs/picture.md` and
`packages/song/docs/setProject.md`.

`HAS_SCAFFOLD` is a different set. Owning a folder kind is a naming rule; creating one needs a
**scaffold** — a file map the file service can write (`createProjectIn`, and `@studio/song`'s
three `scaffold*` modules). z0 owns `.z0` and has none: offered in a "new project" menu, it would
produce a folder whose suffix says z0 and whose contents say st0, and nothing would complain until
the app that opened it found nothing it could read.

It is a `Record<ProjectApp, boolean>` rather than a list, so adding an app to `ProjectApp` fails to
compile until someone answers the question for it.

`projectApp` reads the NAME, not the contents, and the two are different questions: "who opens
this" and "can the engine be given it". Only the second needs a file opened, which is why the
first can be answered without a checkout at all. A `project.yaml` is what makes a project
COMPILE, and `@studio/song` asks that question its own way, on the machine's own clone.

## Where an app is mounted

`PROJECT_MOUNTS` is empty for st0, which IS its service: `priv.st0.app/@local/<workspace>/<project>`.
z0 is six SPAs behind one prefix and only one of them opens a project, so its address has to name
the SPA too — `priv.st0.app/z0/editor/@local/<workspace>/<project.z0>`.

It belongs here rather than in a link builder for the reason the suffixes do: the address is a
contract between the side that WRITES it and the side that parses it back, and a mount known to
only one of them is a 404 nobody can attribute.

The name is `/z0/editor`, with nothing beside it: `/z0/editor` is a literal prefix of any
`/z0/editor-*`, and a proxy comparing raw prefixes would send the project to the wrong SPA. One
name, no overlap. See `apps/z0/docs/editor.md`.

## Parsing one back

st0 is mounted at the ORIGIN ROOT, so its `base` is `/` and the sentinel is the FIRST path segment.
`/z0` is claimed by z0 on the same origin, and `/api`, `/auth` by st0's backend; none of them can
be a sentinel, since each starts with `@`, so nothing collides.

**Where the project ends** is decided by the folder's own name, the same rule as `projectApp`: the
project is everything up to and including the LAST segment claiming THIS app. That is what lets a
project sit at a depth (`songs/winter.st0`), lets the app's own route follow it
(`…/winter.st0/timeline`), and lets a nested set be addressed by its own app without st0's suffix
winning. With no such segment the workspace itself is the project (`"."`) and everything after it
is the app's route — a view segment never ends in a project suffix, so the two cannot be confused.

`base` is where the app is mounted, as vite's `BASE_URL` spells it. An address outside it names
something else: null.

### `projectBasename` is a SLICE, never a rebuild

`projectBasename` is what keeps the launch out of tab-local storage. React Router only ever
writes BELOW its basename, so the project cannot be rewritten away by an app's own `routes.ts` —
which is the single thing such a memory would be for. A reload re-reads the same path, a bookmark
works, and a wrong project is fixed by editing the address instead of by clearing storage nobody
can see. It falls back to `base` when the address names no project, which leaves the app mounted
where it is and lets its gate send you to st0's home page.

React Router compares the string against `window.location.pathname` **verbatim** and renders
NOTHING when it does not prefix it. So any re-encoding here is a chance to disagree with the
address the browser actually holds, over a character with two legal spellings: `%40shares` and
`@shares` are the same address, and this function must answer with whichever one it was handed —
which slicing does by construction and spelling it out again cannot.

`encodeSegment` leaves `@` alone for the same family of reasons. `encodeURIComponent` escapes it
and RFC 3986 does not: `@` is a `pchar`, legal literally in a path segment, and a browser keeps it
that way in the address bar. Encoding it produces an address that does not match the one the
person is looking at — and the sentinels this file mints are exactly the names that would hit it.

## The three sentinels

`@` cannot begin a folder name git gives a clone, so a first segment starting with it can never
collide with a workspace. Three sentinels use it, and they are the only addresses a gate opens.

### `@local` — a project in a workspace on this machine

`/@local/<workspace>/<projet>.st0` names a folder the machine already holds: nothing to look up and
nothing to clone. Every project on st0's home page is linked this way — `Examples`, seeded with the
demos the first time a person is seen, a workspace made there with no repository, and a clone
brought in with **Importer** alike.

`parseLaunch` needs nothing added. `/@local/Examples/synth-demo.st0` reads as repo `@local`, project
`Examples/synth-demo.st0`: the project part ends at the last segment claiming the app, exactly as
everywhere else. `localTarget` is what splits the workspace off the front of it — a workspace that
IS a project has nothing after its name and the project is `"."`.

The price, stated where it is paid: this address names a machine's folder, so it is **not
portable** — a link pasted to somebody names a folder in yours. What it buys is that no service has
to answer before a project opens (`apps/pl8/docs/projects.md`).

### `@banc` — the bench

The bench has no repository and wants none. It is generated, and deleted and generated again
whenever it is opened, so putting it under version control would version something with a lifetime
of one session. `ProjectGate` does no lookup and no clone: one call to the machine, which makes the
folder.

It answers **one** project, `live.st0`, preceded by the library chain's ref the bench is ON —
`/@banc/vocals/warm/live.st0` (or `/@banc/@st0/vocals/warm/live.st0`) seeds the rig with a copy of
that chain, what k7 records through (`apps/k7/docs/chainSource.md`). The bare `/@banc/live.st0` and
a bare library ref, `/@banc/@st0/live.st0`, are refused by the service: a library is not edited on
a bench but by an admin from any project. `benchChainOf` is the whole rule — spelled
once, in this package, so the browser that builds the link and the service that reads it cannot
drift. Anything else under `@banc` names nothing and is a 404 whose sentence says where a chain and
a module are edited instead (`apps/st0/frontend/docs/sharedModules.md`).

The project part is safe to join onto a root, because it never is: the folder is the constant
`live.st0` whatever the address says, and the chain ref is only ever MATCHED against the chains the
library holds. A ref is folder names — no empty, dotted or `.st0` segment — so a traversal is not
even a candidate.

### `@shares` — a frozen snapshot

`/@shares/<token>.st0` opens a snapshot pl8 holds: no clone, no engine, no account.

The `.st0` on the end is not decoration. `parseLaunch` ends a project at the last segment claiming
the app's suffix, so spelling the token this way makes it the PROJECT part of an ordinary address —
which means `parseLaunch`, `projectBasename` and every route below them need no special case, the
token lands inside the router's basename, and a reload or a pasted link simply re-reads it.

`shareToken` is checked rather than trusted, and it is the one sentinel that must be: one segment,
base64url and nothing else — which is what `randomBytes(32).toString("base64url")` produces and
what a traversal is not.

`shareUrl` is built from the ORIGIN the browser is on and not on the machine that rendered: that
machine has no idea which origin you are reading this on, and a checkout, the LAN proxy and the
public host are three different answers. Only the tab knows which one it is.

`shareKey` is `sha256(token)` in hex, computed by whoever holds the link. pl8 stores the hash and
names the directory with it, so the SECRET is never a path segment: a path segment reaches every
access log, every `Referer` and every proxy's error page, and the link is the whole of the
protection. The price is that the page has to do the hashing, and `crypto.subtle` exists only in a
SECURE CONTEXT — over plain http on something that is not localhost there is no digest at all.
That refusal is thrown with a sentence rather than left to surface as
`undefined is not a function`, because it is a real deployment and not a bug: the fix is to serve
the page over https, and nothing about the share is wrong.

`shareApiBase` goes through `serviceUrl` and not the bare origin: the share's routes are pl8's
backend's, on pl8's subdomain, and the difference is invisible until a share is opened — exactly
the kind of route that gets tried last. `public` is IN the path on purpose: a comment that survives
a refactor, and one nobody confuses with `/api/shares`, which is the author's half and is behind the
guard.

## One builder, one claim key

`shareUrl`, `localProjectUrl` and `externalUrl` all go through `launchUrl` rather than spelling the
address out beside it: these addresses are read back by `parseLaunch` and `projectBasename`, and a
second builder is a second place for the encoding to differ. `launchUrl` keeps only the origin of
what it is handed, so a caller can pass `window.location.href` without stripping anything first.
`localProjectUrl` takes an `app` for the reason every other row on the home page does: a `.z0`
folder in the same workspace opens in z0's editor, under its own mount.

`projectClaimKey` is `<sentinel>/<projet>` — for `@local`, the workspace and the folder inside it —
stated here and not in each gate: two surfaces that spell one project differently would each
believe they had it, and the rule "one engine per project" would hold for neither. No app prefix,
because which app opens a folder is decided by its SUFFIX, so two folders with different suffixes
are already two different strings.

## A surface, opened on its own

A surface is a screen the project declares, and some of them are things you stand away from the
computer to use — a desk you want on a tablet by the decks, not on the laptop behind them. So
every surface has an address of its own, `<project>/@external/<surface>`, and opening it on another
device gives that surface and nothing else, driving the same engine as the tab that has the
project open.

`EXTERNAL_SEGMENT` sits BELOW the project, not beside it, and that is what makes it cost nothing:
`parseLaunch` ends a project at the last segment claiming the app's suffix, so everything after is
already the app's own route. The project parses exactly as it always does, the router's basename is
unchanged, and a reload or a pasted link re-reads the address. The `@` cannot be a surface id
either (`createSurfaceFile` allows letters, digits, `_` and `-` and nothing else), so the sentinel
can never collide with the thing it sits next to.

`parseExternal` reads it the same way `parseLaunch` reads the project — off the address and
nothing else — so the two cannot disagree about what a tab is on. It returns null for a bare
`@external` with no name: that is not "some surface", it is an address somebody truncated.

`externalOf` exists for the caller that did not CHOOSE the address: a lister has already built the
project's link (`projectHref`) by the time it wants the surface's. One encoder either way, which is
the point of it being here rather than a template string at the call site.

### `/external`, the menu

The page a second device opens first and, installed as a PWA, the one it starts on: every surface
this account can drive, across every project on the machine. It needs no project in the address,
which is why it sits at the app's mount rather than under one. `isExternalIndex` matches it —
exactly one segment, `external`, after the mount — and `main.tsx` reads it before `parseLaunch`.
Since every project address starts with a sentinel, the plain word collides with nothing.

`/libraries` and `/settings` are two more such pages — st0's list of the origin's libraries, and
its settings — reserved for the same reason: neither opens a project. `isHomePage` matches both,
and it is read BEFORE `parseLaunch`, which would otherwise take the word for a workspace and the
router would mount under it. Once loaded they are ROUTES of st0's home, the router's basename
being the mount, so going between the home and either one reloads nothing. `/external` stays a
branch because it swaps the page's manifest before anything mounts.
