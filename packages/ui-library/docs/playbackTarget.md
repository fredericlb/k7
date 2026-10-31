# Where the médiathèque makes sound

A song plays **on the engine** the host's selector shows — in k7, the engine button above the home
sidebar's user menu — and is heard where that selector's radio says: its own speakers, or this
browser through its broadcast. While no engine answers, it plays in this tab's `<audio>` element.
There is no picker: where the sound is heard is already the engine selector's question, and a
second menu asking it in other words would read as two settings for one thing.

## One fallback, decided once

`src/playback/targets.ts` holds the two destinations and `effectiveTarget`, the whole decision: the
engine once one answers, else the browser — the destination that needs nothing. `PlaybackProvider`
calls it in `start`, so no caller decides where a song goes; a caller hands it what to play
(`Playable`), and the provider stamps where.

The browser is the fallback rather than an error because an engine is a machine somebody turns
off, and "the song does not play" would be the wrong answer to it.

**A song not on this machine yet plays in the browser too**, engine or not: on the phone a server
song opens before its copy lands, and its `Playable` carries the base it streams from, the forward to
the server ([songSource.md](songSource.md)). The engine plays files of its own machine, and handing it
a song first means downloading it whole, which the copy coming down in the background already does;
the next start after it lands plays on the engine. The song page's footer says so
when it happens: the engine's label, then "fallback", so the browser playing is never mistaken for
the engine.

## The browser

An `<audio>` element on the bytes this origin already serves. It is also mounted, silent, while the
**engine** plays, because it is what reports the DURATION: the engine's frames carry a playhead and
no length, and a scrub bar with no end is not one.

## The engine

`engine` plays through `engine/k7-runtime` on the machine the account chose — the same instrument
k7 drives, on its own audio interface. It is the destination for somebody sitting at their rig:
the sound comes out of the monitors, not out of a laptop speaker.

An engine nobody can hear — the server's own, playing into a null sink — says so in `whoami`, and
`useSongEngine` then plays its broadcast in this tab (`packages/engine-browser/src/engineOutput.ts`,
`docs/server-engine.md` at the repo root). It is still the `engine` destination: the song plays on
that engine, only the speakers are this browser's: which engine has no speakers is a fact about the
machine, not a choice.

**A host with an engine selector of its own decides which engine, and where it is heard**
(`LibraryHost.engine`): k7's home bar. `useSongEngine` asks `find()` for that engine first, so the
song goes to the engine the bar shows rather than to one the médiathèque chose alone — two answers
to "which machine" on one screen would be one too many — and a pick there moves the socket to the
new engine. Its **listen here** subscribes to the broadcast on any engine, on the open socket; the
engine's own outputs play on. A host with no selector passes nothing, and the account's remembered
engine and the policy decide as before.

### Looking, then holding

`useSongEngine` **looks** — `engines.find()` on `relook`'s fifteen seconds — and **connects** to the
engine it found, since that engine is where the next song plays. A host mounts the playback only on
the pages that can play (k7: `/media/…`), so the lease and the session last as long as those pages.

The measured engine is kept in a REF and the socket effect keys on its **id**, so re-measuring
every fifteen seconds does not tear the link down and build it again on the same machine.

It claims the engine with **no project** (`engines.hold(found, { project: null })`), and that is
deliberate: the library never opens one, so it must not compete for one. Claiming here would take
a song away from the editor tab next door. See
[packages/engine-registry/docs/claim.md](../../engine-registry/docs/claim.md).

The session is `sessionFor(SESSIONS.pl8, user)` — per service AND per person, `user` coming from
the host ([host.md](host.md)). Per service so the médiathèque cannot tear down the song the editor
has open on the same machine; per person because
the médiathèque is hosted and two people can choose one machine.

### The rest of it is one page down

What the moteur actually plays — two disks and the trap between them, the preview document, the
session, the reset an apply's diff makes necessary, and how the end of a track is inferred — is
[playback.md](playback.md). It is one page because it is one subject, and every screen that starts
a song would otherwise carry a copy of it.

## What it does not cover

**Samples and recordings.** They have no play button, here or anywhere. So the destination governs
exactly one thing: a song's audio, master or variant.

## The preferences document, and the trap under it

The engine remembered on the account lives in the per-user JSON (`packages/user-prefs/docs/store.md`)
— ONE document for the whole origin, holding the editor's `commands` beside the library's `engineId`.

That store **replaces wholesale** — a merge would make a field impossible to clear — which means
two settings that each PUT their own field erase each other. `src/prefs.ts` is the answer:
one holder for the whole document, `patchPrefs` for a change, and nothing else calls `savePrefs`.

Every other writer of the document — the editor's command preferences included — has to keep
the fields it does not know, for the same reason.

`RegistryClient` in `@studio/engine-browser` is generic in that shape (`P`), defaulted to
`{engineId?}`. The schema belongs to the host's backend; `Pl8Prefs` is the library's structural
view of the part of it the library reads.
