# routes/files.ts — the project file API, and why each route is shaped that way

The project file API, rooted per workspace: mounted after `resolveWorkspace`, so `req.ws` is
always a `Workspace`, every file call is a method on that workspace, and the command layer
takes it explicitly.

This page holds the reasoning. The code keeps one line per route and points here.

## `/media` is not on this router

It lives in `packages/file-service/src/server.ts`, outside the header gates: a `<video>` GET
cannot set custom headers, so it authenticates via the query string instead. There is no
single-tab lease anywhere on this service — last write wins, and each tab's next poll
reconciles.

## `GET /workspace` also carries the last take

The take rides the two-second poll rather than getting a route of its own. The browser cannot
work the clip's id out for itself — the engine sends a file path and this service chooses the
name — and the poll is happening anyway. See `takeJustRecorded` in
`packages/file-service/src/engineLink.ts`.

So does `engineSync`, the copy of the project's files to the engine's machine that holds its
document back, for the same reason — the bar it draws needs no route either (`engineSync.md`).

`prewarmEngineForActive` is called on the same poll: idempotent while the engine is idle, so
plugin instantiation overlaps the browser's remaining startup.

## The audio device preference

`PUT /preferences/audio-device` is written here and not by the engine, which keeps no such
memory of its own on purpose: a picker tells the engine to switch NOW, and this service is
what has it still be on that interface after the next restart. `type` matters — ASIO and the
Windows endpoint of one interface share a name and not a latency.

How that interface's inputs are GROUPED is the other half of the same rig, remembered for the
same reason and replayed on the same connect. It is the `system channel type` verb rather than
a route beside this one: a route that remembers the pairing while the browser tells the engine
on its own socket makes one act two doors, and the verb does both, in the order that survives a
slow rig.

## `/project-plugins` answers about a project that is NOT open

`GET /project-plugins?project=<rel>` lists the plugins one project of the workspace needs its
engine to host — internal ones and externals (VST and kin), each once — as `{ format, name }`
(`pluginNeeds.ts`). jsdsp, Faust and offline modules are left out: they are built from the
project's own source on whichever engine plays it.

It takes the project in the query rather than reading the active one because st0's `EngineGate`
asks it BEFORE any engine is chosen, to score each candidate's catalogue against it
(`packages/engine-browser/src/compat.ts`); opening the project would already need the engine.
The header asks it again of the open project on each revision, since adding a module can add a
plugin.

`GET /project-compat?project=<rel>` is the same list SCORED here, against this machine's engine
scan (`scannedPlugins()`), as `{ compat: { score, missing } | null }` — the formula is
`@studio/web-protocol/compat`, the browser's own. It is for a project that lives BESIDE its engine:
each candidate engine's machine answers for itself, so the browser never needs the catalogue. On
the server (hosted files) it means nothing — that scan is whichever engine the hub bound last —
and the browser scores `/project-plugins` against the engine's own `list-plugins` instead.
`null` is an empty scan, which cannot say; it is not "compatible with nothing".

Both COUNT a plugin baked into a render in force — a manual freeze or an automatic VST one: the
render lets an engine without it play the track but not edit it, so that engine keeps its loss
(`packages/song/docs/autoFreeze.md`).

## `/auto-freeze/thaw` leaves a VST live while it is edited

`POST /auto-freeze/thaw { module, on }`: the graph sends it when a control on an automatically
frozen node is touched, since the baked VST has no plugin a knob could reach. It leaves the module
live for the session — in memory, never in the song — and reloads the engine. The scheduler
(`autoFreezeJobs.ts`) ends the thaw itself once the engine has been stopped for a while with no
edit; `on: false` ends it at once.

## The three routes that answer about things OUTSIDE the open song

`/module-libraries`, `/library-chains` and `/playlists` sit beside `/tree` rather than inside
it. `/tree` is deliberately the SONG; these three are the module libraries in precedence
order, the chains the library repository holds, and the workspace's `_playlists/` folder —
none of which `/tree` can reach. A chain's `path` comes from the route rather than being
built by the caller, so opening one is addressed the way a module library is.

