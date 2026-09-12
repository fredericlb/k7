# The engine link — one socket, and what is on it

The médiathèque is a hosted catalogue of files, and for most of what it holds that is all it has
to be: a song, a sample and a capture are bytes, and listing them needs nothing but a directory
walk.

It reaches an `engine/st0-engine` all the same, and it is worth being precise about what for.

## What it carries: playback, and nothing else

A song, one of its variants — anything somebody chose to hear on their own rig rather than in
this tab. The moteur opens file PATHS and cannot fetch a URL, so what plays is the cache on that
machine's disk, reached through its file service. See [playbackTarget.md](playbackTarget.md) for
the choice and [playback.md](playback.md) for what crosses.

`frontend/src/engine/useSongEngine.ts` is the whole of this app's engine half, and it does two
things that are deliberately not one:

- **Looking** — `engines.find()` on `relook`'s fifteen seconds, always, with no socket. The
  destinations menu has to say whether the moteur is offerable before anybody has chosen it, and
  drawing a menu must not open a connection to somebody's machine.
- **Connecting** — only while the moteur is the chosen destination. A catalogue tab left on the
  browser destination holds no lease and no session on a machine it is not using.

The measured engine is kept in a REF and the socket effect keys on its **id**, so re-measuring
does not tear the link down and rebuild it on the same machine every fifteen seconds.

`PlaybackProvider` mounts it, once, and it is the tab's **only** socket: a song that keeps playing
across screens needs the connection to outlive any one of them, and a second client on the same
session would be two things driving one document.

It claims the engine with **no project** (`engines.hold(found, { project: null })`), and that is
deliberate: pl8 never opens one, so it must not compete for one. Claiming here would take a song
away from the st0 tab next door every time somebody glanced at the catalogue. See
[packages/engine-registry/docs/claim.md](../../../packages/engine-registry/docs/claim.md).

The session is `sessionFor(SESSIONS.pl8, currentUser())` — per service and per person. Per service
so the médiathèque cannot tear down the song st0 has open on the same machine; per person because
the médiathèque is hosted and two people can choose one machine.

The lease is held in a **ref**, because it is taken inside an async body, long after the effect
returned its cleanup. A miss is not fatal: it marks the engine in use, it does not grant the
connection, which the browser makes itself. And there is no unsubscribe of our own — `dispose()`
drops the client and its callbacks together, and this hook owns the client outright.

## What it does NOT carry: an analysis

A `{file}.cache` sidecar is written by **this service**, out of its own ffmpeg, because this
service holds the bytes (`packages/audio-analysis/docs/analysis.md` and [analysis.md](analysis.md)).
Asking a machine for it would mean downloading the master to that machine first and posting the
sidecar back, to compute something the host already has everything for.

That is also why the socket may be absent without anything on screen degrading except the one
menu row: nothing but playback depends on it.

## What it does not carry either: a module builder

A **module** is different from a song and a sample. A module file names a plugin, and the only
thing that knows what that plugin's parameters are called, what they span and what presets it
ships is a running engine with **that plugin loaded**. No table can substitute — the answer
belongs to the binary, and it changes when the binary is updated.

This app has an engine and no project to load a plugin into. Building one for the occasion — a
one-track, one-plugin `ProjectDoc` down its own session, purely so there is something to ask
about — drags a whole screen behind it: an audition with its own input picker, its own metered
channel menu, its own level gauge, and an engine gate demanding a machine before you can edit a
text file.

So **modules are built in st0**, from the file tree's **Libraries** tab of whatever project is
open, where a real project instantiates a plugin for real and the builder reads the one that is
actually making the sound. The reasoning is in
[apps/st0/frontend/docs/sharedModules.md](../../st0/frontend/docs/sharedModules.md).

The rule underneath is that a builder needs **two** things which live in different places: an
editable catalogue, and a loaded plugin, which is only ever in a project. When no project you have
open names the module, the generated one supplies both — the bench, [banc.md](banc.md).
