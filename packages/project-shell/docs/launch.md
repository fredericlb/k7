# An app is opened ON a project — it does not choose one

The level above a project is a screen of its own, and exactly one screen: **k7's home page**,
the address that names no project. It lists the account's workspaces on the machine and the
projects inside them, and it links to one with an **address**:

```
/@local/Examples/synth-demo.k7
/@local/band/albums/winter.k7             a project at a depth
/z0/editor/@local/songs/party.z0
/z0/editor/@local/band/winter.k7/live.z0  a .z0 session living inside a .k7 song
```

| | |
|---|---|
| the first segment after the app's mount | a **sentinel** — `@local`, `@banc` or `@shares` |
| for `@local`, the next one | the **workspace**: a folder on the machine holding the working copies |
| the rest | the project folder **inside** that workspace, or nothing at all when the workspace *is* the project |

Which of the two apps gets the link is decided by the folder's **name**: `.k7` or `.z0`
(`@studio/web-protocol/projects`). Resolving the address to a folder is this package's job.

## Why a path, and why a folder rather than a repository

Both halves of that are deliberate.

**A path, not `?repo=&project=`.** A query string is exactly what an SPA's router owns:
`useViewRoute` mirrors the shell's state into the address on every change, and what it writes
comes from each app's `routes.ts`, which knows nothing about a workspace. A launch carried
there is therefore gone within a frame of the first render, which leaves reading it at import
time and keeping it in `sessionStorage` — and *that* is what makes a tab handed a bad project
unable to recover: the memory replays it on every reload and every retry, invisibly.

As a path it is simply the router's **basename**. React Router only ever writes below its
basename, so nothing can rewrite the project away, and the address IS the state: a reload
re-reads it, a bookmark works, and a wrong project is fixed by editing the URL. There is nothing
to clear.

**A folder, not a repository.** No service keeps a register mapping a short name to a git URI, so
nothing has to answer before a project can open, and a machine with no server is not a degraded
one: an imported repository and a project made locally are the same thing, a folder with an
`origin` if it has one. What that gives up is portability between accounts — a link pasted to
somebody names a folder in yours (`apps/k7/frontend/docs/projects.md`).

## Where the project ends, and the app's route begins

One rule: the project is everything up to and including the **last segment whose name claims
this app**. `…/winter.k7/timeline` is the project `winter.k7`
plus the app's own `/timeline`; a view segment never ends in `.k7` or `.z0`, so the two cannot
be confused. Each app reads its OWN suffix, which is what lets z0's editor open
`winter.k7/live.z0` without k7's suffix winning the match.

With no such segment at all, the project part is `"."` — and that means two different things,
which the MACHINE settles rather than the address:

- the workspace's own folder is a project (`hiver.k7/` cloned as itself), so `.` names it;
- it is not, and the workspace holds several projects. Then `.` names none of them, and
  `POST /open` resolves it: the active-project marker first, then the first project on disk,
  then nothing at all — see `packages/file-service/docs/workspaces.md`.

That last case is what a bare `/@local/band` is, and it is why the address may name a project
without being the only thing that can choose one. A workspace holds several, the editor draws all
of them, and the ▶ on a project row moves the engine between them **without touching the address**:
the gate has already resolved, and `POST /open` is a call rather than a navigation. The address
is where you ARRIVE, not a running account of where you are.

## A workspace with nothing in it

`POST /open` answering `activeProject: null` is not a failure — a workspace is CREATED empty
(`packages/file-service/docs/workspaces.md`), so this is the first thing a new one does. The gate
has a phase of its own for it and hands it to the host app through **`renderEmpty`**, because
what a first project IS — which archetypes exist, which suffix ends it — is the app's vocabulary
and not the gate's. k7 draws its wizard there; an app that passes nothing gets a sentence and
the way back.

An account with **no library** is the same case one level up, and goes the same way:
**`renderNoLibraries`** draws the app's form for adding one under the refusal, and its `onAdded`
re-runs the resolve. A refusal that sends you to another page to fix it is a dead end; k7 puts its
Libraries page there, which an admin can add to and anyone else reads, being told to ask one.