Only the LISTING of playlists is a route. Reading one and writing one are `/file` and
`/write`, which already serve any workspace path — a second pair spelling `_playlists` into
their URLs would be two ways to write one file, and the autosave the screen runs on is built
on those two. Making one is `playlist new`, a command like every other act on that screen, for
the same reason.

## `POST /module` writes the file that makes a folder a module

A module is a FOLDER holding a definition, so there is nothing useful "New folder…" could do
here — it would make a folder the loader does not recognise and a row that opens no builder.
This writes `<root>/<type>/<name>/module.yaml`, and the builder takes it from there.

`root` is a library path the caller was GIVEN (`/module-libraries` answered it), never one it
built: the same rule the module builder's store follows, and what keeps a library's
`_libraries/<name>/modules` and a project's own `modules/` from being told apart by string surgery
here.

## `POST /open` asks for the libraries first

The libraries are the file hub's, so the open asks the hub to bring them to their latest
(`docs/libraries.md`) and waits only when one is not cloned yet. Nothing about them rides on the
request: the hub holds the list.

A sync that fails is not a project that refuses: the song opens, and every `@st0/…` ref in it that
does not resolve reports itself missing, which is what the graph already draws a `?` for. The
failure is logged and swallowed, and the Libraries page shows it on the library's row.

## `POST /project/create` takes an ARCHETYPE, not a mode

`arrangement`, `mix` or `video` — each named after the surface it opens on. One field, because
there is one question: every project is an `.st0` folder, so "which app opens this" has no
answers to arbitrate, and what is left is which scaffold runs. See
`packages/file-service/src/projectLifecycle.ts`, and `PROJECT_SHAPES`.

A caller newer than this service gets a 400 naming the enum, which is the right failure: a
shape guessed at would land a folder whose contents nobody asked for.

## `POST /engine/project` — playing a document the BROWSER built

The turntables surface fills the decks' clips into this project's compile. It goes through
this route rather than out of the browser's own socket so that ONE thing writes to the engine.
Two writers is what the route exists to end: the service pushing the compile from disk and a
surface pushing the compile-with-decks, with whichever wrote last winning. See
`packages/song/docs/surfaces.md`.

Deliberately NOT validated field by field. It is a `ProjectDoc`, the same shape `/engine-doc`
just handed out, and the engine decodes by key with defaults and ignores what it does not know
— so a zod mirror here would be a second copy of the wire to keep in step, and its only power
would be to refuse documents the engine would have played. The route is behind the same gate
as every other one on this service.

## `POST /command` — the verb, and the views the caller will draw

A command that writes would otherwise cost three sequential round trips: this one, then
`/graph`, then `/project-doc` — and the last two each rebuild from disk, `buildGraphDoc`
through `loadGraph` and `cachedProjectDoc` through `loadProject`. On a real song (14 tracks, 58
clips, 30 plugins) that is 401 ms and 367 ms, and this service is one process, so they queue
rather than overlap: inserting a module in the chains graph leaves the canvas showing the old
picture for all of it.

Building the graph HERE costs the same 401 ms but spends it inside a request the client is
already waiting on, so the canvas can redraw the moment this returns instead of a fetch and a
parse later. Keying it on the revision keeps `transport play` as cheap as it is without one.

`want` is the other half, and it took a measurement to find: st0 runs a whole class of gestures
— mute, solo, a fader, a knob — through a caller that deliberately does NOT reload the shell,
so nothing fetches `/graph` afterwards and a picture built here is thrown away whole.
62 ms on the reference song, per knob turn, on the one thread everything else queues behind. So
the caller says which views it will draw, and this builds only those. The graph is the
DEFAULT rather than the exception: a body without the field still gets it, and an empty
list is a caller saying, out loud, that it wants none.

`at` is a workspace-relative folder the verbs should act on INSTEAD of the open project — the
chains builder's template. Through `safePath` like every other path a browser sends, so it
cannot address its way out of the workspace, and absent for every ordinary command.

`rev` rides beside the graph and does not depend on it — it is the token AFTER the command,
which a client uses to stop re-asking the questions this reply has already answered (st0's
`noteRevision`). Pairing it with the graph would leave a caller that wanted no picture with no
token either, which is the one thing every writing caller can use.

