# `live` and `live-video` — a rig you play THROUGH

The odd ones out: the other three archetypes are named after the surface they open on
(`arrangement`, `video`, and `mix`, which writes a set — [setProject.md](setProject.md)). These two
are named after what they **are** — nothing is arranged, and there is no lane of any kind.

```
rig.k7/
  project.k7x             no layers — a name, a tempo, a rate (+ a viewport in live-video)
  settings.k7x            metronome off
  graph.k7x               four lines, six in live-video
  nodes/IN.k7x            the live input — OUT is a built-in sink, no file needed
  nodes/fader.k7x         the fader — a use of the library's shared strip
  nodes/rec.k7x           the recorder, on the master run — a rig is something you keep
  nodes/CAM.k7x           live-video ONLY: the webcam
  surfaces/viewport.k7x   live-video ONLY: the frame it fills
```

That is the file MAP. A new rig is then converted to chain files, the main layout
([scaffold.md](scaffold.md)): the graph and the three node files become `chains/`, each node keyed
by an id, and the track the input materialises is labelled by its chain, `IN`, rather than by that
id. The bench keeps the map as it is, a graph, because it splices into it by node name.

No `clips/`, no `sequences/`, no `video_tracks/`, and — bar that one viewport — no `surfaces/`. It opens on its graph and nothing
else, and it is silent about it: `surfaceIssues` warns that an arrangement is undrawn only when the
folder **holds material**, and this one holds none. *A bare rig is silent — it has no arrangement to
draw* ([surfaces.md](surfaces.md)) was already a state the model had a word for; what it had no way
to do was **ask for one**.

## INPUT → FADER, and no track anywhere

```k7x
modules({
  IN: ["fader"], // the input runs into the fader…
  fader: ["MIX"], // …and the fader into the mixer's sum
  MIX: ["rec"], // …through the RECORDER, on the master run…
  rec: ["OUT"], // …and out to the interface
})
```

`fader: [ MIX ]` rather than `fader: [ OUT ]`, and the difference is entirely in what it SAYS: the
two compile to a byte-identical `ProjectDoc`, because a materialised track sums into the master
whatever its run names last. So `OUT` never bypassed anything — it just **drew** a bypass of the
master run, a cable going somewhere the signal does not go. A graph that has to be forgiven by the
compiler is a graph that will be read wrong.

**There is no lane and no `nodes/` track file.** A run carrying a live input and landing on no lane
MATERIALISES its own track, named after the chain, carrying the run's plugins — the same thing a bus
already gets, and for the same reason: the document names a run, and the engine's model needs a
strip ([graphModel.md](graphModel.md)). So the fader is a plugin on that track, and `IN` is what the
mixer calls it.

Measured on the scaffold:

```
tracks: [ IN role=regular in=[] mon=on plugins=[IN:fader] ]
```

Before that rule existed the same graph compiled to **zero tracks** and played silence while the
graph still drew the cable, which is the worst version of being wrong.

Put a module between the two — `IN: [ amp ]`, `amp: [ fader ]` — and you have an effects chain.
That is what the shape is for: it is the smallest project that makes a sound you are making.

### The recorder is ON the master run, not on the track

A rig you play through is a rig you want to KEEP, and the transport-and-take shape cannot do it
here — there is no transport to press. So the scaffold wires a recorder node
([recorderNode.md](recorderNode.md)) between the sum and the interface.

**On the master run** rather than on the input's own track, and the difference is what a take
holds: `MIX -> rec -> OUT` captures the whole mix, post-fader — *what you would have heard* —
where the same node between `IN` and `fader` would capture one voice of it, before the level you
set. Compiled, that reads:

```
tracks:        [ IN plugins=[IN:fader] ]
masterPlugins: [ MIX:rec:Recorder ]
```

It passes the sound through untouched, so its being there changes nothing you hear, and deleting
it changes nothing either — it is the one node in this shape you can take out and still have a rig.

That placement had a consequence in the engine: `populateMasterChain` did not record its plugins
in `pluginsById`, so a module on the master run was invisible to everything keyed by id — a
recorder's ring included, which would have left the node refusing to record with *"no recorder
node in this project"*. It registers them now, which also lets a master module carry a waveform
tap and a param watch, as any other node does.

### The fader is the SHARED strip — the same one every project's mixer node is

`nodes/fader.k7x` extends `@meta/audio/mixer`, k7's own strip ([metaModules.md](metaModules.md)), and two separate things make that the only
right answer rather than merely a tidy one.

**The plugin has to be `Mixer`.** `trackMixer` finds the last one in a track's chain, and *a track
with none has nowhere to put a level*. A fader built out of any other plugin — Tracktion's
volume-and-pan, a jsdsp gain — is a fader **no surface can drive**: the strip on screen finds
nothing to move and the rig is adjustable only by editing its files.

