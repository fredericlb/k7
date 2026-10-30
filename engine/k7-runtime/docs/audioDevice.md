# Which interface the engine plays through, and who remembers it

The engine opens no interface of its own accord — AGENTS.md ("The audio device is opened
ONCE, explicitly") says why. This page is the other half of it: **something else has to
remember the choice**.

## The symptom when nothing does, and why it hides

Monitoring in k7 is unusable: arm an audio track, roll the transport, and the sound of the
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
* **`bufferSize` reads the same either way.** The engine's quality band (`audioTiming` →
  `packages/web-protocol/quality.ts`) is computed from buffer and rate, and both are
  identical on the two devices, so the badge shows the block arithmetic while the truth is
  several times that. The buffer size is not the latency, and nothing on the wire carries what JUCE does
  know (`getInputLatencyInSamples`, `getOutputLatencyInSamples`) — a gap listed below.

The channel counts are the cheap tell: an interface that says `2 in, 2 out` when it has
twenty inputs is not being addressed as itself.

## How it ends up there

`openAudioDevice()` calls `dm.initialise(512, 512)` and takes what JUCE's default device
type offers, which on Windows is the shared WASAPI endpoint of the default output. That
is the correct behaviour for a machine nobody has expressed a preference about. It is only
wrong when a preference exists and is not applied.

What `initialise()` replays can also be a setup with NO output — an ASIO type with a blank output
name, say, which Tracktion keeps saved in `Settings.xml`. That is no one's choice, and it is a
silent engine on every start of every engine on the machine, so `openDefaultOutputIfNone` then
opens the default output of the first backend that has one. The OS's shared endpoint comes before
ASIO there: an ASIO driver may be for an interface that is not plugged in, and is single-client.
A ranked interface (`audioPriority`, below) still moves the engine afterwards.

## Three places could remember, and they are not interchangeable

| where | who writes it | who applies it | when |
|---|---|---|---|
| `<state>/preferences.yaml` (`audioDevice`) | whoever edits the file — no route writes it | `engineLink.wireEngine`, on the socket's `open` | the first socket any session opens, and every reconnect after — so every engine restart, before anything plays |
| `<state>/engine-host.json` (`audioPriority`) | the command-line engine's config file, or k7's engine page under the tray | the supervisor's `AudioPolicy.cpp` | continuously — it also RE-selects the device when it is replugged |
| `%APPDATA%/Studio/Settings.xml` | Tracktion, by itself | nobody | never — inert on purpose, see AGENTS.md |

`set-audio-device` switches the RUNNING engine and is forgotten the moment it exits — in dev
the engine exits on every native rebuild, so a pick made that way lasts minutes. The first row is
what survives it: the field in `preferences.yaml` (`packages/song/src/preferences.ts`) is replayed
by `engineLink` on every connect.

That second row is an ordered LIST, best first, and no longer a pick plus a fallback: the
engine goes to the highest-ranked interface actually plugged in
(`engine/k7-supervisor/docs/supervisorPolicy.md`).

It does not cover for the first: its setting is written on the
engine's own machine, so a hosted browser cannot reach it.

So a picker must do both halves: tell the engine to switch NOW, and ask the account's file service
to still be on it next time. They are two facts — a live engine and a file on
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

The same `Destination` is thrown away on a much smaller change: `applyTrackInput` clears a
lane's assignment and makes a new one whenever its channels, monitor mode or trim move. So
it reads the arm flag off every input instance on the context first and sets it again on the
new assignment — otherwise flipping a lane's monitor from `auto` to `on` disarms it.

And because that replay fires on every reconnect, `setAudioDevice` returns early when the
engine is already on the device asked for. Otherwise a routine reconnect would re-wire a rolling
session's inputs for nothing — and close and reopen a single-client ASIO driver under it.

A track whose channels the new interface does not carry is refused, with the reason logged.
That is honest: a song written for a 20-input rig cannot be armed on a 2-input endpoint,
and pretending otherwise is how you discover it at the end of a take.

Relatedly, `applyTrackInput` ADDS the input instance when the playback context has none. A
context only builds instances for devices that were enabled when it was built, so enabling
a device afterwards is not enough — the same reason `channelLevelsDb` adds its own for
metering. Without it, wiring a track to an input the context predates leaves the track
silent with only a log line to show for it.

### Monitor mode and input gain belong to the DEVICE

