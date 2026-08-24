# meterClients.md — level measurers, their clients, and who clears what

Every meter in this engine is a `te::LevelMeasurer` with one or more
`te::LevelMeasurer::Client`s hung off it. A measurer takes as many clients as it is given and
each keeps its **own** accumulator — which is what makes per-track meters work, and what the
rules below all follow from. The state they live in is `Session` / `EngineHost::Impl`
(`EngineHostImpl.h`).

## Reading a client CLEARS it

`getAndClearAudioLevel` and `getAndClearOverload` both clear what they read. Two readers sharing
one client therefore **steal each other's measurements**: whoever asks first gets the peak and the
other gets silence.

That is why the master meter carries two clients:

| client | read by |
|---|---|
| `masterClient` | `io-levels` — the I/O panel, on demand |
| `masterStateClient` | the ~20 Hz state frame every surface watches |

Anything that becomes a second consumer of an existing meter needs its own client, not a share.

## Output meters are rebuilt with the Edit; input meters are not

**Per-track output metering** is a post-fader `LevelMeterPlugin` per track plus a client we poll,
indexed by track (`levelMeters` / `levelClients`), and the same pair for the MASTER plugin list —
the signal actually leaving for the interface. The master's is separate because the master is not
one of the audio tracks and its meter has to survive being asked for on its own.

All of it dies with the Edit, so `detachLevelMeters()` removes the clients **before** the old
Edit's measurers are torn down. Otherwise the audio thread touches a freed client.

**Per-input metering** is engine-level: the devices outlive every Edit, so those clients attach
lazily on the first poll of a track fed by that device and stay for the engine's life, reading the
live signal used for monitoring and recording.

## Input clients are keyed by device NAME, never by pointer

Any change to the wave-device list — enabling a channel is enough — **destroys every
`WaveInputDevice` and builds new ones** (`docs/audioDevice.md`). Keyed by pointer, `inputClients`
would hold keys into freed memory, grow a second client on every rebuild, and have nothing left to
read the level through.

So the key is the name, and the slot also records `dev`, the object the live client is attached
to. `inputClientFor` compares it: a rebuilt device is a new object carrying a new measurer, so the
old client is **dropped rather than removed** — the measurer it belonged to is already gone, and
removing from it would be a read of freed memory.

`detachInputClients()` (from `~EngineHost` only) applies the same rule at shutdown: it removes
clients only from devices that are **still there**, checked against
`getWaveInputDevices()`. Without that check, a client orphaned by an earlier list rebuild produces
a crash on exit that gets blamed on whatever ran last.
