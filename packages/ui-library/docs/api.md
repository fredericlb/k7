# The client side of the seams

`src/api.ts` is everything the screens ask of the library's backend — st0's backend, whose routes
are `apps/st0/backend/docs/media/`. An engine's machine is never called from here: what the library
needs of one goes through the backend, which reaches it through the engine's tunnel. This page holds
the reasoning; the file itself keeps one line per fact.

## `apiBase()`, read at call time

Every path is `apiBase()` + `/api/…`, and `apiBase()` is what the host set through
`configureLibrary` ([host.md](host.md)). st0 sets its own `BASE`, the routes being on its origin.
Read at call time rather than captured at import, because the host configures the module after its
imports have run, and a captured base is the empty string forever. Every backend path concatenates
it, including the ones that would read fine bare: a path that concatenates nothing is a path that
breaks the day the mount moves.

Sign-in is not here at all. The host's gate owns it, and the library draws only once somebody is
signed in.

## Errors carry the server's sentence

Every write route answers `{ error }` with a sentence saying WHAT was refused — a path outside the
library, a name that is the library's own. `failed()` throws THAT rather than `mkdir 400`, because
throwing the status code is how you end up staring at a number the server already explained. The
status is carried alongside, because one caller has to tell "there is nothing there" from "it went
wrong": a folder with no sidecar yet is a state, a dead backend is not.

## An engine's machine, through the backend

What the library needs of an engine's MACHINE — where a song is on its disk (`/api/engine-local`), a
cut of a song into stems (`/api/stems`) — is asked of the backend, which reaches the machine through
its tunnel (`packages/engine-tunnel/docs/jobs.md`). There is no file service on that machine to
call, and a browser on an HTTPS page could not call one there anyway. The engine itself is the one
thing the library still talks to directly: its socket, for transport and meters
(`@studio/engine-browser`).

## The registry is THE registry

`engines()` is `engineAccess` bound to the current `apiBase()`, rebuilt only when the host moves
it. This registry is the only one (`packages/engine-registry/docs/shared.md`): the editor and z0
list their engines from it too, so an engine connected to a studio in the tray appears here and
there alike. It is typed on `Pl8Prefs` because the library remembers more than an engine id — where
playback happens — and the preference document is the host's rather than the registry's: nothing
should call `savePrefs` directly, since the route replaces wholesale and `prefs.ts` owns the merge
([playbackTarget.md](playbackTarget.md)). The `Pl8Prefs` import is type-only so the cycle with
`prefs.ts` never reaches the bundle.

## The host's player

`player` drives mpv on the machine that serves the files (`packages/mpv-player/docs/mpvPlayer.md`).
Its state carries the path it was ASKED FOR, so the transport can tell its own track from another
listener's on the same host.

## Asking whether a file is there

`library.exists` fetches ONE BYTE (`Range: bytes=0-0`): asking costs a request, and downloading a
master to find out it is there costs the master. It exists for what the catalogue cannot answer — a
song's listing carries no file list, since a song is a folder the scan stops at, so a render written
beside the master is invisible to it. Any refusal reads as absent; the caller's next move is the
same either way.

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

- **`/api/shares`.** The routes are the library's — the shares' bytes and comments are on its
  volume — but nothing here calls them: the screen that draws them is st0's home page
  (`apps/st0/frontend/docs/projects.md`).
- **A module's vocabulary and a plugin scan.** Both belong to whoever authors a module, and that
  is the editor: a module is written against a project where the plugin it names is actually
  LOADED, and only a loaded plugin can say what its parameters are called. Nothing on these screens
  asks a machine what it can load.
- **The machine's channel LABELS.** Routing a live input belongs to the project's own track, in
  the editor, not to a hosted catalogue.
