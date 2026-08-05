# An app is opened ON a project — it does not choose one

l8 used to own the level above a project: a picker over the folders under
`~/.studio/root/<you>/`, a clone-from-SSH form, a key page beside it. All of that is gone from
both apps. **st0 owns the repositories** — it is the studio's home page, and its Projets
section is what it opens on — and it links to a project with two parameters:

```
/l8/?repo=git%40host%3Ame%2Fsongs.git&project=songs%2Ffirst.l8
/m9/?repo=git%40host%3Ame%2Fsongs.git&project=live.m9
```

| | |
|---|---|
| `repo` | the SSH git URI, exactly as st0 holds it |
| `project` | the project folder **inside** the repository, or `.` for the repository itself |

Which of the two apps gets the link is decided by the folder's **name**: `.l8` or `.m9`
(`@studio/web-protocol/projects`). `project` is a path in the repository and not on any
machine, because the sender has never seen the machine it will be opened on. Resolving it to a
folder is this package's job.

## Why `launch.ts` reads the address at import

Because within a frame of the first render, those parameters are gone.

Both apps mirror their shell's state into the address with `replace`, and what they write
comes from their own `routes.ts` — which knows about views, panes and panels and nothing
whatsoever about `repo`. The first commit therefore rewrites `?repo=…&project=…` away and the
launch is lost.

So the read happens **at module scope**, and each app's `main.tsx` imports the module for that
side effect alone (and says so, because an import with no binding is exactly the line someone
tidies away). Everything after that reads `launchTarget()`, which answers from a value
captured before React existed.

It is also remembered in `sessionStorage`, for the same frame of reference: a reload arrives
on whatever the router last wrote, with no parameters at all, and without the memory every
refresh would bounce you back to st0.

## What the gate does with it

1. `GET /workspaces/by-repo?uri=` — does this machine already have this repository? The
   comparison is on a **normalised** URI, because the two ends learned the address by
   different routes: st0 has what was pasted, the file service has whatever git wrote into
   `remote.origin.url`. See `packages/git-repos/src/uri.ts`.
2. If not, `POST /workspaces/clone` and poll the job, showing git's own progress. This is the
   visible wait the whole arrangement is designed around —
   `packages/file-service/docs/cloneJobs.md`.
3. `configureFileApi` with the workspace it resolved, then `POST /open` on the project.
4. Render the app, through the `children` callback.

Arriving with **no** target at all — a hand-typed URL, a cleared session — redirects to st0's
`/projects`. There is deliberately no fallback picker in either app: a second way to choose a
project is a second thing to keep in step with the first.

## Why this is a package and not two copies

`docs/inventaire.md` already records what copied clients cost here: the auth client existed in
three copies and only one had the fix. This is worse than that, because the two ends of it are
a *decision* — "is this repository already on this machine" — and the failure modes are a
duplicate clone or a 404, neither of which looks like a drift when you meet it.

Each app keeps what is genuinely its own: l8 adds waveforms, video, export, the timeline's
tracks; m9 adds nothing at all. The wording is each app's too — l8 has paraglide, m9 is French
in place — which is why the gate takes a `strings` object instead of owning a catalogue.

## What to check in a browser

The suites here run in node and mount nothing, so `launch.test.ts` covers the parsing and the
escaping only. These are the ones a green test run says nothing about:

- open a project from st0 → the address loses its parameters and the app still opens;
- **reload** → still the same project, not st0;
- open a repository this machine has never seen → a progress bar with git's phases, then the
  app; do it again → no clone at all, straight in;
- open a `.m9` folder and a `.l8` folder from the same repository → two apps, one clone.
