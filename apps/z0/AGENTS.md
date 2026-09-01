# AGENTS.md — z0

The **blind-test game**: a presenter runs a session on a screen, players buzz in from their
phones, and an editor builds the rounds. Six single-page apps and one backend, all behind one
origin.

It is the odd one out in this repo, and knowing why saves you looking for things that are not
here. z0 is a **game**, not a studio tool: it has its own login, its own session cookie,
its own database, and it touches `engine/st0-engine` at exactly one point — an offline render.

## The six SPAs and the backend

| workspace | port | served at | what it is |
|---|---|---|---|
| `online` | 3003 | `/z0` | the apex app — solo play and playlists |
| `presenter` | 3001 | `/z0/presenter` | the screen everybody looks at |
| `monitor-web` | 3002 | `/z0/monitor` | the operator's view of a running session |
| `buzzer` | 3004 | `/z0/buzzer` | the player's phone |
| `remote` | 3005 | `/z0/remote` | the presenter's own remote |
| `editor` | 3006 | `/z0/editor` | building rounds over a `.z0` project — [docs/editor.md](docs/editor.md), and [docs/editing.md](docs/editing.md) for what it writes |
| `backend` | 8080 | `/z0/api`, `/z0/auth`, `/z0/ws` | Express + WebSocket |

> Two backend folders that are easy to confuse: `backend/src/editor/` mounts Grist routes
> **no client calls** and is up for deletion, while `backend/src/grist/` is the game's round
> loader and stays.

`shared/` (`z0-shared`) holds what the five game frontends have in common — the
presentational components and types, plus `account.ts`, which is where signing in and out
lives, the rule having two halves (see below). The editor is not one of them: it is not a
game surface at all. Source-only, compiled by each consumer, like `@frediverse/ui`.

Each SPA's vite `base` is its full public path, so the LAN proxy does **not** strip the prefix
for them; it does for the API. That asymmetry is explained in [docs/origin.md](docs/origin.md)
and is not a style choice.

**The dev proxy's path table is not in this repo** — it is traefik on the LAN server. What
stands here instead is the table in the root [docs/dev.md](../../docs/dev.md), which the other
machine must mirror, and `docker/nginx.conf`, which is the same routing for
production. Every SPA here needs its own rule, ordered so the `/z0` catch-all comes last, or an
address lands on the game.

## What makes z0 different

**Its own session cookie — for guests, and only guests.** `bt_session`
(`backend/src/auth/session.ts`) carries the kinds the studio session cannot model: a
blind-test player is a **guest with no account**. z0 runs no OIDC flow of its own: the IdP has
only the **prefixless** callback registered on this client, so a service under a path cannot
own the flow here — st0 does, having no prefix. `studio.sid` is therefore read (never written)
beside `bt_session`. Both use ONE key, `common`'s `SESSION_SECRET` — the same constraint pl8
and k7 are under, and z0 declares no override. A second key would buy nothing:
cookie-session signs `<name>=<value>`, so a renamed cookie fails to verify anyway.
[docs/auth.md](docs/auth.md).

**Its own state, in Grist and SQLite.** `backend/src/db.ts` and `backend/src/grist/`. Nothing
here is a song folder; do not reach for `@studio/song`.

**…except `editor`, which is not a game surface at all.** It opens a `.z0` project out of a
git repository, so it asks pl8 which repositories exist and reads files through the machine's
file service — the same three steps st0 takes, through the same `@studio/project-shell`.
It never talks to z0's backend at all, which is what sets it apart: the five others do, even
though all six take their account login from the origin root. [docs/editor.md](docs/editor.md).

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

`npm run dev --workspace z0` runs all six by turbo. There are ~11 vitest suites under
`backend/src/`, covering the game rules, config and middleware — `npm run test` from a
workspace, and they are the cheapest proof for anything rule-shaped. The frontends have no
component tests; exercise them in the browser.

Long-form rationale goes in `docs/` beside this file.
