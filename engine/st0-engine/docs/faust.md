# FaustPlugin — the engine compiles a module's Faust

`FaustPlugin` is the built-in a `plugin: {type: faust}` module loads. It takes the source on the
`faust` property of its `ValueTree`, **compiles it** with libfaust (interpreter backend), declares
one parameter per control the program announces, and runs it.

The TypeScript side is `packages/song/docs/faustModules.md`.

## The structural contract

**Parameters are created in the constructor.** Tracktion creates its `AutomatableParameter`s there
and never after, and a Faust program declares its own (`hslider`, `nentry`, `checkbox`). So the
compile happens in the constructor, not lazily in `prepare()`. Same contract as `GraphDspPlugin`,
and why `EditBuilder::addPlugin` builds those two plugins from a `ValueTree` rather than from a
type name.

Three decisions that go with it:

- **Faust groups are ignored.** An `hgroup`/`vgroup` nests a control's full path. Folding that into
  the parameter name would make the name depend on how someone grouped their source, while
  `ui.yaml` is written by hand against those names.
- **A `bargraph` is not a parameter**: it is an output the program writes for a meter. Exposing it
  would let a fader write where only the DSP should.
- **Rendering is never in place.** Input and output are two buffers, allocated in `initialise` and
  never in the callback: a `.dsp` does not promise it will not re-read an input after writing an
  output.

`takesAudioInput` and `producesAudioWhenNoAudioInput` are answered **from the compiled program**
(`getNumInputs`), which tells an effect from an instrument without anyone declaring it anywhere.

## The voices: `control: true`, `group: false`

A program with no audio input is an **instrument**, and it gets sixteen voices — `mydsp_poly` takes
ownership of the instance it is given and clones it once per voice. Neither flag on that constructor
is a detail.

**`control: true` is not optional.** From Faust's own documentation: "whether voices will be
dynamically allocated and controlled. If false ALL VOICES ARE ALWAYS RUNNING." With `false`,
`compute` takes a branch that mixes all sixteen every block and never returns one to the pool — so
sixteen FM voices computed from the first sample whether anyone plays or not, and every note past
the sixteenth steals a voice that was never freed, which reads as an instrument going silent after
a few seconds. With `true`, only playing voices are computed and a released voice is freed when it
falls below −90 dB (`VOICE_STOP_LEVEL`) — which is also what makes the decay audible rather than
merely permitted.

**`group: false`** is the other half, and it is what makes the knobs work. With `true`, the
envelope builds ONE control shared by name and distributes it over the voices — "assuming
`GUI::updateAllGuis()` is called", which nobody here calls and nobody should: it is a global static
walking a `std::list`, and the audio thread has no business in it. The knobs would then be written
into a group zone that reaches no voice, and moving one does nothing at all.

With `false`, each voice exposes its own controls and the distribution is ours: one parameter per
NAME, holding the zone of every voice that declares it (`zones_`). Writing sixteen floats per knob
per block is the whole cost, and it is nothing.

The three names the voice allocator DRIVES — `freq`, `gain`, `gate`, plus `key` and `bend` — are
filtered out of an instrument's parameter list. They are real controls of the source and must be;
but on a polyphonic instrument they belong to the playing voice. Exposed as automatable
parameters, they would be a fader fighting the allocator for the same zone, and the fader would
win between two notes.

Sixteen, and fixed: a voice is a whole copy of the program, so that is the module's cost whether
you play a chord or not. It is not in `module.yaml` because a module file describes what a module
IS, and how many fingers you have is not that.

## Notes land on THEIR sample

`renderWithNotes` splits the block at each message: apply what is due, compute up to the next
event, repeat. Faust accepts any length, so a segment is just a shorter `compute`.

Putting everything at the top of the block costs up to 5 ms: inaudible on a keyboard part, wrong on
a programmed roll — two hits 2 ms apart land together, and a semiquaver pattern loses its placement
to the block grid.

A message's timestamp is absolute; `midiBufferOffset` says where this block starts on the same
clock. The exact inverse of what `ExternalPlugin` does on OUTPUT. Nothing allocates in the
callback: the per-segment pointer arrays are sized in `initialise`, and the walk consumes the list
in order rather than sorting a copy.

And `applyToBuffer` sets a `juce::ScopedNoDenormals`: a resonant filter in the tail of its decay is
the canonical denormal generator, and the symptom is an engine that slows down the longer it plays.

## What it costs, measured

`st0-engine.exe` weighs **42.1 MB**, against 36.0 without libfaust: six megabytes, the price of the
interpreter backend. LLVM's would be another order of magnitude.

## Why the interpreter backend, and not LLVM

**LLVM is not needed.** The interpreter backend is already in the default static library
(`build/backends/interp.cmake` sets `INTERP_COMP_BACKEND STATIC DYNAMIC`), and
`createInterpreterDSPFactoryFromString` compiles a source at runtime just as the LLVM variant does:

```
cmake -S faust/build -B out -C faust/build/backends/interp.cmake \
      -DINCLUDE_STATIC=ON -DINCLUDE_DYNAMIC=OFF -DINCLUDE_EXECUTABLE=OFF \
      -DINCLUDE_OSC=OFF -DINCLUDE_HTTP=OFF -DINCLUDE_EMCC=OFF -DINCLUDE_WASM_GLUE=OFF
```

| | |
|---|---|
| `libfaust.lib` (static, unlinked) | 108 MB |
| an executable that LINKS it and compiles a module | **4.0 MB** |
| the standard libraries (`libraries/`) | 47 files, 2.0 MB |

**The tens of megabytes associated with libfaust are LLVM's.** By this route the real cost is about
4 MB.

The alternative — `faust -lang cpp` at engine build time, generating a list the way
`AirWindowsList.h` does — buys zero runtime dependency and native speed, and costs the whole point:
you can no longer write a module from the app. The engine would have to be rebuilt, so Faust
modules stop being files of a project and become engine code.

`createInterpreterDSPFactoryFromString` really takes five parameters, not seven:
`(name, source, argc, argv, error)`. The online documentation describes the LLVM variant; the header
is what counts.

### Its speed, measured in SERIES

One module in isolation says nothing: what matters is what a strip stacks up. `studio_faust_tests`
chains eight `moogladder` one behind the other, on 256-frame blocks at 48 kHz — the engine's budget,
5.33 ms of compute for 5.33 ms of audio:

```
8 moogladder in series: 19.9% of the block budget (1.06 ms per 256-frame block)
-> one instance costs about 2.49%
```

About **2.5 % of the budget per instance**. An interpreter is slower than machine code and it
shows; what this says is that ten of them can go in a chain without thinking about it, which is the
use. The test's ceiling is deliberately loose (50 %): it is there to catch an ORDER of magnitude —
an interpreter at 30 % per instance would make the route wrong — not to serve as a performance
target on a machine that is building at the same time.

## Where `import("stdfaust.lib")` is resolved

At **runtime**, when the engine compiles a module — not at build time. So the folder has to travel
with the app: `stage.mjs` copies the submodule's 43 `.lib` files into `resources/faust-libs/`, and
`faustLibrariesDir()` probes the four layouts an Electron package can take, in the same order and
for the same reason `bundle.ts` does for the file service. `$STUDIO_FAUST_LIBS` comes first: a host
with no executable to look beside — the Android app — names the folder it unpacked them into
(`docs/android.md`).

The fallback is the folder the engine's CMake fetched. It lives in a build directory and does not
travel: reaching it in an installed app means the resource staging did not happen. Which is why the
script fails loudly when it finds nothing to copy, rather than producing a package that looks
built.

`libraries/` is a **submodule** of faust (`grame-cncm/faustlibraries`). A clone that does not
initialise it gets an empty folder, and `import("stdfaust.lib")` fails at runtime — not at build
time.

## Two link traps that do not show up on the author's machine

- **Link the `staticlib` TARGET, never the path to the `.lib`.** The presets pin
  `targets: ["st0-engine"]`, so nothing builds a library nobody depends on. Naming the file links
  perfectly on a tree where it already exists — and fails with `LNK1104` on a fresh tree, at the
  very last step of a twenty-minute build.
- **`ws2_32` is required** on Windows: libfaust embeds an HTTP source fetcher
  (`sourcefetcher.obj`), and without Winsock the link fails on eight symbols that have nothing to
  do with anything being called.

## The INSTRUMENT seam

It is laid, and by the program itself rather than by a declaration. `takesAudioInput` and
`producesAudioWhenNoAudioInput` answer from the compiled program's `getNumInputs()`, and
`takesMidiInput()` answers yes exactly when a `mydsp_poly` was built — i.e. when the program has no
audio input. Nothing in `module.yaml` says which of the two it is, and nothing should: the source
already says.

The `instruments/synth/wurlitzer` module is the first to take it.

What is still open is the **catalogue**: the role decides which type folder a module is filed under
and its place in a chain, so it will probably carry two entries, a `Faust` effect and a
`Faust Instrument`, one class being unable to answer both.

## Verifying what is there

```
cmake --build --preset windows-msvc
cmake --build build/windows-msvc --config RelWithDebInfo --target \
      studio_engine_tests studio_session_tests studio_midigraph_tests studio_dspgraph_tests
ctest --test-dir build/windows-msvc -C RelWithDebInfo -R 'studio_' --output-on-failure
```

The plugin appears in `--dump-builtin-params` under the name `Faust`, **with no parameters**, and
that is not a fault: that dump instantiates each built-in from a type name, so the state carries no
`faust` property, there is no source to compile and therefore no control to declare. A Faust
module's parameters are ITS program's, and they exist only where that program does.
