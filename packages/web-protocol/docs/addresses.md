# The address of a project

`projects.ts` states two contracts: which studio app owns a folder, decided by the folder's NAME,
and the address that names one, `/<repo>/<project>`. Both sit between the side that WRITES an
address — st0's home page — and the apps that read one back, which is why they are stated once,
browser-safe, and nowhere else. See `apps/st0/frontend/docs/projects.md` and
`packages/project-shell/docs/launch.md`.

## Where each service answers

`services.ts` states one origin and one FIXED path per service, and that is the point:
`st0.priv.frediver.se/pl8` in dev and `studio.frediver.se/pl8` in production differ by their
ORIGIN and nothing else. The dev proxy mirrors what the production edge does — strip the prefix
off the API routes, keep it on the SPA's — so a service that moved to a host of its own would
break the one session cookie the origin carries. There is nothing there to configure.

`st0` is deliberately `""`: the EDITOR is the studio's front door, so it answers at the ORIGIN
itself and `serviceUrl(origin, "st0")` *is* the origin. An empty path is a real entry rather than
a special case at each call site — every caller already concatenates.

What you land on is your own WORK: the editor's home page lists the repositories, the projects,
the libraries and the shares. The catalogue is what a project draws ON, so it answers at `/pl8`
and is a link in that home page's header. None of the storage follows that split — the
repositories, the shares and the whole of `/api/mediatek` are pl8's backend's, under `/pl8/api`
like every other prefixed service.

### `/auth/*` belongs to whoever holds `""`

Which is st0. `redirectUriFor` builds `<origin>/auth/callback` and that is the single
`redirect_uri` the IdP has registered, so the flow can only be served by the service with no
prefix. Every other service passes `mountRoutes: []` and verifies the cookie.

That makes auth follow this table rather than escape it — but the paths still do not look alike,
so spell auth routes BARE (`/auth/me`) and never under a service's own `BASE`. For st0 the two
happen to coincide today; for pl8, k7 and z0 they do not, and `${serviceUrl(…, "pl8")}/auth/me`
would 404 into what reads like a broken login.

Routing `/auth/*` to a prefixed service by name in nginx works and reads as an exception to
everything around it, which is why it is not done. Nothing is registered at the IdP per service
either: the `redirect_uri` is one string, and which process serves it is this table's answer.

The table says WHERE a service answers and nothing about whose session it carries. `z0` is the
case that makes the distinction worth stating: the game runs its own login on its own
`/z0/auth/callback` and does not share pl8's cookie — but its path is as fixed as the others', and
it holds a surface that opens a project, which needs an address pl8 can write.

### The ports are the other half of the same table

A SERVER calling another studio service uses `SERVICE_PORTS` rather than the public URL, and the
reason is not performance: in a checkout everything is behind a private CA, whose local CA node
does not trust, so `https://st0.priv.frediver.se/pl8` fails with `UNABLE_TO_GET_ISSUER_CERT` from
a backend while working perfectly in the browser beside it.

## Owning a suffix is not the same as being creatable

`PROJECT_SUFFIXES` has two entries, because two apps open a project. Everything an st0 project can
BE is a shape *inside* `.st0` rather than a folder kind of its own: a song carries `video_tracks/`
and a `viewport` surface, a set carries `songs.yaml` and a `turntables` surface (`PROJECT_SHAPES`
in `@studio/song`). See `packages/song-video/docs/picture.md` and
`packages/song/docs/setProject.md`.

`HAS_SCAFFOLD` is a different set. Owning a folder kind is a naming rule; creating one needs a
**scaffold** — a file map the file service can write (`createProjectIn`, and `@studio/song`'s
three `scaffold*` modules). z0 owns `.z0` and has none, so offering it in pl8's "Nouveau projet"
menu produced a folder with an st0 song inside it: the suffix said z0, the contents said
otherwise, and nothing complained until the app that opened it found nothing it could read.

It is a `Record<ProjectApp, boolean>` rather than a list, so adding an app to `ProjectApp` fails to
compile until someone answers the question for it.

`projectApp` reads the NAME, not the contents, and the two are different questions: "who opens
this" and "can the engine be given it". Only the second needs a file opened, which is why the
first can be answered without a checkout at all. A `project.yaml` is what makes a project
COMPILE, and `@studio/song` asks that question its own way, on the machine's own clone.

## Where an app is mounted

`PROJECT_MOUNTS` is empty for st0, which IS its service: `st0.priv.frediver.se/<repo>/<project>`.
z0 is six SPAs behind one prefix and only one of them opens a project, so its address has to name
the SPA too — `st0.priv.frediver.se/z0/editor/<repo>/<project.z0>`.