`applyTrackInput` sets both on the `WaveInputDevice`, not on the target, because Tracktion
has one of each per input. Two tracks on one physical input therefore share the monitor mode
and share the trim, and the last one applied wins. That is a real limit of this mapping
rather than an oversight: per-track monitoring would need one device per track.

### Enabling a device is expensive, so it is done once for the batch

`setEnabled(true)` on a `WaveInputDevice` rebuilds the whole wave-device list and reallocates
every Edit's graph — the same cost `docs/inputTuner.md` records for metering ("asked for
twenty inputs by a menu polling at 8 Hz, wedged the engine outright"). Routing pays it the same
way: enabled track by track, a twenty-input song pays twenty list rebuilds and twenty graph
reallocations on every full apply. `applyAllTrackInputs` hoists the enabling
out: distinct CHANNEL SETS rather than distinct pointers, one `dispatchPendingUpdates()` for
the batch, and then `applyTrackInput` finds every device already enabled and skips its own.

The channel sets are re-resolved on each pass, and `applyTrackInput` re-resolves after it
enables one, because enabling a device destroys the objects for the others — Tracktion's own
comment inside `setEnabled` is *"this object is probably deleted.."*. Reading through the
pointer you started with is a dangling read.

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

So the grouping is remembered the same way the interface is, in `<state>/preferences.yaml`
(`inputPairs`, the 1-based odd channel of each pair), and replayed by `engineLink` on every connect,
in the same `try`, one line after `setAudioDevice`. The order is load-bearing: opening a device
rebuilds the wave devices from scratch, so a pairing sent first would be thrown away.

That is not a second source of truth — it is the *only* one that can be read, and Tracktion's copy
stays as inert as `Settings.xml`.

## The buffer size the engine asks for

`kPreferredBufferFrames` is **256**, asked of every device the engine opens (a phone asks for at
least two Oboe bursts instead, and grows on underruns — `docs/android.md`), and it decides the
engine's quality band — which decides what you can DO here. A browser reads `2 × buffer / rate` as
the audio half of the link's latency (a block in, a block out) and adds its measured round trip;
under 20 ms is playable, see `packages/web-protocol/docs/quality.md`. At 48 kHz, 256 frames is
10.7 ms and leaves room for the network, while the 480 a Windows endpoint hands out by default is
20 ms on its own and lands the machine in front of you in Q2.

**It was 512 for an afternoon, and the trial is worth keeping.** Two `KMODE_EXCEPTION_NOT_HANDLED`
bugchecks on the machine this was written for, on 23 and 25 August 2026, both with exception
`0x80000003` — a breakpoint, i.e. the driver reaching its own assertion — at
`FocusriteUsb.sys+0x1ED6D` and `+0x1ECAD`, 192 bytes apart and so almost certainly the same
routine. Both minidumps name `k7-runtime` as the current process. A bigger buffer is the
standard answer to a driver that asserts on a late buffer switch, so 512 was tried.

It was given up the same day, for a reason that is a measurement rather than a mood. 512 at 48 kHz
is 21.3 ms, **over the Q1 line before a packet moves** — every machine reads Q2 at best, and the
round trip really is twice what it was. And by then `audio-cost` had measured the callback: at 512
under a driven scratch it cost 0.201 ms of mean against a 10.67 ms deadline, worst block 0.456 ms —
**about 5 %**. An engine with twenty times the headroom it needs is not an engine the buffer is
protecting; paying Q1 for it buys a margin nothing was consuming. `docs/constat.md` holds the
numbers.

So the crash stays where the dump put it: inside a retail driver (4.144.0.362) that executes a
kernel breakpoint, with no lever on this side. Raising the buffer again is a reasonable thing to
try if it recurs — it is one constant — but do it knowing it was tried, what it cost, and that the
callback was nowhere near its deadline either way.

It is a PREFERENCE, not a promise. `applyPreferredBufferSize` takes the nearest size the device
offers, ties going to the LARGER — too small drops out, and a dropout is a worse failure than a
millisecond. It is silent when the device has no say (an empty list of sizes means the driver
decides) and warning-free when it refuses: a device that keeps its own buffer is working correctly,
and the badge simply shows what it costs. The engine reports what it really GOT — `whoami` reads
the open device — so the number on screen is never this constant.

Opening a new interface resets it, which is why `setAudioDevice` asks again after the switch:
without that, changing interface silently moved the engine between quality bands.

