# plugins.md — finding, creating and asking a plugin

Three files share this subject and none of them is the whole of it: `PluginScan.cpp` discovers
what exists, `EditBuilder.cpp` creates one into an edit, and `ParamDump.cpp` creates one on
nothing in order to ask what it has. The traps below are shared between them, which is why they
are on one page rather than three.

`docs/builtinParams.md` is the neighbouring page: what a BUILT-IN publishes, and the generated
table st0 reads. This one is about the plugins that come off disk.

## Register the description BEFORE you create the plugin

`createNewPlugin` keeps **none** of the `PluginDescription` you hand it. It builds an
`ExternalPlugin` from it and throws it away; `initialiseFully` then looks the plugin up *again*,
in `PluginManager::knownPluginList`, and instantiates nothing when that search comes back empty.

Nothing seeds that list here. The moteur runs no Tracktion scan and persists no plugin list —
`%APPDATA%/Studio/Settings.xml` has no `pluginList` key at all — so on a fresh engine it is empty
and **every** external plugin fails at once, whatever the plugin is.

What that looks like is why it goes unnoticed. Tracktion's `getLoadError()` answers "there is no
instance" with a sentence about the plugin — `ERROR! - This plugin couldn't be loaded!` — which
reads as a licence or a bad install, a fact about the machine that no code could fix. It is
neither.

Two sites carry the one-liner today, `EditBuilder::makeExternalPlugin` and `ParamDump`'s
`describeExternal`. A third creation site needs it too. `describeExternal` takes the engine as a
parameter rather than leaving the caller to remember, which is the point: a caller that forgets
registers nothing, and every plugin it asks about answers empty.

It is *not* an async problem. `VST3PluginFormat::requiresUnblockedMessageThreadDuringCreation`
returns false in this JUCE, so `ExternalPlugin::requiresAsyncInstantiation` is false and the
instance is built synchronously on the calling thread. LADSPA the same; AudioUnit is the only
format that ever answers yes. The pump-during-creation theory reads convincingly and is wrong —
check what `requiresAsyncInstantiation` actually returns for the format in hand.

## A CLI must drain the message queue before it returns

`~ExternalPlugin` frees no plugin. It hands the instance to Tracktion's `AsyncPluginDeleter`,
which parks it in an array and starts a 100 ms `juce::Timer` — one instance freed per fire. The
server and the tray run a message loop, so that timer fires. A CLI runs none, so the instances are
still alive when JUCE's shutdown reaches `DeletedAtShutdown` and the deleter's destructor drains
them itself, entering a modal state on a `Component` in the middle of teardown.

That is an intermittent SIGSEGV **after** a perfect answer has been printed: 7 of 32 runs without
the pump, 0 of 32 with it, on Arturia's Prophet-5 V, CS-80 V4 and Jup-8 V4. Load-dependent — it
disappears for twenty clean runs and comes back — so measure it over a batch, never on one run.

It is the worst shape available, because `execFileSync` in the translator
(`packages/translator/src/params.ts`) raises on a non-zero exit and throws away the dump it
already has: a perfect answer read as "the engine returned no params".

One `runDispatchLoopUntil` before returning is the whole fix.
`dumpPluginParamsExternal` waits 500 ms rather than the 200 ms of `OfflineRender.cpp`'s
`drainMessageQueue`, because the deleter frees ONE plugin per fire and that path makes two.

## Read a `.vstpreset` through `loadVstPreset`, never `setStateInformation`

A `.vstpreset` is a Steinberg `PresetFile` — a container, with a header, the plugin's class id and
chunk offsets around the state. `setStateInformation` expects JUCE's own VST3 state format, so
handed the raw container it takes none of it and returns `void`: no error, no exception, nothing
to test.

What it prints then is the fresh instance's defaults, `complete: true`, with the same 77
parameters for a saved Mini V3 patch as for a plugin never touched — a confident answer to a
question it never asked, and the translator writes those defaults into the chain as the musician's
sound.

`EditBuilder::loadVstPreset` parses the container properly
(`VST3PluginFormat::setStateFromVSTPresetFile`), and the rack load, the editor's preset picker and
`--dump-params-ext` all go through it. Be its next caller rather than a second hand-rolled parser.