**And the face lives on the library module, not on the plugin.** A card draws the `ui.k7x` beside
the module it resolves to; the plugin's params alone draw nothing. The library's `mixer/` carries
one — a fader and four knobs, `Volume` `Pan` `Low` `Mid` `High`. A project-owned copy of the same
plugin compiles to the same audio and gives you **a card with no controls on it**, which is how
this was found.

So a rig borrows, and the borrowing is declared. A library repository is attached rather than
seeded ([sharedFolders.md](sharedFolders.md)), so a new account's can be empty, and a `@k7-core/…` ref
that resolves to nothing does not warn — `compileNodeProject` throws `extends unknown module` and
the project does not open. That is what `neededRefs` is for
([scaffoldNeeds.ts](../src/scaffoldNeeds.ts)): it reads every `extends:` off the scaffolded **text**
before a byte is written, so the new-project screen says what is owed. `live` goes through it the
same way `mix` does — a shape that names a shared module is the normal case here, not a hazard.

It is a fader at the CHANNEL rather than at `OUT`, which has one of its own: that one is the song's
output level ([masterVolume.md](masterVolume.md)), and they are two different numbers.

## What the input says — and the one thing it does not

```k7x
io("in")
monitor("on") // audible without arming anything — the word, not a boolean
gain(0) // a trim in dB at the interface, ahead of everything
```

`monitor: "on"` rather than the default `auto` is the one opinion the scaffold has: `auto` means
audible **once the track is armed**, and a rig you plugged into should make a sound when you play it.

**There is no `channel:`, and that is the point.** Which socket you are plugged into is a fact about
your rig, not about this project — no scaffold can guess it, and one that guessed would be wrong on
most machines while looking right on the one it was written on. So the project asks:

```
input 'IN': no channel — it feeds nothing
```

That is the **only** thing a fresh live project says, and it is worth saying: a rig making no sound
is otherwise indistinguishable from a rig that is broken. Pick a socket on the node's card — the
dropdown lists what this machine declares — or write it:

```k7x
channel([1])        // 1-based; a PAIR for a stereo input, e.g. [1, 2]
channel("guitar")   // …or a label from <state>/preferences.yaml (channels.in)
```

A label is the spelling that survives being opened on another machine
([graphModel.md](graphModel.md)).

This is the same bargain a `turntables` surface's `mapping:` strikes with its `null` entries
([surfaces.md](surfaces.md)): a scaffold does not invent an answer only the person can give, and the
question is asked where it can be acted on rather than left silent.

## `live-video` — the same rig, SEEN through

The picture's half is the sound's half again, sentence for sentence, and that is the whole design:

| | sound | picture |
|---|---|---|
| the source | `IN` — an interface channel | `CAM` — a webcam |
| owned as | `nodes/IN.k7x` | `nodes/CAM.k7x` |
| chosen by | `channel:`, blank until you pick | `camera:`, blank meaning the machine's own |
| lands on | `MIX`, the mixer's sum | `RENDER`, where lanes composite |
| its strip | a track it materialises | a layer it synthesises |
| authored lane | none | none |

```k7x
modules({
  IN: ["fader"], // the input runs into the fader…
  fader: ["MIX"], // …and the fader into the mixer's sum
  MIX: ["rec"],
  rec: ["OUT"],
  CAM: ["RENDER"], // …and the lens composites into the frame
  RENDER: ["VIDEO_OUT"],
})
```

`CAM: [ RENDER ]` rather than a bare `CAM: []`. Both compile to the same full-frame layer — a
camera reaching no lane draws its own ([camera.md](camera.md)) — but only one of them **draws** the
path the picture takes. Same argument as `fader: [ MIX ]` above: a cable that means nothing to the
compiler still means something to the reader.

**It declares one surface, and only because a picture has nowhere else to go.** That is the single
exception to "no surface at all", and it is not a softening of the rule: an arrangement left
undrawn is still on disk and still plays, whereas a frame nothing composites is *not shown* —
there is no fallback view for picture the way the timeline is a fallback for lanes. So the viewport
comes with the shape, and `project.k7x` gains the one size a rig has:

```k7x
viewport([1280, 720, 30])
```

### A picture is not the same question as `video_tracks/`

The file service's gate on compiling a picture is `hasPicture(dir)`: *lanes of it, or a lens that
needs none*. `isVideoProject(dir)` — does the folder have `video_tracks/` — cannot be that gate: a
`live-video` project has no lanes, so its viewport would draw **nothing**, with no error to explain
it. `isVideoProject` answers the other question — whether a project is an arrangement owing a
timeline, and whether missing a viewport is worth a warning. The camera is what makes the two
answers differ.

## Making one

```
project new live <name>
project new live-video <name>
```

…or the **New project** card on k7's home page, where they sit beside the other three.
