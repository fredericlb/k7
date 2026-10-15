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
extends: "@meta/CAM"
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
placements. `graph chain connect cam main` is that cable, and so is dragging it on the graph — a
picture lane is a node like any other to every verb that names one (`namesANode`), which it had to
be taught: `videoTracks` is its own key on the graph doc, and reading only `modules` and `tracks`
refused every cable to a card the graph had just drawn.

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
| `extends: "@meta/CAM"` with no `camera:` | `camera: ""` | a lens, whichever this machine calls default |
| `camera: "Logitech BRIO"` | `camera: "Logitech BRIO"` | that lens, matched by name |

The empty string is what makes a camera node usable before anybody has chosen anything, and the
card's dropdown offers **`default`** first and always so a choice can be un-chosen — the argument
`@base`'s `none` makes ([graphBuild.md](../../ui-chains/docs/graphBuild.md)).

## What `validate()` refuses

Three shapes, each one a cable that cannot mean anything:

- **into a lens** — picture comes out of a camera, never in. The same sentence a live input gets;
- **a picture lane fed by something that is not a camera** — an ordinary module aimed at a lane is
  discarded silently, which is the failure a warning is worth. A shape is the other exception
  (`song-video/docs/shapes.md`), and a fade's stretch the third: a run of shaders NOTHING feeds,
  which a placement runs its shot through (`song-video/docs/transitions.md`).

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

## `monitor:` — when the lens opens

The live input's own three words, meaning SHOWN rather than heard, and settable the same way
(`node param cam @monitor auto`, or the card's dropdown — `@monitor` was already an intrinsic, and
this only teaches picture to read it):

| | |
|---|---|
| `off` | never opened. The lane draws nothing — its placements are not what it was showing |
| `auto` | opened while its LANE is armed, and closed the moment it is not |
| `on` | always, which is what a camera node has always done |

**`on` is the default, where audio's is `auto`**, and the difference is not an oversight: `auto`
exists for sound because monitoring a live input you are not recording bleeds into the room. A lens
has no feedback path, and a camera node that says nothing would otherwise go dark.

A lens on **no lane** has nothing to arm, so `auto` on one reads as `on` — a camera you can neither
arm nor see would be a dead end.

Closing means closing: a shut lens is dropped from the scene rather than merely not drawn, so the
stream is never opened and the machine's indicator stays off. That is the same rule as teardown,
one paragraph up, applied to a lane that is simply not being watched.

## Recording it is the browser's too

Arming a picture lane and rolling the transport captures a lens into a clip on that lane —
`MediaRecorder`, in `apps/k7/frontend/docs/picture.md`. It follows from the line above rather than
adding anything to this model: the engine has no camera to record, so the half that holds one is
the half that records it. The label is matched by `matchCamera`, so a take records the lens the
lane names and falls back the same way.

It opens a stream of its **own** rather than reaching into the compositor's. Two reasons, and the
second is the one that decides it: the driver does not hand its stream out, and the lane being
recorded onto usually has no lens wired at all — a lane that HAS one draws it live and ignores its
placements, so recording onto that one would file a shot nothing draws.

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

## The browser that opens it is not always the one that draws

`matchCamera` resolves a label against the browser that draws the lane, and on a second device
that is the wrong machine: a tablet has neither the lens the file names nor — over the LAN, in the
clear — any right to open one, `getUserMedia` being absent outside a secure context.

So the opener is **injected**. `RealtimeDriver.create` takes a `LensOpener`, whose default is this
browser's own camera; a surface on a second device is handed one that asks the machine instead and
receives the stream over a peer connection. `apps/k7/frontend/docs/external.md` is that page.

What matters here is that the file keeps meaning what it says: the label is matched where it was
written, so `"Logitech BRIO"` names the machine's lens whichever screen is drawing it.

**A lens is held only while something draws from it.** On the machine, each label is opened once
and counted by the viewers it serves; the last one leaving stops the camera, and the tab stepping
behind another stops them all. On the device, a received lens carries its own `close`, which the
driver calls with the lane — a peer connection kept open past its lane keeps the machine encoding.
And a lens that lands after its driver was destroyed (a permission prompt outlasting the view) is
released on arrival rather than adopted: otherwise the lamp stays lit until the tab closes.
