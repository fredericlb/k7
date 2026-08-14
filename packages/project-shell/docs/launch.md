# An app is opened ON a project — it does not choose one

l8 used to own the level above a project: a picker over the folders under
`~/.studio/root/<you>/`, a clone-from-SSH form, a key page beside it. All of that is gone from
both apps. **st0 owns the repositories** — it is the studio's home page, and its Projets
section is what it opens on — and it links to a project with an **address**:

```
/l8/songs/first.l8
/m9/songs/live.m9
/l8/band/albums/winter.l8        a project at a depth
/m9/band/winter.l8/live.m9       a .m9 set living inside a .l8 song
```

| | |
|---|---|
| the first segment | the repository's **short name** — its last path segment without `.git`, which is also what the clone is called on the engine's machine |
| the rest | the project folder **inside** the repository, or nothing at all when the repository *is* the project |

Which of the two apps gets the link is decided by the folder's **name**: `.l8` or `.m9`
(`@studio/web-protocol/projects`). The project is a path in the repository and not on any
machine, because the sender has never seen the machine it will be opened on. Resolving it to a
folder is this package's job.

## Why a path, and why a name rather than the URI

Both halves of that are deliberate.

**A path, not `?repo=&project=`.** The parameters were a query string, and a query string is
exactly what an SPA's router owns: `useViewRoute` mirrors the shell's state into the address on
every change, and what it writes comes from each app's `routes.ts`, which knows nothing about a
repository. The launch was therefore gone within a frame of the first render — so it had to be
read at import time and kept in `sessionStorage`, and *that* is what made a tab handed a bad
project unable to recover: the memory replayed it on every reload and every retry, invisibly.

As a path it is simply the router's **basename**. React Router only ever writes below its
basename, so nothing can rewrite the project away, and the state that used to live in storage
is the address itself: a reload re-reads it, a bookmark works, a link can be sent to someone
else, and a wrong project is fixed by editing the URL. There is nothing to clear.

**A name, not the git URI.** `ssh://git@192.168.87.10:6611/music/lemo_mante.git` carries a
host, a port and a user, and an address bar is copied, bookmarked and pasted into chat. The
address carries `lemo_mante`, and the editor asks st0 what is behind it
(`GET /api/projects/by-name/:name` → `RepoRef`). st0 owns the repositories, so st0 is the one
side that can answer — and it refuses an ambiguous name rather than guessing: two hosts can
both carry a `songs.git`, and opening the wrong one silently is worse than saying so.

## Where the project ends, and the app's route begins

One rule, and it is the one already in use: the project is everything up to and including the
**last segment whose name claims this app**. `…/winter.l8/timeline` is the project `winter.l8`
plus the app's own `/timeline`; a view segment never ends in `.l8` or `.m9`, so the two cannot
be confused. Each app reads its OWN suffix, which is what lets m9 open `winter.l8/live.m9`
without l8's suffix winning the match.

With no such segment at all, the repository itself is the project (`"."`) and everything after
the repo name is the app's route.

## What the gate does with it

0. `GET /api/projects/libraries` on **st0** — the account's library repository, or null.
   Before everything below, including the bench: a workspace mounts it as a submodule and every
   `@st0/…` ref resolves inside it, so without one a song opens with every shared module
   missing. That reads as a broken song rather than as an account nobody finished setting up,
   which is why it gets a screen of its own and gets it *before* a thirty-second clone rather
   than after. No Retry — the answer was clear, and it stays that answer until somebody goes
   and sets it (`apps/st0/docs/projects.md`).
1. `GET /api/projects/by-name/<repo>` on **st0** — the git URI behind the name.
2. `GET /workspaces/by-repo?uri=` — does this machine already have this repository? The
   comparison is on a **normalised** URI, because the two ends learned the address by
   different routes: st0 has what was pasted, the file service has whatever git wrote into
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
produced the worst screen in the app — "this page isn't allowed to reach the engine", a CORS
story, with the real message in a code block underneath — because the probe reaches a service
that is plainly up and therefore always reports `blocked`.

Arriving with **no** project in the address — `/l8/` on its own, a hand-typed URL — redirects
to st0's `/projects`. There is deliberately no fallback picker in either app: a second way to
choose a project is a second thing to keep in step with the first.

## Why this is a package and not two copies

`docs/inventaire.md` already records what copied clients cost here: the auth client existed in
three copies and only one had the fix. This is worse than that, because the two ends of it are
a *decision* — "is this repository already on this machine" — and the failure modes are a
duplicate clone or a 404, neither of which looks like a drift when you meet it.

The address vocabulary itself lives one level lower still, in
`@studio/web-protocol/projects`, beside the suffix rule it depends on: st0 **writes** these
addresses and l8/m9 **read** them, which makes it a wire contract rather than an app's habit.
`launch.ts` here is what the two apps import.

Each app keeps what is genuinely its own: l8 adds waveforms, video, export, the timeline's
tracks; m9 adds nothing at all. The wording is each app's too — l8 has paraglide, m9 is French
in place — which is why the gate takes a `strings` object instead of owning a catalogue.

## What to check in a browser

The suites here run in node and mount nothing, so `launch.test.ts` covers the addresses only —
which is now most of it, the launch having stopped being state. These are the ones a green test
run says nothing about:

- open a project from st0 → the address reads `/l8/<repo>/<project>` and stays that way as you
  move around the app;
- **reload**, and use back/forward → still the same project, not st0;
- copy the URL into another tab → the same project opens there too (this is what storage could
  never do);
- open a repository this machine has never seen → a progress bar with git's phases, then the
  app; do it again → no clone at all, straight in;
- open a `.m9` folder and a `.l8` folder from the same repository → two apps, one clone;
- rename the project folder on the machine and reload → the "not in the repository" screen,
  not the CORS one, and its button lands you back on st0's Projets;
- edit the repo name in the address to something nonexistent → the same screen, saying st0 has
  no repository by that name.
