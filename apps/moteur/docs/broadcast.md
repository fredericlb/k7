# Broadcasting the master over the network

The plan's étape 7 — "le moteur traite et **diffuse**" — and the thing that will eventually
let obscura be hosted. Its instruction was explicit: **a throwaway mockup, not a design**,
and measure three things before committing to anything — end-to-end latency, the CPU cost
on the audio thread, and what happens when a listener drops.

This is the engine half. The browser half is `packages/engine-browser/docs/streaming.md`,
which holds the wire-format reasoning; this page is about what happens inside the engine.

> **Status: built, run, and measured.** See "What was measured" at the bottom for the
> numbers and the machine they came from. The one thing not covered by them is a *browser*
> listening — the measurements were taken by a headless Node client
> (`scripts/measure-broadcast.mjs`), which reads every number except "does it sound right
> to a human".

## Where the tap goes, and why there

`getMasterPluginList()`, appended (-1), right beside the master `LevelMeterPlugin` that
`buildLevelMeters` already puts there. That position is not a convenience — it is the
*only* place the outgoing mix can be read at all, for the reason `EngineHost.h` already
records about the meter: an output device carries no measurer in Tracktion, only inputs do.
So the signal leaving for the interface exists in exactly one readable spot, and both the
VU and the broadcast read it there.

`BroadcastTapPlugin` is transparent — it copies and passes through — and is the same shape
as `WaveformTapPlugin`, deliberately: that one has been in the chain for a long time and
works, so this borrows its structure rather than inventing a second one.

## Two channels, fixed

`BroadcastTap::CHANNELS` is a constant 2, not a count adopted from whatever buffer arrives.

That is a correctness decision, not a simplification. The ring interleaves, so the stride
is baked into every frame already written; a channel count that changed between a push and
a drain would have the reader deinterleave the backlog with the wrong stride and play it as
noise. Making it constant removes the race outright. Mono duplicates into both sides,
anything wider keeps the first two — which for a master bus is the pair that leaves.

## The ring, and why it overwrites

`BroadcastTap` is single-producer/single-consumer with a monotonic atomic write head, the
same shape as `WaveformTap`. The audio thread's rules are absolute: **allocate nothing,
block on nothing**. So the buffer is sized in the constructor and a reader that fell behind
is *overwritten*, never waited for. The alternative — making the audio callback wait on a
socket — is a dropout in every listener's monitors to save one listener's stream.

`drain()` reports how many frames it lost that way, and the sender turns that into a jump
in the sequence number, **rounded up**. That is how a listener learns it has a hole: TCP
loses nothing in flight, so a sequence gap always means *the engine decided to drop*. The
rounding matters — integer division would report a hole shorter than one frame as no hole
at all, which is precisely the case the field exists to signal.

Capacity is 16384 frames, about 340 ms at 48 kHz. After an overrun the reader resumes
`CAPACITY - MARGIN` behind rather than `CAPACITY` behind: landing exactly a full ring back
would put the read cursor on the very slots the audio thread is writing this block, so the
first frame after every overrun would be torn — a burst of noise in the one place the
protocol tries hardest to avoid one. The margin is four audio blocks.

The ring is owned by **`EngineHost`**, not by the plugin, and is declared *before* `engine`
in `Impl` so it is destroyed *after* it. Both are deliberate. A project apply destroys every
plugin on the edit, so a ring living inside the plugin would be pulled out from under the
sender thread on every save; and a ring declared after `engine` would be freed while audio
callbacks were still writing into it at shutdown. `EngineHostImpl.h` already says its
declaration order is load-bearing — this is one more entry on that list.

## The sender is its own thread, and that is not a preference

It started as a `juce::Timer` on the message thread — the simplest thing that could be
measured. Reading the actual IXWebSocket v12.0.1 sources killed that:

* `WebSocketServer` leaves `kSendTimeoutSeconds` at **-1**, and `connectToSocket` sets
  `_blockingSend = true` for every server-side socket.
* So `flushSendBuffer` loops on `isReadyToWrite(10)` with `timeoutSecs == 0` — that is,
  **forever**, until the socket errors or is closed.

Meaning: `sendBinary` does not return until the listener's TCP window drains, without any
bound. On the message thread, one suspended laptop parks the entire engine — no meters, no
transport, no project applies — and it reads as a hang with no visible cause. So the sender
is a `std::thread` in `main.cpp`, where the worst a stalled listener costs is that the ring
overruns and everyone gets a gap.

It wakes every 5 ms and drains **everything waiting**, not one frame per pass. An earlier
version took one 480-frame frame per 10 ms tick, which at 48 kHz is *exactly* the production
rate: zero headroom, so any late wake-up added backlog no later pass could work off, the
ring filled within a second and stayed full, and the result was a permanent 340 ms latency
with a third of the audio dropped for ever. A ceiling equal to the production rate is not a
ceiling, it is a leak.

**What this does not fix, and you should know before trusting it:** the JSON `broadcast()`
still sends from the message thread, and IXWebSocket holds a per-socket write mutex for the
whole of a send. A listener wedged in the audio path therefore still stalls the 20 Hz state
frame behind that same mutex. That hazard predates the stream — any client could always do
it — but a 3 Mbit/s subscriber turns it from theoretical into likely. Fixing it means giving
the JSON path a bounded send too. Measure first.

## Nobody listening means nobody pays

The tap is put on the master list for the first listener and taken off when the last one
goes. Uncompressed stereo float32 is ~3 Mbit/s, and the tray polls this port several times
a second on sockets it drops immediately — pushing audio at a `whoami` probe would be
absurd. Subscription is per-connection (`{type:"broadcast", on:true}`), tracked by pointer
against `server.getClients()`.