It belongs here rather than in pl8's link builder for the reason the suffixes do: the address is a
contract between the side that WRITES it and the side that parses it back, and a mount known to
only one of them is a 404 nobody can attribute.

The name is `/z0/editor`, with nothing beside it: `/z0/editor` is a literal prefix of any
`/z0/editor-*`, and a proxy comparing raw prefixes would send the project to the wrong SPA. One
name, no overlap. See `apps/z0/docs/editor.md`.

## Parsing one back

st0 is mounted at the ORIGIN ROOT, so its `base` is `/` and the repository is the FIRST path
segment. Which makes every prefix the origin claims above st0 — `/pl8`, `/k7`, `/z0`, `/api`,
`/auth`, and in dev `/dev`, `/console`, `/dev-status` — a repository short name that can never be
opened: the request never reaches this app. Nothing in `parseLaunch` can detect that, and nothing
should try; it is the edge's routing table, and `docker/nginx.conf` is where it is
written down. z0's editor keeps a prefix and is unaffected.

**Where the project ends** is decided by the folder's own name, the same rule as `projectApp`: the
project is everything up to and including the LAST segment claiming THIS app. That is what lets a
project sit at a depth (`songs/winter.st0`), lets the app's own route follow it
(`…/winter.st0/timeline`), and lets a nested set be addressed by its own app without st0's suffix
winning. With no such segment the repository itself is the project (`"."`) and everything after
the repo is the app's route — a view segment never ends in a project suffix, so the two cannot be
confused.

`base` is where the app is mounted, as vite's `BASE_URL` spells it. An address outside it names
something else: null.

### `projectBasename` is a SLICE, never a rebuild

`projectBasename` is what keeps the launch out of tab-local storage. React Router only ever
writes BELOW its basename, so the repo and project cannot be rewritten away by an app's own
`routes.ts` — which is the single thing such a memory would be for. A reload re-reads the same
path, a bookmark works, and a wrong project is fixed by editing the address instead of by
clearing storage nobody can see. It falls back to `base` when the address names no project, which
leaves the app mounted where it is and lets its gate send you to pl8.

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

`@` cannot begin a git short name — the last path segment of an SSH URI without `.git` — so a
repository position starting with it can never collide with a real repository. The gate sees the
sentinel and takes another road. Three use it.

### `@banc` — the bench

Every other project resolves against the MACHINE — a repository is a folder it holds, and
`GET /workspaces/by-repo` is what answers; the bench has no repository and wants none. It is generated from the médiathèque's
catalogue and regenerated whenever it is opened, so putting it under version control would version
a cache. `ProjectGate` does no lookup, no clone, one call to the machine that makes the folder.

A CHAIN on the bench is `/@banc/chains/<path>.st0`, and the address's project part is what says
which. The catalogue path IS the project path with `.st0` on the end, which is why there is no
lookup table and no marker file: pl8 writes the link from the chain it is showing, the file service
reads the chain back out of it, and neither can drift from the other. `chains/` is the family
folder in the médiathèque, so a chain's path always begins with it and nothing else can be mistaken
for one.

`benchChainPath` checks rather than trusts: the path comes off an address anyone can type and is
then joined onto two roots, the médiathèque and the workspace, so every segment must be an ordinary
name — which is what stops `chains/../../…` from naming a folder outside either. Null, not an
exception: it is the same answer as "this is not a chain".

The CHAIN bench is the only one. A shared module is edited from the Libraries tab of whatever
project you already have open (`apps/st0/frontend/docs/sharedModules.md`), so nothing needs the
catalogue mirrored into a generated project of its own.

### `@shares` — a frozen snapshot

`/@shares/<token>.st0` opens a snapshot pl8 holds: no pl8 lookup, no clone, no engine, no account.

The `.st0` on the end is not decoration. `parseLaunch` ends a project at the last segment claiming
the app's suffix, so spelling the token this way makes it the PROJECT part of an ordinary address —
which means `parseLaunch`, `projectBasename` and every route below them need no change at all, the
token lands inside the router's basename, and a reload or a pasted link simply re-reads it. The
three other shapes considered all cost a special case somewhere.

`shareToken` is checked rather than trusted, exactly as `benchChainPath` is: one segment,
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

`shareApiBase` goes through `serviceUrl` and not the bare origin: pl8 sits under `/pl8`, and this
route is its backend's like every other `/api/*` of its. The difference between the two is
invisible until a share is opened — exactly the kind of route that gets tried last. `public` is
IN the path on purpose: a comment that survives a refactor, and one
nobody confuses with `/api/shares`, which is the author's half and is behind the guard.

