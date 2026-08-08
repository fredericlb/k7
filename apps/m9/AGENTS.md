# AGENTS.md — m9

**l8 without the timeline.** It opens on ONE project — a `*.m9` folder in a git repository,
chosen from st0's Projets section — and shows three views: **Mix**, **Édition**, **Graphe**.
It was `platines` until the rename, and the decks are still what Mix draws.

Dev ports: **frontend 5225, backend 8796**, served at `https://studio.test/m9`.

| workspace | role |
|---|---|
| `frontend` (`m9-frontend`) | React + Vite. The project shell, the file tree, the editor, the chains graph — and the decks, under Mix. |
| `backend` (`m9-backend`) | Express — OIDC auth, **this service's** engine registry, and which machine the account works from. No file routes, no media. |

Read `docs/views.md` first: what each view is, why Mix is still the decks, and what m9
deliberately does not have. The project it opens is a **set** — `songs.yaml` plus two decks
meeting at a crossfade — described in
[packages/song/docs/m9Project.md](../../packages/song/docs/m9Project.md); what Mix does with
it is [docs/setList.md](docs/setList.md).

## The two things to understand first

**1. m9 picks no workspace.** st0 owns the repositories and links here with
`?repo=&project=`. `ProjectShell` mounts `@studio/project-shell`'s gate — the same one l8
mounts — which resolves that repository to a folder on the chosen machine, cloning it with a
visible progress bar if that machine has never seen it, then opens the project. Arriving with
no parameters redirects to st0's `/projects`. See
[packages/project-shell/docs/launch.md](../../packages/project-shell/docs/launch.md), in particular why the two
parameters are read at *import* time.

**2. The moteur opens file paths. It cannot fetch a URL.** That is still why Mix plays the
médiathèque's **cache on the engine's own disk**, reached through that machine's file service,
rather than the hosted library st0 serves — and it is why `songs.yaml` is a file rather than a
picker: everything the set names is pulled onto that machine before the gig. Three servers,
and only one is same-origin:

| | m9's backend | the machine's file service | the machine's moteur |
|---|---|---|---|
| holds | who you are, which engines exist, which one you work from | the project's files, AND the cached catalogue | playback |
| reached | same-origin `/api` | absolute URL — direct when the browser may, else relayed through this origin | WebSocket — direct when the browser may, else relayed through this origin |

See `docs/plumbing.md` for the whole path, and `docs/chains.md` for what hosting the shared
chains view proved about its seams.

**3. The decks are a DOCUMENT, and it does not live in the view that draws them.**
`useDeckSet` is held by `Studio`: what is loaded, what each deck plays at, the bindings, the
compiled project and every gesture that changes them. Mix is unmounted the moment somebody
opens Graphe, and a set does not stop existing then — that one fact is why the graph can show
a plugin's real value, why a trip through it no longer forgets the songs or re-centres the
crossfader, and why a tempo can be turned from either side. `MixView` draws and owns nothing;
what stays its own is the set list, the waveforms and the song browser. See
[docs/deckSet.md](docs/deckSet.md).

## Conventions worth knowing

- **Every file route is `@studio/project-shell`'s.** `api.ts` re-exports `projectApi` and adds
  nothing: m9 is l8 without the timeline, not a second dialect of the same file service. A
  route m9 needs and l8 has goes in the package, not here.
- **The session is `SESSIONS.m9`, per service AND per person** (`useEngine.ts`). A deck runs
  safely beside l8 on one engine, and two people on one machine hold two of them.
- **Everything that reaches an engine goes through `api.ts`'s `engines`** — one
  `@studio/engine-browser/access` object holding the registry routes, the probe, the policy
  and the lease, bound to `/m9` once. `engines.find()` is the four steps every gate runs;
  `engines.hold()` is the lease, which must be HELD and not taken (a single `select` lapses
  after the TTL and the machine reads free in everyone's picker mid-set — m9 shipped that bug
  once). See that package's `docs/access.md` and `docs/lease.md`.
- **`platine` the French noun still appears** and is not a leftover: the deck slot's label and
  the turntable glyph mean a turntable, not this app.
- **No command bar.** The chains view's `command` prop is required, so `GraphView` passes a
  warning stub. That is deliberate — see `docs/chains.md`.

## Verify

`npm run dev --workspace m9` runs both halves. `npm run test --workspace m9-frontend` covers
the deck document, the graph builder and the view routing — pure logic, **nothing mounted**.
For the gate, the lease and the engine picking, run it and watch: this app's failures are
mostly "something reads as available when it is not", which no unit test here would catch.

To reach it at all you need a project: add a repository in st0's Projets section with a folder
whose name ends in `.m9`, and open it.
