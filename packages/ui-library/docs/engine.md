# The engine link — one socket, and what is on it

The médiathèque is a hosted catalogue of files, and for most of what it holds that is all it has
to be: a song, a sample and a capture are bytes, and listing them needs nothing but a directory
walk.

It reaches an `engine/k7-runtime` all the same, and it is worth being precise about what for. The
server side — the registry it lists from, and the jobs it sends a machine — is
[apps/k7/backend/docs/media/engine.md](../../../apps/k7/backend/docs/media/engine.md).

## What it carries: playback, and nothing else

A song, one of its variants — anything somebody chose to hear on their own rig rather than in
this tab. The moteur opens file PATHS and cannot fetch a URL, so what plays is the copy on that
machine's disk, which the backend puts there first. See [playbackTarget.md](playbackTarget.md) for
the choice and [playback.md](playback.md) for what crosses.

`src/engine/useSongEngine.ts` is the whole of the library's engine half, and it does two things
that are deliberately not one:

- **Looking** — `engines.find()` on `relook`'s fifteen seconds, always, with no socket. The
  destinations menu has to say whether the moteur is offerable before anybody has chosen it, and
  drawing a menu must not open a connection to somebody's machine.
- **Connecting** — only while the moteur is the chosen destination. A catalogue tab left on the
  browser destination holds no lease and no session on a machine it is not using.

The measured engine is kept in a REF and the socket effect keys on its **id**, so re-measuring
does not tear the link down and rebuild it on the same machine every fifteen seconds.

`PlaybackProvider` mounts it, once, and it is the tab's **only** socket: a song that keeps playing
across screens needs the connection to outlive any one of them, and a second client on the same
session would be two things driving one document. The host mounts `MediaPlayback`, and with it
this probe, only on the pages that can play: the editor's home pages do not look for an engine at
all.

It claims the engine with **no project** (`engines.hold(found, { project: null })`), and that is
deliberate: the library never opens one, so it must not compete for one. Claiming here would take a
song away from the editor tab next door every time somebody glanced at the catalogue. See
[packages/engine-registry/docs/claim.md](../../engine-registry/docs/claim.md).

The session is `sessionFor(SESSIONS.pl8, user)` — per service and per person, `user` coming from
the host. Per service so the médiathèque cannot tear down the song the editor has open on the same
machine; per person because the médiathèque is hosted and two people can choose one machine.
`pl8` is the session's NAME, and it stays the library's whatever page mounts it.

The lease is held in a **ref**, because it is taken inside an async body, long after the effect
returned its cleanup. A miss is not fatal: it marks the engine in use, it does not grant the
connection, which the browser makes itself. And there is no unsubscribe of our own — `dispose()`
drops the client and its callbacks together, and this hook owns the client outright.

## The engine id is the account's, and the editor's too

The chosen engine is `engineId` in the ONE preferences document the backend keeps per person
(`apps/k7/backend/src/server.ts`), beside the editor's command preferences and the playback
destination. Picking a machine in the library picks it for the editor as well, which is the point
of one origin. It is also why every write goes through `patchPrefs` (`src/prefs.ts`): the store
replaces the document wholesale, and a bare save of the destination would erase the engine id.

## What it does not carry: a module builder

A **module** is different from a song and a sample. A module file names a plugin, and the only
thing that knows what that plugin's parameters are called, what they span and what presets it
ships is a running engine with **that plugin loaded**. No table can substitute — the answer
belongs to the binary, and it changes when the binary is updated.

The library has an engine and no project to load a plugin into. Building one for the occasion — a
one-track, one-plugin `ProjectDoc` down its own session, purely so there is something to ask
about — drags a whole screen behind it: an audition with its own input picker, its own metered
channel menu, its own level gauge, and an engine gate demanding a machine before you can edit a
text file.

So **modules are built in the editor**, from the file tree's **Libraries** tab of whatever project
is open, where a real project instantiates a plugin for real and the builder reads the one that is
actually making the sound. The reasoning is in
[apps/k7/frontend/docs/sharedModules.md](../../../apps/k7/frontend/docs/sharedModules.md).

The rule underneath is that a builder needs **two** things which live in different places: an
editable catalogue, and a loaded plugin, which is only ever in a project. When no project you have
open names the module, the generated one supplies both — the bench,
[apps/k7/backend/docs/media/banc.md](../../../apps/k7/backend/docs/media/banc.md).
