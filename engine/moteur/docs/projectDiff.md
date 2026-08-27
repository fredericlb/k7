# projectDiff.md — identity, and what a diff refuses to do incrementally

`ProjectDiff` turns two `ProjectDoc`s into an ordered changeset. Everything below is a rule
`ProjectDiff.cpp` enforces in a line or two of code, and whose *reason* does not fit beside it.
The failure mode is always the same shape: **an empty diff**. The file says one thing, the engine
goes on playing another, and nothing on screen suggests it.

## What goes into a plugin's identity

`keyOf(const PluginDoc&)` is not the plugin's `id`. It is `id : type : name : path`, plus three
things folded in afterwards. Each was added because leaving it out produced a silent no-op.

**Type, name and preset.** A module keeps its stable id when its plugin definition changes, so a
different type *or* a different name — one VST3 swapped for another, both `"vst3"` — has to read
as a replace rather than "the same plugin whose params drifted".

**The sidechain source.** The second input is wired when the plugin is inserted, by `EditBuilder`,
and nowhere else. Left out of the key, re-aiming the cable is an empty diff. `docs/sidechain.md`
says it again from the routing side.

**A Faust module's source.** A Faust program is compiled in the plugin's *constructor*, so an
edited program can only take effect by re-creating the plugin — saving `dsp.dsp` would otherwise
reach the engine and change nothing you could hear. The key carries the source string itself, not
a hash of it: the string is already in hand, and a hash collision here would be silent in exactly
the way this guards against.

**A jsdsp module's GRAPH.** The same argument as Faust's, and it was missing for a long time. A
`jsdsp` plugin builds its nodes and DECLARES ITS PARAMS from the graph JSON in its constructor, so
an edited module reaches the engine and changes nothing: the old graph keeps running, under the old
parameter names, and every value sent to a name the new module introduced lands nowhere.

It is worse than inert, because the document and the engine then disagree about what the plugin
*is* while agreeing about everything the diff looks at. Editing `stemcut` from a one-way `Cut` to a
signed `Level` produced exactly that: the knob moved, the value travelled, the log said
`~ stemBassA: Level = 0`, and the plugin on the track had no `Level` at all. Nothing anywhere
reported a fault — the only symptom was a control that did nothing.

**A rack's sounds.** They are built at insert time rather than carried as params, so remapping a
note or a clip would read as "same plugin" and the sampler would never rebuild. Compiled order is
stable, so concatenating them is enough.

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

## The master chain is compared whole

`sameMasterChain` compares **in order**, unlike a track's plugin diff, which indexes by key: the
master list *is* a signal order, and swapping the compressor and the EQ changes the sound while
leaving both keys present. `keyOf` already carries type, name, preset and sidechain, so the
comparison adds only what identity leaves out — the bypass and the parameter values.

Any difference at all is one `MasterChainChanged` and a **full rebuild**. Two reasons the
incremental path does not pay here: the master list is not addressed by it (that one walks
tracks), and editing the mix bus is a mixing decision taken between passes, not a knob turned
while the song runs — where a track's plugin list is exactly the opposite. The cost is that
changing the master chain stops playback. The song side is `packages/song/docs/masterChain.md`.

## What `needsFullRebuild` deliberately leaves out

Adding a plugin, removing one, swapping one (remove + add, removals first) and changing a param
are all **absent** from the list, on purpose. A rebuild throws the Edit away and instantiates every
plugin again — **4026 ms of a 4169 ms apply on a 32-plugin song** — and it replaces the transport
with the Edit, so it also stops whatever is rolling. What the incremental paths cannot place
exactly, they hand back to a rebuild themselves; those cases and the measurements are in
`docs/engineHost.md`.

**Known gap:** `diff()` walks the NEW params, so a *deleted* one emits nothing and the live plugin
keeps its value until the next full rebuild.

Three cases do force one:

- **A track REMOVED.** The same INDEX correspondence, but permanent rather than transient: a lane
  left standing under a document that got shorter puts every later track's clips, mute, input and
  meter one lane off, for good. `docs/audit-stabilite.md` works the example through. This is the
  one case where the incremental path was not merely incomplete but *wrong*, and it is why the
  change kind is no longer a stub in `EngineHost::apply`.
- **A plugin added in a diff that also adds a track.** Not about plugins at all: `trackById` maps a
  doc track to the engine track at the same INDEX, so while the loop is still adding tracks the two
  are briefly out of step and the plugin would land on the wrong lane. The remove path does not
  care — it finds its plugin by id, never by track position.
- **A plugin arriving with a sidechain source**, since that is wired by a pass which runs once
  every track exists, and no insert here can do that.
