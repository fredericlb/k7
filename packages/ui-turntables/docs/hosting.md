# What a host owes the desk

Two turntables meeting at a crossfade, their channel strips, the waveforms, the cues and the
set list. st0 draws it as a `surfaces/` view (`packages/song/docs/surfaces.md`).

## The seam is the ENGINE, and only the engine

`./engine` declares `Deck`: a phase, a transport, a client, the live plugin values, and the two
calls that watch and publish them. **Nothing in it names a host.** The registry, the session id,
the service prefix and the lease are how a host *obtains* an engine, and none of that is in the
type — which is what keeps the desk independent of the app around it.

So a host supplies a `Deck` and the desk asks nothing else. st0 does it with an adapter over the
link its shell already holds, since it has an engine before it has a surface
(`apps/st0/frontend/src/hooks/useTurntableDeck.ts`).

### The transport is TWO readers, and a host owes both

`Deck` asks for the position twice, and the split is not redundancy — the two callers want
opposite things:

| field | shape | for |
|---|---|---|
| `playhead` | a ref, `{ seconds, at }` — the last frame, unprocessed, and when it landed | a cue drop, which stores where the finger fell |
| `drawNow` | `() => number` | the record's wedge and the waveform, redrawn at 60 fps |

The engine speaks every 50 ms and not on a regular beat. Extrapolating from the raw anchor
re-anchors on every frame and copies that arrival jitter into the picture — 60 fps of stutter
instead of 20. The transport's rate is KNOWN — one second per second, pitch fader included,
since that stretches the clip rather than the transport — so `drawNow` predicts from local time
and estimates only the OFFSET, taking the least-delayed frame of a recent window. The drawn
position is then a straight line, and a real seek rolls the window back.

**Worth reading before you choose between them.** `drawNow` is not the less accurate of the
two: the clock converges on the *minimum* transit latency rather than the mean, so continuity
costs nothing in accuracy. Measured over a realistic feed, the raw anchor lags by whatever the
last frame's transit was (4 to 55 ms, mean ~14) while `drawNow` sits flat at the best one.

Which leaves the split narrow: `playhead` is what the engine literally said, and `drawNow` is
an estimate of the same thing. Moving the cue path onto
`drawNow` would probably be an improvement and would change where cues land by a few
milliseconds — a musician-facing change, and so a decision rather than a tidy-up. Until then a
host owes both, and must not implement one by calling the other.
`@studio/engine-browser/playhead-clock` is the clock; st0's adapter feeds it the same frames it
writes into the ref, a few lines apart.

### `sendProject` is part of the seam, and it is not optional

The desk plays by handing over a whole `ProjectDoc`. **Who is allowed to hand one to an engine is
the host's answer, not the desk's**: st0's file service loads st0's project itself and is the only
writer to that engine. So `sendDecks` takes `Deck.sendProject` rather than an `EngineClient`, and
st0 posts to its service.

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
- `library` is pl8's API base, because separating a record is pl8's work: pl8 holds the master
  (`apps/pl8/docs/stems.md`). Optional, so a host with no library to point
  at still draws a desk — the knobs then say a record has no stems, which is true, rather than
  the view failing to render.

Everything else the desk needs is already shared and is imported directly rather than injected:
the file routes are `@studio/project-shell`'s `projectApi`, the catalogue types and the
playlist RESOLUTION are `@studio/mediatek`'s, and the playlist format is `@studio/song`'s. A
seam over those would be a seam over something that is already one thing.

### Listening in the tab is optional, and its absence is deliberate

`Deck.setListening` is the one seam member the desk draws a control for only when the host
supplies it. The "Écouter ici" checkbox is **off by default**: the sound already comes out of the
machine's audio interface, so streaming it into the tab doubles it. On a laptop with no monitors
it is the only way to hear anything, which is why it exists at all.

A host with no stream player gets **no checkbox**, not a disabled one. A checkbox that cannot be
honoured is worse than none: it says the sound could be here, and the only thing it changes is
your confidence about why it is not.

### Two services, two credentials

`service.ts` talks to two things, and they do not authenticate the same way — so they cannot
share a `get`:

| | how it is reached | credential |
|---|---|---|
| the file service | `FileLink.base`, from the engine's own probe reply | the three shared `x-studio-*` headers (`fileHeaders`) |
| pl8's library | `LibraryLink.base`, supplied by the host | the session cookie, `credentials: "include"` |

The file service sits on a machine with no cookie jar, and `requireEngineToken` gates the whole
service before `/mediatek` is even mounted — so a call missing the engine token is a 401 whatever
it asks for. Sending `fileHeaders()` at pl8 would be the mirror mistake: a 401 carrying an engine
token nobody there can check. `fileHeaders` is safe to call from a view because the gate
configures the transport before anything renders.

The base rather than a derived path, in both cases, because the prefix differs by host: pl8
answers at `/api` on its own origin and at `/pl8/api` from st0's, and a package that guessed would
be wrong for one of them.

Both read the SERVER's sentence out of an error body rather than throwing the bare status. Every
route answers `{error}` with something actionable — "engine binary not found", "is not in this
cache" — and a surface can only be as honest as the error it is handed.

## What is NOT in here

`useEngine` itself, and the gate that picks an engine. Those are the app's — a package that
chose a machine would be choosing it for every host.

Nor an editor or a graph view. A file tree and an editor are `@studio/ui-editor`'s job, not a
desk's, and the chains graph is `@studio/ui-chains-react`'s. What the graph needs FROM here —
`M9_ICONS` and `deckGraph` — lives here because those describe *decks*.

## The set list is a FILE, and that is what makes st0 able to host it

A playlist in the workspace's `_playlists/`, named by the surface's `playlist:` and read
through `@studio/song/playlist`. Nothing about it is desk-shaped: it names médiathèque songs,
and st0 has a screen for writing one under its cog. That is why hosting the desk in st0 needs no
set-list concept of st0's own — the concept lives in the repository, shared by every project in
it.

The host passes the NAME and this package reads the file. That split is the same one `mapping`
takes, and for the same reason: the declaration is the host's business (a host outside st0 has
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
npx tsx packages/ui-turntables/scripts/put-on.ts [ws://127.0.0.1:8765]
```

Three others lived here and went with the clip they measured (`tempo-drag.ts`, `metronome.ts`,
`scratch-drag.ts`). What they established is kept where it belongs — `docs/bpm.md` for the fader,
`docs/metronome.md` for the click, `docs/scratch.md` for the hand. The platter's own numbers are
measured from the engine side now, in `engine/moteur/scripts/`.

It lives here rather than in a host, beside the maths it exercises and the pages that explain it.