`revBefore` comes with it: the token the command STARTED from. A client that adopts `rev` without
telling anyone needs it, because `rev` also covers whatever another tab, the CLI or another replica wrote just
before — and adopting that silently would hide it. Only when `revBefore` is the token the client
already held is `rev` this command's change alone.

`changed` is the third of that family and the finest-grained: WHICH files the command wrote.
The token says something moved, this says what — so a client can re-ask the questions that
depend on it and skip the ones that cannot. It comes out of the journal's own diff and costs
nothing here. Absent when the diff could not be taken, which a client must read as "I don't
know" and not as "nothing". See `ChangedFile` and st0's `reloadScope.ts`.

`refused` rides beside the output lines: the command was understood and declined, which is a
different fact from "it ran" and from "it threw". Sent only when true, so a surface reading the
old shape sees exactly what it saw before.

### The route takes no walk of its own

The two tokens come OUT of the run. Taken by the route instead — one before the command and one
after — they would be two more walks of the tree the run already crosses four times inside
`recordChange`, all microseconds apart. `recordChange` has to cross it twice whatever happens,
to diff what the mutation did, so it names both instants off walks it was doing anyway. `Workspace.Recorded` is the shape, and
`withRevision` seeds the graph build with that same token rather than a fresh walk: `graphDoc`
asks for the revision several times over (its own memo, then `clipExtents` through the compiled
doc).

