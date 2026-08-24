# The engine link — one socket, and what is left on it

The médiathèque is a hosted catalogue of files, and for most of what it holds that is all it has
to be: a song, a sample and a capture are bytes, and listing them needs nothing but a directory
walk.

It holds **one** socket to an `engine/moteur` all the same, and it is worth being precise about
what that socket is for.

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

## What it does not carry: a module builder

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
editable catalogue, and a loaded plugin, which is only ever in a project. A **chain** has no
project that supplies both at once, which is why it gets a generated one — the bench,
[banc.md](banc.md).

## Holding the socket

`apps/pl8/frontend/src/engine/useModuleEngine.ts` is where the one socket lives. What follows is
the reasoning behind it, so the file itself can keep one line per fact.

**The pick is handed DOWN, not read here.** The screen and the header's picker are on show at the
same time, so the choice can move while a pane is open — and a socket left on the previous machine
would answer for a plugin loaded somewhere else. The caller's pick wins over the stored one: it is
the same value, but it arrives already updated, whereas a fetch inside the hook would still be
answering with what was saved a moment ago. Omitted, it falls back to the stored preference.

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
second connection, which is why it borrows this one.

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
failure a transport cannot report by itself, so this channel is the only account of it, and
dropping it is expensive. It is cleared when a new document is SENT rather than on stop, so a
complaint raised by that send survives to be read.

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
edit can hold a plugin that document does not mention — a state the engine can reach, measured on
this machine — and then no document will ever remove it: the diff sees no change, so nothing
rebuilds. What plays afterwards runs through a module nobody asked for, which for a `crossfade` is
-100 dB. Silence, from a transport reporting that it is rolling. The session comes back on the next
apply, since it is created by a client driving it.

### Choosing one without connecting

`useEngineChoice` is the other half: it reads the engine list and the remembered id **without
opening a socket**, so drawing the header's picker cannot make a second connection. That is the
whole reason it exists.

Four things it reports, and the distinctions matter:

- **`settled`** — the list and the remembered choice have both come back at least once. Distinct
  from "nothing is chosen": a gate that cannot tell those two apart flashes in everybody's face on
  load.
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
snapshot, and without it one missed race marks the engine unreachable until the page is reloaded
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
