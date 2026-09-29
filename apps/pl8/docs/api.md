# The client side of the seams

`apps/pl8/frontend/src/api.ts` talks to two things, and they are not the same kind of thing at all:
this app's own backend (same origin) and the studio's auth, which lives on st0's origin. An engine's
machine is never called from here: what this app needs of one goes through its backend, which
reaches it through the engine's tunnel. This page holds the reasoning; the file itself keeps one
line per fact.

## `BASE`, and the one path that is not this origin's

The app answers at the root of its own subdomain (`play.priv.st0.app`), so `BASE` — vite's `base`
with its trailing slash trimmed — is empty. Every backend path still concatenates it, including the
ones that would read fine bare: a path that concatenates nothing is a path that breaks the day the
mount moves.

`/auth/*` is not this backend's at all: the flow belongs to st0, because the IdP has one
`redirect_uri`, at the root of st0's origin. So auth calls go to `authOrigin(origin)` — st0's
origin, from `packages/web-protocol/services.ts` — with `credentials: "include"`, since a
cross-origin fetch sends no cookie without it. This backend only VERIFIES the cookie, which the
shared `COOKIE_DOMAIN` makes good on every studio subdomain.

`loginUrl` is a GETTER rather than a constant. Evaluated at import it would capture whatever page
happened to load the module, so every later click would return you there instead of where you
were. `return_to` is the name the OIDC package reads, and `redirect` is silently ignored: a
missing `return_to` falls back to st0's home page, which is a different application entirely.

Signing out ends the session for the WHOLE origin: `studio.sid` is shared, so it signs you out of
st0 and k7 too.

## Who is signed in, and why it is module state

`signedInAs` is set once, by the gate, before anything below it renders — this SPA has exactly one
gate and therefore exactly one user for its whole life. A prop threaded through three components
would say the same thing three times.

## Errors carry the server's sentence

Every write route answers `{ error }` with a sentence saying WHAT was refused — a path outside the
library, a name that is the library's own. `failed()` throws THAT rather than `mkdir 400`, because
throwing the status code is how you end up staring at a number the server already explained. The
status is carried alongside, because one caller has to tell "there is nothing there" from "it went
wrong": a folder with no sidecar yet is a state, a dead backend is not.

## An engine's machine, through this backend

What this app needs of an engine's MACHINE — where a song is on its disk (`/api/engine-local`), a
cut of a song into stems (`/api/stems`) — is asked
of this backend, which reaches the machine through its tunnel
(`packages/engine-tunnel/docs/jobs.md`). There is no file service on that machine to call, and a
browser on an HTTPS page could not call one there anyway. The engine itself is the one thing this
app still talks to directly: its socket, for transport and meters (`@studio/engine-browser`).

## The registry is THE registry

`engines` is `engineAccess` bound to this service's prefix, which `BASE` derives from vite's `base`
rather than spelling. This registry is the only one (`packages/engine-registry/docs/shared.md`):
st0 and z0 list their engines from it too, so an engine connected to a studio in the tray appears
here and there alike. It is typed on `Pl8Prefs` because this service remembers more than an engine
id, and the preference document is the host's rather than the registry's — nothing should call
`savePrefs` directly, since the route replaces wholesale and `prefs.ts` owns the merge. The
`Pl8Prefs` import is type-only so the cycle with `prefs.ts` never reaches the bundle.

## Asking whether a file is there

`library.exists` fetches ONE BYTE (`Range: bytes=0-0`): asking costs a request, and downloading a master to find out it is there costs the
master. It exists for what the catalogue cannot answer — a song's listing carries no file list,
since a song is a folder the scan stops at, so a render written beside the master is invisible to
it. Any refusal reads as absent; the caller's next move is the same either way.

## Uploads, captures, songs and variants

`uploadTree` carries each file's own path, folders included: a flat list could not express a folder
drop. The server creates the intermediate directories (`putFile` in `@studio/mediatek/write`), so
one PUT per file is all the client does, and a path with a `..` in it is refused there rather than
here.

`addRecordings` sends one request per file so each carries its OWN moment — its mtime, which for a
capture is when it was recorded. A session dragged in the morning after would otherwise land under
today, whole, which is the one day it certainly does not belong to.

`addSong` sends the THREE TAGS and never a path: the library derives
`songs/<artiste>/<album>/<titre>/original.<ext>` itself (`packages/mediatek/docs/songs.md`). A 409
is told apart from every other refusal because it is the one the UI can offer to resolve — hence
`SongExists` as its own type, so the dialogue can offer to replace instead of showing a status code.

`addVariant` has its own route rather than being an `upload` into the folder. The chain renderer
does the latter, and the difference matters: that one writes bytes the sidecar ALREADY names, and
this one is what puts the name there. Dropping a file in without it declares nothing, because the
scan reads a song's versions from the sidecar and from nowhere else.

`removeVariant` un-declares before it deletes: the sidecar line goes first, then the file — the
same order `addVariant` uses in reverse, so a crash mid-way leaves an orphan FILE the scan simply
does not read as a variant, never a line still pointing at bytes that are gone. It is a button on
the song editor's own variant list, not the tree — `packages/mediatek/docs/variants.md` is where
that choice is explained.

`move` is one server-side syscall, so it works on a folder and can never leave a duplicate — a
read+write+delete dance could do neither. `removeTree` is its own route so that
removing a folder is never something a caller does by accident while meaning to remove one entry.

## What this file does NOT ask for

- **`/api/shares`.** The routes are this service's — the shares' bytes and comments are on its
  volume — but nothing here calls them: the screen that draws them is st0's home page, across
  origins (`apps/st0/frontend/docs/projects.md`).
- **A module's vocabulary and a plugin scan.** Both belong to whoever authors a module, and that
  is st0: a module is written against a project where the plugin it names is actually LOADED, and
  only a loaded plugin can say what its parameters are called. Nothing on this screen asks a
  machine what it can load.
- **The machine's channel LABELS.** Routing a live input belongs to the project's own track, in
  st0, not to a hosted catalogue.
