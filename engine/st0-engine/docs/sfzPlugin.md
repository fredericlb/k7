# sfzPlugin.md — an SFZ instrument as a built-in

`SfzPlugin` plays an **SFZ instrument**: a `.sfz` text file and the samples it names, read by
[sfizz](https://github.com/sfztools/sfizz). It is what a sampled instrument is in this engine — a
piano with sixteen velocity layers, release and pedal samples is a FOLDER of files, not a plugin to
install, and the library's `@st0/instruments/keys/piano` (the Salamander Grand Piano) is one.

## Why sfizz, and how it is built

sfizz is the one maintained-in-recent-memory, permissively licensed (BSD-2) SFZ player that is a
LIBRARY rather than a plugin: it is linked into the engine the way NAM's core is, with no window and
no format wrapper. It reads FLAC itself (dr_libs), so an instrument can ship compressed.

**Upstream is archived** (June 2026) at 1.2.3, which is pinned. Three things are patched at fetch
time (`engine/patches/sfizz.cmake`), and none will be fixed upstream: its 32-bit ARM test matches
`arm64` and passes flags clang refuses on Apple Silicon; its vendored `atomic_queue` uses a
`template` keyword form that clang 19 makes an error; and on MSVC it forces the static C runtime,
which a library linked into an engine on the dynamic one cannot use — every object it builds
would clash at link time.

**One feature is patched in as well: a gain per KEY.** A kit's pad must be able to sit louder or
quieter than the others. Velocity cannot do that, because on a sampled kit a velocity also picks the
sample layer, so a softer pad is a different stroke and not just a quieter one. SFZ has no per-key
level a host can set either: the opcodes that come close (`amp_keytrack`) are a slope, not a
table, and editing the kit's regions means rewriting a file the supervisor owns. So the patch adds a
128-entry dB table to sfizz's config and adds a note's entry to its voice volume when the voice starts,
the same place the region's own `volume` is applied. The plugin exposes it as `Key 0` … `Key 127`,
from -24 to +12 dB, and writes the table from the audio thread at each block, where sfizz
reads it, so no lock is shared. A gain applies to the notes that START after it changes. A ringing
cymbal keeps the level it was struck at, which is also what a real one does.

**It is compiled as C++17, ours being 20.** Under C++20 `std::result_of` is gone and abseil changes
what `string_view` is, and sfizz does not build; 17 is what it already picks for itself on MSVC, so
it is the one standard every platform builds it at. Only its public header is included on our side,
and that one is plain `std`. **Not shallow**: one of its submodules has a submodule pinned at a
commit a shallow clone cannot reach. It is built on **every platform, Android included**: there
the engine library links it with no static TLS (`llvm-readelf -d` shows none, which `android.md`
says the loader would refuse), and the stripped library with it is 40.5 MB. `STUDIO_SFZ` is what says the
plugin is compiled in, and the scan lists it only then.

**On a phone, the instrument is the expensive part, not the code.** The app's supervisor downloads
every instrument into its storage when the engine starts, as a desktop's does. Playing
one on a device has not been measured yet: how much of each sample sfizz keeps in memory, and
whether the phone's storage streams the rest fast enough, are the two questions it would answer.

## Where an instrument is

An instrument's samples run to hundreds of megabytes, so they are in no library and no project:
`@instruments/<name>/<file>.sfz` names a folder under THIS machine's `<state>/instruments`, the same
state directory the scan cache uses (`$STUDIO_HOME`, else `~/.st0`), and `SfzPlugin::resolve` is the
one place that reads it. The supervisor fills that folder when the engine starts, every instrument
it ships whether or not a song names one, pinned by hash (`engine/st0-supervisor/docs/instruments.md`).
So the files come from their origin straight onto the machine that plays them — never through a
server, and never once per account through a tunnel. Any other `sfz:` is a path, played as written.

**One not downloaded yet is waited for, not refused.** A song can be opened during the first
download; the plugin says so once, checks every two seconds on the message thread, and loads the
instrument the moment its `.sfz` is there. Until then the node is silent. An offline render cannot
wait — it runs no message loop — so it renders the silence.

## Loading off the audio thread

The instrument is named by the document (`PluginDoc::sfzFile`) and loaded by `loadPluginFiles` on
the message thread like a NAM model — never from the plugin's stored state, so the file the song
names is the one that plays. Loading parses the `.sfz` and preloads the head of every sample, which
takes seconds on a big instrument, so it happens in a FRESH synth that is swapped in under a lock
the audio thread only ever tries: a block that finds it taken renders silence rather than waiting.
The old synth is destroyed after the swap, on the message thread.

**An offline render free-wheels.** sfizz streams most of each sample from disk while it plays; a
render runs faster than real time and would reach a note before its sample did, so while
`isRendering` is set the synth loads each sample before sounding it.

**One parameter, `Volume`** (dB). Everything else a sampled instrument does is in its samples and its
`.sfz`; sfizz's own controls are the instrument's CCs, which reach it as MIDI like any other.