`broadcastWanted` outlives the plugin on purpose. A project apply rebuilds the edit and
every plugin on it, so the *wish* is what has to survive in order for `buildLevelMeters` to
reassert the tap. Without that, saving a file silences every listener — a fault nobody would
ever trace back to a save.

## What happens when a listener drops

The third thing the plan said to measure, and the one most likely to be got wrong.

The real answer is the dedicated thread above: the send blocks, so nothing else can be
allowed to depend on it returning. The `bufferedAmount()` check against
`kBroadcastMaxQueuedBytes` is a cheap extra, not the protection — after a *blocking* send
returns the tx buffer is empty, so it reads ~0 nearly every time.

Skipping rather than queueing is right, not merely cheap: audio is only worth sending while
it is still current, and a listener who was away wants to rejoin at live rather than receive
a backlog. The sequence gap tells them, and the browser re-cushions.

The `Close` handler removes the socket from the listener set *and* takes the tap off when
that was the last one. A closed tab never sends `{"broadcast": false}`, so without that the
engine would copy every block and encode a frame for nobody for the rest of its life, with
`buildLevelMeters` faithfully reasserting the tap on every apply.

Both the subscribe and the unsubscribe compute their wish and queue it **under one lock**.
Deciding inside the lock and posting outside lets two connection threads queue in the
inverted order — a departing listener's `false` landing after an arriving one's `true`,
silencing someone who is still there, with nothing to re-assert it.

The listener set is keyed by raw socket pointer, matched against `server.getClients()`. The
sender prunes entries that are no longer connected on every pass, so an address the
allocator reuses cannot inherit a subscription — otherwise one of the tray's several
probe sockets per second could be handed a 3 Mbit/s stream it never asked for.

At shutdown, `server.stop()` runs **before** the sender thread is joined. The sender may be
parked in a send with no timeout, and closing the socket is the only thing that unwedges
it; joining first would hang the engine on Ctrl-C. The thread is also created only *after*
a successful `listen()` — created before, the `return 1` on a port already in use would
destroy a joinable `std::thread` and turn a clean error exit into `std::terminate`.

## What was measured

`node apps/moteur/scripts/measure-broadcast.mjs ws://HOST:PORT [seconds]` subscribes,
decodes with the same `@studio/engine-protocol/stream` the browser uses, and prints the
numbers. It sends its own project first — a 4OSC holding a long note, so there is real
signal; an empty track proves only that silence is silent, since "the tap sees the master"
and "the tap sees nothing" produce identical all-zero frames.

Windows 11, Focusrite USB interface, loopback, 150 s:

| | measured | what it means |
|---|---|---|
| frames | 14998, **0 dropped, 0 undecodable** | the C++ and TypeScript encoders agree byte for byte |
| format | 48000 Hz, 2 ch | |
| realtime ratio | **0.9999** | the sender keeps up exactly; no backlog builds |
| bitrate | **3.10 Mbit/s** | as predicted for uncompressed stereo float32 |
| frames with signal | **14998/14998**, peak 0.51 | audio really flows, end to end |
| jitter spread | **2.22 ms** | a ~50 ms cushion is ample — 20× the spread |
| drift | **−0.46 ms/min** | ≈ 8 ppm |
| a listener killed mid-stream | engine RSS **+0.0 MB** over 20 s | no unbounded queue; the socket closes and the tap comes off |
| both departure paths | `listener gone (0 listening)` on close code 1005 **and** 1006 | a clean goodbye and a killed process both retire the tap |

### What those numbers decide

**Drift is the one that mattered, and it came back small.** −0.46 ms/min means a 50 ms
cushion survives about an hour and a half before it drains. So the answer to "resample,
rate-nudge, or WebRTC" is **none of them yet** — a cushion plus the existing re-cushion on
a gap is enough for a rehearsal or a set. That is a real decision, taken on a number
instead of on fear.

**One honest caveat on that figure.** It compares the engine's *sound card* clock against
the measuring process's *system* clock. In the real deployment the listener's playback is
driven by the listener's own sound card, so a second machine adds its own error — plausibly
tens of ppm. Read −0.46 ms/min as a floor for the same-machine case, not as the number for
two machines across a room. Measuring that properly needs the browser sink's `depth` trend
on a second machine, which is the next thing to do and cannot be done headlessly.

**Jitter at 2.22 ms vindicates the dedicated sender thread**, and by implication condemns
the `juce::Timer` it replaced — the message thread also builds plugins and applies
projects, and a 2 ms spread would not have survived that.

**CPU on the audio thread** was not separately profiled. The realtime ratio of 0.9999 with
zero overruns over 150 s says the copy is not costing anything visible, which is the
question that mattered; a profiler pass is still the honest way to put a number on it.

### Still unmeasured

* A real browser as the listener — the `AudioWorklet` path has unit tests behind it but has
  never played a sound.
* Two machines, i.e. the drift figure that actually governs the design.
* Sustained multi-listener load, and the JSON-broadcast stall described above.

## What is deliberately absent

* **No compression.** Opus would fold its own latency and CPU into every measurement above,
  which is exactly what a transport measurement must not include. The frame header carries
  a `codec` byte and decoders reject unknown ones, so adding it later is not a flag day.
* **No drift correction**, for the reason in the browser doc: which fix is right depends on
  how much drift there is, and that is measurement 5.
* **No authentication of its own.** The stream rides the existing socket and inherits
  exactly what that socket already has, which is the engine token echoed on `whoami` — and
  no more. Worth saying plainly: anyone who can reach the port can listen to the room.
  Acceptable on loopback and on a trusted LAN, which is where `LANES_ENGINE_HOST` puts it
  today, and **not** acceptable the day this is exposed further.
* **No multi-device output.** Master plus a headphone cue, which platines will need, is a
  separate chantier from this one and the plan keeps it separate.
