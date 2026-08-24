# Which interface the engine plays through, and who remembers it

The engine opens no interface of its own accord — AGENTS.md ("The audio device is opened
ONCE, explicitly") says why. This page is the other half of it: **something else has to
remember the choice**.

## The symptom when nothing does, and why it hides

Monitoring in st0 is unusable: arm an audio track, roll the transport, and the sound of the
instrument comes back a long way behind the hand playing it. Playback of a mix is fine. That
asymmetry is the whole diagnostic — an interface only costs you latency in the direction you
can hear it, and playback has nothing to be late against.

What the running engine reports:

```
[device] 'Haut-parleurs (Focusrite USB Audio)' open: 2 in, 2 out
whoami: bufferSize=256 sampleRate=48000
```

and the same machine's device list:

```
  [ASIO]          Focusrite USB ASIO                       20 in, 8 out
* [Windows Audio] Haut-parleurs (Focusrite USB Audio)       2 in, 2 out
```

— the engine is on the **Windows shared endpoint** of the interface, not its ASIO driver.
Two things follow, and only the first is obvious:

* The shared endpoint is the Windows mixer, so the round trip includes the mixer's own
  buffering in both directions. It is several times an ASIO driver's, and that difference
  is the whole of the complaint.
* **`bufferSize` reads 256 either way.** The engine's quality band (`audioTiming` →
  `packages/web-protocol/quality.ts`) is computed from buffer and rate, and both are
  identical on the two devices, so the badge says ~10 ms while the truth is several times
  that. The buffer size is not the latency, and nothing on the wire carries what JUCE does
  know (`getInputLatencyInSamples`, `getOutputLatencyInSamples`) — a gap listed below.

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

The first row is the one a browser can reach, and it is the one that is easy to leave half
done. `set-audio-device` switches the RUNNING engine and is forgotten the moment it exits —
in dev the engine exits on every native rebuild, so a pick made that way lasts minutes.
Writing `preferences.yaml` through `PUT /preferences/audio-device` is what makes it survive:
`packages/song/src/preferences.ts`'s `setAudioDevice()` writes the field and `engineLink`
replays it on every connect.

The tray's row does not cover for it: the tray is not used in dev at all, and its setting
is reachable only from its own menu — the supervisor has no network surface, so a browser
cannot write it.

So a picker must do both halves: tell the engine to switch NOW, and ask that machine's
file service to still be on it next time. They are two facts — a live engine and a file on
a disk — and sending only the first is the bug this page exists for.

## An interface change un-wires every live input

Switching device destroys Tracktion's `WaveInputDevice` objects and builds new ones
(`DeviceManager::handleAsyncUpdate`). Everything expressed through them dies with them:
which track an input feeds, and whether that track is armed. `applyAllTrackInputs`
otherwise runs only from a full project apply, so between a device switch and the next
apply an armed track still LOOKS armed in the UI and records silence.

`EngineHost::reconnectTrackInputs` closes that, and two details in it are load-bearing:

* **The arm set is read BEFORE the switch.** Afterwards there is nothing left to read —
  the flag lives on the input's `Destination`, which has just been thrown away.
* **`rescanWaveDeviceList()` only triggers the rebuild**; it is asynchronous. Re-wiring
  without `dispatchPendingUpdates()` first would wire tracks to the devices that are about
  to be destroyed, which is indistinguishable from working until the next block.

And because that replay fires on every reconnect, `setAudioDevice` returns early when the
engine is already on the device asked for. Otherwise a routine reconnect would re-wire a rolling
session's inputs for nothing — and close and reopen a single-client ASIO driver under it.

A track whose channels the new interface does not carry is refused, with the reason logged.
That is honest: a song written for a 20-input rig cannot be armed on a 2-input endpoint,
and pretending otherwise is how you discover it at the end of a take.

Relatedly, `applyTrackInput` ADDS the input instance when the playback context has none. A
context only builds instances for devices that were enabled when it was built, so enabling
a device afterwards is not enough — the same reason `channelLevelsDb` adds its own for
metering.

## Grouping the inputs: mono channels or stereo pairs

The same device list can be built two ways, and the choice is the interface's, not the song's.
Tracktion's `describeStandardDevices` walks the open device's channels **two at a time** and asks
`isDeviceInChannelStereo(i)` for each even one: set, the two become a single stereo
`WaveInputDevice`; clear, they stay two mono ones. All bits start clear, so a Focusrite 18i20
comes up as twenty mono inputs and no stereo device at all.

That matters the moment anything offers a *choice* of input. `findWaveInput` matches a device
only when its channel list is exactly the one asked for, so on that rig `channel: [1, 2]` matches
nothing and plays silence — there is no pair to match it. Filtering a picker by width offers
stereo for ever and never finds any.

`EngineHost::setInputStereo(channel, stereo)` is the other half: it makes the pair rather than
looking for one. Three things about it are load-bearing.

* **The channel names its PAIR.** 1-based on the wire, 0-based inside, and
  `setDeviceInChannelStereo` rounds down to even itself — so either half names the same pair, and
  **2 can never be paired with 3**. The hardware boundary is not ours to move.
* **It regroups exactly as a device switch does**, so it needs the same repair:
  `reconnectTrackInputs`, with the armed set read *before*. Without it the first take after
  pairing records silence from a track that still looks armed — the bug this page already
  describes, reached by the other road.
* **Nothing is broadcast back.** The device layout rides on `io-levels`, the one message that
  carries it and which every surface showing inputs already asks for. `setInputStereo` forces the
  async rebuild through before returning, so the next `io-levels` on that thread is the new list.

Pairing **destroys** the two mono devices: their names merge, and a device is identified by its
name (`"wavein_" + hash(name)`). A module still saying `channel: [2]` after 1+2 are paired matches
no device and goes quiet with no error. The surface that offers the act says so before it does it;
see `packages/ui-module-builder/docs/inputChannels.md`.

### …and it is remembered exactly where the device choice is

Tracktion *does* persist the grouping itself — `saveSettings` writes `stereoChansIn` per audio
device type. It is never read back, and that is structural rather than an oversight: the only
thing that loads it is `DeviceManager::loadSettings()`, whose first act is

```cpp
auto audioXml = storage.getXmlProperty (SettingID::audio_device_setup);
if (audioXml != nullptr)
    error = deviceManager.initialise (…, audioXml.get(), true);
```

— reopening the remembered interface, which is the one thing the top of this page forbids. So this
engine never calls it, and the pairing bits go down a well.

To check rather than assume: pair channel 5, restart the engine, ask again — twenty mono devices.

So the grouping is remembered the same way the interface is, in `~/.studio/preferences.yaml`
(`inputPairs`, the 1-based odd channel of each pair), and replayed by `engineLink` on every connect,
in the same `try`, one line after `setAudioDevice`. The order is load-bearing: opening a device
rebuilds the wave devices from scratch, so a pairing sent first would be thrown away.

That is not a second source of truth — it is the *only* one that can be read, and Tracktion's copy
stays as inert as `Settings.xml`.

## What is still missing

The device's true input and output latency is not on the wire. Until it is, the quality
badge cannot tell a shared-mode endpoint from an ASIO driver, and the number it shows will
keep agreeing with a device that is four times slower. The fix is a field on `whoami`
(`audioTiming` already reads the open device) plus the two consumers in
`packages/web-protocol/quality.ts` — not done here.
