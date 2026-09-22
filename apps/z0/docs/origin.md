# One origin, seven services, two session cookies — one of them borrowed

z0 lives under `/z0` on the same host as every other studio service, and that
single fact drives most of its wiring. This page collects the consequences, because each one
on its own reads like an arbitrary choice.

## Why the prefix is stripped for the API and not for the SPAs

The proxy handles z0 in three blocks, and the order matters because the more specific rule
has to win over the `/z0` catch-all. It is traefik on the LAN server — see the root
[docs/dev.md](../../../docs/dev.md) for the table it must hold, and
`apps/z0/docker/nginx.conf` for the production twin, where nginx's longest-prefix rule
does the ordering instead.

- `/z0/api/*` — prefix **stripped**. The backend keeps seeing `/api/...` exactly as it
  would at a root, which is what the production edge does too.
- `/z0/auth/*`, `/z0/audio/*`, `/z0/ws*` — stripped, and nothing more: no
  `X-Forwarded-Prefix` header. See below.
- the six SPAs — **not** stripped. Each vite `base` is the full public path, so the dev
  server must see the prefix; strip it and every asset request 404s against a server that is
  only listening under `/z0/<app>/`.

## Why z0 sets no `X-Forwarded-Prefix`

`redirectUriFor` builds `<origin><X-Forwarded-Prefix>/auth/callback`. Setting the header
here would name `/z0/auth/callback` rather than the origin root's, which belongs to st0 —
the service with no prefix, the one that mints `studio.sid`.

That cannot work, and the reason is not z0's: **the IdP has only the prefixless callback
registered on this client.** Asking for the prefixed one is refused at the authorization
endpoint, before any password is typed, so no account could sign into z0 at all. A service
mounted under a path cannot own an OIDC flow here, so the account login is st0's. Full
account in [auth.md](auth.md).

## Why a second cookie exists

`bt_session` **beside** `studio.sid` — one written here, one only read here.

The studio session models **an account**: an OIDC identity, resolved to a folder slug, that
owns workspaces and preferences. A blind-test player is a **guest** — they have a name they
typed, a seat in a session, and no account anywhere. Modelling that as a studio session would
mean either inventing accounts for strangers or teaching the shared session a guest kind that
only one app would use. So the guest cookie stays, and stays z0's.

The other half is not z0's. An operator who is a studio user holds one session, the same one
st0 and the médiathèque see, and signing out of z0 signs them out of those too. Both cookies
use **one** key, `common`'s — z0 declares no `SESSION_SECRET` of its own. What keeps a guest
cookie from being renamed into an account is not a second key but the signature itself, which
covers the cookie's name; [auth.md](auth.md) shows it.

## Nothing durable on disk

`backend/src/state.ts` names a **fresh temp directory per launch**, and that is the whole
storage story: the only thing written under it is the Grist attachment cache
(`backend/src/grist/load.ts`) — downloaded attachments and their ffmpeg-transcoded copies, every
one of which can be fetched again. Game state never touches the disk; `backend/src/state/persist.ts`
write-behinds it to Grist's `Games` / `GamePlayers` tables and a fresh boot rehydrates from there.

The trade is deliberate: each boot starts cold and re-downloads everything the session needs, in
exchange for no stale cache, no volume to manage, and no invalidation to get wrong. The cost is
startup work proportional to the session's audio.

Two details that look like oversights and are not:

- **It only NAMES the directory, never creating it.** Every writer already does
  `mkdir(..., { recursive: true })`, and `routes.ts` asks for the path merely to mount
  `express.static`, which tolerates a missing root and 404s until something fills it. Creating on
  read would leave an empty directory behind for every process that so much as imports
  `routes.ts` — which is every test run.
- **Cleanup is best-effort.** The OS reaps its own temp directory (and a container takes the
  whole layer), so one leaked directory after a hard kill is acceptable.

## The one engine nobody chooses

`backend/src/render.ts` is the exception to the per-account engine story the rest of the repo
tells, and three details follow from the same fact — **nobody here is sitting at an interface**.

- **`Z0_RENDER_ENGINE` is configuration, not a choice.** A render has no audience, so "which of
  my machines" is a deployment fact; asking a player would be asking them about somebody else's
  hardware.
- **It names the file service's base URL** on that machine (`http://192.168.1.20:8770`), not the
  engine's own WebSocket. The socket has no render verb and never will: an offline bounce is a
  one-shot `st0-engine --render`, and letting the live server spawn one would put a second
  engine inside the process that holds the audio device.
- **The wav comes back whole, in memory.** z0's clips are seconds long, and a temp file this
  container then has to clean up on every failure path is more machinery than the bytes are
  worth. A full-length master would need a stream; this is the line to revisit if one appears.

## The seam that surfaces a rename last

`backend/src/render.ts` sends `x-studio-engine-token` and friends to a file service. It is the
only consumer of those headers outside `packages/`, so a header rename that is otherwise
complete will still break here — and only when somebody renders, which is rare enough that
the failure arrives long after the change. Check it explicitly when touching the header names.

Server-to-server there is no `Origin` header, so CORS lets the call through outright: that
token is the only thing making it deliberate.
