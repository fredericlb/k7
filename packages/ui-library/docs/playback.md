# Two records, and the trap between them

The médiathèque is **hosted**; the engine opens **paths on its own machine** and cannot fetch a
URL. What the moteur plays is therefore never the bytes this screen lists: it is the copy on the
chosen engine's machine, which the backend puts there first.

That is the easiest fact in this whole service to forget, and it holds for everything an engine
plays for the médiathèque — a track, a variant.

| what | from where | why |
|---|---|---|
| the audio | the engine machine's copy of the médiathèque, answered by `POST /api/engine-local` | the engine opens it as a file |
| what is listed on screen | the hosted library | it is DATA, and it is the same on both sides |

`localPathOn` (`src/engine/enginePlayback.ts`) asks the backend where a song is on the
chosen engine's machine; the backend brings the song there through the engine's tunnel and answers
with the MACHINE's own path (`apps/k7/backend/src/media/routes/engineLocal.ts`). A song is on a machine because
it was asked for, the first time it is played there, and stays for the next time.

## What it says when it cannot play

The question runs **before the document goes**, in `PlaybackProvider` and nowhere else — an
unopenable clip plays silence, the one failure a transport cannot report — and each way it can
fail gets its own sentence on the transport's `error`:

- **no engine answered** — no engine chosen, or one with no tunnel to this server;
- **this track is not in the médiathèque** — nothing to bring;
- anything else, in the server's own words.

They are fixed differently, and a single "cannot play" invites guessing. The path comes back in
the machine's own spelling (`C:\…` or `/home/…`), and nothing here rewrites it.

Asking in ONE place is the point: every screen that starts a song would otherwise ask again, and
each copy is a place the trap can be forgotten.

## The document

`songPreviewDoc` is **one track, one clip**: the file as it is. Nothing else.

`recordDir` stays empty — a preview plays and never records, and an invented folder is a folder
the engine would eventually write into.

One document builder, then, and it is the degenerate case: what the médiathèque plays is always a
file. A chain is written in k7 into a library folder by an admin, from whatever project
they have open — the engine playing the song already loads it.

## One session, one sound

The preview goes out on `SESSIONS.pl8`, per service **and** per person. Playing something
therefore replaces whatever that session held. That is deliberate: making an engine play two
things at once is not something to organise, it is something to forbid.

## Say where to start, always

`EngineHost::play` repositions the playhead only when the transport is **looping**; otherwise it
resumes from wherever it was left. And a session outlives the documents put through it — it is
keyed by service and person, not by what is loaded — so the playhead sitting there belongs to
whatever this account last auditioned on that machine, very likely a longer song.

Send a master and press play with no position, and the transport rolls from a point past the end
of the clip. `playing` is true, the playhead advances, the meters move, and there is **no sound** —
a failure whose only symptom is the absence of one.

So `play(doc, fromSeconds)` takes the position, between the document and the verb: the position
belongs to the document just applied, and asking for it after `play` would be heard as a jump. The
document goes FIRST for the same family of reasons — a transport verb sent first plays whatever
the engine still had loaded, which is a second of the wrong sound before the right one.

## A clean edit, because an apply is a diff

An apply is a **diff**, and a diff can only remove what the engine's stored document says is
there. An edit holding a plugin that document does not mention is therefore unreachable —
`needsFullRebuild` never fires, nothing rebuilds, and the plugin stays for the life of the
session, which means until the engine process exits.

The symptom is silence while everything reports fine. Asking the running moteur reads
`sessions` → the song's own project name, `playing: true`; `edit-plugins` → a plugin from some
other audition still on the track; `state` → `levels: [-100]` while rolling. Sending a document
with `plugins: []` does **not** remove it; `drop-session` does, and the identical document then
plays at −25.8 dB.

**What is not established**: how the edit comes to hold a plugin its document does not. On a fresh
session the removal works correctly, so this is a state the engine can reach and cannot leave, by
a path nobody has identified. `reset()` makes the library immune to it rather than fixing it, and the
engine-side inconsistency is still worth hunting.

