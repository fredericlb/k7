# tapOutputs.md — an instrument whose taps leave by outputs of their own

A rack's tap or a kit's pad can be routed to a subchain of its own (`packages/song/docs/racks.md`):
the snare through a reverb the kick never hears. In the document that is two fields:
`PluginDoc.tapOuts`, `{ note, pair }` per routed tap, and `TrackDoc.inputFrom`, `{ plugin, pair }`
on the track that pair feeds. Pair 0 is the instrument's main output, which every unrouted tap
keeps.

## Why a RackType

Tracktion gives a plugin on a TRACK two channels, whatever it says it outputs: the node is
clamped (`EditNodeBuilder::createNodeForPlugin`), and a plugin rendering more has them thrown away
after the call. Aux sends and `setOutputToTrack` carry a whole track's stereo signal, never one
output of one plugin. **A RackType is the one place a plugin's extra channels survive**: a plugin
inside one is not clamped, and each `RackInstance` of the rack, on any track, returns one pair of
its outputs, followed by that track's own plugins. The rack is processed once per block whatever
its number of instances, and the graph orders every instance after it, so a routed tap is in the
same block as the rest of the kit, latency compensated, in a live play and an offline render alike.

So a plugin with `tapOuts` is built into a RackType of its own (`EditBuilder.cpp`'s
`addRackedPlugin`): MIDI from rack pin 0 into the plugin, one rack output per channel, wired one
to one, pair N being pins 2N+1 and 2N+2. Its lane gets an instance returning pair 0 where the
plugin would have sat; each track with `inputFrom` gets one at its FRONT returning its pair, with
no audio input, so the track's own chain processes the tap and nothing of the track goes back in.
`pluginsById` still holds the plugin itself, so its parameters, files and kit reload exactly as
they do on a track.

## What each instrument had to learn

- **The sampler** (`type: rack`) is Tracktion's own `SamplerPlugin`, patched at fetch time
  (`engine/patches/tracktion.cmake`): a sound carries an output pair in its state, a note plays on
  its sound's pair when the buffer has one, and the plugin reports two channels per pair.
- **The SFZ player** routes by KEY, which sfizz cannot: its outputs are chosen per region, by the
  `output=` opcode of the file. `engine/patches/sfizz.cmake` adds a key's own output, which wins
  over its region's, and `SfzPlugin` renders as many pairs as its routed keys need. A kit stays
  ONE synth, so a routed hi-hat still chokes the others.
- **Both name every channel.** A RackType refuses a connection from a pin past the plugin's
  channel names, and Tracktion's default names two: an instrument that rendered four channels and
  named two had its routed pair wired to nothing, in silence.

## A routing change is a rebuild

`ProjectDiff`'s `tapRoutingSignature` — every routed tap and every fed track — joins the send
routing in deciding a full rebuild. A RackType is built whole with its instances, and an in-place
edit that moved one instance would leave the others reading pairs that no longer mean what they
did. A tap's sound, its gain and its mute stay in place, as on any rack.

## Proven by rendering

`scripts/tap-outputs.ts` plays one pad at a time, on the sampler and on an installed SFZ kit: a
routed pad must be heard on its own track at the level it had unrouted, go silent when that track
is muted, and leave the other pads where they were. No unit test can hear a RackType.