## `audioTiming` reads atomics, never the live device

`whoami` answers on the asking socket's own thread, and `setAudioDevice` destroys and rebuilds the
live `juce::AudioIODevice*`. Dereferencing one from `audioTiming` therefore races every device
switch — and the browser's keepalive sends `whoami` every few seconds on every socket, so any
switch overlapping one takes the process down. The buffer and rate are published into two atomics
on every exit from `setAudioDevice`, success or refusal, since the rollback paths reopen a device
too.

Zeros mean nothing is open. That is not "instant": a client reads a zero as *not measured* and says
so, rather than crediting an engine with a latency nobody proved.

## Two smaller traps in opening one

**An empty device name REMOVES that direction.** Most interfaces carry both, but a mic is
input-only, and writing an empty name into `AudioDeviceSetup` is not "leave it alone". Clearing the
input is survivable; clearing the OUTPUT is not — with nowhere to play there is no audio callback,
so the transport reports playing while nothing moves and no error appears anywhere. Picking the
built-in mic is exactly that case, and the setup is persisted, so a blanked output stays broken
across restarts. `setAudioDevice` names only the directions the device actually has, and refuses
outright when that would leave no output.

**A device being OPEN is not the same as being able to play**, for the same reason: an input-only
device opens happily with zero output channels. `outputDeviceName()` asks
`getActiveOutputChannels()` rather than trusting the open handle.

## One row per interface in the list

Windows exposes the same endpoint under WASAPI shared, exclusive and low-latency AND DirectSound,
which is three or four identical rows per device. `enumerateDevices` sorts by backend rank and
keeps the first occurrence of each NAME. ASIO is not lost to that dedup: its driver names differ
from the WASAPI endpoint names, so it stays its own row — which is the whole point, since it is
the row a musician needs to pick. The running device's `current` flag is carried onto the kept row
even when the engine is on a collapsed variant, so the picker still ticks the right interface.
Channel counts are known only for the OPEN device; answering for the rest would mean opening them.

### The list is cached, and sent to everyone only when it moved

Enumerating asks every backend to scan — ASIO, WASAPI and DirectSound on Windows, Oboe through JNI on
a phone — which takes tens to hundreds of milliseconds on the message thread every session shares,
and the supervisor asks every ten seconds. So `listAudioDevices` answers from `DeviceListCache`
(`EngineHostImpl.h`) and scans again only when it has a reason:

- the device manager **reports a change** — a backend that hears the OS (WASAPI, CoreAudio) calls it
  when an interface comes or goes, and an open or a close sends one too;
- the engine **opened, closed or switched** a device itself: every such path passes through
  `publishAudioTiming`, which marks the list stale at once, so the reply to a switch is never the
  list from before it;
- the list is **thirty seconds old**: ASIO, DirectSound and ALSA say nothing when a device is
  plugged in, so a polled list must still find it. On Windows an ASIO interface is usually a WASAPI
  endpoint too, whose notice makes the next poll rescan every backend.

The reply goes to **every client only when it differs from the last one sent to all**; an unchanged
list answers its asker alone. A page still learns a hot-plug from the supervisor's poll, and nobody
receives the same list every ten seconds.

### A setup may take its inputs from another device

CoreAudio lets one setup play through one device and record from another, and Tracktion
restores whatever setup it saved last (`~/Library/Studio/Settings.xml` on a Mac). The open
device carries the OUTPUT's name, so a row keyed on that name alone shows the interface as
`current` with the built-in mic's input count, and the input card offers one mono channel on
an eight-input interface with nothing to say why. A row therefore carries two flags: `current`
for the output side with the output count, `currentInput` for the device named by the setup's
`inputDeviceName` with the input count. On an unsplit setup both land on the same row; a list of
interfaces says "output only" or "input only" when they do not. The supervisor relays both
counts in its snapshot (`inputs`, `outputs`), and k7's engine page prints them in the
badge on the interface in use.

The engine also undoes such a split when it opens: `keepInputsOnOutputDevice` moves the inputs
onto the output device whenever that device has inputs of its own. A split survives only where
the output device has none — built-in speakers with the built-in mic — since there it is the
only way to have an input at all. A pick never needs the correction: `setAudioDevice` names the
picked device for both directions whenever it has both. What it costs: a deliberate pick of an
input-only device beside an interface that has inputs does not survive a restart.