### `complete: false` from a big instrument is the flag working

`--dump-params-ext` reports `complete` by round-tripping: a fresh instance carrying only the text
params must reproduce the exact state blob. Only then is dropping the opaque preset lossless.

Expect `false` from the big commercial instruments, and do not go looking for the bug. Their patch
is not in their automatable parameters — an Arturia **Wurli V2 reports the same 50 values** loaded
from a preset as untouched, and **Mini V3 the same 77**, checked against the JUCE
`AudioProcessorParameter`s directly and not just Tracktion's cache in front of them. So it is the
plugin's own answer, not a value gone stale. What the preset changed is opaque chunk state, which
is exactly what `complete: false` is for: **keep the `.vstpreset`.**

A `true` reached through a state load that applied NOTHING is the damage to fear — the round-trip
matches trivially, and the translator drops a preset for the defaults.

## Waiting for a parameter list, and reading a zero

`createNewPlugin` does not always come back with a loaded plugin, and it hands back a `Plugin`
whether or not an instance was ever made — that object is what draws a red box in a project whose
plugin is missing. "Not null" has never meant "loaded".

`waitForParameterList` waits on the parameter COUNT rather than on `isInitialisingAsync`. The tell
that a zero is about the load and never about the plugin: `buildParameterList` adds `dryGain` and
`wetGain` unconditionally, before it looks at the instance at all, so anything loaded reports at
least two. Zero cannot mean "it has none". The flag would be the narrower race — it is cleared at
the top of `completePluginInstanceCreation` and the list is built at the bottom.

`getLoadError` is the question that distinguishes "refused" from "slow", and it is empty while an
async load is in flight, so it is only conclusive once nothing is. The wait **sleeps rather than
pumps**: it runs on the socket's detached thread, and the callback that builds the list is
dispatched to the message thread, which the server is already running — pumping from here would be
a second thread claiming the message loop.

**A zero says something about this PROCESS at least as often as about the machine.** Read the wrong
way — through a `getLoadError` that reports an unregistered description in the words of a plugin
that failed — twenty-seven of forty external plugins "never load at all", Arturia's CS-80 V4,
Prophet-5 V, DX7 V and Piano V3 among them, which sends you to a licence or an installation. Every
one of them loads: **CS-80 V4 answers with 719 parameters, Prophet-5 V with 603, Piano V3 with
151.**

## One offline engine per process, and the orphans on it

`ParamDump.cpp`'s `ParamQueryEngine` is built on the first ask and kept for the run.

**One per process, not one per question.** A `te::Engine` per query, built and destroyed on the
way out, kills the engine after forty of them in a row — twice, measured on a pass that drew a
panel for every module in a library of 260. Nothing in Tracktion promises that constructing and
tearing down whole engines beside a live one is safe, and it is not. That one engine can host
every plugin in turn is not a hope: `dumpBuiltinParams` creates 212 of them in a single edit, one
at a time. Keeping it alive also makes a batch far cheaper, since building the engine is most of
what a query costs.

Still an engine of its own rather than the live host's: that one holds the audio interface, and an
ASIO driver is single-client — a query that borrowed it would wedge the thing making sound.
`makeOfflineEngine` opens no device. And it is **leaked deliberately** — `new`, never deleted. A
destructor would run at process exit in an order nothing here controls, which is the same teardown
crash moved to the end of the run.

`paramQueryMutex` serialises the queries: one edit, and two plugins being built into it at once is
not a thing Tracktion offers. It costs the caller nothing it was not already spending — the ask is
seconds.

An **orphan** is an installed plugin instantiated on nothing: on the shared offline edit, on no
track, wired to nothing, belonging to no session, saved nowhere. That is what makes it answerable
at all — the module being authored may name a plugin the open project does not load, or there may
be no project.

Two entry points, and the distinction is the whole reason there are two:

| call | behaviour |
|---|---|
| `orphanPluginFor` | give me this plugin — loading one to satisfy that is right |
| `orphanPluginIfLoaded` | a SNAPSHOT: what is this instance holding right now |

If there is no instance, the honest answer to the second is "nothing", not "here are the factory
defaults I just loaded for you". The second would write a file the user believes is the sound they
dialled in, and it would be silence-shaped: correct bytes, wrong sound, discovered weeks later.

