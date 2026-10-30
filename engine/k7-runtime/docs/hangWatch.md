# A hung engine leaves

A plugin hung in `processBlock` holds the device lock. The next message-thread job that needs that
lock waits behind it — a rebuild, the abandoned-session sweep, a device reopen — and from then on
no apply, no transport, no state frame goes anywhere, for every session. `whoami` is answered on
the socket's own thread, so the engine still looks alive from outside. Nothing in the process can
free the audio thread, and nothing waiting on the message thread can notice that it waits.

## The watch has a thread of its own

`HangWatch.h` reads two clocks once a second from a `std::thread` that touches nothing else:

- **the audio callback's entry stamp** (`te::studioCallbackEnteredMs`, a fetch-time Tracktion patch,
  `docs/audioDevice.md`) — a callback inside for `kStuckCallbackMs` (10 s) is hung;
- **the message thread's heartbeat**, which the state timer stamps on every tick — silent for
  `kStuckMessageThreadMs` (60 s) means the thread is wedged.

Either one, and the engine says which on stderr and leaves with exit code 5, for the supervisor to
start a fresh one; `std::_Exit`, since unwinding would join a thread that never returns. Inside an
app (`STUDIO_ENGINE_IN_APP`: Android, iOS), where leaving takes the app with it, it warns once per
hang instead.

60 s for the message thread because it legitimately stalls for seconds: a first `applyFull`
instantiating every plugin, a Faust compile. Plugin scans and probes run elsewhere (a child process,
the detached work threads), so nothing expected comes near a minute.

The check that the callback is merely BUSY — inside for half a second, so a device reopen is not
tried — stays in `checkAudioCallback`, on the message thread: it decides about a reopen, which is
that thread's.

## A process that slept is not hung

A laptop lid or an iOS suspension stops every thread, the watch's included, and a millisecond
counter that runs through the sleep makes both clocks look ancient on waking. So the watch times its
own looks with the same counter: one that comes five seconds late means the process slept, and the
next ten looks are skipped while the other threads catch up.

## The supervisor restarts one that cannot leave

`whoami` carries `messageThreadMs`, the heartbeat's age, read from an atomic so the socket thread can
answer it. The supervisor asks every 10 s and kills an engine it owns once that age passes 90 s —
longer than the engine's own bound, so it acts only where the engine could not
(`engine/k7-supervisor/docs/crashLoop.md`).
