# Playing the graph from a MIDI controller

Right-click any knob, slider, fader or number on a module in the chains graph and the menu
answers for **that param**: assign a control to it, or take one away. The map itself is a file —
`controller.yaml` in the module's folder, see `packages/song/docs/controller.md` — so what this
side owns is only the listening and the sending.

## The split

| | where | why |
|---|---|---|
| the map | `controller.yaml`, per module | it belongs to the device, and travels with it |
| the listening | the browser (`midiControl.ts`) | the controller is plugged in **here**; the engine may be on another machine |
| the writing | `module cc`, over the file service | a binding is an edit, and every edit is a command |

`ui midi learn <module> <param>` is the one piece that is UI-local, and it is local for the same
reason the recorder is: Web MIDI lives in the browser. It captures, then runs `module cc` — so a
learn is exactly a `module cc` you did not have to count the CC number for, and the two paths
cannot disagree about what gets written.

## Learn

Picking "bind this param to the next controller knob you touch" runs `ui midi learn <module>
<param>` and arms it; the next control change binds. The right-click already named both
arguments, so there is nothing for the command bar to collect and the menu goes straight there
(see `contextMenu.md`).

It used to pre-write the line and wait for an Enter, on the grounds that a menu should never act.
The Enter was doing no work: arming a learn changes nothing until a knob moves, and the next
paragraph is why moving one is safe. What survives from that rule is the part that mattered —
the gesture is still a COMMAND, typeable and logged, and not a menu action of its own.

The message that teaches it is **swallowed**, not also actuated. The knob you wiggle is usually
already mapped to something else, and moving that something while assigning is a surprise you
cannot undo.

## Bidirectional when possible

After a bind the status line says which you got:

```
synth Filter Freq ← Arturia MiniLab ch1 cc74 — bidirectional (the control will follow the value)
synth Filter Freq ← nanoKONTROL2 ch1 cc74 — write only (this device has no MIDI output to answer on)
```

"Possible" means: something has driven this binding (so we know *which* device to answer), and
that device has an **output port of the same name**. Pairing by name rather than broadcasting to
every output is what stops one controller's knob moving another's motorised fader.

Feedback is driven by the engine's own param values, not by what we last sent — so a fader
follows a preset load and an automation curve, not only its own knob. Two guards keep it from
looping: a value equal to the last one sent is not re-sent, and a value that *arrived* from the
device is recorded as already-sent.

`MidiFeedback` is a component that renders nothing. It exists because it is the one thing here
that must watch the plugin param store, which ticks per engine frame — subscribing in `ChainsTab`
would re-render the whole graph at that rate, which is exactly what that store exists to prevent.

## Where the runtime lives

In **`ChainsTab`**, not the shell. It is the one component that always holds the graph (the map is
part of the graph), and it stays mounted when its pane is hidden — so a controller keeps playing
while you are looking at the timeline, which is the point of having one. The shell reaches in
through a ref only to arm a learn.

Incoming values go out through the same `setPluginParam` a knob drag uses, so a param moved by
hand and one moved by a controller are indistinguishable downstream.

## What is deliberately not bindable

- **A track's mixer control** (`@volume` on a track node) — a track has no module folder, so
  there is nowhere to record the binding. The right-click falls through to the node's own menu.
- **A module FIELD** (`@monitor`) — a word rather than a number; a control change has nothing to
  sweep.
- **Notes.** A CC is what a knob sends. Pads and keys are the recorder's business (`webmidi.ts`),
  which is a different feature with a different destination.

A binding whose param has **no widget** in this project is dropped silently rather than played:
without min/max there is no way to turn 0–127 into a value, and inventing a range would make the
knob sweep one nobody chose. The map travels with the module, so meeting a project that draws it
differently is a normal state, not a broken file.
