# AGENTS.md — v1

**l8's picture half, on its own.** It opens on ONE project — a `*.v1` folder in a git
repository, chosen from st0's Projets section — and shows two views: **Montage** (the
viewport over a timeline) and **Édition** (the YAML behind it).

Dev ports: **frontend 5226, backend 8790**, served at `https://st0.priv.frediver.se/v1`.

| workspace | role |
|---|---|
| `frontend` (`v1-frontend`) | React + Vite. The project shell, the transport, the timeline, the viewport, the editor. |
| `backend` (`v1-backend`) | Express — OIDC auth, **this service's** machine registry, and which machine the account works from. No file routes, no media. |

The project it opens is a **cut** — a viewport and its lanes, every position in seconds —
described in [packages/song/docs/v1Project.md](../../packages/song/docs/v1Project.md).
Read [docs/views.md](docs/views.md) first for what each view is and what v1 deliberately
does not have.

## The three things to understand first

**1. There is no engine.** This is the one structural difference from l8 and m9, and
everything else follows from it. A cut has no audio, so there is no process that owns a
sound card and no playhead to follow: the transport is v1's own `TransportClock`
(`@studio/ui-eyes/clock`), and the renderer draws against it directly. What the app still
needs from a MACHINE is its **file service** — the project's YAML, and the footage bytes —
which is why the gate still picks one and why the backend still holds a registry. See
[docs/plumbing.md](docs/plumbing.md).

**2. v1 picks no workspace.** st0 owns the repositories and links here with an ADDRESS —
`/v1/<repo>/<film.v1>`. `ProjectShell` mounts `@studio/project-shell`'s gate — the same one
l8 and m9 mount — which resolves the repository to a folder on the chosen machine, cloning
it with a progress bar if that machine has never seen it, then opens the project. That
prefix is the router's `basename` (`projectBasename` in `main.tsx`), so `routes.ts` writes
only below it. See
[packages/project-shell/docs/launch.md](../../packages/project-shell/docs/launch.md).

**3. `Studio.tsx` owns every write.** The timeline reports a finished drag; the editor
reports a save. Both land in `Studio`, go through the file service, and come back as a
recompiled document — so what is on screen is always the compiler's answer and never the
drag's guess. A drag writes the lane's YAML **surgically**
(`@studio/song/yaml/videoTrackFile`), never by re-serialising: these files carry the
comments that document the format.

## Conventions worth knowing

- **Every file route is `@studio/project-shell`'s.** `api.ts` re-exports `projectApi` and
  adds nothing. The one route v1 leans on that l8 does not is `videoDoc` — `GET /video-doc`,
  the same folder read as picture.
- **Seconds, everywhere.** There is no beat in this app. If a number in a component is not
  a pixel, it is a second.
- **The timeline is not l8's.** `views/Timeline.tsx` is v1's own, and deliberately: l8's is
  1900 lines of musical grid. What the two genuinely share is in `@studio/ui-timeline` —
  the wheel zoom, the middle-drag pan, the tick chooser, the lane geometry.
- **No command bar.** Space toggles the transport and that is the only global key. A
  command palette is the obvious next thing and does not exist yet.

## Verify

`npm run dev --workspace v1` runs both halves. `npm run test --workspace v1-frontend`
covers the routing; the dialect's own tests are in `@studio/song`
(`videoProject.test.ts`). For the gate, the machine picking and the drift correction, run
it and watch — this app's failures are mostly "the picture is on the wrong frame", which no
unit test here would catch.

To reach it at all you need a project: in st0's Projets section, add a repository and
create a project with the `v1` type, or add a folder whose name ends in `.v1`.
