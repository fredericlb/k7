# surgePlugin.md — Surge XT as a built-in

`SurgePlugin` plays a **Surge XT patch**: an `.fxp` file a module chooses as its `base:`, rendered by
Surge's own synthesizer compiled into the engine. It is the engine's one full synthesizer — three
oscillators per scene over a dozen algorithms, two filters from forty models, waveshapers, twelve
modulators and a routing matrix, two effect chains. Every other built-in instrument is a single
voice (the eurorack modules, `eurorack.md`), a small subtractive (4OSC), a program written here
(`faust.md`) or samples (`sfzPlugin.md`).

## Why Surge

A convincing synth sound is an engine AND a patch, and the patch is most of the work. Surge is the
one open-source synthesizer that has both: a core as capable as commercial ones, and hundreds of
factory patches made by sound designers. It is GPLv3, which is this engine's licence too (`../LICENSE`).

## What is built, and from where

**A commit of `main`, not the 1.3.4 release.** That release's core links `juce_dsp` for two effects,
which would put a second JUCE beside Tracktion's in one binary. `main` dropped it: its core is
JUCE-free. The commit is pinned in `../CMakeLists.txt`.

**Only the core**, `surge-common`: no plugin wrappers, no JUCE, no standalone. Three features are
off:

- **Lua** — the formula modulator and wavetable scripting. LuaJIT is a Makefile build that does not
  cross-compile with the rest. Among the factory patches only the templates and tutorials use it,
  and the library leaves those out.
- **MTS-ESP** — microtuning shared between plugins, which needs a host that has other plugins.
- **`-Werror`** — Surge's own flags are its business; the engine's warnings are not raised by them.

**Fetched by a script** (`engine/patches/surge-fetch.cmake`), not FetchContent's git step, which
cannot shallow-fetch a commit hash. A full clone is 640 MB; the script fetches one commit, sparse
without `resources/data` (480 MB of presets, wavetables and skins the engine never reads), and
only the fifteen submodules the core compiles from — not JUCE, LuaJIT, pybind11 or the CLAP glue.
It then drops every `.git`, having written the branch and hash to `VERSION_GIT_INFO`, the file
Surge's `cmake/versiontools.cmake` reads before it asks git (`build.md`).

**Four fixes at fetch time** (`engine/patches/surge.cmake`), every one about being a SUBPROJECT:
two paths and a version number Surge takes from the top project, which is ours; the static MSVC
runtime it forces, which an engine on the dynamic one cannot link (sfizz has the same fix); and the
storage config a synth is built with. Two settings in `../CMakeLists.txt` do the rest:
`SURGE_RELIABLE_VERSION_INFO` off, because the other branch stamps the build time into a source
and would relink the engine on every build; and `std::filesystem` forced, because sst-plugininfra
probes for it under the 10.13 deployment target Tracktion forces, and the probe fails. On macOS the
top project enables Objective-C and Objective-C++ itself: Surge's path code is a `.mm`, and a
language enabled only inside a subdirectory configures fine and then fails to generate
(`CMAKE_OBJCXX_COMPILE_OBJECT` missing).

**On the phones too.** `STUDIO_WITH_SURGE` is on everywhere; a build that turns it off gets no
Surge and no `STUDIO_SURGE`. Surge's SIMD goes through simde on ARM, as on Apple Silicon, and
Android asked three things of it:

- **No `backtrace()` before API 33**, and the app starts at 29: the crash report's stack trace is
  left out on Android (`patches/surge.cmake`).
- **No `libpthread`**: Android's pthreads are in its libc, so the name is linked everywhere else.
- **A `HOME`**: Surge's storage throws without one, and an Android app process has none, so
  `EngineBridge.kt` sets it to the app's files folder. Surge writes nothing there — its config
  creates no user directory and scans no library.

Measured on a Nothing Phone (4a) Pro (A069P, Android 16, arm64), 2026-10-20: the engine library
grows from 40.7 to 46.1 MB, the APK from 121.9 to 124.3 MB. A four-note chord held on a patch from
`base/` costs 5.7 % (Basses/E-Bass) to 8.1 % (Pads/Bell Pad) of the audio block on average, 14 % at
most, with no underrun; loading a patch takes 110 to 150 ms of the apply.

## Four namespaces are renamed, or the engine runs the wrong code

Surge brings its own copies of code the engine already links: Mutable Instruments' `plaits`,
`clouds` and `stmlib`, from Surge's fork at another commit than `eurorack.md`'s (and without its
Clouds fix), and a newer `Tunings` than the one inside sfizz. A static link keeps ONE definition of
each symbol and says nothing, so a module ends up running the other copy's code on its own data
layout. It is not hypothetical: unrenamed, building a Surge synth crashes in sfizz's
`Tunings::Scale::operator=` applied to Surge's `Scale`, and nothing guarantees `mu-plaits` still
runs the firmware it was tuned against.

