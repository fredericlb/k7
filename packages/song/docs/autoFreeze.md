# Automatic VST freezes

A VST is the plugin an engine is most likely not to have. It is installed on one machine and not the
next, and some exist on one platform only. A song through one plays on the machine that has it and
nowhere else — which is what an engine's compatibility score counts
(`packages/engine-browser/docs/access.md`).

So a track through a VST is **frozen automatically**: rendered once, while nobody is listening, on
a machine that has the VST, and the render plays instead — on that machine and on every other —
until what it was made from changes. It is the manual freeze ([freeze.md](freeze.md)), with the
module chosen for you and the render named for its inputs.

## Where

At every VST module (an external format — `EXTERNAL_PLUGIN_FORMATS` — in a plugin slot) that has
**no other freezable VST downstream of it**: the last VST of a run. One render then covers every VST
before it; freezing each would bake the first one twice.

The freeze rules are the manual ones, unchanged. A VST whose upstream also leaves the set is left
live (its signal would be in the render AND still playing — `freezeBlockedBy`), and so is one fed by
a strudel lane, whose material only exists while it plays. A VST inside a manual freeze is already
baked. Downstream of the point stays live, so an internal effect after the VST is still editable
for free.

## Nothing in the YAML: the render is named by its inputs

A render lives at `renders/auto/<module>-<fingerprint>.wav`. The fingerprint is a hash of exactly
what the render is made from: `freezeCut`, the compiled doc cut down to the plan — the lanes' clips,
the plugins, their params, their automations — plus the tempo, the sample rate and the metre.

That name is the whole invalidation scheme. Change a VST param, move a clip, edit a lane, and the
fingerprint changes; the render for the NEW inputs is not on disk, so the compile plays the track
live again. Nothing has to notice the change and delete anything. Put it back and the old render is
valid again (if it has not been cleaned up yet).

Three details make it hold:

- **A VST's params are its `.vstpreset`**, which its own window rewrites IN PLACE — same path, new
  bytes. Files the doc names are therefore entered by CONTENT when under 1 MB (presets, NAM models,
  IRs), by name and size when larger (audio), memoised on mtime. The file service's revision token
  counts `.vstpreset` for the same reason (`packages/file-service/src/workspace.ts`,
  `REVISION_FILE`).
- **Portable names.** A file inside the project enters by its path there; one outside (a
  médiathèque song, a library) by its name. The same song on two machines gives the same
  fingerprint — which is the point: the machine WITHOUT the VST must find the render the other one
  made.
- **The master is not in the cut.** `freezeCut` sends a neutral master: the render plays back
  through the master live, and baking it in would apply it twice. The manual freeze shares the cut.

## The compile, in two passes

`compileWithAutoFreezes` (`nodeProject.ts`) compiles LIVE first — the fingerprint is of what the
render would replace — then, if any automatic freeze's render is on disk, again with those modules
frozen exactly as a `frozen:` field would freeze them. A song with no VST, or none rendered, costs
one compile as before. `compileNodeProject` is the doc of that answer, so every reader — the engine,
`/project-doc`, a share — plays the same thing.

## Making the renders

`packages/file-service/src/autoFreezeJobs.ts` looks at each served project every few seconds. When
the engine is **stopped** and the revision moved, it asks for every missing render whose VSTs the
rendering engine has — ALL of them, and a non-empty catalogue: a render made without the VST would
bake its stub, and then play everywhere as the song.

The render is made on the engine's MACHINE, which is the one with the VSTs:

- when the server hosts the files, as a `render` job on the bound machine's jobs path
  (`engine/st0-supervisor/src/MachineJobs.cpp`). The doc travels in the request; the tunnel brings
  its clips down and the render back up (`packages/engine-tunnel/docs/jobs.md`);
- when the file service runs beside the engine, by the local engine binary, without blocking.

Then the module's older renders are removed, `renders/auto` alone is committed — never an edit
somebody has not committed — and pushed, best-effort; `*.wav` goes through Git LFS in every
workspace this service makes (`gitLfs.ts`). Finally the project is reloaded so the render plays. A
render that finishes after the transport started waits for the next stop: a freeze never swaps a
track's contents under the playhead.

## Editing a frozen VST: thaw on touch

A baked VST has no plugin in the engine, so a knob drag or its window would reach nothing. The node
card therefore wears the snowflake but does not refuse: touching a control on an automatically
frozen node, or its plugin bubble, **thaws** the freeze point (`POST /auto-freeze/thaw`) — the
module is left live for the session (`setThawed`, in memory, never in the song) and the project
reloads with the real plugin.

The edit changes the fingerprint, so the old render stops applying anyway. Once the engine has been
stopped for `THAW_IDLE_MS` with no further change, the thaw ends and the module is frozen again —
from its existing render if nothing changed, by a new one otherwise.

## On screen

`WebGraph.autoFrozen` maps every node an automatic render bakes to the VST it was taken at. It is
kept apart from `frozen` because it acts the other way: `frozen` refuses controls, `autoFrozen`
gives way to them. Both wear the frost; only a manual freeze hides the plugin and bypass bubbles.

## Compatibility

A plugin baked into a render in force — manual or automatic — is not counted in what a project
needs its engine to host (`packages/file-service/src/pluginNeeds.ts`). Once a VST track is frozen,
an engine without that VST scores 100 for it, and the auto-pick stops holding it against them.