`onCreated` re-runs the whole resolve rather than being told what was made. The wizard therefore
does not have to report a project, an address or a workspace correctly: it makes one and asks the
gate to look again, which is the same road every other arrival takes.

## Three addresses, and nothing else

The first part of an address is a **sentinel**, and `@` is what makes that safe: it cannot begin
a folder name git would give a clone, so none can collide with a workspace.

| address | what it opens | the road |
|---|---|---|
| `/@local/<workspace>/<project>` | a project in a workspace on this machine | `POST /open` on it — no lookup, no clone, **no libraries check** |
| `/@banc/<chain>/live.k7` | the bench: one live rig, generated, seeded with a copy of a library chain, for anyone. The bare `/@banc/live.k7` and a bare library (`/@banc/@k7-core/live.k7`) are refused — a library is edited by an admin from any project | the libraries check, then the machine writes the rig again and opens it |
| `/@shares/<token>.k7` | a project at a checkpoint the media library holds | no account and no working copy; the server's engine, through the share's player |

**Anything else is refused** with the "missing" screen, which says a project opens from the home
page: guessing which folder a repository name meant would open the
wrong one silently. A repository reaches a workspace on the home page — **Importer** clones it
there — never through the gate.

**The libraries, and why `@local` skips them.** The bench asks for `GET /account/libraries` first
(the file hub answers it): every `@<library>/…` ref resolves against one of them, so without
any the rig opens with every shared module missing, which reads as a broken rig rather than as an
account nobody finished setting up — hence a screen of its own and no Retry, the answer staying the
answer until an admin sets it in k7's Libraries page (`apps/k7/frontend/docs/projects.md`). A workspace
on this machine is what a NEW account has — `Examples`, seeded with the demos — and a new account
has no library: refusing it would put the demos behind the one piece of setup they exist to
precede, and a song that needs a library says so itself, as an unresolved reference.

`POST /open` asks the file hub to bring the origin's libraries to their latest on the way — waiting
only for one not cloned yet — brings an admin's own clones of them to their remote, and takes out whatever `_libraries` submodule the workspace holds
(`packages/file-service/docs/libraries.md`). Nothing about the libraries rides on the request:
they are the server's, and it knows them.

The bench is matched on the **app** as well as the name. It is a `.k7` project, so
`/z0/editor/@banc/…` names nothing and is refused like any other unknown address. Its wait is
reported as `cloning` because from here it is the same thing: a visible wait while the server
brings the libraries up to date, and the first one is the slow one. The project part of the address rides
along with it, since the machine is the side that says which address the bench answers.

**`parseLaunch` knows about none of them.** All three are ordinary addresses whose first part
happens to start with `@`: the project part still ends at the last segment claiming the app's
suffix, which is why `@shares` spells its token `<token>.k7` and why `@local` puts the workspace
name in front of an ordinary project path. The only rule any of them adds is a reader —
`shareToken`, `isBenchProject`, `localTarget` — and all three live in
`packages/web-protocol/projects.ts`, beside the address they read.

Two failures get a screen of their own rather than a diagnosis, because in both the machine
answered and nothing is broken: an **address naming no workspace**, and a **project that is not in
the workspace** (400/404 from `POST /open`, whose sentence IS the explanation). Their only useful
action is to go and pick again, so that is the one button. Running the reachability probe on them
gives the worst screen in the app — "this page isn't allowed to reach the engine", a CORS story,
with the real message in a code block underneath — because the probe reaches a service that is
plainly up and therefore always reports `blocked`.

Arriving with **no** project in the address is not a failure to redirect away from — for k7 it
IS the home page, `main.tsx` branching on `parseLaunch` before any gate is mounted (see
`apps/k7/frontend/docs/projects.md`). For every OTHER app that mounts this gate, it is a
redirect there, through `projectsUrl`.

There is deliberately no *second* picker: one list, in one app, is the whole point. z0's editor
comes back to k7's home rather than growing one of its own, because that list already holds
`.z0` folders and a second one would be the second thing to keep in step with the first.

