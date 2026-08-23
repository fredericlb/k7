# The client side of the seams

`apps/pl8/frontend/src/api.ts` talks to three things, and they are not the same kind of thing at
all: this app's own backend (same origin, under a prefix), the ORIGIN's auth (no prefix), and the
engine MACHINE's file service (cross-origin, and the only side that knows anything about a disk).
This page holds the reasoning; the file itself keeps one line per fact.

## `BASE`, and the one path that must not carry it

The app is mounted under a path (`st0.priv.frediver.se/pl8`), so every backend path in the file
concatenates `BASE` — vite's `base` with its trailing slash trimmed, so the literals keep reading
as paths. It was the EMPTY string for as long as this app served the origin root, which is why
every literal was already written to concatenate and why moving under a prefix cost the file
nothing.

`/auth/*` is spelled BARE on purpose. It is not this backend's at all: the flow belongs to st0,
the service with no prefix, because the IdP has one prefixless `redirect_uri`. This backend only
VERIFIES the cookie. `${BASE}/auth/me` would 404 into what reads like a broken login. See
`packages/web-protocol/services.ts`.

`loginUrl` is a GETTER rather than a constant. Evaluated at import, it captures whatever page
happened to load the module, so every later click returned you there instead of where you were.
`return_to` is the name the OIDC package reads; `redirect` was silently ignored, which only looked
fine while this app owned the origin root — the fallback is st0's home page now, so a missing
`return_to` sends you to the other application entirely.

Signing out ends the session for the WHOLE origin: `studio.sid` is shared, so it signs you out of
st0 and k7 too.

## Who is signed in, and why it is module state

`signedInAs` is set once, by the gate, before anything below it renders — this SPA has exactly one
gate and therefore exactly one user for its whole life. A prop threaded through three components
would say the same thing three times. The file service's gate wants it on every call, beside the
machine's token, which is what `machineHeaders` writes once instead of six times.

## Errors carry the server's sentence

Every write route answers `{ error }` with a sentence saying WHAT was refused — a path outside the
library, a name that is the library's own. `failed()` throws THAT rather than `mkdir 400`, because
throwing the status code is how you end up staring at a number the server already explained. The
status is carried alongside, because one caller has to tell "there is nothing there" from "it went
wrong": a folder with no sidecar yet is a state, a dead backend is not.

## The engine machine's own file service

`engineMachine` is reached cross-origin and directly — the same seam st0 uses, and the only way to
learn a fact about that MACHINE rather than about the library. This app's backend is hosted: it has
no scan cache and never will. The origin has to be trusted on that machine
(`~/.studio/web-origins.json`, offered by the tray); a refusal reads as a network error here, which
is why a caller treats an empty list as "cannot say" rather than as "nothing there".

It is also the only thing that can WRITE into a repository — create or delete a project — because
it alone holds a working copy.

**Analysing a file** (waveform envelope, transient onsets, tempo) is asked of the machine because
THIS service cannot: it has no engine, and the engine is what decodes audio. The machine downloads
the file from here, runs its engine, pushes the `.cache` sidecar back beside the audio, and seeds
`song.yaml` with the tempo it found (`packages/file-service/src/routes/mediatek.ts`). It is the one
route here worth CANCELLING, hence the signal: it answers nothing until the whole decode is done,
so a caller that has moved on would hold a request open for minutes. Cancelling does not stop the
work on the far machine — nothing propagates that — it stops this tab waiting on an answer it will
throw away.

**The audio device takes two calls, and both are needed.** The engine's own `set-audio-device`
switches the running one; `setAudioDevice` here makes it survive a restart. They are separate
because they are separate facts — a live engine and a file on a disk — and the engine holds no
memory of its device by design (`engine/moteur/docs/audioDevice.md`). Sending only the first is how
a machine ends up back on the Windows endpoint after every rebuild, monitoring at four times the
latency, with nothing on screen saying so. `audioDevicePref` reads what is REMEMBERED, with null
for "(system default)" — the state that leaves the engine on that endpoint.

**Cloning is a job, not a request.** A real repository takes tens of seconds, longer than a request
should stay open, so `startClone` returns a handle and `cloneJob` polls it. `null` means the machine
has forgotten the job: nothing can wait on state nobody holds.

**Creating a project sends `shape` as a field of its own.** `name` already carries its suffix
(`hiver.st0`) and the service takes it as the folder name, so the ARCHETYPE — `arrangement`, `mix`
or `video` — cannot travel inside it. A file service older than those three names answers 400 on
its `z.enum`, which is the right failure: "unknown archetype" beats a template guessed wrong. See
`PROJECT_SHAPES` in `@studio/song`.

**Deleting bins rather than erases.** The commit that follows is what removes the project from the
repository.

**The machine's player** is mpv on its own outputs, without the engine, and every path is RELATIVE
to the médiathèque — mpv knows only absolutes, and returning one would expose the machine's tree.
See `packages/file-service/docs/machinePlayer.md`.

## The registry is this service's own

`engines` is `engineAccess` bound to this service's prefix, which `BASE` derives from vite's `base`
rather than spelling. Each hosted service holds its OWN registry
(`packages/engine-registry/docs/shared.md`), so an engine appears here only once it has been pointed
at the médiathèque too. It is typed on `Pl8Prefs` because this service remembers more than an engine
id, and the preference document is the host's rather than the registry's — nothing should call
`savePrefs` directly, since the route replaces wholesale and `prefs.ts` owns the merge. The
`Pl8Prefs` import is type-only so the cycle with `prefs.ts` never reaches the bundle.

## Asking whether a file is there

`library.exists` fetches ONE BYTE (`Range: bytes=0-0`), the same trick `cachedOnMachine` uses on the
engine's side: asking costs a request, and downloading a master to find out it is there costs the
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

`move` is one server-side syscall, so it works on a folder and can never leave a duplicate; it
replaced a read+write+delete dance that could do neither. `removeTree` is its own route so that
removing a folder is never something a caller does by accident while meaning to remove one entry.

## What left this file

- **`/api/projects` and `/api/shares`.** The routes are untouched and still this service's — it owns
  the volume they are stored on and outlives every engine — but the drawing moved to st0's home
  page, which calls them across the origin (`apps/st0/frontend/docs/projects.md`).
- **`baseModules`, `addEngineFaces`, `hints` and `moduleStore`.** All four served the module
  builder, which is st0's now: a module is authored against a project where the plugin it names is
  actually loaded. `hints` in particular had one real field — the library's own modules as refs a
  sibling could extend — and st0 fills the same shape from the open PROJECT.
- **The machine's channel LABELS.** They were read for the one screen that routed a live input, the
  builder's audition. A module is auditioned in st0 now, where the input belongs to the project's
  own track.
- **`plugins`.** The machine's whole plugin scan, fetched so every plugin could be given a module.
  Nothing on this screen asks a machine what it can load any more.
