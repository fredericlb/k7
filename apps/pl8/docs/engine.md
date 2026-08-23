# The engine link — one socket, and what is left on it

The médiathèque is a hosted catalogue of files. For two of its three families that is all it
has to be: a song and a sample are bytes, and listing them needs nothing but a directory walk.

It still holds **one** socket to a `engine/moteur`, and it is worth being precise about what
that socket is for now, because it used to be for two things and one of them left.

## What it carries

Playback. A song, one of its variants — anything the médiathèque hands to a machine to
be heard. The moteur opens file PATHS and cannot fetch a URL, so what plays is the cache on
that machine's disk, reached through its file service. See
[playbackTarget.md](playbackTarget.md) and [miniPlayer.md](miniPlayer.md).

`PlaybackProvider` opens that socket and hands it out through `useEngine()`. **It is the tab's
only one**, and that rule is enforced in one place rather than remembered in several:
`useEngineChoice` reads the engine list and the remembered id WITHOUT connecting, so drawing
the header's picker cannot open a second.

The session is `sessionFor(SESSIONS.pl8, currentUser())` — per service and per person. Per
service so the médiathèque cannot tear down the song st0 has open on the same machine; per
person because the médiathèque is hosted and two people can choose one machine.

It claims the engine with **no project** (`engines.hold(found, { project: null })`), and that
is deliberate: pl8 never opens one, so it must not compete for one. Claiming here would take a
song away from the st0 tab next door every time somebody glanced at the catalogue. See
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

That is all gone. **Modules are built in st0**, from the file tree's **Libraries** tab of
whatever project is open, where a real project instantiates a plugin for real and the builder
reads the one that is actually making the sound. The reasoning is in
[apps/st0/frontend/docs/sharedModules.md](../../st0/frontend/docs/sharedModules.md).

What the médiathèque keeps is what it is: **the only editable catalogue**. The Modules section
lists, searches, uploads, renames and deletes; opening a module shows its files, read-only. And
st0 writes back here, through this backend's own `PUT /api/mediatek/file` — same origin, same
session cookie — which is what makes editing a module there mean editing *the* module rather
than forking a copy into a song.

There is no engine gate on the section any more. There is nothing left on it that an engine
would improve, and a door in front of an empty room is worse than no door.

## Why the builder passed through here at all

It used to be a screen inside st0, editing the workspace's `_modules` in place through an
`editShared` flag on the file service's write route. That worked because a workspace's
`_modules` was, at the time, where modules lived.

It is not any more. Modules live in the médiathèque, which every project reads through the
`@st0` named root; a workspace's copy is a **read-only mirror**, and the general escape
hatch is gone (see `packages/song/docs/moduleFork.md`). So the builder moved here, where the
catalogue is editable — and moving it here is what made it a package, `@studio/ui-module-builder`,
which is why it could move back out again without being rewritten.

The round trip was not wasted. What it settled is that the builder needs **two** things and
they live in different places: an editable catalogue, which is here, and a loaded plugin, which
is only ever in a project.

The first answer to having both at once was the **bench** — a generated project holding the
whole catalogue, which you opened *in order to* edit a module ([banc.md](banc.md)). The second
is smaller and is what ships: st0 lists this catalogue in a second tab of its file tree and
writes back over these routes, so the project supplying the loaded plugin is whichever one you
already had open. The bench still exists for a **chain**, which has no such second home.

## Holding the socket

`apps/pl8/frontend/src/engine/useModuleEngine.ts` is where the one socket lives. What follows is
the reasoning behind it, so the file itself can keep one line per fact.

**The pick is handed DOWN, not read here.** `engineId` used to be read inside the hook and only
there, because the editor REPLACED the screen the picker lives on and a choice therefore could not
move while it was open. The editor sits beside that header now, so it can — and a socket left on
the previous machine would answer for a plugin loaded somewhere else. The caller's pick also wins
over the stored one: it is the same value, but it arrives already updated, whereas the fetch inside
would still be answering with what was saved a moment ago. Omitted, it falls back to the stored
preference exactly as before.

**An absent engine is a normal state.** The editor edits text either way; it just cannot offer a
parameter list. The policy of which engine to take lives in `chooseEngine`, where it can be tested.

**The lease is held in a ref**, because it is taken inside an async body, long after the effect
returned its cleanup. A miss is not fatal: it marks the engine in use, it does not grant the
connection, which the browser makes itself.

**The link URL is re-measured before every reconnect.** The relayed URL's ticket outlives nothing,
and a pane stays open far longer than a minute.

**There is no unsubscribe of our own.** `dispose()` drops the client and its callbacks together,
and this hook owns the client outright — nobody else holds a reference to it.

### Two flags that look like one

`phase: ready` says a client was made and told to connect; `connected` says the socket is OPEN. A
screen that queries on connect needs the difference. `client` itself is exposed rather than wrapped
verb by verb, because `EnginePage` asks a dozen questions about the MACHINE — the device list, the
session list, the installed catalogue — and drives no document; what it must not do is open a
second connection, which is exactly what it did before there was one socket to borrow.