## The warning channel is the only account of silence

A document naming a file the engine cannot open — absent, or in a format that build has no reader
for — raises `clip source not found/invalid: <path>` and then plays SILENCE. Silence is the one
failure a transport cannot report by itself, so `onWarning` is the only account of it and dropping
it is expensive. It lands on the transport's `error`, which the mini player and the song's pane
already draw, and it is cleared when a document is **SENT** rather than on stop — a complaint
raised by that send has to survive long enough to be read.

The playhead is qualified the same way and for a related reason. That session is shared with
everything else the library auditions, so an unqualified read would draw another document's position on
this song's waveform — and, worse, hand it back as the point to resume from, which is the section
above with extra steps. `loadedEnginePath` is what makes "is this ours" a question with an answer,
and it is cleared for the length of the question above: nothing of ours is loaded while it is
outstanding.

## The transport sits above the screens

`src/playback/PlaybackProvider.tsx` holds what is playing, and it holds the
tab's **only** engine socket. One socket per screen would only be safe if screens replaced one
another, and a track that keeps playing while you navigate breaks exactly that arrangement: its
transport has to outlive the screen that started it, and a second socket would be a second client
on the same session, driving the same document.

The `<audio>` element stays mounted for the engine as well as for the browser, silent in the first
case: it is what reports the master's **duration**, the engine's state frame carrying a playhead
and no length.

What is loaded is identified by a **path**, never a name: two tracks can share a name, not a path.
And the document name sent to the engine carries the variant (`track · instrumental`), because the
session is shared with everything the library auditions — two versions of a track under one name are two
indistinguishable lines in its log.

## Knowing a track ended by itself

The two destinations do not say so the same way, and a queue must only advance on a real end:

| destination | signal | what to make of it |
|---|---|---|
| the browser | `onEnded` | exact: it only fires for an end |
| the engine | `playing` goes false | ambiguous: that is also what a requested stop does |

Hence the engine's "we stopped" flag, set by **every** deliberate transition (start, toggle) and
cleared by the effect that reads it. Without it, pressing pause chains to the next track.

`ended` is a **counter** and not a boolean: what a player wants is the event, and a flag would
have to be cleared by whoever saw it. It exists only for the queue, the one thing here with a
"next". `now` is deliberately not cleared at the end — "what did I just listen to" outlives the
last sample — and nothing clears it but the next song started.

## The two positions

- The browser is tracked in `requestAnimationFrame` while it plays: `timeupdate` only fires about
  four times a second, which reads as stutter on a waveform.
- The engine pushes its frame fast enough to need no loop; what is kept aside is **where it was
  asked to be**, because between the request and the first frame (~20 Hz) that is the only honest
  answer. It is read only while `loadedEnginePath` says the document on that machine is ours.
Past the end, the engine does not rewind by itself — it replays nothing — so the button asks for
the file again from zero. The `<audio>` element rewinds on its
own, which is exactly the behaviour a bar that outlives a track needs.

A document the session never held needs a `reset` before being sent: an apply is a diff, and a
diff cannot remove a plugin the engine's stored document never mentioned. `lastSent` is what makes
that "never held" precise — a pause and a resume of the same file must not rebuild the edit under
the transport.

## The position is not in the context

`usePlayback()` carries what plays and how to drive it; WHERE the transport is lives in a store of
its own (`src/playback/position.ts`), read with `usePlaybackPosition()`. The position moves up to
60 times a second, and a value in the context re-renders every consumer of it — the library with
its tree, the playlists, the queue — none of which draws a playhead. Only
the bar and the open song's waveform read the store, and the waveform reads it only while its own
version is the one playing.

Every source writes into that store and none into React state: the browser's animation-frame loop
and the engine's frames, which `useSongEngine` hands to a callback instead of holding —
a playhead in its state would re-render the provider twenty times a second for nothing. The store
drops a write that changes nothing, so a frame repeating the same duration notifies nobody.
