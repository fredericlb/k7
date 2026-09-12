# An app is opened ON a project — it does not choose one

The level above a project is a screen of its own, and exactly one screen: **st0's home page**,
the address that names no project. It lists the account's repositories and the projects inside
them, and it links to one with an **address**:

```
/songs/first.st0
/z0/editor/songs/party.z0
/band/albums/winter.st0             a project at a depth
/z0/editor/band/winter.st0/live.z0  a .z0 session living inside a .st0 song
```

| | |
|---|---|
| the first segment after the app's mount | the repository's **short name** — its last path segment without `.git`, which is also what the clone is called on the engine's machine |
| the rest | the project folder **inside** the repository, or nothing at all when the repository *is* the project |

Which of the two apps gets the link is decided by the folder's **name**: `.st0` or `.z0`
(`@studio/web-protocol/projects`). The project is a path in the repository and not on any
machine, because the sender has never seen the machine it will be opened on. Resolving it to a
folder is this package's job.

## Why a path, and why a name rather than the URI

Both halves of that are deliberate.

**A path, not `?repo=&project=`.** A query string is exactly what an SPA's router owns:
`useViewRoute` mirrors the shell's state into the address on every change, and what it writes
comes from each app's `routes.ts`, which knows nothing about a repository. A launch carried
there is therefore gone within a frame of the first render, which leaves reading it at import
time and keeping it in `sessionStorage` — and *that* is what makes a tab handed a bad project
unable to recover: the memory replays it on every reload and every retry, invisibly.

As a path it is simply the router's **basename**. React Router only ever writes below its
basename, so nothing can rewrite the project away, and the address IS the state: a reload
re-reads it, a bookmark works, a link can be sent to someone else, and a wrong project is fixed
by editing the URL. There is nothing to clear.

**A name, not the git URI.** `ssh://git@192.168.87.10:6611/music/lemo_mante.git` carries a
host, a port and a user, and an address bar is copied, bookmarked and pasted into chat. The
address carries `lemo_mante`, and the editor asks pl8 what is behind it
(`GET /api/projects/by-name/:name` → `RepoRef`). pl8 STORES the repositories, so pl8 is the one
side that can answer, and it refuses an ambiguous name rather than guessing: two hosts can both
carry a `songs.git`, and opening the wrong one silently is worse than saying so.

## Where the project ends, and the app's route begins

One rule: the project is everything up to and including the **last segment whose name claims
this app**. `…/winter.st0/timeline` is the project `winter.st0`
plus the app's own `/timeline`; a view segment never ends in `.st0` or `.z0`, so the two cannot
be confused. Each app reads its OWN suffix, which is what lets z0's editor open
`winter.st0/live.z0` without st0's suffix winning the match.

With no such segment at all, the project part is `"."` — and that means two different things,
which the MACHINE settles rather than the address:

- the workspace's own folder is a project (`hiver.st0/` cloned as itself), so `.` names it;
- it is not, and the workspace holds several projects. Then `.` names none of them, and
  `POST /open` resolves it: the `.studio-active` marker first, then the first project on disk,
  then nothing at all — see `packages/file-service/docs/workspaces.md`.

That last case is what a bare `/band` is, and it is why the address may name a project without
being the only thing that can choose one. A workspace holds several, the editor draws all of
them, and the ▶ on a project row moves the engine between them **without touching the address**:
the gate has already resolved, and `POST /open` is a call rather than a navigation. The address
is where you ARRIVE, not a running account of where you are.

## A workspace with nothing in it

`POST /open` answering `activeProject: null` is not a failure — a workspace is CREATED empty
(`packages/file-service/docs/workspaces.md`), so this is the first thing a new one does. The gate
has a phase of its own for it and hands it to the host app through **`renderEmpty`**, because
what a first project IS — which archetypes exist, which suffix ends it — is the app's vocabulary
and not the gate's. st0 draws its wizard there; an app that passes nothing gets a sentence and
the way back.

`onCreated` re-runs the whole resolve rather than being told what was made. The wizard therefore
does not have to report a project, an address or a workspace correctly: it makes one and asks the
gate to look again, which is the same road every other arrival takes.

## Three addresses take a road of their own, and take it first

The repository part of an address may be a **sentinel** instead of a name, and `@` is what makes
that safe: it cannot begin a git short name — the last segment of an SSH URI without `.git` — so
none of these can ever collide with a real repository. Each skips the whole name → URI → clone
sequence below, because in each there is no repository to resolve.

