# What a host owes the desk

Two turntables meeting at a crossfade, their channel strips, the waveforms, the cues and the
set list. It was `apps/m9/frontend/src` and is a package because **l8 draws it too**, as a
`surfaces/` view (`packages/song/docs/surfaces.md`) — the same move `ui-chains` made when the
médiathèque and the decks turned out to want the same graph, and for the same reason.

## The seam is the ENGINE, and only the engine

`./engine` declares `Deck`: a phase, a transport, a client, the live plugin values, and the two
calls that watch and publish them. That interface is m9's `useEngine` return type, moved
unchanged — and what made this an extraction rather than a rewrite is that **nothing in it named
m9**. The registry, the session id, the `/m9` prefix and the lease are how a host *obtains* an
engine, which is exactly the part that differs between the two, and none of it was in the type.

So a host supplies a `Deck` and the desk asks nothing else:

| host | how it gets one |
|---|---|
| m9 | `useEngine` — its own registry, `SESSIONS.m9`, its lease. See `apps/m9/docs/plumbing.md`. |
| l8 | an adapter over the link the shell already holds, since l8 has an engine before it has a surface |

### `sendProject` is part of the seam, and it is not optional

The desk plays by handing over a whole `ProjectDoc`. **Who is allowed to hand one to an engine is
the host's answer, not the desk's**: m9's browser is the only writer to its engine, while l8's
file service loads l8's project itself and is the only writer to that one. So `sendDecks` takes
`Deck.sendProject` rather than an `EngineClient` — m9 passes its socket, l8 posts to its service.

Getting this wrong is not subtle and it is not loud either: two writers push documents that are
each correct, and the last one wins. See `packages/song/docs/surfaces.md` for the ordering rule
the file service now owns.

`engine` stays on the seam for everything that is NOT a document — the transport, a seek, a param.
Those are messages about what is already loaded, and neither host has a second writer for them.

Everything else the desk needs is already shared and is imported directly rather than injected:
the file routes are `@studio/project-shell`'s `projectApi` (m9 reached them through an `api.ts`
that was one line re-exporting exactly that), the catalogue types are `@studio/mediatek`'s, and
`songs.yaml` is `@studio/song`'s. Putting a seam over those would have been a seam over
something that was already one thing.

## What is NOT in here

`useEngine` itself, and the gate that picks an engine. Those are the app's — a package that
chose a machine would be choosing it for every host.

m9's **Édition** and **Graphe** views also stayed. Édition is a file tree and an editor, which
is `@studio/ui-editor`'s job and not a desk's. Graphe is a thin wrapper over
`@studio/ui-chains-react`; what it needed from here — `M9_ICONS` and `deckGraph` — came along,
because those describe *decks* and not m9.

## The set list is a FILE, and that is what makes l8 able to host it

`songs.yaml` at the project root, read through `@studio/song/yaml/songsFile`. Nothing about it
is m9-shaped: it names médiathèque songs, and any project that carries one has a set. That is
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

The two harnesses that measure a SOUND stayed in m9 (`frontend/scripts/tempo-drag.ts`,
`metronome.ts`) and now import `@studio/ui-turntables/deck`. They drive the real `deckDoc` and
`nudgedTempos`, so they still measure what ships.
