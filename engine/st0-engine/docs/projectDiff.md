# projectDiff.md — identity, and what a diff refuses to do incrementally

`ProjectDiff` turns two `ProjectDoc`s into an ordered changeset. Everything below is a rule
`ProjectDiff.cpp` enforces in a line or two of code, and whose *reason* does not fit beside it.
The failure mode is always the same shape: **an empty diff**. The file says one thing, the engine
goes on playing another, and nothing on screen suggests it.

## What goes into a plugin's identity — what its CONSTRUCTOR builds

`keyOf(const PluginDoc&)` is `id : type : name`, plus what the plugin builds when it is created and
cannot change afterwards. A different key is a replace: remove, then add. Leaving any of these out
produces an empty diff — the file says one thing and the engine plays another.

**Type and name.** A module keeps its stable id when its plugin definition changes, so a different
type *or* a different name — one VST3 swapped for another, both `"vst3"` — reads as a replace
rather than "the same plugin whose params drifted".

**A Faust module's source, and a jsdsp module's GRAPH.** Both are built in the constructor — the
program compiled, the nodes made and the PARAMS DECLARED from the graph. An edited module that
reached the engine as "the same plugin" would keep running the old program under the old parameter
names, and every value sent to a name the new one introduced would land nowhere, with nothing
reporting a fault. The key carries each as a DIGEST — length and 64-bit FNV-1a — because it is
rebuilt for every plugin on every apply, and a program can be tens of KB; `mustReplace` compares the
full text of any pair whose keys match, so a collision is a replace and never an unheard edit.

**A pattern lane's shape.** How a pattern picks and plays its events is fixed at construction (its
SOURCE is not: `PatternChanged`, in place).

## What a module LOADS is reloaded into the same instance

A module's preset, a NAM module's model and cabinet IR, a platter's record, a rack's sounds and a
module's second input are not identity. A different one is `PluginReloaded`: `loadPluginFiles` loads what moved into
the LIVE instance — the same helper the build uses, so the two cannot disagree — the document's text
params go back on top of a new preset as at insert, and `wireSidechain` re-aims the second input.
The instance survives, and with it its tails, its place in the chain and a platter's needle state.

A rack is reloaded slot by slot (`reloadRack`): a property set to its own value changes nothing, so an
untouched pad costs nothing, and Tracktion's sampler — patched at fetch time,
`engine/patches/tracktion.cmake` — decodes only the sounds no old one holds, moving the rest's audio
across under its lock. Unpatched, any change to one pad decodes every sample of the rack twice, the
second time holding the lock the audio thread takes. Measured on eight 90-second pads, remapping one
note: the message thread's longest stall goes from 181 ms to 1 ms, and the longest gap in the audio
stream from 30 ms to the 12 ms it shows idle; a rendered rack is sample-identical to the unpatched one.

A file going from SET to EMPTY is still a replace (`mustReplace`): nothing unloads a preset, a model
or a record, and only a new instance is one without it.

A second input whose SOURCE track arrives in the same diff is reloaded too, though the module did not
change: the build wired it once, to a track that was not there.

## A duplicate key is warned about, not resolved

`index()` builds a `std::map` with `emplace`, which keeps the first entry and drops the rest. Left
unannounced, a duplicate id is invisible to every later diff: `populateEdit` iterates the *vector*
and builds both, but nothing can update or remove the second one incrementally, and `trackById`
routes its changes to the first match instead. Same shape as a lane requesting a ring twice and
getting an empty one — a duplicate key taking a different, quiet path.

First-wins stays, because changing which one survives would change what plays. The `warn()` is
what keeps it from being quiet.

## What re-inserts a clip

`clipMoved` lists every field applied **at insert time and nowhere else** — start, length, source,
offset, `sourceFrom`/`sourceTo`, the loop points, the warp (`clipPositionFor`, `applyClipLoop`,
`applyClipWarp`, `docs/warp.md`), and the notes.