`pluginParamsOf` drops its plugin the moment it has read the list — an instrument left on the
shared edit holds voices and a binary open. An orphan opened for its own WINDOW cannot be dropped
on the same principle, since the window is still on screen and the user is turning its knobs, so
it is held instead, one per plugin, until the process ends. A handful of loaded synths is what the
feature costs, and it buys a reopen that is a visibility flip rather than another fourteen seconds
of loading.

`nullopt` from `pluginParamsOf` means "no answer about this plugin" — cannot find, cannot create,
cannot load — and never "this plugin has no parameters".

## Built on the message thread

Both entry points are called from the socket's detached worker, and neither builds its plugin
there. `onMessageThread` hands the creation — and the shared engine's own construction, the first
time — to the message thread and waits for it; the worker only WAITS for the parameter list, and
the read and the `deleteFromParent` go back to the message thread too.

A VST3 instance is built synchronously on whatever thread asks (see AGENTS.md), and some plugins
post work to the main run loop while they are being constructed. Built on a worker, that work runs
on the message thread against an instance still half-built: Arturia's Matrix-12 V2 dies there of a
null read three times out of three, inside its own code, under `runDispatchLoopUntil`, before any
parameter is listed — while the same plugin through `--dump-params-ext`, which builds it on the
main thread, lists 4524 parameters and exits clean. Jup-8 V4, from the same vendor, survives the
worker build, which is what makes the hazard easy to miss: it is a race that most plugins win.

What it costs: the message thread is busy for as long as the plugin takes to construct — the UI
socket answers late during that time, the audio thread does not notice. That is the price of a
query not killing the engine that is making sound.

## The scan

`scanInstalledPlugins` loads each plugin in a **child process** (`runPluginScanChild`), so a
crashy plugin only kills its own child. The child fences its JSON with `STUDIO_SCAN_BEGIN` /
`STUDIO_SCAN_END` sentinels, because a plugin is free to print to stdout while loading. The parent
captures the whole of that output on a helper thread — `readAllProcessOutput()` blocks until the
child exits — and bounds the wait at 20 s, so a hung plugin is killed and the reader unblocks.
`ChildProcess::start(StringArray)` is used rather than a command line so a `C:\Program Files\…`
path reaches the child's argv intact.

`<state>` is the ONE directory `@studio/song`'s `studioHome.ts` computes — `$STUDIO_HOME`, else
`~/.st0`, the same on every platform. `extsCacheFile()` mirrors that by hand, and must: juce's
`userApplicationDataDirectory` is NOT node's equivalent (`~/Library` against
`~/Library/Application Support` on macOS), so a per-platform rule would have these two halves
computing different directories on two of the three. A wrong path here does not throw — the engine
reads its own cache and logs "N from cache" while the TypeScript finds nothing and draws every
`@engine/…` module unresolved. See packages/engine-client/docs/paths.md.

The cache is `<state>/exts.json`, keyed by identifier and carrying the file's mtime. An entry is
reused only when the file is unchanged **and** it already holds a full `PluginDescription` as XML
— older caches do not — so a plain rescan upgrades pre-description entries without needing
`--force`. Keeping the description is what lets `makeExternalPlugin` instantiate without calling
`findAllTypesForFile`, which would reload the binary just to re-derive it. The map written back
holds only current files, so uninstalled plugins drop out.

**When the engine scans on its own is `pluginCacheWarm()`'s answer, asked of the FILE.** Not
`!loadPluginCache().empty()`, which is always true since that list starts with the ~224 built-ins:
the startup warm would never scan, and on a machine where nobody typed `st0-engine scan` there would
be no `exts.json` at all — so the TypeScript, which reads that file for `@engine/…`, would show an
empty engine library. Warm means: the file holds `builtin:*` entries equal to this binary's built-ins (a built-in
added or renamed since the last scan otherwise never reaches the TypeScript), and at least one
external, unless the build can host none (Android). The scan is incremental, so a warm-up forced
by a new built-in re-reads no plugin binary.

