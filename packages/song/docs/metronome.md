# metronome.md — the click, and how loud it is

Two fields in `settings.yaml`, and they are deliberately two:

```yaml
metronome: true
metronome_level: 0.45
```

| field | what it is | range |
|---|---|---|
| `metronome` | whether the click sounds at all | boolean |
| `metronome_level` | how loud it is | **0.2 … 1** |

Both are PROJECT settings, so both are written to the file and read by the engine off the compiled
document — there is no live control the two could drift from. The commands are
`transport metronome` (the switch) and `transport metronome volume <0.2..1>`.

## Why the level stops at 0.2

Not a taste, and not a slider that was easier to draw that way. Tracktion clamps its click gain:

```cpp
void Edit::setClickTrackVolume (float gain)
{
    clickTrackGain = juce::jlimit (0.2f, 1.0f, gain);
```

So a smaller number is accepted, written into `settings.yaml`, and then **played at 0.2** — a file
stating a level nobody hears, and a slider whose bottom third does nothing. The floor is stated once
as `METRONOME_MIN` in `@studio/engine-protocol/build` and read by the schema, the command and the
UI, because a surface that stopped somewhere else would reintroduce exactly that gap.

**Silence is `metronome: false`.** That is the other field, and keeping the two apart is what lets
turning the click off and back on bring back the level you had — one field could not do both. It is
also why the schema REFUSES a level outside the range rather than clamping it: a value that means
something other than what it says is worse than an error naming the range. `parseSettings` clamps
instead, because it also feeds the engine from files edited by hand, and landing on the number both
sides agree on beats disagreeing quietly.

## The chain

`settings.yaml` → `SettingsSchema` → `parseSettings` → `SettingsDoc.metronomeLevel` → the wire →
C++ `ProjectDoc::metronomeLevel` → `EngineHost::applyMetronome`, which calls
`Edit::setClickTrackVolume` on every apply.

Through Tracktion's setter and not the value directly: it clamps, and it remembers the choice in the
engine's own property storage, which is what makes a fresh Edit in the same process start where the
last one left off. The document still wins — `applyMetronome` runs on every apply, so a project that
states a level overrides that memory every time.

A document that states no level defaults to **0.6**, Tracktion's own, so a song written without one
clicks at the engine's own default rather than at some number this package picked.

## The control

The footer's metronome button carries both questions: a **left click toggles**, a **right click
opens the level**. The slider commits on RELEASE, not on every frame — the command rewrites
`settings.yaml` and re-sends the whole document, so a live commit would be forty writes and forty
journal entries for one gesture. Same rule as the clip panel's velocity drag and the sequencer's
nudge.

The menu says the floor out loud (`le plus bas est 20% — pour le silence, cliquez le métronome`),
because a slider that stops short of zero reads as a bug otherwise, and the way to silence it is the
control your hand is already on.
