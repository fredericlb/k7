# Routing a track off the mixer's sum

`TrackDoc.outputChannels` — 1-based physical output channels, empty meaning the mixer's sum, which
is every track but a cue bus. The mirror of `inputChannels`, including the rule that a label is
resolved by the brain so the engine only ever sees numbers.

What it is FOR is `packages/song/docs/cue.md`: a headphone feed on a second pair of the interface.
This page is what the engine does with it.

## One function, two callers, and the second one is the trap

`routeTrackOutput` (`AudioInputs.cpp`) is called from **`populateEdit`** and from the live diff's
`TrackOutputChanged`. Both, not either:

- the live path alone leaves an **offline render** unrouted, because `buildRenderEdit` builds its
  edit through `populateEdit` and never runs a diff;
- `populateEdit` alone means a preference changed mid-session never lands.

## `initialise` used to open TWO output channels

`dm.initialise(512, 2)` asked for every input the device has and exactly two outputs — so a
Focusrite with eight was addressed as a stereo pair, and there was no second pair to find. It asks
for 512 both ways now.

Outputs are grouped the OPPOSITE way from inputs, which is worth knowing before hunting a missing
device: `isDeviceOutChannelStereo` reads `! outMonoChans[chan / 2]`, and the bits start clear, so
outputs come up as **stereo pairs** where inputs come up as twenty mono devices
(`docs/audioDevice.md`). `[3, 4]` therefore usually matches something, and the input side's pairing
dance has no counterpart here.

## An absent pair is SILENT, and that is not a detail

`findWaveOutput` matches a channel set exactly, like `findWaveInput`. When it finds nothing —
a two-output endpoint, an interface unplugged, an offline render that opened no device at all — the
track is routed to a device id that matches nothing:

```cpp
track.getOutput().setOutputToDeviceID("studio-absent-out:3+4");
```

`TrackOutput::getOutputDevice` returns null for an unknown id and `canPlayAudio()` goes false, so
the track plays nowhere.

**Falling back to the default device would be the bug this exists to prevent**: the headphone feed
would go to the room, at full level, with nothing on any surface to say so. Silence is wrong in a way
you notice in a second; a cue in the mains is wrong in a way you notice from the audience.

## A render does not consult track routing at all

The one that does not announce itself. `te::Renderer::Parameters::tracksToDo` is the set of tracks a
bounce sums, and output routing is a **playback** concept it never reads. So a mixdown contained the
cue bus at full level, and no log line, no warning and no test saw it.

`tracksOnTheMix()` in `OfflineRender.cpp` is the answer: every track but the ones carrying
`outputChannels`. It matches **by index**, which is the correspondence `populateEdit` itself uses
(`doc.tracks[i]` -> `audioTracks[i]`) — a name is not an identity here, since only a bus happens to
be named after its id.

The FREEZE path is deliberately untouched: it renders one track the caller named, so freezing a cue
bus is something somebody asked for.

## Changing it does not stop playback

`TrackOutputChanged` is applied in place, beside `TrackInputChanged` and after it — enabling an
output device rebuilds the wave-device list under both, so the inputs go first. A track that stops
being a cue bus gets `setOutputToDefaultDevice`, since empty means the sum rather than "leave it
alone".

`applyAllTrackOutputs` re-routes only the tracks that asked for a pair. Calling it for every track
would re-assert the default on each apply, for nothing.

## Verified how

```bash
npx tsx engine/moteur/scripts/cue-bus.ts
```

Two sources, one on the mix and one on the cue, changing nothing but the cue bus's `outputChannels`:

| render | peak |
|---|---|
| cue routed to pair 3+4 | **−7.5 dBFS** |
| the cue source REMOVED from the document | **−7.5 dBFS** — identical |
| the same bus left on the mix | −1.7 dBFS |

The assertion is an **identity**, not "quieter": routed away has to be indistinguishable from never
having been there. A threshold on the summed peak would measure how two notes happen to line up —
and with two IDENTICAL notes that figure swung 7 dB run to run, a 4osc's start phase not being
fixed, so the two sources play different notes.

The mix source stays in ALL passes on purpose: an empty mixdown is also what a broken render looks
like, so "the file is silent" would prove nothing.

The same harness measures the send behaviour `feedsBusOnly` rests on — see
`packages/song/docs/busOnly.md`, and `docs/editBuilder.md` for the routing itself.

**What cannot be checked here is listening.** That the headphones really come out of 3/4 is a sound.
