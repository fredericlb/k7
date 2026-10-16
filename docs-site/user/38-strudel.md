# Strudel pattern files

A **generated lane** plays a [Strudel](https://strudel.cc) pattern instead of placed events. The
pattern lives in a file under `algo/`, and the engine plays it in time with the transport. Save the
file and the change is heard on the next pass.

## Wiring a pattern to lanes

1. Write the pattern in `algo/<name>.strudel`.
2. Create a lane that extends `@meta/strudel-track` and names the file:

   ```yaml
   # tracks/pad.yaml
   extends: "@meta/strudel-track"
   strudel: algo/pattern.strudel
   ```

3. Route the lane. A pattern lane holds nothing until the transport rolls, so the routing names its
   port: `pad#midi` to an instrument for notes, the bare lane (or `#audio`) for samples.

The `strudel:` value must match `algo/<name>.strudel`. If the file does not exist the project
refuses to load with `strudel pattern '…' file missing`. A pattern file no lane names is ignored.

## One file, several lanes: `.label()`

Several lanes may play the same file. Each part of the pattern says which lane it belongs to with
`.label("…")`. A label matches a lane whose name is the same word, ignoring case and punctuation:
`.label("Pad")` lands on the lane `pad`.

```js
// algo/pattern.strudel
stack(
  note("c e g c5").s("sawtooth").slow(2).label("Pad"),
  sound("bd hh sn hh").label("Kit"),
)
```

Parts with no label, or with a label no lane of that file claims, play on the file's **first lane by
name** (alphabetical order), so nothing in the pattern is silently lost.

## Samples or notes

Each event is decided on its own:

- If its sound name (`s`, or `sound`) resolves to a sample, it plays as a one-shot. Samples are looked
  up in the project's `samples/` folder, then in the folders named by the machine's `DIRT_SAMPLES`
  and `STRUDEL_SAMPLES` environment variables. `n` picks the variant.
- Otherwise it is a **note** for the lane's instrument. Its pitch is `note` (a name or a MIDI number),
  else `n` as semitones from middle C, else a fixed pitch derived from the sound name (common drum
  names map to General MIDI: `bd` 36, `sn` 38, `hh` 42, `oh` 46, `cp` 39…).

Velocity is the event's `gain` (0–1, default 0.9). Events with no `note`, `n` or `s` make no sound.

## What the pattern can use

The file is evaluated by Strudel 1.1 (`@strudel/core` and `@strudel/mini`): the pattern functions
and the mini-notation. The file's value is the pattern it ends with. One cycle of the pattern is one
bar of the song, converted with the project's tempo and metre by the engine. If the file fails to
evaluate, the previous version keeps playing.
