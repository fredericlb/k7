# Mixing, metering and mastering

## Where a lane's level lives

Every track ends in a **mixer strip** — a Mixer module at the end of its chain, written when the
track is made. The strip is a module like any other, so its settings are saved in the song and can
differ between a node's alternatives.

### The mix panel

Click the **Mix panel** button in the footer (or type `ui mixer`, or `ui panel mix`) to open the mix panel under the
page: the chains graph with every strip lined up on one row, in track order. The wheel walks along
the row. The button is greyed out in a song with no strip.

Each strip has:

| Control | Range |
|---|---|
| Volume fader, with a level meter beside the rail | −60 to +6 dB |
| Pan | −1 (left) to 1 (right) |
| High, Mid, Low | −18 to +18 dB each |
| **+10** | The lane's highlight: heard 10 dB up while on, fader untouched (`track highlight`). |

Gestures on a knob or fader:

- **Drag up or down.** The engine hears it as you move; on release the value is written with
  `node param <strip> "Volume" -3.5` (or `Pan`, `High`…). A click that does not move writes nothing.
- **Shift** while dragging for fine control (a quarter of the speed).
- **Double-click** to type a value. A comma works as a decimal mark; the value is clamped to the
  range.
- **Right-click** for what can drive the control: MIDI learn, automate, and the like.

The wheel never changes a value.

Mute, solo and arm are on the lane headers of the timeline — see [Tracks and lanes](./21-tracks.md).

### The summing console

A console from your libraries can colour the whole mix: its channel half is placed after every
lane's strip and its buss half first on the master. Choose it in **Settings → Project → Console**,
or:

```text
project console                              # list the consoles available
project console @k7-core/console/console-6
project console none
```

## The song's output and the master meter

The header carries the song's **master meter** — the mix after the output level — and the output
fader on top of it.

| Part | Meaning |
|---|---|
| Bar | The output level, from −60 dB. Green, amber from −6 dB. A tick marks 0 dB. |
| Fader over the bar | The song's output level, −60 to +12 dB, in half-dB steps. Written when you let go. |
| Readout | The output level in dB. |
| Clip light | Red when the output clipped during the current or last pass. It stays lit after you stop, and clears when playback starts again. |
| **fix** | Shown when the last pass clipped. Lowers the output so that pass's peak would sit at −6 dB. |

The output level belongs to the song and travels with it in a share. Typed:

```text
project master -3          # -100 … +12 dB; 0 is unity
project master fix         # what the fix button does, from the meter's last peak
project master fix 1.8     # the same, for a peak you give in dB
```

`project master` refuses a value outside its range rather than clamping it. `project master fix`
says "nothing to catch — the last pass did not clip" when there was nothing to fix, and works only in
the browser that watched the pass.

## The mastering surface

A project can declare a **mastering** surface: one quick-master module drawn as three appliances.
Add it with:

```text
project surface new mastering
```

It then appears as a pane (`ui mastering`). Its controls:

| Part | Controls |
|---|---|
| 3-band compressor | Low cut, Low, Mid, High (amount per band), Low crossover (40–500 Hz), High crossover (800–8000 Hz) |
| Widener | Width (0–200 %), Bass mono (0–300 Hz) |
| Limiter | HF limit, Drive (0–12 dB), Ceiling (−12–0 dB), Release (10–500 ms), Output (Float / 24-bit / 16-bit) |

Which module parameter each control moves is stated under `mapping` in the surface's file in `surfaces/`. When a required control is not mapped, the pane lists what is missing instead of
drawing the controls.

A mastering control is heard at once while you move it, and is written to the song when you let
go — the same as a knob on the graph — so its setting is still there when the song reloads. Each
release is one `node param` on the module the surface maps, which you can also type yourself.

## Reference tracks

The finished mixes you compare against are played by your browser, beside the engine, from the
**References** panel (`ui references`). They are covered in the DJ and sets section of this guide.

## See also

- [Exporting and importing](./27-export-import.md)
- [Tracks and lanes](./21-tracks.md)