So every Surge source is compiled with `plaits=surge_plaits`, `clouds=surge_clouds`,
`stmlib=surge_stmlib` and `Tunings=surge_Tunings` (`STUDIO_SURGE_RENAMES`, directory-scoped around
Surge's subproject, and given to `studio_surge` too). Macros do not reach `#include` paths, so
the headers still resolve. **After a Surge or sfizz bump, or a new library, check the link again**:
list the symbols, hidden ones included (`nm -m`), that a Surge archive and any other archive both
define. What is left is identical `std::` template code and the aligned `operator new`, both
harmless.

## No Surge install, no files written

A synth is built with an empty data path, no factory scan and no user directory. A patch carries
its own wavetables, so loading one reads that one file. Without the config fix in `surge.cmake` a
synth would index any factory library it found on the machine (60 ms per instance instead of 10)
and create `~/Documents/Surge XT` on the musician's disk.

## The core is JUCE-free, for the eurorack cores' reason

`surge-common` exports `MAC=1`, `WINDOWS=1`, `UNICODE` and its block size as PUBLIC definitions.
`engine/surge/SurgeCore.{h,cpp}` is a pimpl in its own library, `studio_surge`, linked PRIVATE: the
definitions reach that one translation unit, and `SurgePlugin.cpp` includes a plain header.

## Choices inside the plugin

**A patch is a BASE**, `base: Pads/Bell Pad`, a file under the module's `base/` beside any
`.vstpreset` (`packages/song/docs/userPresets.md`). That is k7's place for a plugin whose state is not
its parameters, and a patch is exactly that: its routing, wavetables and step shapes are no knob. So it
gets what every base gets — chosen per node, the node's own values applied over it — and a preset keeps the base it was taken on. The library's preset shelf holds a
FACTORY preset per patch, `<Category> - <Patch>`, generated beside the panel: a base and nothing else,
which applied is that patch, since a base switch drops the node's own values. That shelf is how a patch
is picked, so the panel carries no base dropdown: two pickers for one choice, one of which kept the
old patch's values and one of which dropped them, would be two answers to the same click. The compile sends a `.fxp` base as
`surgePatch` rather than as the `.vstpreset` path, an absolute path — which is what lets a remote engine
have it: the tunnel copies every file a document names under a shared root
(`packages/engine-tunnel/docs/tunnel.md`).

**A new patch is a new synth.** It is built and loaded on the message thread and swapped in under a
lock the audio thread only tries, as SfzPlugin swaps instruments. Loading into the live synth would
mean the audio thread waits on a file read. It stays on the message thread, unlike SfzPlugin's, which loads on
a thread of its own: a patch SETS every parameter, and the document's own values go on top right after
(`loadPluginFiles`, then `applyPluginParams`). A patch landing later from another thread would put
its values back over the document's. The build and the parse are milliseconds, not an SFZ's seconds.

**Every parameter of Surge's is one of the plugin's, except the MIDI ones**: 758 of them, then the
eight macros. What is left out is what the engine does itself with notes — the scene split, the
channel split, the active scene, the pitch-bend ranges. The list and its order come off a fresh synth
(`SurgeCore::params`), so they are the same for every patch, which a Tracktion plugin needs: its
parameters are created once, in its constructor.

**Names are STABLE, and that rules out Surge's own for two kinds.** A scene's parameters carry its
letter (`A Filter 1 Cutoff`); the rest is Surge's name. But an oscillator's seven slots and an
effect's twelve mean what their owner's TYPE makes them — `a_osc1_param0` is Shape on Classic and
Morph on Wavetable — so they are `A Osc 1 Param 1` and `FX A1 Param 1`, and the panel's screens say
what each one does for the type set. A name that followed the type would rename an automation curve
under the musician the moment they changed oscillator.

**Ranges are 0..1 except the selectors.** A continuous value goes through Surge's own normalised
scale, the one every host automates Surge by; a slot does too, whatever its type makes it. An integer
or a switch — a type, an octave, a mode — keeps its own range, so a module file reads
`A Osc 1 Type: 2` and a dropdown's values are the choices' indices.

**The parameters FOLLOW the synth.** A patch load writes every value of the patch onto them, and
the document's own values go back on top after it, as after a `.vstpreset` (`EditBuilder`,
`EngineHost`'s reload). A type change resets its slots inside Surge, so the plugin reads the synth
back ten times a second and moves any parameter the synth moved and nobody touched — which is what
keeps a knob from showing the old type's value. The writes skip the undo manager: they are the
patch's, not an edit.

**The timer never reads the synth.** The audio thread owns it while it renders — a type change
rewrites a slot's range and value mid-block — so a message-thread read can see half of one, and a
value read half-written would be pushed back as a parameter. Taking the lock instead is no option:
the audio thread only tries it, and every tick that held it would be a silent block. So the timer
ASKS, and the audio thread, holding the lock after its block, publishes the synth's values beside
the `agreed` value of each; the next tick reads that copy. A parameter is moved only when the
synth's value left the one agreed at that snapshot and nothing was pushed or touched since, so a
snapshot up to a tick old cannot undo a knob turned meanwhile.

**A value's text is read off a TWIN.** Surge's own words for a value — `440 Hz`, `-6.0 dB`, a slot's
meaning under its type — come from the parameter's `Parameter` object, which a type change rewrites
on the audio thread: a message-thread copy of the live one can tear, and it holds strings and an
optional that a torn copy corrupts. The lock is no option, for the timer's reason. So the plugin
keeps a second synth on the message side, built on the first text anyone asks for and dropped on a
patch change, and brings it to the values the audio thread last PUBLISHED for the read-back — types
included — before reading it; it renders twice after a change, since Surge applies an effect's type
inside a render. Nothing in the engine asks for text today, Tracktion's control surfaces aside, so the
twin's cost — a synth's memory — is paid only by a host that does; and its text lags the live synth
by one read-back at most.

**The panel is GENERATED** (`scripts/gen-surge-panel.mjs`, `npm run gen:surge-panel`) from
`k7-runtime --dump-surge-layout`: the parameters with their ranges and choices, and what every
oscillator and effect type calls its slots. Seven hundred binds typed by hand would drift from the
engine the first time Surge renamed one; the generator refuses a bind the engine does not have.
Run it after a Surge bump. The oscillator and effect types that need an audio input are left out of
the pickers — this instrument takes none — and a patch that uses one still loads.

**Every page is laid out twice, from ONE list of sections** (`packages/ui-module-builder/docs/layouts.md`):
across 4 rows for the panel, stacked in 4 columns for `vertical:`. A section names each control's box in
both shapes, and the generator refuses one that lacks either, so a control cannot exist in one shape only.
Four rows hold a section two knobs high, which is why a scene's page is split where Surge's is not: the
envelopes and the VCA get a page of their own beside the filters, and each LFO bank is two pages of three,
each with a screen drawing those three. The macros and the level stay on every page, a frame at the panel's
right and at the top of the vertical one. The LFO and effect slots keep 1×1 knobs: ten or twelve 2×2
knobs a slot would cost a page per slot.

**A page per OSCILLATOR, holding its mix channel.** Surge draws an oscillator's controls and its
mix channel on two different panels. Here each oscillator gets one page with its type, slots, route,
level, mute and solo, because what a sound is made of and how loud it goes in are adjusted together.
The ring modulators, the noise and the scene-wide controls are what is left, on the scene's own page.

**Each oscillator page shows which EFFECTS its sound reaches, and how much.** Surge applies effects
per scene, not per oscillator, so this screen shows the oscillator's path rather than a setting of its
own. That path is the scene's four inserts, then the four sends at this scene's send level times their
return, then the four globals. Each effect's share is its own `Mix` slot where its type has one, and
all of it where the type has none. `FX Chain Bypass` greys out the groups it switches off, and a
muted oscillator reaches nothing. The routing is in the patch and not in any one knob, so a list read
off the parameters is the only place it can be seen at once.

**Modulation routing is not a parameter.** Which LFO moves which control lives in the patch, so the
LFO pages shape the modulators a patch already routes and route nothing new.

**Events land on Surge's block, not their sample.** Surge renders fixed 32-sample blocks, so an
event is played before the block that follows it — at most 0.7 ms late at 48 kHz. An event after the
buffer's last block boundary is handed over at the end of the buffer, never dropped.

## What it costs, measured

On an M-series Mac, a six-note chord held four seconds then released, factory patches with their
effects on: **0.5 to 1.5 % of one core**. A synth builds and loads a patch in about 10 ms. A
process holding one synth peaks at **about 30 MB**, so a song with ten Surge tracks pays a few
hundred, and a patch change briefly holds two synths for that track.

**Surge is not deterministic from run to run** — oscillator phases and drift are random — so two
renders of the same notes differ sample by sample. A render can be checked by level or spectrum,
never by comparing samples.
