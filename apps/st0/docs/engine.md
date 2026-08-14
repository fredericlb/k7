# The engine link — one socket, and what is left on it

The médiathèque is a hosted catalogue of files. For two of its three families that is all it
has to be: a song and a sample are bytes, and listing them needs nothing but a directory walk.

It still holds **one** socket to a `engine/moteur`, and it is worth being precise about what
that socket is for now, because it used to be for two things and one of them left.

## What it carries

Playback. A song, a playlist, a chain variant — anything the médiathèque hands to a machine to
be heard. The moteur opens file PATHS and cannot fetch a URL, so what plays is the cache on
that machine's disk, reached through its file service. See
[playbackTarget.md](playbackTarget.md) and [miniPlayer.md](miniPlayer.md).

`PlaybackProvider` opens that socket and hands it out through `useEngine()`. **It is the tab's
only one**, and that rule is enforced in one place rather than remembered in several:
`useEngineChoice` reads the engine list and the remembered id WITHOUT connecting, so drawing
the header's picker cannot open a second.

The session is `sessionFor(SESSIONS.st0, currentUser())` — per service and per person. Per
service so the médiathèque cannot tear down the song l8 has open on the same machine; per
person because the médiathèque is hosted and two people can choose one machine.

It claims the engine with **no project** (`engines.hold(found, { project: null })`), and that
is deliberate: st0 never opens one, so it must not compete for one. Claiming here would take a
song away from the l8 tab next door every time somebody glanced at the catalogue. See
[packages/engine-registry/docs/claim.md](../../../packages/engine-registry/docs/claim.md).

## What left: the module builder

A **module** is different from a song and a sample. A module file names a plugin, and the only
thing that knows what that plugin's parameters are called, what they span and what presets it
ships is a running engine with **that plugin loaded**. No table can substitute — the answer
belongs to the binary, and it changes when the binary is updated.

The médiathèque had an engine but no project to load a plugin into, so it manufactured one: a
one-track, one-plugin `ProjectDoc` sent down its own session, purely so there would be
something to ask about. Everything else followed from that — an audition with its own input
picker, its own metered channel menu, its own level gauge, and an engine gate over the whole
Modules section demanding a machine before you could edit a text file.

That is all gone. **Modules are built in l8**, from the file tree's **Libraries** tab of
whatever project is open, where a real project instantiates a plugin for real and the builder
reads the one that is actually making the sound. The reasoning is in
[apps/l8/frontend/docs/sharedModules.md](../../l8/frontend/docs/sharedModules.md).

What the médiathèque keeps is what it is: **the only editable catalogue**. The Modules section
lists, searches, uploads, renames and deletes; opening a module shows its files, read-only. And
l8 writes back here, through this backend's own `PUT /api/mediatek/file` — same origin, same
session cookie — which is what makes editing a module there mean editing *the* module rather
than forking a copy into a song.

There is no engine gate on the section any more. There is nothing left on it that an engine
would improve, and a door in front of an empty room is worse than no door.

## Why the builder passed through here at all

It used to be a screen inside l8, editing the workspace's `_modules` in place through an
`editShared` flag on the file service's write route. That worked because a workspace's
`_modules` was, at the time, where modules lived.

It is not any more. Modules live in the médiathèque, which every project reads through the
`@mediatek` named root; a workspace's copy is a **read-only mirror**, and the general escape
hatch is gone (see `packages/song/docs/moduleFork.md`). So the builder moved here, where the
catalogue is editable — and moving it here is what made it a package, `@studio/ui-module-builder`,
which is why it could move back out again without being rewritten.

The round trip was not wasted. What it settled is that the builder needs **two** things and
they live in different places: an editable catalogue, which is here, and a loaded plugin, which
is only ever in a project.

The first answer to having both at once was the **bench** — a generated project holding the
whole catalogue, which you opened *in order to* edit a module ([banc.md](banc.md)). The second
is smaller and is what ships: l8 lists this catalogue in a second tab of its file tree and
writes back over these routes, so the project supplying the loaded plugin is whichever one you
already had open. The bench still exists for a **chain**, which has no such second home.