`cachedPluginInfos()` memoises the parsed cache, because `makeExternalPlugin` runs per plugin and
re-parsing added up on projects with many. It is handed out as a **shared snapshot**, not a
reference into a global: `scanInstalledPlugins` invalidates the memo from a DETACHED thread while
the message thread reads it, and `makeExternalPlugin` holds a raw `const PluginInfo*` into the
vector across a dozen lines — a background scan finishing mid-apply therefore freed the buffer
under it. Hold the returned pointer for as long as you hold anything into what it points at, and a
rescan lands on the next lookup instead of on this one.

## The built-ins are code, not cache

`builtInPlugins()` and `airWindowsPlugins()` are lists in the source, and `loadPluginCache` puts
them FIRST so a stale `builtin:*` entry from an older scan loses to the live one. They have no
file to scan; a cached copy is only a snapshot of which ones this engine had when someone last
rescanned. That went wrong the moment the engine gained some — a user had to rescan every VST3 on
disk to see plugins that ship in the binary.

`builtInPlugins()` and `registerBuiltInPlugins()` MUST match: the first is what a project can
name, the second is what can then be created. They are kept adjacent on purpose — the two drifting
apart is a plugin the UI offers and the engine refuses. `MasterGainPlugin` is the deliberate
exception: registered so the plugin cache can create one, absent from the catalogue because nobody
places it in a chain.

Tracktion **ships** the convolver and the AirWindows set but registers neither, so both were dead
weight in the binary; `initialiseAirWindows()` is defined in `PluginManager.cpp` and called from
nowhere in the module. The 186 AirWindows entries are listed from the same X-macro that DECLARES
them (`AirWindowsList.h`, `docs/airWindowsList.md`) rather than retyped — a hand-written copy
would rot the first time Tracktion added one.

Categories on the built-ins are assigned by hand rather than derived: a built-in declares none,
and there are few enough to say what each one IS. Same vocabulary as the AirWindows enum, so a
module lands in the same folder either way. `midiEffect` is not cosmetic — it is what files a
module under `transformers/` rather than `audio/`, and what puts it BEFORE the instrument in a
chain.

## Parameters an external plugin has that Tracktion never wrapped

`buildParameterList()` keeps only automatable parameters. That is most of a synth, but on an amp
sim it drops exactly the controls picking the RIG: amp model, cabinet, IR, mic and position. They
are real VST3 parameters; the plugin just declines to mark them automatable, usually because
changing one reloads something. `nonAutomatableParams` in `PluginParams.cpp` appends them AFTER
the automatable ones and names them the same way, so every name already bound in a song keeps
meaning what it always did.

Two filters on that walk:

* **`MIDI CC *` is dropped by name.** JUCE's VST3 host publishes the plugin's MIDI-mapping table
  as parameters — 16 channels × 130 controllers = 2080 of them. A routing table, not controls, and
  they buried the real ones: Genome reports 31 of its own and 2080 of these. The name is the only
  thing that distinguishes them.
* A parameter with no name at all is skipped: there is nothing a module could bind to.

**Discrete states come from JUCE, not from Tracktion.** Tracktion decides discreteness from
VSTXML, a VST2-era sidecar no VST3 ships, so `isDiscrete()` is false for every VST3 parameter.
JUCE's wrapper does model it, so `juceParamsById` asks it directly — keyed the way Tracktion keys
its own (paramID, falling back to position), because `ExternalAutomatableParameter` is private to
the module and cannot be named from here. Built ONCE per plugin: a linear search per parameter was
19k casts on a 138-parameter VST3.

A dropdown of hundreds of entries is a list rather than a control, so states are collected only up
to `MAX_NAMED_STATES`; some plugins report one step per program. A parameter that names none of
its steps stays continuous — there is nothing to put in a dropdown.

Where Tracktion's own answer is used, labels and state count can disagree on a plugin whose VSTXML
lists blank entries (`removeEmptyStrings` drops them), so the two are paired by the SHORTER of the
two rather than either being trusted.

`withStates` is **off by default**, and that is a performance decision: collecting states asks an
external plugin for every step's display string — fine once, ruinous on a hot path. The live
watch runs per watched plugin per state frame, and a 138-parameter VST3 made that enough work to
starve the message thread. States cannot change while a plugin is loaded, so that path never needs
them. The callers that pass `true` are the one-shot ones: `--dump-builtin-params`, `pluginParamsOf`
and `pluginParamInfos`.
