# Webcam and live video

A **camera** is a live picture source. It is opened by the browser, never by the engine, and it
can fill the frame on its own, feed a picture lane, or be recorded into clips.

## The live-video project

Create a project with the `live-video` archetype and you get the `live` rig — an input, a fader,
the master run with its recorder — plus:

- a camera node `CAM` that names no camera, so it opens whichever one this machine calls default;
- the graph line `CAM: [ RENDER ]`: the camera composites straight into the frame;
- `viewport: [1280, 720, 30]` and the viewport surface, the one surface this project has.

There is no timeline and no lane: a camera that reaches no picture lane draws a layer of its own,
on top of the authored lanes, filling the frame unless its node says otherwise. Open the viewport
(`ui viewport`) and you see yourself.

## The camera node

A camera node extends `@meta/CAM` (an `io: camera` module). Its fields:

| field | meaning |
|---|---|
| `camera` | which camera, by the **label** the machine shows (`"Logitech BRIO"`). Empty or absent: this machine's default |
| `frame` | `[x, y, w, h]` in viewport pixels, for a camera drawing a layer of its own; absent fills the frame |
| `monitor` | when the lens opens: `on` (always, the default), `off` (never), or `auto` (while its lane is armed) |

You can pick the camera on the node's card, which lists the cameras this browser sees, or write it:

```js
id("cam").extends("@meta/CAM").camera("Logitech BRIO").frame([40, 40, 320, 180])
```

The label is matched loosely: exactly first, then ignoring case, then by one name containing the
other — browsers decorate labels (`"Logitech BRIO (046d:085e)"`). When no camera matches, the
default camera opens and a message lists the cameras this machine does have, so a project moved to
another computer still draws something.

## A camera on a picture lane

Wire the camera to a picture lane instead of `RENDER`, and that lane draws the camera instead of its
shots, inside the lane's rectangle:

```yaml
# graph.yaml
modules:
  cam: [ main ]
```

A lane drawing a camera draws nothing while its lens is shut. With `monitor: auto` the lens opens
only while the lane is armed; on a camera that reaches no lane, `auto` reads as `on`.

## Recording camera takes

Arm a picture lane — its **R** button on the timeline, `r` with the caret on the lane, or
`ui picture arm <lane>` — then press record and play. The lane's camera is captured; when you stop,
the take is saved in `clips/` as `<lane>_<YYMMDD>T<HHMMSS>.webm` (or `.mp4` when that is all the
browser records) and placed on the lane where the playhead was when the camera started, with its
measured length. `ui picture arm` with no lane disarms.

The arm belongs to this browser, like the camera: nothing is written to the project when you arm.
Recording happens in the browser: the take is written to disk while it records, and a take
interrupted by a crash or a closed tab is offered back as a download the next time. A lane drawing
shapes has no camera and no arm button.

## A second device

A surface opened on another device (see the external surfaces pages in the
[index](./00-index.md)) can show the viewport too. Against a hosted k7 the other device opens its
own camera. Against the **desktop app** over your local network, a tablet or phone has no secure
connection and cannot open a camera; it receives the desktop machine's camera instead, streamed
over the local network. Two devices watching one camera open it only once on the machine.