## A device that stops calling back is reopened

An ASIO driver can stop calling back and stay OPEN: no error anywhere, the device still listed as
current, every meter at -100, every transport frozen. It shows up as a playhead bug before it
reads as an audio one. Tracktion moves a play head only inside the callback, and while stopped it
copies the play head back into the transport 200 ms after a seek (`lastUserDragTime` in
`TransportControl`), so every seek lands, then snaps back to where the dead play head sits. JUCE's
own recovery does not cover it: a driver's reset request closes, reopens and restarts the device,
and nothing checks that the callbacks resumed.

So the state timer reads the callback counter once a second — `callbackCost().runs`, the number
`audio-cost` answers with — and `CallbackWatchdog.h` decides. Two checks without a single callback,
with a device open, is a stall; the answer is to close and reopen THAT device
(`restartLastAudioDevice`, from the setup JUCE already holds) and re-wire the armed inputs the way
a switch does. A counter that moves at all is progress, downwards included: a reopen resets it.

It reopens the device already open and never the remembered one, so the rule in AGENTS.md holds.
Each reopen is a `warn()`, since a stall is something the musician needs to know happened; after
three it stops and says so once, because a single-client driver held by another application
refuses every reopen and retrying it for ever is noise. The log says which way it went:
`[device] … calling back again`, or the give-up warning.

To check by hand: `audio-cost` twice, a second apart. A `runs` that does not move while a device is
open is exactly the stall this watches for.

### A callback stuck INSIDE is not a stall, and a reopen would hang on it

The counter cannot tell the two apart: a driver that stopped calling and a plugin hung inside
`processBlock` both leave `runs` where it was. The answers are opposite. Reopening closes the device,
and closing it takes the lock the running callback holds — so on a hung plugin the reopen blocks the
MESSAGE thread for ever: no apply, no transport, no state frame, while `whoami`, answered on the
socket's own thread, tells the supervisor the engine is fine.

So Tracktion's callback records when it entered, and clears it as it returns (a fetch-time patch,
`engine/patches/tracktion.cmake`, since the callback is Tracktion's). The watchdog reads that first.
A callback inside for half a second is BUSY, and the check is skipped — not counted towards a stall,
not reopened. One inside for ten seconds is HUNG, and nothing frees an audio thread a plugin never
gives back: the engine logs why and leaves with exit code 5, for the supervisor to start a fresh one.
On Android, where leaving takes the app with it, it warns once instead.

Which plugin hung is not known — the graph runs many — so a project that hangs every time it plays
hangs every time it is restarted too. The log line is what tells that loop apart from a crash.

## MIDI devices are rescanned only while nothing plays

When a MIDI device appears or vanishes, Tracktion's `applyNewMidiDeviceList` clears and reloads
every Edit's context devices. That restarts each Edit's playback graph: the transport stops and
lanes fall silent for a moment. A Bluetooth keyboard with power saving (a microKEY2 Air) drops and
rejoins every few seconds, so left to Tracktion's own 4-second timer a song stopped after a few bars
and its drums cut in and out.

So the engine turns Tracktion's interval to 0 and runs the same rescan from its own timer
(`MidiScanTimer` in `engine/EngineHost.cpp`), skipped while any session is playing. A keyboard
plugged in mid-song is seen at the next stop — the price of a song that keeps playing.

## The engine opens no MIDI input

Tracktion opens every MIDI input it finds and enables, and enables a new one by default. k7 never
reads one there: a keyboard is read by the BROWSER, which records it and sends what is played as
`midi-live` (`packages/song/docs/midiIn.md`). On Windows a MIDI input has one owner, so an engine
holding the keyboard leaves the page listing it and receiving nothing from it. The engine therefore
disables every physical MIDI input each time Tracktion applies a device list (`closePhysicalMidiInputs`
in `engine/EngineHost.cpp`), which covers the first scan, a rescan and a keyboard plugged in later.
Tracktion saves the setting, so a device let go of once stays closed across restarts. The outputs
are left as Tracktion has them.

## What is still missing

The device's true input and output latency is not on the wire. Until it is, the quality
badge cannot tell a shared-mode endpoint from an ASIO driver, and the number it shows will
keep agreeing with a device that is four times slower. The fix is a field on `whoami`
(`audioTiming` already reads the open device) plus the two consumers in
`packages/web-protocol/quality.ts` — not done here.