A field missing from that list is a field you can edit while the engine is up and hear nothing
change. The MIDI notes are the case that bit: a clip's notes are written into the edit when the
clip is inserted, so without `a.notes != b.notes` the whole note vocabulary — add, remove,
velocity, move — reached the engine and did nothing.

`disabled` is on the list for the same reason, and its re-insert is the one that inserts nothing. A
disabled clip is placed and silent: the full build skips it (`EditBuilder`), so the incremental
path must too — `ClipAdded` builds no disabled clip, and `ClipMoved` removes the old one and puts
back only an enabled one. Left off either side, a muted clip played on: unseen as a change, or
rebuilt by the first edit that re-inserted it.

## The master chain is compared whole

`sameMasterRun` compares **in order**, unlike a track's plugin diff, which indexes by key: the
master list *is* a signal order, and swapping the compressor and the EQ changes the sound while
leaving both keys present. It compares identity, what each module loads and a pattern's source —
everything that decides WHICH instances sit on the bus, and where.

Another run is one `MasterChainChanged` and a **full rebuild**, which stops playback: placing a
module mid-list in the live Edit is not something the incremental path does, and changing the mix
bus's shape is a decision taken between passes. The SAME run with a knob or a bypass moved is
not: those are the per-plugin `PluginParamChanged` / `PluginEnabledChanged` a track emits, with an
empty `trackId`, applied in place — the master modules are in `pluginsById` like any other, and a
rebuild for a turned knob costs seconds and every tail. The song side is
`packages/song/docs/masterChain.md`.

## Sends are planned for the whole song at once

Buses are numbered per DESTINATION in document order, the first sender wires the return, and a
muted track that sends is a ROUTING — its output goes to its first destination instead of the mix
(`feedsBusOnly`, `docs/editBuilder.md`). `SendPlan.h` makes those decisions once; the builder wires
from it, and the diff compares its **routing signature** — everything the plan decides except the
levels.

A different signature is `SendsRewired` and a full rebuild: a send added, removed, re-aimed or
enabled re-plans every bus. Muting or unmuting a track that sends is one too, since it turns a lane
into a routing and back. The same signature with a level moved is `SendLevelChanged`, applied in
place on the aux send the plan names — the fader-drag case, which a rebuild would stop the song for.

## What `needsFullRebuild` deliberately leaves out

Adding a plugin, removing one, swapping one (remove + add, removals first) and changing a param
are all **absent** from the list, on purpose. A rebuild throws the Edit away and instantiates every
plugin again — **4026 ms of a 4169 ms apply on a 32-plugin song** — and it replaces the transport
with the Edit, so it also stops whatever is rolling. What the incremental paths cannot place
exactly, they hand back to a rebuild themselves; those cases and the measurements are in
`docs/engineHost.md`.

**Known gap:** `diff()` walks the NEW params, so a *deleted* one emits nothing and the live plugin
keeps its value until the next full rebuild.

The cases that do force one:

- **A track REMOVED.** A lane is found by its INDEX (`trackById`), so a lane left standing under a
  document that got shorter puts every later track's clips, mute, input and meter one lane off.
  `docs/audit-stabilite.md` works the example through.
- **The same tracks in another ORDER, or a track INSERTED before a kept one.** Nothing else
  differs, so without a change of its own the diff is empty — and the baseline takes the new order,
  putting every later mute, input, arm and meter on its neighbour's lane. `TracksReordered` exists
  only to say so.
- **The sends REWIRED**, above.

A track ADDED at the end is not one. `EngineHost::apply` makes the new lanes before the loop, in
DOCUMENT order — the diff lists changes by id, and lanes made in that order would swap — takes the
hidden preview lane out of their way, meters them, and then resolves every lane through the NEW
document, which the rules above guarantee agrees with the old one on every kept track. A module
with a second input is placed in place for the same reason: every lane it can name exists by then.

## Changes arrive in CHAIN order

A track's plugin changes are emitted walking its plugin LIST, not the key index: an add is placed
after its predecessor, which must already be in, and two modules added together in key order —
`amp` before `synth` — would have the first find nothing to follow and hand the whole apply to a
rebuild. `diff_plugins_added_in_chain_order` pins it.
