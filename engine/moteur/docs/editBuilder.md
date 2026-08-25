# editBuilder.md — turning a `ProjectDoc` into a Tracktion edit

`EditBuilder.cpp` is the one place a document becomes a graph. `populateEdit` is shared by the
live server path and the offline renderer — both need exactly this graph, and only what happens
afterwards differs — while the smaller helpers (`addPlugin`, `insertClip`, `applyAutomationLane`,
`applySoloMute`) are what the incremental diff-apply path reaches for.

`EditBuilder.h` is an INTERNAL header: it includes Tracktion and JUCE, unlike `EngineHost.h`.

This page holds the reasoning the code used to carry inline. Each section names the function it
belongs to, and the code carries a one-line pointer back here.

## Where a clip reads from — `clipPositionFor`

Three numbers stack, and getting the order wrong is silent.

| number | unit | what it means |
|---|---|---|
| `sourceFrom` / `sourceTo` | seconds | the clip FILE's window into its material |
| `offset` | beats | the placement's own musical offset, read FURTHER into that window |
| `length` | beats | how long the placement occupies the timeline |

The in-point is `from + offset`, **clamped to the window**. Measuring the offset from the file's
start instead let it run off the end of the window and into material the clip file had excluded.

What is left of the window after the in-point — `usable` — is the clip's natural length as far as
everything downstream is concerned, which is what makes an untimed placement play exactly the
window. A placement asking for MORE than that would read straight past `to`, so the window wins
and the end is clamped. **Not for a looped clip**: there the length says how many times the window
repeats, which is a legitimately longer region and a different question.

Finally, the returned `ClipPosition` carries the source in-point rather than `{}`. Passing `{}`
made every clip start at sample 0 of its file, so leading silence baked into an exported source
played first — heard as a fixed per-clip latency, on every clip, with nothing naming it.

## The warp that is skipped — `applyClipWarp`

`docs/warp.md` is the page for how a warp map reaches the sound. One thing lives here instead,
because it is a defensive skip rather than part of the mechanism.

A two-marker map that stretches by 1.0 and pins nothing in between is **not a warp**: the source
already runs at the project tempo and both markers say so. Importers emit these for any clip that
needed no correction — 11 of 31 in one real project.

Skipping them is not an optimisation. Auto-tempo hands playback to
`AudioSegmentList::buildAutoTempo`, whose non-looping branch emits a segment per sync point with
no bound against the clip's length. `removeExtraSegments` then "truncates" the straddling one with
`seg.length = getEnd() - seg.start` — where `getEnd()` is the last REMAINING segment, i.e. that
very segment, since the loop runs backwards and has already dropped the rest. The truncation is a
no-op and the clip plays its whole source past its declared end. **Not entering that path is the
only part of this fixable from outside Tracktion.**

Two more orderings in the same function, both of which look arbitrary and are not:

* `setTimeStretchMode` runs the request through `checkModeIsAvailable()`, which silently returns
  `disabled` for a mode not linked into this build — and disabled means no stretching at all.
  Elastique is licensed and usually absent, so the fallback is SoundTouch, which ships.
* `setUsesProxy(false)` comes **before** `setWarpTime(true)`. A proxy is a background render job
  the headless renderer never pumps, so a proxy makes the render task loop forever; with the proxy
  already refused, `WaveAudioClip::needsRender()` stays false and nothing is scheduled.

## A pad's `skip`, unrolled — `insertMidiClip`

`repeat` is local to a note and costs nothing: one note retriggered inside its own duration, the
hits dividing the step rather than overrunning into the next one.

`skip` is not local. It silences a pad on every Nth PASS of the pattern, and a pass only exists
because the clip carries a loop range Tracktion repeats. There is no per-repetition hook to hang
it on, so the passes are **unrolled**: the notes are written out for each one, the skipped pads
left out, and the loop range deliberately not applied — looping the expansion would play the whole
thing over.

Unrolled **only when some pad actually asks for it**. Without that guard every looping sequence
would stop being a loop and become its own expansion: more notes in the edit, and a diff that has
to re-insert all of them for a change to one pass. A pattern with no `skip` takes exactly the path
it always did.

