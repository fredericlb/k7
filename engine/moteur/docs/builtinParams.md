# A built-in's parameters, known without a running engine

The module builder binds a widget to a parameter by NAME, and the bind list is the only place a
name can come from. Three sources feed it, and two of them are *learned* — the base module's own
`params:` and whatever extends it. So a plugin nobody has authored a param on yet has an **empty
list, and no panel can be built for it at all**, which is the one thing the builder exists to do.

That is what 4OSC looked like: 68 parameters, none of them offerable.

## Why nothing static could find them

A Tracktion plugin registers its parameters **in its constructor**. `FourOscPlugin` calls
`addParam` 68 times there — four oscillators of seven, two LFOs, two envelopes, a filter, and the
built-in effects. Nothing short of an instance can list them, so reading the C++ is guesswork that
rots the first time Tracktion is bumped.

`--dump-params` cannot answer it either, and this is worth knowing before reaching for it: that
mode prints the **non-default subset** — the "preset" of an instance somebody configured. On a
freshly created plugin it prints `{}` whatever the plugin has, which is exactly the shape of an
answer that looks like a confirmation.

## So the table is generated, from a real instance of every built-in

```
studio-moteur --dump-builtin-params          # what a TYPE has: name, range, default, named states
node engine/moteur/scripts/gen-builtin-params.mjs
  → packages/song-schema/src/builtinParams.generated.ts
```

The script instantiates every entry of `builtInPlugins()` — the same list
`registerBuiltInPlugins` matches, so a plugin the UI offers is one this can ask — reads
`pluginParams(plugin, true)` off it, and writes the file `@studio/song` ships. **The output is
committed**, so nothing in the build depends on a C++ binary; re-run it after bumping Tracktion
or adding a built-in.

Today: **26 plugins, 150 parameters** — 88 of them 4OSC's.

`withStates` is on, unlike the hot path: a discrete parameter's named settings are what make a
dropdown instead of a slider, and collecting them costs one pass here rather than one per state
frame — which is precisely why that flag defaults to off.

`builtinParams.ts` is the half a human writes: the shape, and how a module's `plugin:` block finds
its entry. That lookup accepts **both spellings** — the human form (`Chorus`, `Mixer`) and the
internal id (`chorus`, `studio_mixer`), case-insensitively — because that is exactly what the
engine's `resolveBuiltInType` does in `EditBuilder.cpp`. The two disagreeing would be the worst
available shape: a module that plays perfectly and shows an empty parameter list.

## Controls that are not automatable parameters — and the table is a SUPPLEMENT

Chorus and Phaser keep their controls as `juce::CachedValue<float>` members bound to ValueTree
properties (`depthMs.referTo (state, IDs::depthMs, um, 3.0f)`) instead of calling `addParam()`.
Nothing enumerates those, so the engine carries their metadata by hand in `PluginParams.cpp`'s
`stateParamTable()`.

That table used to be reached **only when the automatable walk came up empty**, which was right
for the two plugins it was written for and wrong the moment a plugin had both kinds. 4OSC has
both: 68 registered parameters, and its **wave shapes** on the ValueTree — so its 68 hid them, and
it read as a synth whose oscillators could be tuned but not chosen.

It is appended now, guarded by name so an entry can never shadow a registered one. 4OSC's 20 state
controls are in it:

| what | why it is here |
|---|---|
| `Wave Shape 1..4`, `LFO Shape 1..2` | `CachedValue<int>`, and the only ones whose settings the header NAMES |
| `Voices 1..4`, `Voices`, `Voice Mode` | ints with no automatable twin |
| `Filter Type`, `Filter Slope` | the same, and see below |
| `Amp Analog` | a bool |
| `Distortion/Reverb/Delay/Chorus On` | the four built-in effects' switches — their depth and mix knobs ARE automatable, and a knob doing nothing because the effect is off is the worst version of an incomplete list |
| `Delay` | the delay TIME, whose three companions are automatable and it is not |

**Named settings only where the plugin names them — and "is there an enum" is the wrong question
to stop at.** `FourOscPlugin::WaveShape` *is* an enum (`none, sine, triangle, sawUp, sawDown,
square, random`), so a wave shape carries those seven labels with the value that selects each and
draws as a list. The other three have no enum and are named all the same:

| control | where its values are named |
|---|---|
| `voiceMode` | `isMono()`, `isLegato()`, `isPoly()` — three predicates in the header |
| `filterType` | the calls it selects in `updateFilter`: `makeLowPass`, `makeHighPass`, `makeBandPass`, `makeNotchFilter`, and 0 skips the filter |
| `filterSlope` | `filterSlopeValue == 24` is the test that cascades the second pole pair — so 12 or 24, and the values ARE the dB/octave |

Read off the code that CONSUMES the value, which is exactly how this table's ranges have always
been derived. What is still refused is a label nobody wrote down: an invented one is worse than a
number, because it reads as knowledge.

**4OSC is polyphonic**, and the table says so now: `Voice Mode` defaults to Poly, with 32 voices
and voice stealing on. `Voices` means something only in Poly — the other two modes reduce the pool
to one whatever it says (`valueTreePropertyChanged`). The per-oscillator `Voices 1..4` is a
different number: unison copies within one voice, which `Detune` and `Spread` act on.

The generator picks all of this up without knowing any of it is special.

The **defaults** in that table are copied from each plugin's constructor and are exact. The
**ranges** are ours: the plugin never publishes one, so they are read off how `applyToBuffer()`
consumes the value. They are advisory metadata for a UI, not a claim that the plugin enforces
them.

| plugin | property | how the value is used | range |
|---|---|---|---|
| chorus | `depthMs` | modulation depth added to a fixed 20 ms base delay | 0..20 ms |
| chorus | `speedHz` | LFO frequency, `2pi / (sampleRate / speedHz)` | 0..10 Hz |
| chorus | `width` | right-channel phase offset, used as `pi * width` | 0..1 |
| chorus | `mixProportion` | fed to `AudioFadeCurve::CrossfadeLevels`, a 0..1 crossfade | 0..1 |
| phaser | `depth` | octave span of the sweep, `range = pow(2, depth)` | 0..10 |
| phaser | `rate` | sweep rate, `pow(range, rate / (sampleRate / 2))` | 0..10 |
| phaser | `feedback` | feedback gain, `t = in + feedback * fv[7]` | 0..1 |

Note the phaser's member is `feedbackGain` but its **property** is `feedback` — the property name
is what matters here.

Automation does not go through that fallback: a curve needs a real `AutomatableParameter`, so a
state param can be set and read but never automated.

## An empty list is an ANSWER

Patch Bay, MIDI Patch Bay, Text, Insert, Freeze Point, Aux Return, Level Meter and Sampler come
back with no parameters, and the generated table keeps them as `params: []` rather than dropping
them. Their state is genuinely not parameters — a patch bay's is its routing, a sampler's is its
sounds. "It has none" and "we never asked" are different answers, and only the first lets a panel
say so instead of looking unfinished. `builtinParamsFor` returns `undefined` for the second and
`[]` for the first.
