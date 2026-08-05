# AGENTS.md — z0

The **blind-test game**: a presenter runs a session on a screen, players buzz in from their
phones, and an editor builds the rounds. Seven single-page apps and one backend, all behind one
origin.

It is the odd one out in this repo, and knowing why saves you looking for things that are not
here. z0 is a **game**, not a studio tool: it has its own login, its own session cookie,
its own database, and it touches `engine/moteur` at exactly one point — an offline render.

## The seven SPAs and the backend

| workspace | port | served at | what it is |
|---|---|---|---|
| `online` | 3003 | `/z0` | the apex app — solo play and playlists |
| `presenter` | 3001 | `/z0/presenter` | the screen everybody looks at |
| `monitor-web` | 3002 | `/z0/monitor` | the operator's view of a running session |
| `buzzer` | 3004 | `/z0/buzzer` | the player's phone |
| `remote` | 3005 | `/z0/remote` | the presenter's own remote |
| `editor` | 3006 | `/z0/editor` | building rounds and questions, out of Grist |
| `editor-v2` | 3007 | `/z0/editor-v2` | the same job over a `.z0` project — see [docs/editor-v2.md](docs/editor-v2.md) |
| `backend` | 8080 | `/z0/api`, `/z0/auth`, `/z0/ws` | Express + WebSocket |

`shared/` (`z0-shared`) holds the presentational components and types the six frontends
have in common — source-only, compiled by each consumer, like `@frediverse/ui`.

Each SPA's vite `base` is its full public path, so the Caddyfile does **not** strip the prefix
for them; it does for the API. That asymmetry is explained at the top of the repo-root
`Caddyfile` and is not a style choice.

## What makes z0 different

**Its own session cookie.** `bt_session` (`backend/src/auth/session.ts`), not the `studio.sid`
that l8, the médiathèque and m9 share. The reason is in the domain: a blind-test player is
a **guest with no account**, a kind the studio session does not model. So z0 runs its own
OIDC flow on its own backend, which is why the Caddyfile sets `X-Forwarded-Prefix` for it and
nowhere else — `redirectUriFor` reads that to name `/z0/auth/callback` instead of the
origin root, which belongs to l8.

**Its own state, in Grist and SQLite.** `backend/src/db.ts` and `backend/src/grist/`. Nothing
here is a song folder; do not reach for `@studio/song`.

**…except `editor-v2`, which is not a game surface at all.** It opens a `.z0` project out of a
git repository, so it signs in with the STUDIO session, asks st0 which repositories exist and
reads files through the machine's file service — the same three steps l8 and m9 take, through
the same `@studio/project-shell`. It never talks to z0's backend. That is the one place where
"z0 has its own everything" stops being true, and [docs/editor-v2.md](docs/editor-v2.md) says
why it has to.

**One engine, owned by the BACKEND.** `backend/src/render.ts` is the single exception to the
per-account engine story the rest of the repo tells: z0 renders offline and never plays,
so the engine is configured by environment (`Z0_RENDER_ENGINE`) rather than chosen by a
person. It is also the only consumer of the `x-studio-*` headers outside the shared tier,
which makes it the place where a half-finished rename surfaces last. See
`packages/file-service/docs/render.md`.

**Audio playback goes through `@studio/player-web`**, not through a moteur socket. The
moteur-backed implementation exists behind that package's seam but the game does not use it —
`preloader` and `effects` are what the SPAs import.

## Verify

`npm run dev --workspace z0` runs all seven by turbo. There are ~11 vitest suites under
`backend/src/`, covering the game rules, config and middleware — `npm run test` from a
workspace, and they are the cheapest proof for anything rule-shaped. The frontends have no
component tests; exercise them in the browser.

Long-form rationale goes in `docs/` beside this file.