### Everything about the transport comes from the engine

`playing`, `playhead` and `outputLevel` all come off the engine's own state push, never off a
hopeful local flag set on click: the transport is on another machine, so "did it start", "where is
it" and "how loud" are answers only that machine has. The subscription is permanent rather than
only-while-playing, because a session can already be running when this tab connects — the same
person left it playing in another one — and a pane that assumed silence would draw a Play button
over a song that is audible. The level is the FIRST of the list, since the médiathèque plays one
track at a time, and -100 dB is the engine's "nothing".

A seek moves the playhead LOCALLY as well as sending it: the state frame is ~20 Hz, so a playhead
that only ever came back from the engine would lag a drag on the waveform by up to 50 ms — long
enough to read as the cursor snapping back before it catches up. It is its own verb rather than a
re-send of the document, because the engine keeps playing across a seek and a document would
restart it.

### The warning channel is the only account of silence

A document naming a file the engine cannot open — absent, or in a format that build has no reader
for — raises `clip source not found/invalid: <path>` and then plays SILENCE. Silence is the one
failure a transport cannot report by itself, so this channel is the only account of it. It was
being thrown away. It is cleared when a new document is SENT rather than on stop, so a complaint
raised by that send survives to be read.

### The order of a play, and why `fromSeconds` matters

The document goes first, THEN the verb. A transport verb sent first plays whatever the engine still
had loaded, which is a second of the wrong sound before the right one. The seek goes BETWEEN the
two: the position belongs to the document just applied, and asking for it after `play` would be
heard as a jump.

Leaving `fromSeconds` out is almost always wrong. `EngineHost::play` repositions the playhead only
when the transport is LOOPING; otherwise it resumes from wherever it was. A session outlives the
documents put through it — it is keyed by service and person, not by what is loaded — so the
playhead can sit well past the end of the clip just sent, and the transport then rolls in silence
with `playing` perfectly true. That is a failure with no symptom other than no sound.

### Why `reset` exists

An apply is a DIFF, and a diff can only remove what the engine's STORED document says is there. An
edit can hold a plugin that document does not mention — a module audition left one behind, measured
on this machine — and then no document will ever remove it: the diff sees no change, so nothing
rebuilds. What plays afterwards runs through a module nobody asked for, which for a `crossfade` is
-100 dB. Silence, from a transport reporting that it is rolling. The session comes back on the next
apply, since it is created by a client driving it.

### Choosing one without connecting

`useEngineChoice` is the other half: it reads the engine list and the remembered id **without
opening a socket**, so drawing the header's picker cannot make a second connection. That is the
whole reason it exists.

Four things it reports, and the distinctions matter:

- **`settled`** — the list and the remembered choice have both come back at least once. Distinct
  from "nothing is chosen", which before this was indistinguishable from "we have not looked yet",
  and a gate that cannot tell the two apart flashes in everybody's face on load.
- **`chosen`** — the remembered engine, *reachable from this browser*. A choice pointing at a
  machine that is off is not one.
- **`fileBase`** — that engine's file service, `http://<host>:<filePort>`, or null when there is no
  reachable choice. Every per-MACHINE fact lives behind it: what it has scanned, what it can render.
- **`quality`** — what the link MEASURED, which is the status bar's Q badge. It comes from the probe
  this hook already ran, so the bar costs no socket and no lease of its own.

The list, the preference and the measurement arrive in one call. The POLICY that call also applies
is ignored here on purpose: this hook draws a picker, so it shows what the account remembered even
when that engine did not answer — `ready` is what says whether it can be driven. The CURRENT choice
is passed back in as the preference, which is what makes re-measuring safe: `find` returns
`preferId ?? prefs.engineId`, so an optimistic `choose()` whose save has not landed yet is not
overwritten by the server's value. That choice is held in a REF rather than in the effect's
dependencies, so re-measuring reads it without choosing an engine triggering a full measurement.

`relook` brings the hook back every fifteen seconds and when the tab returns: a probe is a
snapshot, and one missed race marked the engine unreachable until the page was reloaded
(`packages/engine-browser/src/relook.ts`).

Choosing is **optimistic, then persisted** — the tick moves under the cursor rather than after a
round trip. A failed save is not surfaced (`packages/user-prefs/docs/store.md` says why that
failure is deliberately quiet) and the choice still holds for the session. It goes through
`patchPrefs` and never `savePrefs`: the route REPLACES the document, so a PUT of `{engineId}` alone
would clear the playback destination beside it.

### The session name, again

`sessionFor(SESSIONS.pl8, currentUser())` — per service AND per person. The médiathèque is hosted,
so two people can choose the same machine, and on a bare `pl8` one of them starting a song would
tear down the other's mid-listen. It also keeps this out of the slot st0 has a song in.