### `@local` — a project belonging to no repository

`/@local/<workspace>/<projet>.st0` skips the whole road that turns a name into a URI into a clone.
There is nothing to clone — the folder is already on the machine and came from nowhere else.

Two kinds of workspace need it: `Examples`, seeded with the demos the first time a person is seen,
which is what a new account has on the day it has nothing else; and a folder somebody made by
hand. Neither has an origin, so neither has a `<repo>` to put in an address — without this
sentinel neither has an address at all, and so no row on the home page.

It is also the way OUT of an ambiguity: two clones whose origins end in the same short name make
`/<name>/…` name two repositories, which pl8 refuses (409) rather than resolving. Their rows link
through here instead, because a workspace name is unique on a machine by construction — it is a
folder name.

`parseLaunch` needs nothing added. `/@local/Examples/synth-demo.st0` already reads as repo
`@local`, project `Examples/synth-demo.st0`: the project part ends at the last segment claiming the
app, exactly as everywhere else. `localTarget` is what splits the workspace off the front of it,
and is the only new rule — a workspace that IS a project has nothing after its name and the project
is `"."`, the same answer `parseLaunch` gives when a repository is the project.

The price, stated where it is paid: this address names a machine's folder, so it is **not
portable**. A repository's address opens the same song on any machine — that is what
`projectClaimKey` identifies a project by — while this one means nothing on the next one. A
workspace that has a repository must therefore keep its `/<repo>/…` address, and this is for the
ones that cannot have it.

## One builder, one claim key

`shareUrl`, `localProjectUrl` and `externalUrl` all go through `launchUrl` rather than spelling the
address out beside it: these addresses are read back by `parseLaunch` and `projectBasename`, and a
second builder is a second place for the encoding to differ. `launchUrl` keeps only the origin of
what it is handed, so a caller can pass `window.location.href` without stripping anything first.
`localProjectUrl` takes an `app` for the reason every other row on that page does: a `.z0` folder
in the same workspace opens in z0's editor, under its own mount.

`projectClaimKey` is `<repo>/<projet>`, stated here and not in each gate: two surfaces that spell
one project differently would each believe they had it, and the rule "one engine per project"
would hold for neither. The repository's short name and the folder path inside it are exactly what
identifies a project across machines — a workspace path would not, since the same repository is
cloned somewhere different on each. No app prefix, because which app opens a folder is decided by
its SUFFIX, so two folders with different suffixes are already two different strings.

## A surface, opened on its own

A surface is a screen the project declares, and some of them are things you stand away from the
computer to use — a desk you want on a tablet by the decks, not on the laptop behind them. So
every surface has an address of its own, `<project>/@external/<surface>`, and opening it on another
device gives that surface and nothing else, driving the same engine as the tab that has the
project open.

`EXTERNAL_SEGMENT` sits BELOW the project, not beside it, and that is what makes it cost nothing:
`parseLaunch` ends a project at the last segment claiming the app's suffix, so everything after is
already the app's own route. The repo and the project parse exactly as they always did, the
router's basename is unchanged, and a reload or a pasted link re-reads the address. The `@` cannot
be a surface id either (`createSurfaceFile` allows letters, digits, `_` and `-` and nothing else),
so the sentinel can never collide with the thing it sits next to.

`parseExternal` reads it the same way `parseLaunch` reads the project — off the address and
nothing else — so the two cannot disagree about what a tab is on. It returns null for a bare
`@external` with no name: that is not "some surface", it is an address somebody truncated.

`externalOf` exists for the caller that did not CHOOSE the address: a workspace is named by its
repository when that works and by `@local` when it does not (`projectHref`), and a lister has
already made that decision by the time it wants the surface's link. One encoder either way, which
is the point of it being here rather than a template string at the call site.

### `/external`, the menu

The page a second device opens first and, installed as a PWA, the one it starts on: every surface
this account can drive, across every project on the machine. It needs no project in the address,
which is why it sits at the app's mount rather than under one.

**It is a reserved short name.** A single segment is a legal project address — `/<repo>` is how a
lone-project clone is opened — so claiming `external` there means a repository of that exact name
cannot be opened at its root. It joins the list the origin already keeps (`/pl8`, `/k7`,
`/z0`, `/api`, `/auth`), with the same remedy: rename the repository, or address a project inside
it, which is unaffected — `/external/song.st0` still parses as the repo `external`. The sentinel
spelling `@external` would avoid the shadow outright, as `@shares` does; the plain word is the
address chosen, and one reserved word is a cost that can be read in the URL bar.
