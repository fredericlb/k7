# l8 is opened ON a project, it does not choose one

This app used to own the level above a project. `WorkspaceGate` listed the folders under
`~/.studio/root/<you>/`, offered a "new workspace" box and a clone-from-SSH form, and had a
key page beside it. All of that is gone. **st0 owns the repositories now** — it is the
studio's home page and the place a person's things are listed — and it links here:

```
/l8/?repo=git%40github.com%3Ame%2Fsongs.git&project=songs%2Ffirst
```

Two parameters, and they are the whole contract:

| | |
|---|---|
| `repo` | the SSH git URI, exactly as st0 holds it |
| `project` | the project folder **inside** the repository, or `.` when the repository itself is the project |

`project` is a path in the repository and not on this machine, because the sender has never
seen this machine. Resolving it to a folder is `ProjectGate`'s job.

## Why `launch.ts` reads the address at import

Because within a frame of the first render, those parameters are gone.

`useViewRoute` mirrors the shell's state into the address and does it with `replace`, and
what it writes comes from `routes.ts` — which knows about views, panes and panels and nothing
whatsoever about `repo`. The first commit therefore rewrites `/l8/?repo=…&project=…` to `/l8/`
and the launch is lost.

So the read happens **at module scope**, and `main.tsx` imports the module for that side
effect alone (and says so, because an import with no binding is exactly the line someone
tidies away). Everything after that reads `launchTarget()`, which answers from a value
captured before React existed.

It is also remembered in `sessionStorage`, for the same frame of reference: a reload arrives
on whatever the router last wrote, with no parameters at all, and without the memory every
refresh would bounce you back to st0.

## What `ProjectGate` does with it

1. `GET /workspaces/by-repo?uri=` — does this machine already have this repository? The
   comparison is on a **normalised** URI, because the two ends learned the address by
   different routes: st0 has what was pasted, the file service has whatever git wrote into
   `remote.origin.url`. See `packages/git-repos/src/uri.ts`.
2. If not, `POST /workspaces/clone` and poll the job, showing git's own progress. This is the
   visible wait the whole arrangement is designed around —
   `packages/file-service/docs/cloneJobs.md`.
3. `configureFileApi` with the workspace it resolved, then `POST /open` on the project.
4. Mount the editor.

Arriving with **no** target at all — a hand-typed URL, a cleared session — redirects to
st0's `/projects`. There is deliberately no fallback picker: a second way to choose a project
is a second thing to keep in step with the first.

## What to check in a browser

The suites here run in node and mount nothing, so `launch.test.ts` covers the parsing and the
escaping only. These three are the ones a green test run says nothing about:

- open a project from st0 → the address loses its parameters and the editor still opens;
- **reload** → still the same project, not st0;
- open a repository this machine has never seen → a progress bar with git's phases, then the
  editor; do it again → no clone at all, straight in.
