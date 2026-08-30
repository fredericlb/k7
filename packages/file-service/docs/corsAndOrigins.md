# CORS and pending origins — the load-bearing control

`cors.ts` and `pendingOrigins.ts` together decide which browser origins may drive this
service. They are security-adjacent surfaces reached by anyone who can send a request,
so the reasoning is spelled out here rather than trusted to memory.

## Why CORS is the control, not a formality

The file service is reached DIRECTLY by the browser, cross-origin, and its identity is a
set of headers the caller writes (Phase-2 local trust — see `context.ts`).

Every gated route requires the custom `x-studio-*` headers, which are NOT CORS-simple,
so a cross-origin call MUST preflight. A preflight we refuse means the browser never
issues the real request — so a strict allowlist blocks cross-origin WRITES as well as
reads. That is what stops a page you happen to visit from driving this service, even
though the engine still hands its token to anyone who asks it `whoami`.

Hence the one rule `cors.ts` exists to enforce: **NEVER reflect an arbitrary origin.**
A `cors({ origin: allowlist ?? true })` makes reflect-everything the DEFAULT and the allowlist
opt-in, so a launch that configures nothing is wide open. Deny-by-default is the whole point;
keep it that way.

The callback form in `server.ts` is deliberate: `origin: true` would reflect ANY origin. And an
`OPTIONS` that reaches past the middleware has been refused there, so it is answered with a 403
naming the origin and where to allow it — running on would return a 401 that lies, since a
preflight carries no header to be missing.

## Two routes outside the header gates

Every gated route requires the custom `x-studio-*` headers, and two routes cannot send any.

**`/media`**, for a `<video>` element: an element GET can't set headers, so user, workspace and token
ride in the QUERY. It is read-only, with the traversal guard still applied, and the token is compared
in constant time by the same three-state rule `requireEngineToken` uses — an absent identity allows,
an unreadable one refuses. The residual risk is deliberate and worth writing down: a token holder can
read any user's media here.

**`/health`** is ungated and deliberately EMPTY. Its one caller is a browser telling "my origin is
refused" apart from "nothing is listening", which `fetch()` reports identically. It must reveal
nothing — the answer IS the payload — and it sits after the cors middleware so a refused probe is
still recorded for the tray.

The effective policy is logged at boot, because a bad allowlist otherwise surfaces only as an
unexplained browser failure; and so is an absent engine identity, because this binds `0.0.0.0` and an
open run is an open run on the whole LAN — worth a line rather than a state you have to infer.

## The user's own web UIs

`<state>/web-origins.json` — `{"origins": ["https://daw.test"]}` — is part of the
shared `<state>` contract (the supervisor's `paths.ts` / `webOrigins.ts` write it). It exists
because the built-in rules cannot cover a web UI on a real hostname: a reverse proxy in
front of the SPA is neither loopback nor private, so without this the editor loads and
then fails every preflight.

Read on EVERY call rather than captured at boot: the whole point is that adding a web UI
from the tray takes effect on the next request, with no file-service restart. A
`statSync` per request is sub-millisecond on a local file, and the parse is memoised
until the file's mtime/size actually moves.

This is still an allowlist of exact origins the user typed into their own menu bar — NOT
a relaxation of deny-by-default. Nothing here reflects an origin.

## Recording refusals (`pendingOrigins.ts`)

Recording a refusal turns fixing a blocked hostname around: the blocked browser names
itself, and the user approves a concrete origin from the tray instead of transcribing a
URL into a menu-bar prompt or hand-editing `web-origins.json`.

`<state>/pending-origins.json` joins the shared contract:

```json
{"pending": [{"origin": "https://daw.test", "lastSeen": 1721430000000, "count": 3}]}
```

The supervisor reads it (`webOrigins.ts`) and clears an entry when it is allowed or dismissed.

### Three rules

1. **Nothing here grants anything.** It records a *request to be asked* — the only way an
   origin becomes allowed is a human clicking it in the tray.
2. **When `STUDIO_WEB_ORIGIN` is set, record NOTHING.** An operator who pinned the
   origin list meant it; offering a one-click way around that in the menu bar would
   quietly undo the lockdown.
3. **Bounded and self-expiring.** A hostile page can hammer this endpoint from a thousand
   origins; the cap and the TTL mean the worst case is a short list of recent junk, not
   an unbounded file or a menu with a thousand rows.

The filter on what can be recorded and the one guarding the allowlist must be the same
function — and are: `@studio/engine-host/webOrigins`, where the writer defines it. A
row in the menu is one click from being allowed, so junk must never reach it.
