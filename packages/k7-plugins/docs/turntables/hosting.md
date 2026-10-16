# What a host owes the desk

Two turntables meeting at a crossfade, their channel strips, the waveforms, the cues and the
set list. k7 draws it as a `surfaces/` view (`packages/song/docs/surfaces.md`).

## The seam is the ENGINE, and only the engine

`./engine` declares `Deck`: a phase, a transport, a client, the live plugin values, and the two
calls that watch and publish them. **Nothing in it names a host.** The registry, the session id,
the service prefix and the lease are how a host *obtains* an engine, and none of that is in the
type — which is what keeps the desk independent of the app around it.

So a host supplies a `Deck` and the desk asks nothing else. k7 does it with an adapter over the
link its shell already holds, since it has an engine before it has a surface
(`apps/k7/frontend/src/hooks/useTurntableDeck.ts`).

### A deck's position is its platter's needle, handed over RAW

What the desk draws and stores is each deck's needle, and a host owes it as the engine said it:
`platters`, a ref of every platter's last reported position in seconds of its record. A host
smooths nothing there. The steering a 60 fps picture needs is the desk's own
([needleClock.md](needleClock.md)), because only the desk knows the rate each platter was told to
run at — a host sees frames, not tempo faders.

`playhead` and `drawNow` are the TRANSPORT's position, raw and steered
(`apps/k7/frontend/docs/playhead.md`). The transport is no deck's clock, and the desk reads
neither.

### `sendProject` is part of the seam, and it is not optional

The desk plays by handing over a whole `ProjectDoc`. **Who is allowed to hand one to an engine is
the host's answer, not the desk's**: k7's file service loads k7's project itself and is the only
writer to that engine. So `sendDecks` takes `Deck.sendProject` rather than an `EngineClient`, and
k7 posts to its service.

Getting this wrong is not subtle and it is not loud either: two writers push documents that are
each correct, and the last one wins. See `packages/song/docs/surfaces.md` for the ordering rule
the file service owns.

`engine` stays on the seam for everything that is NOT a document — the transport, a seek, a param.
Those are messages about what is already loaded, and no host has a second writer for them.

### The two props that are NOT the engine, and how narrow they are

`MixView` takes `engine: { fileBase, id }` and an optional `library: { base }`. Both are as small
as they can be on purpose:

- `engine` is used on exactly one line, `fileLink(engine)`. A prop asking for a whole probe
  reply — a `RankedEngine<PublicEngine>` — would force a host without one to fabricate the other
  fifteen fields: the difference between a seam and a shape one host happens to have.
- `library` is the media library's API base, because separating a record is its work: it holds the master
  (`apps/k7/backend/docs/media/stems.md`). Optional, so a host with no library to point
  at still draws a desk — the knobs then say a record has no stems, which is true, rather than
  the view failing to render.

Everything else the desk needs is already shared and is imported directly rather than injected:
the file routes are `@studio/project-shell`'s `projectApi`, the catalogue types and the
playlist RESOLUTION are `@studio/mediatek`'s, and the playlist format is `@studio/song`'s. A
seam over those would be a seam over something that is already one thing.

### The desk does not stream into the tab

The sound leaves through the machine's audio interface, and the seam carries no way to hear it in
the browser: no host has a stream player. The desk draws no "Listen here" control, not a disabled
one — a control that cannot be honoured says the sound could be here, and the only thing it
changes is your confidence about why it is not.

### Two services, two credentials

`service.ts` talks to two things, and they do not authenticate the same way — so they cannot
share a `get`:

| | how it is reached | credential |
|---|---|---|
| the file service | `FileLink.base`, from the engine's own probe reply | the three shared `x-studio-*` headers (`fileHeaders`) |
| the media library | `LibraryLink.base`, supplied by the host | the session cookie, `credentials: "include"` |

The file service sits on a machine with no cookie jar, and `requireEngineToken` gates the whole
service before `/mediatek` is even mounted — so a call missing the engine token is a 401 whatever
it asks for. Sending `fileHeaders()` at the media library would be the mirror mistake: a 401 carrying an engine
token nobody there can check. `fileHeaders` is safe to call from a view because the gate
configures the transport before anything renders.

The base rather than a derived path, in both cases, because the address is the host's to know: where
the media library is mounted is read from the services table, and a package that guessed would hold
a second copy of that fact.

Both read the SERVER's sentence out of an error body rather than throwing the bare status. Every
route answers `{error}` with something actionable — "engine binary not found", "is not in this
cache" — and a surface can only be as honest as the error it is handed.

## What is NOT in here

`useEngine` itself, and the gate that picks an engine. Those are the app's — a package that
chose a machine would be choosing it for every host.

Nor an editor or a graph view. A file tree and an editor are `@studio/ui-editor`'s job, not a
desk's, and the chains graph is `@studio/ui-chains-react`'s. What the graph needs FROM here —
`M9_ICONS` and `deckGraph` — lives here because those describe *decks*.

## The set list is a FILE, and that is what makes k7 able to host it

A playlist in the workspace's `_playlists/`, named by the surface's `playlist:` and read
through `@studio/song/playlist`. Nothing about it is desk-shaped: it names médiathèque songs,
and k7 has a screen for writing one under its cog. That is why hosting the desk in k7 needs no
set-list concept of k7's own — the concept lives in the repository, shared by every project in
it.

The host passes the NAME and this package reads the file. That split is the same one `mapping`
takes, and for the same reason: the declaration is the host's business (a host outside k7 has
no `surfaces/` to look in), and what the file MEANS is this package's.

## What one deck costs

`DECKS` is a list, not a pair. A third deck is a third track and a second meeting point in the
chains file; nothing here hardcodes two, and `controls.ts` derives the desk's controls from that
list precisely so adding one does not silently leave it unbindable.

## Verified how

`npm run test --workspace @studio/ui-turntables` — pure logic: the deck document, the beat grid,
the bindings join, the set list, the waveform buckets. **Nothing mounts.**

**One failure mode here is a SOUND**, and `scripts/put-on.ts` is the harness left for it: it
points at a running engine, drives the real `deckDoc`, and times the `applied` answer to putting a
record on a deck that already holds one — the one gesture whose cost is paid in front of an
audience (`docs/platter-plan.md`).

```
npx tsx packages/k7-plugins/scripts/turntables/put-on.ts [ws://127.0.0.1:8765]
```

Three others lived here and went with the clip they measured (`tempo-drag.ts`, `metronome.ts`,
`scratch-drag.ts`). What they established is kept where it belongs — `docs/bpm.md` for the fader,
`docs/metronome.md` for the click, `docs/scratch.md` for the hand. The platter's own numbers are
measured from the engine side now, in `engine/k7-runtime/scripts/`.

It lives here rather than in a host, beside the maths it exercises and the pages that explain it.

## Hidden, the desk goes still

A host keeps the desk mounted and hides it, as k7 does every pane, so the desk works out for
itself whether it is on screen: its root is watched by an `IntersectionObserver`, which reads a
`display: none` pane as out of sight, and the answer is shared through a context
(`src/turntables/views/inSight.ts`). While hidden the channel and master meters read the floor —
the same value every frame, so no re-render per engine frame — and the records keep their angle
without writing it to the page. The master's clip light is the exception: it is a latch, and an
overload while nobody looked is still worth seeing on the way back. Nothing here stops the SOUND:
the decks play on, it is only the drawing that rests.
