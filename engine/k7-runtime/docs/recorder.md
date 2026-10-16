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
`RecorderWriter.h` is the thread that writes every node's take (below).

## An overrun is COUNTED, not forgiven

This is the one line where the two rings differ, and it is why there are two.

`BroadcastTap` forgives an overrun: a listener wants **now**, so it resumes near the live edge and
the past is not worth mentioning. A recording is the opposite — everything still in the ring
belongs to the take — so this one drains everything available and CATCHES UP rather than skipping
forward, and when the writer genuinely laps the reader it records `lostFrames`.

The take is then reported `damaged`. **A file that is silently short is a file you trust**, and
the failure is invisible by construction: nothing about the wav says frames are missing, and the
only thing that ever knew is the ring that dropped them.

The ring is 2^20 frames — ~21.8 s at 48 kHz, ~10.9 s at 96 kHz, 8 MiB per recording node. What
drains it is a thread of its own (below), so the ring is sized for that thread falling behind: a
disk that stalls — a USB stick, a network folder, a phone's flash under load — or a machine so busy
the writer is not scheduled. Ten seconds at the highest rate a device opens here is the margin; the
cost is memory, a few megabytes per node, against a take lost to a slow disk.

### It keeps the MARGIN, and that is not the same decision

A lapped reader still resumes `MARGIN` frames behind the write head, exactly as the broadcast tap
does — and this was the one thing removing "the skip" got wrong at first. The slots nearest the
write head are the ones the audio thread is filling *right now*; copying them yields a frame whose
two sides came from different moments. A **tear**, in the file, that nothing reports — which is
the failure the counting was supposed to make impossible.

So the margin's frames are lost too, and counted with the rest. The claim is that the count is
honest, never that it is minimal.

The margin covers the block being written when the reader STARTS. A reader pre-empted mid-copy
can be lapped while it reads, so `drain` loads the head again after the copy, and every frame that
has fallen further than `SAFE` behind it is zeroed and counted as lost: it may hold half of a newer
block. `MARGIN` is 4096, above the largest block any device opens here (Android's 40 ms cap at
96 kHz is 3840 frames). `the_two_threads_do_not_tear` PACES its writer, because the rate is what
keeps a real reader thousands of frames from the head — an unpaced version failed one run in five,
which is how the margin was found.

`tests/RecorderTap_test.cpp` is the fifth fast suite (JUCE-free, links nothing), and the overrun
case is the one that cannot be checked by looking.

## A node that leaves mid-take has its take FILED

A stop is answered by the NODE, not the plugin, so a recorder whose plugin left the document can
still be stopped. `attachRecorderTaps` runs after every apply, incremental or full, and a node that
is gone while still recording is stopped there — its take closed, named and listed — then kept one
more pass so the state frame reports that take before the node goes. Nothing can feed its ring
again, so leaving it recording would only have kept the session awake with a file never finished.

## The ring belongs to the SESSION, not to the plugin

A `ProjectDoc` apply can rebuild a track's plugin list, destroying and recreating the
`RecorderPlugin` in the middle of a take. So the ring lives in `Session::recorders`, keyed by
plugin id, and the plugin holds only an atomic pointer at it. `attachRecorderTaps` re-points every
recorder after each build — called from `applyProject` right after `buildLevelMeters`, which
reasserts the broadcast tap for the same kind of reason.

A node that leaves the document takes its ring with it, **unless it is recording**: a rebuild
mid-take must not lose the file.

And not AT ONCE. An incremental apply removes the plugin from the Edit, but the playback graph the
audio thread is running still holds it until Tracktion swaps a new one in, and a free-running
recorder writes into its ring on every block of that window, transport stopped or not. Freeing the
ring in the same message-thread job is a write into freed memory. So the node is parked in
`retiredRecorders` and freed by the state tick two seconds later — a graph swap takes a few
blocks. The parked nodes are declared beside the live ones, before the Edit, so a session that dies
frees them after the graph.

## A take is written by a thread of its own

`RecorderWriter` is one thread per engine. While a take records, its node is REGISTERED with the
writer, which drains every registered ring about fifty times a second, each until it is empty, and
writes it to the take's wav. The message thread only starts and stops takes and reads what the
state frame reports.

It cannot share the message thread, because that thread stalls for whole seconds — a first
`applyFull` instantiating plugins, a Faust compile — and a take drained there laps its ring during
any stall longer than the ring, and adds a disk write to every state tick besides.

**The writer holds the nodes, never the session map.** A node is shared between its session and the
writer, so nothing the writer touches can be freed under it, and no lock covers the sessions.
Ownership is one rule: a node is the writer's while registered and its owner's once `remove()` has
returned — `remove()` waits for a pump in progress and guarantees none starts after. So a stop
removes the node, then drains what is left in the ring itself and closes the file, on the message
thread, with nobody else touching it. A start opens the file first and registers the node after.

What both threads read is atomic — the frame count, `damaged`, a refused write — or the take's
picture, under a mutex the writer takes only to append points, never across a disk write: a state
tick never waits on the disk.

A session that is dropped takes its nodes back from the writer first, so a take still recording
there is closed with the session rather than outliving it; the writer is joined before the sessions
are destroyed. `tests/RecorderWriter_test.cpp` checks the ownership rule and the shutdown.

### The idle short-circuit knows about it

`StateTimer` sends one frame in five when a session looks idle — not playing, not record-enabled,
no armed track, every meter silent. **That is exactly what a rig capturing looks like**: free
-running means the transport is stopped and nothing is armed. `anyRecording()` is in that test so
a take's clock and picture keep their 20 Hz; the writing does not depend on the tick.

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
`subscribers.emplace(...).second`, in `server/Serve.cpp` — every recorder in it is rewound, and the
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

A take started in the same second as another one gets a sibling name rather than the same one:
JUCE opens an existing file for APPENDING, so a second take would land after the first one's bytes
and neither would read.

A take is closed on stop, and `clear` deletes the file of the one it pops. It pops a take being
WRITTEN too, stopping it first — the stop files the take, so there is always one to pop, and the
open writer never outlives the file it points at.

## A take survives a crash, and a full disk says so

A WAV header holds the length, and JUCE writes it only on `flush()` and when the writer closes. A
take whose header was never rewritten reads as EMPTY after a crash, a kill by the supervisor or the
fast exit at quit — however long it ran. So the writer flushes about once a second: the header is
rewritten and the stream goes back to where it was, and a crash loses at most that last second.

A write the disk refuses — full, or the folder gone — is refused for every later write too. The
take is then closed where it stood, marked `damaged`, a warning names the file, and the state
tick stops the node, so the take is filed with what it holds. Counting frames after a refused
write would show a clock running over a file that stopped growing.

A take also outlives its tab. A session whose last driver left is let go after a grace period
(`docs/sessions.md`), but never while anything in it records: a locked phone or a dropped network
must not end a take — what was recorded would stop, and the take would resume later with the gap
cut out and nothing marking it.

## Two refusals worth their sentences

- **`"<node>" has not carried audio yet`** — the plugin publishes the sample rate from
  `initialise`, so a node that has never been prepared has none, and a wav header written from
  zero is a file that plays at the wrong pitch for ever.
- **`no record directory`** — the project cannot record at all, which is a fact about the
  document rather than about the node.