Why here and not in the compiler: the sequencer draws the same document the engine plays, and a
document holding four passes of a one-bar pattern is one the grid would draw four bars of. The
pattern as authored and the notes as played are different lists, and this is where they part.

The pass count is `round(length / window)`, not a floor: `length` is window × loops computed in
floating point, so the last pass can land a few ulps short of a whole one and be dropped.

Two Tracktion signatures worth knowing before touching this: `ClipTrack::insertMIDIClip` takes a
`TimeRange`, **not** a `ClipPosition` like the wave path, and `MidiList::addNote` takes
`(pitch, BeatPosition, BeatDuration, velocity, colour, undo)`.

`@studio/song`'s `docs/padEffects.md` is the authoring half, and
`engine/moteur/scripts/pad-effects.ts` is the proof — a render, with hits counted per pass.

## The master fader is pinned at 0 dB — `populateEdit`

Tracktion's master fader defaults to **-3 dB**, and nothing here ever moved it. Every mixdown this
engine wrote came out 3 dB below the material that made it, on a fader no surface draws and nobody
set.

Found by measuring, after two wrong guesses: a one-track doc with no plugins rendered 3 dB low
with the master (`useMaster=true`) and exactly at unity without it, so a stem was always right and
a mixdown always low. It is not a pan law — the plugin was asked, and answered `vol=-3, pan=0`.
Track faders were never involved.

Set in `populateEdit`, so playback, `--render` and a freeze move together: a bounce that came back
at one level and played at another would be audible the moment you froze a track. It matters most
where a render is written BACK onto the material — `clip process` treated the same audio 3 dB
quieter every pass (`packages/audio-passes/docs/peakPass.md`).

It stays a hard 0. The song's own output level does **not** go here: this fader stops at +6 dB and
a master trim is exactly where that ceiling bites, so `masterVolume` is applied by a gain the
engine owns (`MasterGainPlugin.h`), on the master plugin list just after the chain. Pinning this
one is what keeps the two from multiplying — `packages/song/docs/masterVolume.md`.

## What sits on the master list, and in which order — `populateMasterChain`

The song's `MIX -> OUT` run goes on **first**, and everything the engine adds itself comes after,
in the order the graph reads:

1. the song's own master plugins
2. `MasterGainPlugin` — the OUT node's `Volume`
3. the mix meter and the broadcast tap (`buildLevelMeters`)

So the two readers answer for the whole run, chain and output level alike, which is what lets the
Fix button write the output and see the clip light clear. The cost is stated rather than hidden: a
limiter in the song's chain is upstream of the meter, so the clip light stops seeing the raw sum
it was built to catch.

The gain is created **here** rather than in `EngineHost::buildLevelMeters`, which runs only on the
live path. An offline render calls `populateEdit` and nothing else, so a gain owned by the meter
code would leave `--render`, a freeze and `clip process` all bouncing at unity however the song's
output level reads. The live path takes hold of THIS one through `masterGainOf`; two would
multiply.

## Creating a plugin — `addPluginTo`

Ordering again, and each step is load-bearing:

* A built-in is created from a **state tree** rather than a type name whenever the module carries
  something the plugin must know before its constructor returns. Exactly two things qualify, for
  one reason: a DSP graph and a Faust program each DECLARE the plugin's parameters, and Tracktion
  plugins create their `AutomatableParameter`s in the constructor and never after — so it has to
  be on the tree already. Never both: a module names one plugin, and that plugin reads one of the
  two properties.
* `setEnabled(p.enabled)` comes **before** the preset and the params. A step written
  `enabled: false` always reached the engine and was silently dropped here, so a bypassed module
  went on processing; Tracktion's `enabled` is exactly bypass — the plugin stays in the chain and
  passes its input through. Setting it first means flipping bypass off restores the module as
  configured rather than as created.
* The `.vstpreset` loads, then the text params override it.
* A Neural Amp Modeler's `.nam` model is loaded from the FILE the project names rather than the
  plugin's stored blob — the song is the source of truth, so swapping an amp is picking a file.
  Loaded on the message thread while the edit is built, never from the audio thread.

Two warnings that exist because nothing else in the signal path would tell you:

| when | why it matters |
|---|---|
| the model's training rate differs from the engine's | the plugin does not resample, so the amp simply sounds like a different amp |
| Normalize is on and the model declares no loudness | Normalize has nothing to level to, so the output sits wherever the model was trained |

The second is checked AFTER the params, because it depends on one of them, and is silent when
Normalize is off — a module that turned it off has already said it does not care.

## Second inputs and aux sends are separate passes

Both need every track to exist first, and for the same reason: the source is a TRACK, and a track
has no `EditItemID` until it has been made. A chain sidechaining from a lane later in the doc
would find nothing at all if this were done inline.

Tracktion carries one sidechain source per plugin and sums it into the render buffer past the
stereo pair, which is where a DSP graph's `ain` port 1 reads it (`docs/sidechain.md`). The wires
are what actually map channels, so a plugin with none gets the default routing — with our channel
names, source L/R onto channels 2/3. A plugin sidechained from its OWN lane is refused rather than
wired into a loop: that signal is already its first input, and Tracktion excludes the owner track
from a sidechain source for exactly that reason.

Auxiliary sends are the second pass. A send routes a copy of a source track's post-FX signal onto
a shared bus; an `AuxReturnPlugin` on the destination injects that bus back into its chain, so the
return's own plugins process the summed sends before the master. Source and return are linked by a
bus number. The return goes at the FRONT of the destination track, so bus audio flows through that
track's effects on the way out; each send is appended at the END of its source track, post-FX and
post-fader. The first sender to name a destination is what wires its return.

### A lane heard through its buses is ROUTED, not muted-and-sent

`feedsBusOnly` — muted, with at least one enabled send — takes a different path: the track's output
goes to the **first** destination with `setOutputToTrack`, and `applySoloMute` leaves it unmuted.
That is not a shortcut, it is the only thing that works, and the measurement is worth recording
because two plausible designs die on it:

**A muted track processes nothing.** Not its plugins, not its sends. Measured on a set whose decks
were muted to keep them off the master: the bus received silence, so the whole mix was silent.
Moving the `AuxSend` to the front of the plugin list changes nothing, because the list never runs.

So a lane cannot be both muted and heard through a bus, and `setMute` is the wrong tool for "off
the master". Routing the output is the right one: the track is not muted, it simply does not go to
the device — its signal leaves by the bus and only by the bus.

#### …and the SECOND destination is an ordinary send

A track has one output, so only the first destination can be a routing. The rest fall through to
`AuxSend` as usual — and they carry signal, because the routed track is **not muted**. That is what
makes "one source, several buses, heard nowhere else" expressible: a pre-fade headphone tap beside
a crossfade (`packages/song/docs/cue.md`), and any bus that wants two consumers.

It used to require `enabled == 1`, so a second destination fell out of the routed case entirely and
the track was muted with two dead sends — silent everywhere. Measured, on the shape a cue needs:

| shape | peak at the master |
|---|---|
| two destinations, muted source, before this | **−100 dBFS** |
| two destinations, muted source, first routed | −1.6 dBFS |
| two destinations, source left unmuted | 0.0 dBFS — the dry path included |

`npx tsx engine/moteur/scripts/cue-bus.ts` replays all three. The project says which buses want this
with `bus_only:` — `packages/song/docs/busOnly.md` for why that is not the same word as `bypassed:`.

**The same measurement kills `setOutputToDeviceID({})`**, tried for a run consumed by another
module's port. It takes the track off the device, and takes it off the sidechain with it: in this
engine a track's signal reaches a sidechain only if that track also reaches a device. A run whose
signal is consumed by a port and heard nowhere else is therefore **not expressible today** — see
`packages/song/docs/setProject.md`, where the crossfade's second input needs exactly that.

## Two small ones worth keeping

`applyTrackParams` leaves the track's own fader at unity on purpose: what a track sounds like is
decided by the modules on it, and the last of those is its mixer strip. Driving the Tracktion
fader as well would be a second gain stage nothing names.

`populateEdit` points `edit.filePathResolver` straight at the file because every media path in a
doc is ABSOLUTE. Tracktion's `SourceFileReference` — which `SamplerPlugin` uses to open a rack
sound — otherwise reads a source string as a `ProjectItemID` or as a path relative to the
nonexistent edit file, and the sound is silent. Nothing else here goes through a resolver.