> **The screen is k7's, and so is the list.** The catalogue (the médiathèque) is what a project draws ON,
> while "which projects do I have" is the first question of the app that opens one, and the
> machine that scaffolds a project is k7's side of the wire. The workspaces and the libraries
> are the machine's, asked of the file service.
>
> k7 answers the ORIGIN, so this page is `<origin>/`, and `projectsUrl` asks `serviceUrl` for
> k7's origin rather than spelling it, so where the editor answers stays a fact of one table.

`projectsUrl` ends in a slash on purpose — that is `BASE_URL`'s own spelling, so a tab lands on the
app's mount rather than on a redirect to it. And `serviceUrl` is what keeps the prefix a fact read
from one table rather than a slash somebody has to remember.

## Waiting for sync

On a machine that syncs with a relay, the gate asks `/sync/project` before `/open` and shows the
SYNC screen until the answer is ready (`src/syncWait.tsx`): reaching the server, the latest edits
arriving, or N files still downloading. Asking first matters on a first download, where the project
folder may not even exist yet and `/open` would answer "no such project".

The machine is the rule and the gate the courtesy: `/open` refuses with 409 while the project is
still syncing (`packages/file-service/docs/liveCapture.md`, "Up to date"), so a ▶ on a project row
cannot open half a project either, and a gate that hears 409 because the project fell behind between
its two questions waits again. A service without the route answers 404, which reads as nothing to
wait for: an older machine, or a share, has nothing on its way.

## What the gate takes, and what it refuses to know

`GateEngine` declares what the gate needs about the engine it resolved against, **structurally**,
so it does not care how each app models one. Two of its fields are flat (`fileBase`, `token`) and
the third is nested: `engine: { id }`, because a call to another service has to name the machine it
is borrowing (`FileCfg.engineId`, and the media library's `/api/stems` is the first that does). Nested rather
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

`ProjectGateStrings` is mostly required, and some groups are not: the **bench**'s wait
(`benchWorkspace`, `benchFetching`), the **idle** screen (`idleTitle`, `idleBody`, `resume`), and the
**sync** wait (`syncing`), which a machine linked to no relay never shows. The missing screen's two
address hints (`localUsage`, `retiredAddress`) and the `details` label over the raw message are optional
too: they were added after z0 pinned the package, and an addition must not break it.
Both are screens an app may be structurally unable to reach — the bench is a `.k7` project, so
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
with the fix in only one of them. A gate is worse than that, because what it holds are
*decisions* — which addresses open what, which skip the libraries check — and two copies that
disagree open a project in one editor and refuse it in the other, which does not look like a
drift when you meet it.

The address vocabulary itself lives one level lower still, in
`@studio/web-protocol/projects`, beside the suffix rule it depends on: k7's home page
**writes** these addresses and both editors **read** them back, which makes it a wire contract
rather than an app's habit. Neither end of the contract is where the vocabulary lives, and that
is the point. `launch.ts` here is what the apps import — k7 from this tree, z0's editor from its
own repository through the published package (`docs/publishing.md`), which is why a change to an
export here is a versioned change.

Each app keeps what is genuinely its own: k7 adds waveforms, video, export, the timeline's
tracks; z0's editor adds nothing at all. The wording is each app's too — k7 has paraglide,
z0's editor is French in place — which is why the gate takes a `strings` object instead of
owning a catalogue.

## What to check in a browser

The suites here run in node and mount nothing, so `launch.test.ts` covers the addresses only —
which is most of it, the launch being the address rather than state. These are the ones a green
test run says nothing about:

- open a project from k7's home page → the address reads `/@local/<workspace>/<project>` and
  stays that way as you move around the app;
- **reload**, and use back/forward → still the same project, not the home page;
- copy the URL into another tab → the same project opens there too;
- open a `.z0` folder and a `.k7` folder from the same workspace → two apps, one working copy;
- rename the project folder on the machine and reload → the "not in the workspace" screen, not the
  CORS one, and its button lands you back on k7's home;
- replace `@local` in the address with a repository name → the same screen, saying a project opens
  from the home page and giving its address.
