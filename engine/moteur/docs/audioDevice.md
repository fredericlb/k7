# Which interface the engine plays through, and who remembers it

The engine opens no interface of its own accord — AGENTS.md ("The audio device is opened
ONCE, explicitly") says why, and that decision stands. This page is the other half of it:
**something else has to remember the choice**, and for a while nothing did.

## The symptom, and why it hid

Recording monitoring in l8 was suddenly unusable: arm an audio track, roll the transport,
and the sound of the instrument came back a long way behind the hand playing it. Playback
of a mix was fine. That asymmetry is the whole diagnostic — an interface only costs you
latency in the direction you can hear it, and playback has nothing to be late against.

What the running engine reported:

```
[device] 'Haut-parleurs (Focusrite USB Audio)' open: 2 in, 2 out
whoami: bufferSize=256 sampleRate=48000
```

and the same machine's device list:

```
  [ASIO]          Focusrite USB ASIO                       20 in, 8 out
* [Windows Audio] Haut-parleurs (Focusrite USB Audio)       2 in, 2 out
```

So the engine was on the **Windows shared endpoint** of the interface, not its ASIO
driver. Two things follow, and only the first is obvious:

* The shared endpoint is the Windows mixer, so the round trip includes the mixer's own
  buffering in both directions. It is several times an ASIO driver's, which is what
  "monstrous" was.
* **`bufferSize` reported 256 either way.** The engine's quality band (`audioTiming` →
  `packages/web-protocol/quality.ts`) is computed from buffer and rate, and both are
  identical on the two devices. The badge therefore said ~10 ms while the truth was
  several times that. The buffer size is not the latency, and nothing on the wire
  currently carries what JUCE does know (`getInputLatencyInSamples`,
  `getOutputLatencyInSamples`) — a known gap, listed below.

The channel counts are the cheap tell: an interface that says `2 in, 2 out` when it has
twenty inputs is not being addressed as itself.

## How it ends up there

`openAudioDevice()` calls `dm.initialise(512, 2)` and takes what JUCE's default device
type offers, which on Windows is the shared WASAPI endpoint of the default output. That
is the correct behaviour for a machine nobody has expressed a preference about. It is only
wrong when a preference exists and is not applied.

## Three places could remember, and they are not interchangeable

| where | who writes it | who applies it | when |
|---|---|---|---|
| `~/.studio/preferences.yaml` (`audioDevice`) | the machine's file service — `PUT /preferences/audio-device` | `engineLink.wireEngine`, on the socket's `open` | the first socket any session opens, and every reconnect after — so every engine restart, before anything plays |
| `~/.studio/engine-tray.json` (`audioDevice` / `audioFallback`) | the tray's audio submenu | the supervisor's `audioPolicy` | continuously — it also RE-selects the device when it is replugged |
| `%APPDATA%/Studio/Settings.xml` | Tracktion, by itself | nobody | never — inert on purpose, see AGENTS.md |

The hole was in the first row's second column. `preferences.yaml` has held an
`audioDevice` field all along and `engineLink` has always replayed it, but the only thing
that ever WROTE it was a CLI (`l8 config --set interface`) that no longer exists in this
repo — `packages/song/src/preferences.ts`'s `setAudioDevice()` had no callers left, and
the picker in st0's « État du moteur » sent `set-audio-device` to the engine and nothing
else. That switches the running engine and is forgotten the moment it exits. In dev the
engine exits on every native rebuild, so the pick lasted minutes.

The tray's row does not cover for it: the tray is not used in dev at all, and its setting
is reachable only from its own menu — the supervisor has no network surface, so a browser
cannot write it.

So the picker now does both halves: tell the engine to switch NOW, and ask that machine's
file service to still be on it next time. They are two facts — a live engine and a file on
a disk — and sending only the first is the bug this page exists for.

## An interface change un-wires every live input

Switching device destroys Tracktion's `WaveInputDevice` objects and builds new ones
(`DeviceManager::handleAsyncUpdate`). Everything expressed through them dies with them:
which track an input feeds, and whether that track is armed. `applyAllTrackInputs`
otherwise runs only from a full project apply, so between a device switch and the next
apply, an armed track still LOOKED armed in the UI and would have recorded silence.

`EngineHost::reconnectTrackInputs` closes that, and two details in it are load-bearing:

* **The arm set is read BEFORE the switch.** Afterwards there is nothing left to read —
  the flag lives on the input's `Destination`, which has just been thrown away.
* **`rescanWaveDeviceList()` only triggers the rebuild**; it is asynchronous. Re-wiring
  without `dispatchPendingUpdates()` first would wire tracks to the devices that are about
  to be destroyed, which is indistinguishable from working until the next block.

And because that replay fires on every reconnect, `setAudioDevice` now returns early when the
engine is already on the device asked for. Otherwise a routine reconnect would re-wire a rolling
session's inputs for nothing — and close and reopen a single-client ASIO driver under it.

A track whose channels the new interface does not carry is refused, with the reason logged.
That is honest: a song written for a 20-input rig cannot be armed on a 2-input endpoint,
and pretending otherwise is how you discover it at the end of a take.

Relatedly, `applyTrackInput` now ADDS the input instance when the playback context has
none. A context only builds instances for devices that were already enabled when it was
built, so enabling a device afterwards is not enough — the same reason `channelLevelsDb`
has always added its own for metering.

## What is still missing

The device's true input and output latency is not on the wire. Until it is, the quality
badge cannot tell a shared-mode endpoint from an ASIO driver, and the number it shows will
keep agreeing with a device that is four times slower. The fix is a field on `whoami`
(`audioTiming` already reads the open device) plus the two consumers in
`packages/web-protocol/quality.ts` — not done here.
