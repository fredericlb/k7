# What a host owes the desk

Two turntables meeting at a crossfade, their channel strips, the waveforms, the cues and the
set list. It was an app of its own — `apps/m9` — and is a package because **l8 draws it**, as a
`surfaces/` view (`packages/song/docs/surfaces.md`). That app is gone now; the desk outlived it,
which is the whole point of having made this a package first.

## The seam is the ENGINE, and only the engine

`./engine` declares `Deck`: a phase, a transport, a client, the live plugin values, and the two
calls that watch and publish them. That interface is m9's `useEngine` return type, moved
unchanged — and what made the extraction possible at all is that **nothing in it named m9**. The
registry, the session id, the service prefix and the lease are how a host *obtains* an engine,
which was exactly the part that differed, and none of it was in the type.

So a host supplies a `Deck` and the desk asks nothing else. There is one host today — l8, with
an adapter over the link its shell already holds, since l8 has an engine before it has a
surface (`apps/l8/frontend/src/hooks/useTurntableDeck.ts`). The seam stays a seam anyway: it is
what let the desk change hosts once, and it costs an interface.

### `sendProject` is part of the seam, and it is not optional

The desk plays by handing over a whole `ProjectDoc`. **Who is allowed to hand one to an engine is
the host's answer, not the desk's**: m9's browser was the only writer to its engine, while l8's
file service loads l8's project itself and is the only writer to that one. So `sendDecks` takes
`Deck.sendProject` rather than an `EngineClient` — m9 passed its socket, l8 posts to its service.

Getting this wrong is not subtle and it is not loud either: two writers push documents that are
each correct, and the last one wins. See `packages/song/docs/surfaces.md` for the ordering rule
the file service now owns.

`engine` stays on the seam for everything that is NOT a document — the transport, a seek, a param.
Those are messages about what is already loaded, and no host has a second writer for them.

Everything else the desk needs is already shared and is imported directly rather than injected:
the file routes are `@studio/project-shell`'s `projectApi`, the catalogue types are
`@studio/mediatek`'s, and `songs.yaml` is `@studio/song`'s. Putting a seam over those would have
been a seam over something that was already one thing.

## What is NOT in here

`useEngine` itself, and the gate that picks an engine. Those are the app's — a package that
chose a machine would be choosing it for every host.

Nor the two views that sat beside the desk. **Édition** is a file tree and an editor, which is
`@studio/ui-editor`'s job and not a desk's; **Graphe** was a thin wrapper over
`@studio/ui-chains-react`. l8 has both already, and better — which is most of why an app around
this package stopped earning its keep. What the graph needed FROM here — `M9_ICONS` and
`deckGraph` — came along, because those describe *decks*.

## The set list is a FILE, and that is what makes l8 able to host it

`songs.yaml` at the project root, read through `@studio/song/yaml/songsFile`. Nothing about it
is desk-shaped: it names médiathèque songs, and any project that carries one has a set. That is
why bringing the desk to l8 did not require inventing a set-list concept for l8 — an `.l8`
folder with a `songs.yaml` beside its `surfaces/` is a set, in the same words.

## What one deck costs

`DECKS` is a list, not a pair. A third deck is a third track and a second meeting point in the
chains file; nothing here hardcodes two, and `controls.ts` derives the desk's controls from that
list precisely so adding one does not silently leave it unbindable.

## Verified how

`npm run test --workspace @studio/ui-turntables` — 201 tests, all of them the ones m9 already
had, moved with the code they cover. They are pure logic: the deck document, the cue and slip
maths, the beat grid, the bindings join, the set list, the waveform buckets. **Nothing mounts.**

**One failure mode here is a SOUND**, and `scripts/` holds the two harnesses for it. Both point
at a running engine and drive the real `deckDoc` and `nudgedTempos`, so they measure what ships:

- `tempo-drag.ts` — does moving the BPM fader move the MUSIC? It plays a source whose frequency
  encodes its own position and reads the tone back off the broadcast tap, so a skip shows up as
  a step in that number. `--raw` drops the slip correction, to see what the fader used to do.
- `metronome.ts` — does the click land ON the deck's beat? The deck plays a SILENT file, so
  everything the tap hears is the click.

```
npx tsx packages/ui-turntables/scripts/tempo-drag.ts [ws://127.0.0.1:8765] [--raw]
npx tsx packages/ui-turntables/scripts/metronome.ts  [ws://127.0.0.1:8765]
```

They lived in m9 while m9 existed, which nearly cost them: an app's `scripts/` folder is the
last place anyone looks when the app goes. They are here now, beside the maths they exercise
and the pages that explain it (`docs/bpm.md`, `docs/metronome.md`).
