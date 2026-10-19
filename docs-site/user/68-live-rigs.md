# Live rigs

A **live** project is a rig you play *through*: something plugged into your audio interface, heard through k7's effects, with nothing arranged. It has no timeline, no desk and no lanes. It opens on the graph.

Choose the **live** archetype when creating a project ("no surface — an input, a fader, the output"). The **live video** archetype is the same rig plus a webcam and the viewport it fills; its picture half is covered in the picture section of this guide.

## What a live project contains

```
IN -> fader -> MIX -> rec -> OUT
```

| Node | What it is |
|---|---|
| `IN` | The live input from your audio interface. Monitoring is on, so it is heard without arming anything. |
| `fader` | A level, a pan and three EQ bands: the shared mixer strip. Its level is in dB, 0 is unity, −60 silence, +6 the top. |
| `MIX` | The mixer's sum, which every project has. |
| `rec` | A recorder on the master run. It captures the whole mix after the fader. |
| `OUT` | The interface output. |

`settings.k7x` turns the metronome off. `project.k7x` keeps a tempo of 120, which the metronome and delays written in beats use.

## First steps

1. **Choose the input channel.** A new rig names no channel, so it says "no channel — it feeds nothing" until you pick one. Pick it on the `IN` node's card on the graph, or write it in the node file:

   ```k7x
   io("in")
   monitor("on")
   gain(0)
   channel([1]) // 1-based; a pair for a stereo input, e.g. [1, 2]
   ```

   You can also write a channel label from the machine's settings (`channel: "guitar"`), which survives moving to another machine. `gain` is a trim in dB at the interface. Keep `"on"` in quotes.

2. **Add effects** by putting modules between the input and the fader in the graph:

   ```k7x
   modules({ IN: ["amp"], amp: ["fader"], fader: ["MIX"], MIX: ["rec"], rec: ["OUT"] })
   ```

   See the Chains section of this guide for adding modules.

3. **Add more inputs**: a second input with its own fader, both landing on `MIX`. Each fader is its own node, so each input keeps its own level.

## Recording a rig

The `rec` recorder runs freely, independent of the transport (which has nothing to play in a rig). On its card:

- the round button starts a take and stops it,
- **Clear** drops the last take,
- **Save** sends it to the media library's recordings.

It passes the sound through untouched; removing it changes nothing you hear.

## Listening against a reference

A reference track plays in the browser, over the rig, without touching the engine. See [Reference tracks](./66-reference-tracks.md).
