# AGENTS.md — m9

**The decks.** Pick a morceau from the médiathèque's cache on the machine you chose, and let
that machine's `engine/moteur` play it. Named m9; it was `platines` until the rename.

Dev ports: **frontend 5225, backend 8796**, served at `https://studio.test/m9`.

| workspace | role |
|---|---|
| `frontend` (`m9-frontend`) | React + Vite. The deck, the médiathèque list, the chains view. |
| `backend` (`m9-backend`) | Express — OIDC auth, **this service's** engine registry, and which machine the account DJs from. No file routes, no media. |

## The one thing to understand first

**The moteur opens file paths. It cannot fetch a URL.** Everything about this app's shape
follows from that: the thing m9 plays from is the médiathèque's **cache on the engine's own
disk**, reached through that machine's file service — not the hosted library the médiathèque
serves. Three servers, and only one of them is same-origin:

| | m9's backend | the machine's file service | the machine's moteur |
|---|---|---|---|
| holds | who you are, which engines exist, which one you DJ from | the cached catalogue on that disk | playback |
| reached | same-origin `/api` | cross-origin, absolute URL | WebSocket, direct |

See `docs/plumbing.md` for the whole path, and `docs/chains.md` for what hosting the shared
chains view proved about its seams.

## Conventions worth knowing

- **The session is `SESSIONS.m9`, per service AND per person** (`useEngine.ts`). A deck runs
  safely beside l8 on one engine, and two DJs on one machine hold two decks.
- **The engine lease must be HELD, not taken** — `holdEngine` from
  `@studio/engine-browser/lease`. A single `select` lapses after the TTL and the machine reads
  free in everyone's picker mid-set. m9 shipped that bug once; see that package's
  `docs/lease.md`.
- **`platine` the French noun still appears** and is not a leftover: the deck slot's label and
  the turntable glyph mean a turntable, not this app.
- **No command bar.** The chains view's `command` prop is required, so `chains.tsx` passes a
  warning stub. That is deliberate — see `docs/chains.md`.

## Verify

`npm run dev --workspace m9` runs both halves. `npm run test --workspace m9-frontend` covers
the deck document and the graph builder — pure logic, nothing mounted. For the lease and the
engine picking, run it and watch the médiathèque's picker: this app's failures are mostly
"something reads as available when it is not", which no unit test here would catch.