| address | what it opens | what it skips |
|---|---|---|
| `/@shares/<token>.st0` | a frozen snapshot pl8 holds | everything: no account, no engine, no working copy |
| `/@banc/live.st0` | the bench: one live rig, generated | the lookup and the clone — the rig is written again on every open |
| `/@local/<espace>/<projet>` | a project in a workspace with no repository | the lookup, the clone, **and the libraries check** |

`@local` is the one that disagrees with step 0 below, and deliberately: a workspace with no
repository mounts no submodule, and it is what a NEW account has — `Examples`, seeded with the
demos. Refusing to open it without a library repository would put those demos behind the single
piece of setup they exist to precede. See `apps/st0/frontend/docs/projects.md`.

The bench is the one the gate matches on the **app** as well as the name. It is a `.st0` project,
so `/z0/editor/@banc/…` names nothing at all and must fall through to the ordinary road, where pl8
answers "no such repository" — which is exactly what it is. Its wait is reported as `cloning` because from
here it is the same thing: a visible wait while a machine mounts a library, and the first one is
the slow one. The project part of the address rides along with it, since the machine is the side
that says which address the bench answers.

**`parseLaunch` knows about none of them.** All three are ordinary addresses whose repository part
happens to start with `@`: the project part still ends at the last segment claiming the app's
suffix, which is why `@shares` spells its token `<token>.st0` and why `@local` puts the workspace
name in front of an ordinary project path. The only rule any of them adds is a reader —
`shareToken`, `isBenchProject`, `localTarget` — and all three live in
`packages/web-protocol/projects.ts`, beside the address they read.

## What the gate does with an ordinary one

0. `GET /api/projects/libraries` on **pl8** — the account's library repository, or null.
   Before everything below, including the bench: a workspace mounts it as a submodule and every
   `@st0/…` ref resolves inside it, so without one a song opens with every shared module
   missing. That reads as a broken song rather than as an account nobody finished setting up,
   which is why it gets a screen of its own and gets it *before* a thirty-second clone rather
   than after. No Retry — the answer was clear, and it stays that answer until somebody goes
   and sets it, on st0's home page (`apps/st0/frontend/docs/projects.md`).
1. `GET /api/projects/by-name/<repo>` on **pl8** — the git URI behind the name.
2. `GET /workspaces/by-repo?uri=` — does this machine already have this repository? The
   comparison is on a **normalised** URI, because the two ends learned the address by
   different routes: pl8 has what was pasted, the file service has whatever git wrote into
   `remote.origin.url`. See `packages/git-repos/src/uri.ts`.
3. If not, `POST /workspaces/clone` and poll the job, showing git's own progress. This is the
   visible wait the whole arrangement is designed around —
   `packages/file-service/docs/cloneJobs.md`.
4. `configureFileApi` with the workspace it resolved, then `POST /open` on the project —
   carrying the library URI from step 0, which is what mounts `_libraries` in that workspace if
   it is not there yet. The URI rides on the request because the BROWSER is the side that knows
   who is asking: it read it on this person's session, where the file service holds a machine
   token and no session at all.
5. Render the app, through the `children` callback.

Two failures get a screen of their own rather than a diagnosis, because in both the machine
answered and nothing is broken: an **unknown or ambiguous repo name** (404/409 from step 1) and
a **project that is not in the workspace** (400/404 from step 4). Their only useful action is
to go and pick again, so that is the one button. Running the reachability probe on them
gives the worst screen in the app — "this page isn't allowed to reach the engine", a CORS
story, with the real message in a code block underneath — because the probe reaches a service
that is plainly up and therefore always reports `blocked`.

Arriving with **no** project in the address is not a failure to redirect away from — for st0 it
IS the home page, `main.tsx` branching on `parseLaunch` before any gate is mounted (see
`apps/st0/frontend/docs/projects.md`). For every OTHER app that mounts this gate, it is a
redirect there, through `projectsUrl`.

There is still deliberately no *second* picker: one list, in one app, is the whole point. z0's
editor comes back to st0's home rather than growing one of its own, because that list already
holds `.z0` folders and a second one would be the second thing to keep in step with the first.

> **The screen is st0's, the storage is pl8's**, and that split is the whole arrangement: the
> catalogue is what a project draws ON, while "which repositories do I have" is the first
> question of the app that opens one, and the machine that scaffolds a project is st0's side of
> the wire. So the list lives here and every route it calls — `repoByName`, `librariesRepo` —
> is pl8's.
>
> st0 answers the ORIGIN and the médiathèque is at `/pl8`, so this page is `<origin>/` and not
> `<origin>/st0/`. `projectsUrl` asks `SERVICE_PATHS` rather than spelling either.

