# The recorder node

A **tape machine you drop in a chain**: one audio in, one audio out, and what passes through it
is unchanged. `RecorderPlugin` is transparent, exactly as `BroadcastTapPlugin` is, and for the
same reason — the capture is a side effect, not a detour the signal takes.

It is **free-running**. Press record and it captures; press again and it stops. The transport is
never consulted, and that is the whole point: a `live` rig has no arrangement and never presses
play (`packages/song/docs/liveProject.md`). This is what track-and-transport recording
(`Recording.cpp`) has no answer for.

The browser half is `packages/song/docs/recorderNode.md`; this page is the engine's.

## Where the audio is copied, and by whom

Three files, and each is the twin of one beside it:

| here | its twin | differs in |
|---|---|---|
| `RecorderTap.h` | `BroadcastTap.h` | an overrun is COUNTED, below |
| `RecorderPlugin.{h,cpp}` | `BroadcastTapPlugin.{h,cpp}` | the DOCUMENT declares it, so it is created by the plugin cache like any module |
| `Recorder.cpp` | `Recording.cpp` | an `EngineHost` member file, for that file's reason |

`RecorderNode.h` holds one node's state — its ring, the take being written, the takes finished.

## An overrun is COUNTED, not forgiven

This is the one line where the two rings differ, and it is why there are two.

`BroadcastTap` forgives an overrun: a listener wants **now**, so it resumes near the live edge and
the past is not worth mentioning. A recording is the opposite — everything still in the ring
belongs to the take — so this one drains everything available and CATCHES UP rather than skipping
forward, and when the writer genuinely laps the reader it records `lostFrames`.

The take is then reported `damaged`. **A file that is silently short is a file you trust**, and
the failure is invisible by construction: nothing about the wav says frames are missing, and the
only thing that ever knew is the ring that dropped them.

The ring is four times the broadcast's — 65 536 frames, ~1.4 s at 48 kHz — because a disk write
can stall far longer than a socket send.

### It keeps the MARGIN, and that is not the same decision

A lapped reader still resumes `MARGIN` frames behind the write head, exactly as the broadcast tap
does — and this was the one thing removing "the skip" got wrong at first. The slots nearest the
write head are the ones the audio thread is filling *right now*; copying them yields a frame whose
two sides came from different moments. A **tear**, in the file, that nothing reports — which is
the failure the counting was supposed to make impossible.

So the margin's frames are lost too, and counted with the rest. The claim is that the count is
honest, never that it is minimal.

It narrows the window; it does not close it against a writer running at memory speed, and no ring
arithmetic would. What closes it is the rate: an audio thread delivers 256 frames every ~5 ms, so
a reader keeping up is thousands of frames from the head. `the_two_threads_do_not_tear` PACES its
writer for that reason and says so — an unpaced version failed one run in five, which is how the
margin was found.

`tests/RecorderTap_test.cpp` is the fifth fast suite (JUCE-free, links nothing), and the overrun
case is the one that cannot be checked by looking.

## The ring belongs to the SESSION, not to the plugin

A `ProjectDoc` apply can rebuild a track's plugin list, destroying and recreating the
`RecorderPlugin` in the middle of a take. So the ring lives in `Session::recorders`, keyed by
plugin id, and the plugin holds only an atomic pointer at it. `attachRecorderTaps` re-points every
recorder after each build — called from `applyProject` right after `buildLevelMeters`, which
reasserts the broadcast tap for the same kind of reason.

A node that leaves the document takes its ring with it, **unless it is recording**: a rebuild
mid-take must not lose the file.

## The state tick IS the writer thread

There is no writer thread. `pumpRecorders` runs on the ~20 Hz state tick, drains each recording
ring and writes it out — a few thousand frames per pass, on the message thread, which already
does file work elsewhere.

The trade is stated rather than hidden: **a slow disk delays the state frame** instead of
delaying a dedicated thread. The 1.4 s ring absorbs a hiccup, and a genuine stall becomes
`lostFrames` — reported, which is what the design is for. A thread of its own would need the
session map under a lock, and the lock would be the new hazard.

### The idle short-circuit had to learn about it

`StateTimer` skips the whole pump when a session looks idle — not playing, not record-enabled,
no armed track, every meter silent. **That is exactly what a rig capturing looks like**: free
-running means the transport is stopped and nothing is armed. Without `anyRecording()` in that
test the ring is never drained, laps within a second and a half, and the take is lost while
every light says it is recording.

## What the wire carries

```
{ type: "recorder", node: "<chain>:<module>", action: "record" | "clear", on?: boolean }
```

`on` omitted toggles **that node** — `anyRecording` is the wrong question for a toggle and would
flip the wrong one the moment a project has two. There is no reply on success: the state frame
carries the light at 20 Hz, and a reply would be a second answer racing it. A refusal is an
`error` message, as `arm` sends.

Back, on every state frame:

```
recorders: { "<chain>:<module>": { recording, seconds, takes: [{file, seconds, damaged}], envelope, from } }
```

`envelope` is the points made **since the last frame** — the same drain contract the waveform tap
has, at a coarser bucket (4096 samples, ~12 points a second). The client appends;
`packages/engine-browser/src/takeEnvelope.ts` is what knows when to throw the total away — and it
sits beside the STORE rather than beside the card, for the reason the next section gives.

### …and `from`, which is what makes a RELOAD work

`recording`, `seconds` and `takes` are absolute in every frame, so a page that just opened has
them within 50 ms. The picture is the one thing that is not: a client that joins mid-take has
none of what came before, and the frames only carry what is new. Reloading drew a take that
looked like it had started at the reload.

So the node **keeps the whole take's envelope** rather than moving it out on each drain, and
`from` says where the frame's points sit in it. When a socket subscribes to a session —
`subscribers.emplace(...).second`, in `server/main.cpp` — every recorder in it is rewound, and the
next frame carries the picture from 0.

That resend reaches **every** subscriber of the session, not just the new one, which is exactly
why `from` is a number and not a flag: a client further along keeps what sits before the frame's
stretch and takes the frame's word for the rest, so the resend costs it nothing. The same
arithmetic covers an ordinary append and the overlap in between — one expression, three cases.

An hour of recording is about 42 000 points, 340 kB. That is the price of the whole picture being
answerable at any moment, and it is the right one: the alternative is a request/reply the client
has to know when to send.

There is deliberately **no `save` action**. The engine's job ends at a wav on disk; sending it
anywhere is the file service's, which runs on the machine the file is on.

## Where a take lands

`<recordDir>/<node>-<stamp>.wav`, 32-bit float at whatever rate the samples are actually at.
`recordDir` is the document's — the same directory transport takes go to — which is what lets the
file service check a path a browser hands it (`packages/file-service/src/recorderSave.ts`).

Float, and not converted here: a take is raw capture, and a bit depth is a decision the person
saving it has not made yet.

A take is closed on stop, and `clear` deletes the file of the one it pops.

## Two refusals worth their sentences

- **`"<node>" has not carried audio yet`** — the plugin publishes the sample rate from
  `initialise`, so a node that has never been prepared has none, and a wav header written from
  zero is a file that plays at the wrong pitch for ever.
- **`no record directory`** — the project cannot record at all, which is a fact about the
  document rather than about the node.
