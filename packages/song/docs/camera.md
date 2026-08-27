# A camera — the live picture source

A webcam is an **io module that emits video**, declared in `graph.yaml` like any other node.

**It is to a picture what a live audio input is to a sound** — the same shape, and deliberately: a
signal comes FROM it, it has no plugin, so every control it has is a field of its file
([intrinsics.md](intrinsics.md)), and it needs no lane to be playable.

## It needs no lane, and that is the ordinary shape

```yaml
# graph.yaml — the whole of a live picture
modules:
  cam: []                   # a lens on the canvas, wired to nothing
  RENDER: [ VIDEO_OUT ]
```

There is no `video_tracks/` file and no `layers:` line. The compiler **synthesises a layer** for a
camera that feeds no lane: the whole frame unless the node says otherwise, drawn on top of whatever
lanes the project does author, in the order the graph declares the cameras.

```yaml
# nodes/cam.yaml
extends: "@engine/CAM"
camera: "Logitech BRIO"
frame: [40, 40, 320, 180]   # …and leave THIS out to fill the frame
```

`frame:` is one key rather than four, so it cannot be confused with `graph.yaml`'s `positions:` —
which is where a node's CARD sits, a different fact about the same node.

It is the picture's half of the rule the sound half already got: *a run carrying a live input and
landing on no lane materialises its own track* ([graphModel.md](graphModel.md)). Both say the same
thing — the document names a source, and the renderer's model needs a strip; making you author one
is making you say something the compiler already knows.

**Wiring it to a lane still works**, and is what you want when the lens should share a lane's
rectangle, its `mute`, or the shader passes over it. Then the lane draws the camera instead of its
placements.

## Why the LABEL and not a deviceId

`enumerateDevices()` hands back a `deviceId`, and it is the obvious thing to write down. It must not
be: an id is **salted per browser and per origin**, and it rotates — on a second machine, in a
second browser, after a profile reset. A project that named one would draw a black rectangle with
nothing to explain it, on a file that is correct.

So the file names the camera the way a person does, and the browser matches it (`matchCamera` in
`@studio/ui-eyes`): exact, then case-insensitively, then by containment either way — a browser
dresses a label up (`"Logitech BRIO (046d:085e)"`) and nobody copies the vendor ids by hand.

This is the rule `channel:` already follows for audio, for the same reason: *a preferences label
stays a label, because this doc describes the song rather than the rig it runs on*
([graphModel.md](graphModel.md)).

**Nothing is refused.** A lens this machine has not got falls back to the default one and says
which cameras it *does* have — a project travels, and a picture with an explanation beats no
picture. On the very first run the labels are blank until permission has been granted once, which
is the second reason not to refuse.

## `""` and absent are two different answers

| the node says | the layer gets | what it means |
|---|---|---|
| it is not a camera at all | no `camera` field | an ordinary lane, drawing its placements |
| `extends: "@engine/CAM"` with no `camera:` | `camera: ""` | a lens, whichever this machine calls default |
| `camera: "Logitech BRIO"` | `camera: "Logitech BRIO"` | that lens, matched by name |

The empty string is what makes a camera node usable before anybody has chosen anything, and the
card's dropdown offers **`default`** first and always so a choice can be un-chosen — the argument
`@base`'s `none` makes ([graphBuild.md](../../ui-chains/docs/graphBuild.md)).

## What `validate()` refuses

Three shapes, each one a cable that cannot mean anything:

- **into a lens** — picture comes out of a camera, never in. The same sentence a live input gets;
- **a picture lane fed by something that is not a camera** — an ordinary module aimed at a lane is
  discarded silently, which is the failure a warning is worth.

A camera landing on **no** lane is refused by nothing: that is the shape above.

A bypassed camera node opens no lens: a switch that is off is off.

## Which lane, when several are wired

The first one wins. A lane draws one picture.

## The lens is the BROWSER's, top to bottom

The engine never hears about it. `getUserMedia` is the browser's, the stream is a `MediaStream` on
a parked `<video>`, and the compositor uploads from it exactly as it does from a clip's element —
`@studio/ui-eyes`' `realtime.ts`. Three things follow, and all three are deliberate:

- **A live lane chases no clock.** It holds no clip, so every seek, drift and playback-rate rule in
  that driver skips it — and it draws while the transport is STOPPED, which is what live has to mean.
- **The camera is stopped on teardown.** A stream left running is a lamp left on: the browser keeps
  the indicator lit and the device held until the tab closes, on a surface you merely navigated away
  from.
- **A failure is carried, never thrown.** A refused permission must not take the viewport down with
  it; the other layers have pictures to show.

## Export skips it, and that is the answer rather than a gap

`exportScene` walks a timeline frame by frame, faster or slower than real time. A lens has no frame
at *t*. What an export would record is "whatever the camera happened to show while the encoder ran",
which is not the picture anybody asked for — so a live layer is left out of the render.

## Setting it

```
node param cam @camera "Logitech BRIO"     # by name
node param cam @camera default             # back to the machine's own
```

One verb, because that is the rule intrinsics already follow: a vocabulary that grows a verb every
time a field becomes settable is a vocabulary that will be one field behind
([intrinsics.md](intrinsics.md)). The card's dropdown sends exactly that line.