`projectsUrl` ends in a slash on purpose — that is `BASE_URL`'s own spelling, so a tab lands on the
app's mount rather than on a redirect to it. And `serviceUrl` is what keeps the prefix a fact read
from one table rather than a slash somebody has to remember.

## What the gate takes, and what it refuses to know

`GateEngine` declares what the gate needs about the engine it resolved against, **structurally**,
so it does not care how each app models one. Two of its fields are flat (`fileBase`, `token`) and
the third is nested: `engine: { id }`, because a call to another service has to name the machine it
is borrowing (`FileCfg.engineId`, and pl8's `/api/stems` is the first that does). Nested rather
than flattened to `id` is the shape `RankedEngine` already has — both hosts pass one of those
straight through, so asking for the field where it actually lives costs neither of them an edit.

`base` is handed over rather than read, for a dull reason with no way round it: it is vite's
`import.meta.env.BASE_URL`, a build constant of the APP, and a package cannot read another
package's build constant.

The **address is parsed once per mount**, from `window.location.pathname` and not from
`useLocation()` — the router's basename is this very prefix, so what the hook reports has the repo
and the project already stripped off it. Once matters twice: `parseLaunch` returns a fresh object
every call, which as a dependency of the setup effect would re-resolve the workspace forever; and
the prefix cannot change without a navigation that remounts the gate anyway.

### Strings that are optional, and why that is honest

`ProjectGateStrings` is mostly required, and two groups are not: the **bench**'s wait
(`benchWorkspace`, `benchFetching`) and the **idle** screen (`idleTitle`, `idleBody`, `resume`).
Both are screens an app may be structurally unable to reach — the bench is a `.st0` project, so
z0's editor can never open one, and an app that passes no `idleTimeoutMs` never leaves the
running phase. Required, they would each be made to translate a card nobody can see. The gate
falls back to plain English rather than to an empty one.

### "Somebody else opened this project"

`ProjectTakenOver` lives here, and not three times in three engine gates, because the claim is
enforced in ONE place (`@studio/engine-registry`) and a screen explaining it per app would be three
accounts of one rule. It is pure presentation: a `heldBy` string and a callback, which is what keeps
this package free of `@studio/engine-browser`. The wording stays the caller's, as everything else
here does.

**No Retry**, and that is the point of it. Retrying is precisely what must not happen: the claim is
handed over on purpose, and a tab that takes it back on a timer is how one project ends up flickering
between two people. The only move is to go and pick again — or to reopen the project deliberately,
which is a fresh open and therefore a fresh takeover.

## Why this is a package and not two copies

`docs/inventaire.md` records what copied clients cost here: one auth client in three copies,
with the fix in only one of them. This is worse than that, because the two ends of it are
a *decision* — "is this repository already on this machine" — and the failure modes are a
duplicate clone or a 404, neither of which looks like a drift when you meet it.

The address vocabulary itself lives one level lower still, in
`@studio/web-protocol/projects`, beside the suffix rule it depends on: st0's home page
**writes** these addresses and both editors **read** them back, which makes it a wire contract
rather than an app's habit. Neither end of the contract is where the vocabulary lives, and that
is the point. `launch.ts` here is what the apps import.

Each app keeps what is genuinely its own: st0 adds waveforms, video, export, the timeline's
tracks; z0's editor adds nothing at all. The wording is each app's too — st0 has paraglide,
z0's editor is French in place — which is why the gate takes a `strings` object instead of
owning a catalogue.

## What to check in a browser

The suites here run in node and mount nothing, so `launch.test.ts` covers the addresses only —
which is most of it, the launch being the address rather than state. These are the ones a green
test run says nothing about:

- open a project from st0's home page → the address reads `/<repo>/<project>` and stays that
  way as you move around the app;
- **reload**, and use back/forward → still the same project, not the home page;
- copy the URL into another tab → the same project opens there too;
- open a repository this machine has never seen → a progress bar with git's phases, then the
  app; do it again → no clone at all, straight in;
- open a `.z0` folder and a `.st0` folder from the same repository → two apps, one clone;
- rename the project folder on the machine and reload → the "not in the repository" screen,
  not the CORS one, and its button lands you back on st0's home;
- edit the repo name in the address to something nonexistent → the same screen, saying pl8 has
  no repository by that name.