The graph is built INSIDE the run (`runWebCommand(…, { graph })`), not by the route after it: the
verb's held reload compiles in the same module-stamp scope, so a writing command rebuilds the
module vocabulary once rather than twice (`docs/activeProject.md`, "A reload is held to the end of
the run").

One line is logged per WRITING command, in the shape the engine's `[applyFull]` uses: the two
halves of the wait, so "the insert is slow" can be answered without a profiler. `ran=` is the
verb, journal included; `graph=` is what follows it — the held reload's compile and the graph,
which share their cost. `graph=skipped` is the third state and the one worth seeing — a gesture
that costs nothing here; its reload, if it had one, is then counted in `ran=`.

## `/engine-doc` vs `/project-doc` vs `/video-doc`

`/project-doc` returns the web view: tracks and clips arranged for a screen. `/engine-doc` is
the compiled `ProjectDoc` itself, plugins and baked DSP graphs included, and it exists because
the desk plays a project it did not compile. Its decks' songs are a live choice rather than an
arrangement, so it fills the clips in and sends the result to the engine over its own socket —
which needs the real document, not a picture of one. Read-only, and no transport of its own:
WHO plays and WHEN stays with the app holding the engine session.

`/video-doc` is the same folder read as PICTURE — the `WebVideoProject` the viewport surface
draws. A route of its own rather than a shape `/project-doc` might also return: the two are
different documents from different compilers (a song has a tempo, its picture has a viewport),
and one route answering either would make "which did I get" a runtime question at every call
site. BOTH answer for the same folder — a song carries its own picture — and a project with
no `video_tracks/` gets an empty document rather than an error, so "no picture" and "broken
picture" stay two different answers.

## `/surfaces` is derived here, not walked in the browser

The project's `surfaces/` folder, parsed — a DERIVED view like `/graph` beside it, rather than
the editor walking the tree and reading each file itself: the parse and its diagnostics are
`@studio/song`'s, and a second reader in the browser would be a second answer to "is this
surface valid". Always 200 — a project with no surfaces has none, which is not an error.

`/workspace-tree` is separate from `/tree` for the reason `Workspace.workspaceTree` is its own
method: two questions, and only one of them is the editor's.

## `POST /module-base/snapshot` — keeping a plugin's opaque state

The counterpart to `node preset save`, for the plugins that one cannot serve. A preset is a list
of named numbers, which is everything a module's `params:` can hold — and for
a big commercial instrument it is not the sound. An Arturia patch lives in opaque chunk state:
loaded from a `.vstpreset`, Wurli V2 reports the same 50 parameter values as an untouched one,
Mini V3 the same 77. Written as numbers, that patch is the factory default with a name on it. A
base is the blob, so the sound actually travels with the module.

It reads the ORPHAN instance — the one the module builder's "Native UI" button opens, which
belongs to no project. That is what makes this usable at all: a module is authored against a
plugin the open project need not load, and often there is no project. It also means the state
being kept is exactly what somebody dialled in by hand in the plugin's own window, and nothing
else.

Three answers, because three things can go wrong and only one of them is the user's to fix:
404 the ref names no scanned plugin, 503 no engine answered, 409 the engine answered that there
was nothing to keep — no window was ever opened for this plugin, so a snapshot would be the
factory defaults wearing a name somebody chose for a sound they thought they had made.

`/module-base` is the same folder read the other way: the named bases a module may be set to,
its own `base/` and every ancestor's, nearest first. Answered from the LOADED module rather
than by listing a directory here — the ancestry is what makes the list useful (the bases live
on the shared module, the song points at it through a thin local one), and the loader is the
only thing that knows where each ancestor's folder is.

## `POST /preview` hands back the window it sent

The browser draws an audition playhead over it, and a second resolution of `from`/`to` there —
timecode spelling, house rules for an absent edge and all — is exactly how a mark comes to sit
somewhere the sound is not. `length: 0` is "to the end of the file", the one number this side
genuinely does not know.

## `PUT /file` pushes to the engine when the write touched the open song

A hand-edited source is a project change, and the ENGINE only ever hears about one when
something pushes: a command through the host's `applyProject`, `/open` and a reconnect through
`sendActiveProject`. A write does none of those by itself, so without this push editing a
clip's `from`/`to` in the editor moves the file, moves the revision and redraws every surface
while the engine goes on playing the window it already has — until something restarts the link
and its `open` re-sends the document. That is the whole of "I have to restart it for the change
to land".

TWO gates, because either alone is wrong. The token — `recordChange` brackets the mutation with
the revision either side — says the tree moved, but it moves for a playlist and a library
module too, which are not this song. And the path alone would push for a `.wav` dropped beside
the clips. Measured, not assumed: a write to `_playlists/` does move that token
(`packages/file-service/src/writePushes.test.ts`).

`startEngineForActive` rather than `reloadActiveProject`: the latter drops the browser's
document, which on a turntables surface is the live desk — a save during a set must not empty
the decks (`useTurntableDeck.ts`). This one only flushes when the project CHANGES, which a save
never does.

`forked` is set when the target was an `@engine` ref materialising into its first folder: the
save landed on a freshly made module, and the editor has to follow it — there was no file open
before, only a synthesised ref. An ordinary `@workspace` or `@st0` save writes the file it had
open and answers with no `forked` at all. The reply is `r.value` because a journalled mutation
answers with the tokens either side of it too, and the editor asks `/revision` like everything
else.

## The waveform routes

`/waveforms/prewarm` is fire-and-forget, so `wrap` cannot see it: `wrap` only catches what the
handler RETURNS, which is why the promise goes through `guard`.

`/waveforms/cancel` gives the machine back. The batch runs a SECOND engine process to decode
audio, and a surface that is playing wants those cores — st0 calls this when the transport
starts and prewarms again when it stops. Sidecars already written stay written, so resuming
costs only what was in flight.

On `/waveform` itself: `whole=1` asks for the source's full duration rather than the
placement's span — what a `clips/*.yaml` shows. `sensitivity` re-detects the source's
transients at that threshold and REMEMBERS it, because it is written into the sidecar; absent,
the source keeps whichever it was last built with. Bounded, because 0 makes every bucket an
onset and a large value makes none, so neither end is a useful thing to ask for.

## `GET /presets?node=` — the one preset route, and it only lists

A node's presets live in a presets tree — the workspace's `_presets/` or a library's `presets/` —
keyed by the module the node extends, which the engine never sees, so they are handled here. The
route answers `NodePresets`: that ref, every preset from every scope, and the scopes a new one may
go to. Applying, saving and updating are `node preset` verbs through `/command`, so the graph's
dropdown and the command bar run one code path. Every call names a NODE, a scope and a preset NAME,
never a path: the path is built server-side and refused if the name would leave its folder
(`packages/song/docs/userPresets.md`).

## `GET /logs` — the Logs panel's two halves

The bound engine machine's `.studio.log` (`?tail=N` seeds, `?offset=X` continues, by byte) and this
service's own lines under `service` (`?after=S` continues, by number). See `docs/serviceLog.md`.
