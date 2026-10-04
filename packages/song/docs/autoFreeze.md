# Automatic VST freezes

A VST is the plugin an engine is most likely not to have. It is installed on one machine and not the
next, and some exist on one platform only. A song through one plays on the machine that has it and
nowhere else — which is what an engine's compatibility score counts
(`packages/engine-browser/docs/access.md`).

So a track through a VST is **frozen automatically**: rendered once, while nobody is listening, on
a machine that has the VST, and the render plays instead **on an engine that lacks it** — until
what it was made from changes. It is the manual freeze ([freeze.md](freeze.md)), with the module
chosen for you and the render named for its inputs.

## Only for an engine that cannot host the VST

An engine whose catalogue names every VST of a freeze **ignores the render** and plays the plugins
live. The render is a fallback, not a replacement: it is a snapshot, and the live plugin is the
song — editable, and exact. So a freeze stands in for its modules only when its render is on disk
AND the bound engine lacks one of its VSTs (`playsRender`: `ready && !hosted`).

`hosted` is read from the bound engine's scan (`scanHostsAll`, the `exts.json` the hub writes at
binding) with the same match the compatibility score uses: format and name, case aside. An EMPTY
scan cannot say, so it counts as lacking: the render is sound that is certain to play, and a VST
the engine may not have is not. The one engine a render is MADE on is a hosting one, so the engine
that renders is never the one that plays it.

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

A render is `<module>-<fingerprint>.wav` in the render cache (below). The fingerprint is a hash of exactly
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
  médiathèque song, a library) by its name. The same song in two places gives the same
  fingerprint, so a copied project finds the renders its original already has.
- **The master is not in the cut.** `freezeCut` sends a neutral master: the render plays back
  through the master live, and baking it in would apply it twice. The manual freeze shares the cut.

## Kept in a cache, never in the repository

A render is DERIVED: the fingerprint says exactly how to make it again. So it is not the song's to
carry. A wav per VST track per edit, committed, is a history that only grows — and every clone,
every engine copy and every LFS quota pays for renders nobody will play again.

- **Where.** `<studioHome>/.renders/` (`autoRendersHome`, `AUTO_RENDERS_HOME_DIR`). On the server
  that is the ACCOUNT's folder on pl8's volume, `$STUDIO_FILES_ROOT/<account>/.renders`, beside its
  `workspace/` and never inside it, so no project tree lists it and no commit can pick it up. Per
  account rather than one for the origin: a fingerprint names large files by name and size, and two
  accounts' songs must not be able to hand each other their audio.
- **Shared by the account's projects.** The name is the inputs, so two projects that produce the
  same render play the same file. That is also why a new render deletes nothing: a module's name is
  no longer unique to one project, and an older fingerprint may be another project's current one.
- **Reached by the engine as a root of its own.** The bound engine sees the cache as
  `renders-<account>`, WRITABLE: the render job writes its wav there and the tunnel uploads it, and a
  doc that plays it gets it copied down like any clip (`packages/file-hub/binding.ts`).
- **Purged after a month (30 days) unused** (`packages/file-hub/staleCaches.ts`). The HUB sweeps every
  account's cache hourly, not the file service: an account's service is stopped when idle, which is
  exactly when its renders go stale. A purged render is only a missing one — the next compile plays
  the track live and the freezer makes it again.
- **"Used" is the atime.** A compile that plays a render marks it — at most once an hour — on its
  ATIME alone, and the sweep reads the later of atime and mtime. Not the mtime: the engine sync
  compares size and mtime to decide what to copy, and a bump there would send the wav to the
  machine again (`packages/file-service/docs/engineSync.md`). Set explicitly, an atime holds on a
  volume mounted `noatime`.

## The compile, in two passes

`compileWithAutoFreezes` (`nodeProject.ts`) compiles LIVE first — the fingerprint is of what the
render would replace — then, if any automatic freeze's render is on disk, again with those modules
frozen exactly as a `frozen:` field would freeze them — those, among the renders on disk, whose
VSTs the bound engine lacks. A song with no VST, none rendered, or an engine that hosts them all,
costs one compile as before. `compileNodeProject` is the doc of that answer, so every reader — the
engine, `/project-doc`, a share — plays the same thing for the engine the account drives.

The scan's mtime is in the file service's revision token, so binding another engine recompiles;
the freezer compares the renders the new compile plays with the last, and reloads the project when
they differ — at the next stop if the transport runs.

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

Nothing is committed and nothing reloads: the render lands in the cache for the engines that will
need it, and the engine that made it goes on playing the VST live. When a render does start
standing in — an engine without the VST bound — the swap waits for a stop: a freeze never changes
a track's contents under the playhead.

## Editing a frozen VST: thaw on touch

This only arises on an engine without the VST. A baked VST has no plugin in the engine, so a knob drag or its window would reach nothing. The node
card therefore wears the snowflake but does not refuse: touching a control on an automatically
frozen node, or its plugin bubble, **thaws** the freeze point (`POST /auto-freeze/thaw`) — the
module is left live for the session (`setThawed`, in memory, never in the song) and the project
reloads with the real plugin.

The edit changes the fingerprint, so the old render stops applying anyway. Once the engine has been
stopped for `THAW_IDLE_MS` with no further change, the thaw ends and the module is frozen again —
from its existing render if nothing changed, by a new one otherwise.

## On screen

`WebGraph.autoFrozen` maps every node an automatic render bakes — one that plays, on this engine —
to the VST it was taken at. It is
kept apart from `frozen` because it acts the other way: `frozen` refuses controls, `autoFrozen`
gives way to them. Both wear the frost; only a manual freeze hides the plugin and bypass bubbles.

## Compatibility

A frozen VST still COUNTS in what a project needs its engine to host
(`packages/file-service/src/pluginNeeds.ts`). The render lets an engine without the VST play the
track, not edit it — a knob, the plugin window, a param change all need the real plugin — so that
engine keeps its compatibility loss, and the auto-pick still prefers one that has the VST.
