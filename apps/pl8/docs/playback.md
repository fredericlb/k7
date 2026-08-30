# Two records, and the trap between them

The médiathèque is **hosted**; the engine opens **paths on its own machine** and cannot fetch a
URL. What plays is therefore never the bytes this screen lists: it is the copy in the chosen
machine's cache, reached through that machine's file service.

That is the easiest fact in this whole service to forget, and it holds for everything an engine
plays for the médiathèque — a track, a variant.

| what | from where | why |
|---|---|---|
| the audio | the engine machine's cache (`/mediatek` → `root`, plus the entry's path and `meta.master`) | the engine opens it as a file |
| what is listed on screen | the hosted library | it is DATA, and it is the same on both sides |

`cacheRoot` asks the machine for its root, `playablePath` glues it to the entry's path, and
`cachedOnMachine` answers "does this machine have it" with a `Range: bytes=0-0` — one byte, not
the file, because asking must cost less than being wrong.

A cache root is not a copy. Only `modules` are pulled automatically
(`packages/file-service/src/mediatekPull.ts`); a track is on a machine because something put it
there, and on a fresh machine it simply is not. The engine would then open nothing and play
silence, the one failure a transport cannot report. Hence the probe — and hence **every** refusal
reading as absent: treating an unreachable machine as "present" would bring the silence back.

## What the button says when it cannot play

It stays greyed and its tooltip says which of the three reasons applies:

- **no engine** — nothing chosen, or nothing answered the probe;
- **this machine has no médiathèque cache** — the file service answered but holds no library;
- **this track has no audio file** — a folder with a sidecar and no master, which is a real state
  (a mirror stopped halfway, a hand-made folder) and not a fault to hide.

The distinction matters because the three are fixed differently, and a plain grey button invites
guessing. `playablePath` returns `null` for a REAL state and not for a swallowed error: a track is
a folder, and a folder carrying a sidecar with no audio has nothing to play. The service reports a
native root (`C:\…` or `/home/…`) while entry paths are POSIX, and the engine accepts both — so
they are joined with a separator chosen from the root rather than normalised into a form this app
has no business deciding.

## The document

`songPreviewDoc` is **one track, one clip**: the file as it is. Nothing else.

`recordDir` stays empty — a preview plays and never records, and an invented folder is a folder
the engine would eventually write into.

One document builder, then, and it is the degenerate case: what the médiathèque plays is always a
file. A chain is written in st0 and committed to the account's libraries repository, where the
engine playing the song already loads it.

## One session, one sound

The preview goes out on `SESSIONS.pl8`, per service **and** per person. Playing something
therefore replaces whatever that session held. That is deliberate: making an engine play two
things at once is not something to organise, it is something to forbid.

## The two headers the machine demands

`apps/pl8/frontend/src/engine/songPreview.ts` sends the user **and** the token on every call to a
machine's file service. The token is not optional in practice: anything behind
`requireEngineToken` is refused without it as soon as a token is configured — which the supervisor
always does on a real machine. A call sending only the user works on a bare dev run and answers
401 everywhere else; `cacheRoot` swallows that 401 as `null`, which the screen words as "this
machine has no médiathèque cache" — plausible, and false, which is exactly how a missing token
hides.

The token is **omitted** when there is none: a machine that configures no token keeps none, and
adding an empty header would fail a comparison that passes.

`bounce` is the **offline** render (`--render`) and not the transport: it opens no audio device,
so it cannot collide with an engine that is playing — which is what makes "process every variant"
launchable while you listen to one. `format: mp3` is a **request** and not a guarantee: the engine
writes wav, mp3 is an ffmpeg transcode on that machine at best. What comes back says which, by its
content type, because filing a wav under `.mp3` produces a library of files that lie about
themselves.

## The transport sits above the screens

`apps/pl8/frontend/src/playback/PlaybackProvider.tsx` holds what is playing, and it holds the
tab's **only** engine socket. One socket per screen would only be safe if screens replaced one
another, and a track that keeps playing while you navigate breaks exactly that arrangement: its
transport has to outlive the screen that started it, and a second socket would be a second client
on the same session, driving the same document.

The `<audio>` element stays mounted whatever the destination, including when the engine or mpv is
playing: it is what reports the master's **duration** — the engine's state frame carries a
playhead and no length — and keeping it here is what lets a track outlive its screen. When mpv
plays, its own duration wins: it has already read the file.

What is loaded is identified by a **path**, never a name: two tracks can share a name, not a path.
And the document name sent to the engine carries the variant (`track · instrumental`), because the
session is shared with everything pl8 auditions — two versions of a track under one name are two
indistinguishable lines in its log.

## Knowing a track ended by itself

The three destinations do not say so the same way, and a queue must only advance on a real end:

| destination | signal | what to make of it |
|---|---|---|
| the browser | `onEnded` | exact: it only fires for an end |
| the engine | `playing` goes false | ambiguous: that is also what a requested stop does |
| mpv | `idle` | plain, but a requested stop looks like it too |

Hence the `weStopped` flag, set by **every** deliberate transition (start, toggle, close) and
cleared by the effect that reads it. Without it, pressing pause chains to the next track.

`ended` is a **counter** and not a boolean: what a player wants is the event, and a flag would
have to be cleared by whoever saw it. It exists only for the queue, the one thing here with a
"next". `now` is deliberately not cleared at the end — "what did I just listen to" outlives the
last sample — and only the bar's close button clears it.

## The three positions

- The browser is tracked in `requestAnimationFrame` while it plays: `timeupdate` only fires about
  four times a second, which reads as stutter on a waveform.
- The engine pushes its frame fast enough to need no loop; what is kept aside is **where it was
  asked to be**, because between the request and the first frame (~20 Hz) that is the only honest
  answer.
- mpv is **polled** twice a second: it is elsewhere and has no way to push its position here. A
  missed tick is silent — a busy machine is not an error to show someone who is listening. Cursor
  movement is optimistic and the next tick tells the truth: waiting for the round trip would make
  the cursor jump back under the mouse.

Past the end, neither mpv nor the engine rewinds by itself — mpv is `idle`, the engine replays
nothing — so the button asks for the file again from zero. The `<audio>` element rewinds on its
own, which is exactly the behaviour a bar that outlives a track needs.

A document the session never held needs a `reset` before being sent: an apply is a diff, and a
diff cannot remove a plugin the engine's stored document never mentioned.
