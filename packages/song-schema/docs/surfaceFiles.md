# A surface file

The rationale behind `packages/song-schema/src/yaml/surfaceSchema.ts` and
`packages/song-schema/src/yaml/surfaceFile.ts` — `surfaces/<name>.yaml`, the special VIEW a project
asks its editor to draw. What a surface IS lives in `packages/song/docs/surfaces.md`; this page is
about the file's shape and what the schema refuses.

## Why `type` is an enum

A control id is the app's vocabulary and grows whenever a panel gains a knob; a surface TYPE is a
component that has to exist in the editor, so a folder naming one nothing can draw is a project that
will open onto an empty screen with no explanation. That is worth refusing at the schema, by name,
with the list of what there is.

All the kinds are declared the same way: a song says it wants an arrangement exactly as a set says
it wants a desk, or a song with picture says it wants a frame. Nothing is implicit, so a project that
draws none of them opens on its graph and is told why.

## The two axes, and the pair check

Where a surface goes is its own screen off the header (`view`) or a slot in the layout that shares
the window with the graph (`split`). Two axes rather than one, deliberately — the same turntables
could be a screen or a band under the arrangement, and that is a layout rather than a kind. What each
TYPE can actually be drawn in is `SURFACE_LAYOUTS_BY_TYPE`: the axes stay independent, and which
pairs the editor has a component for is a separate, checkable fact. The pair is checked for the
reason `type` is an enum at all — a `turntables` asking for `view` names something the editor has no
component for, and the result is a blank screen. The issue is raised on `layout`, so the squiggle
lands on the line that is wrong rather than on the file.

**Nothing draws in `view`.** The word stays in the enum on purpose rather than being deleted: it is
what lets the pair check answer a file that says `layout: view` with "a 'turntables' surface draws in
'split', not in 'view'", which names the fix. Dropped from the enum, the same file would get zod's
own "invalid enum value", which names the field and not the remedy.

A `split` surface is not a `view` surface drawn smaller. It takes a slot in the layout, is mounted
for as long as the project is open (its caret and its zoom stack outlive being hidden), and joins the
pane ring — which is the whole of why the two are separate words.

- `viewport` is `split` for the sharpest version of that reason: it owns a WebGL context and one
  `<video>` element per layer. As a `view` it would tear both down whenever you looked at something
  else and rebuild them — with a decoder flush and a visible hitch — whenever you came back. `full`
  is how the picture gets big, which is the pane ring doing its job.
- `turntables` is `split` for the plainest reason: a desk is something you work THE GRAPH against,
  and a screen off the header, over the whole window, makes "which module is this fader on" a round
  trip.
- `mastering` is `split` for that reason and one of its own: this desk is a picture of ONE node, so
  the graph beside it is where you check that the node it names is the node in the master chain.

## The mapping skeleton

`SURFACE_MAPPING_SKELETON` is `[id, note]` per component, in the order a scaffolded surface lists
them — what `project surface new` writes as `<id>: null # <note>`.

`timeline` and `viewport` have none, and that is not an omission: a mapping says which module a
component MOVES, and neither has a component that moves one. The arrangement draws the project's own
lanes and the frame composites its own layers.

**The desk's vocabulary is written out here and held to the original by a test.**
`@studio/song-schema` does not know what a `crossfade` is, and that is the rule — what the test
protects against is a copy going STALE. `@studio/ui-turntables` owns the real list (`MIX_CONTROLS`,
`REQUIRED_CONTROLS`) and cannot be imported from here in either direction: it reaches
`@studio/engine-browser` through `deck.ts`, and the node-side half of the song packages would drag
`node:fs` back the other way. So the copy lives in this BROWSER-SAFE module, where that package's own
`mapping.test.ts` can import it without pulling the disk in, and fail the day the desk grows a
control the scaffold does not offer.

The desk's four stem cuts are OFFERED but not REQUIRED, which is the one place the two lists differ:
a desk with no stem cut is a complete desk, so a set that does not wire them must not be told it is
missing something. What a scaffold offers and what a surface must have are two questions, and this is
where their answers part.

`mastering`'s ten are the same copy under the same rule: st0's `mastering/controls.ts` owns the real
list and this is the scaffold's, held to it by a test over there. Which is why the vocabulary is
`comp.low` and not `Low Amount` — a control id is the surface's word for a knob, and the PARAM it
happens to name today is what the mapping says. All ten name the SAME module, which is what makes
this surface different in kind from the desk: a desk is a room of appliances and its map says which
is which; this is one appliance, and its map says which one. So the notes spell the param rather than
the module, and the ORDER is the signal's rather than the panel's — the three bands are compressed,
then the image is widened, then the whole thing meets the ceiling, so a scaffolded file read top to
bottom reads as the chain inside the node.

## `mapping`

It is `views/mix.yaml`'s map, key for key — control id → `{ module, param }` — and it is the same map
because it is the same question, asked by a surface instead of by a desk. Reusing `MixViewSchema`
itself (rather than a record built the same way) is what keeps `module` meaning "the name the CHAINS
file uses" in both places. Two shapes built alike would drift the first time one of them grew:
`null` — a component named and not wired, which is what a scaffolded desk is made of — has to be
legal in both, or the file `project surface new` writes will not load in the other. See
`packages/song/docs/viewBindings.md` for why a binding cannot live in the module's own
`controller.yaml`.

It is OPTIONAL, and an absent one is not an error in the schema. Which components a given type needs
is the surface's own business, so a missing component is reported by whoever DRAWS the surface, on
the component, where it can be read against the thing that is not working. Refusing the file instead
would refuse to open a project because one knob is unwired.

## `playlist`

A name under the workspace's `_playlists/`, not a path (`playlistPathOf`), and a `turntables`
surface only. It is what the song browser lists: the twelve songs that are to hand tonight, rather
than the two hundred and seventy-nine on the volume.

**This is where "which songs" lives**, and `songs.yaml` does not answer it: a playlist is a document
with a screen (st0's cog opens it), it can be shared between sets, and it is the thing a person has
already written. What `songs.yaml` holds is the half a playlist has no place for: this set's CUE
points on a song, which belong to the desk that plays it rather than to a list other sets read
(`packages/song/docs/setProject.md`).

Optional, and an absent one is not an error: a desk with no playlist draws, and says on the browser
that it names none, which is a sentence you can act on.

## `stems`

Does this desk SEPARATE a record it is handed unprepared? A `turntables` surface only, and a boolean
rather than a chain ref: which module separates and which model it wants is one answer for the whole
machine, and it lives in `<state>/preferences.yaml` where `system stems` puts it — asking a project
would be asking it a question that has nothing to do with it. What a SET decides is whether an hour
of arithmetic may start because somebody put a record on — and that is
worth deciding per set, because a rehearsal rig and a stage rig answer it differently. Absent is
false, and false is a state rather than a fault: the desk draws, plays, and says on its greyed knobs
that this record was never separated (`packages/ui-turntables/docs/stems.md`).

## What the pair refinements refuse

A `playlist` or a `stems` on a surface with no song browser names something nothing will read.
Refused rather than ignored, for the reason `.strict()` refuses an unknown key: a field that is
accepted and does nothing is worse than one that is turned down, because the person who wrote it goes
looking for the effect somewhere else.

## Reading the file

YAML 1.2, as every other file here pins it: a scalar shaped like `5:1:1` stays a string, and a param
name is arbitrary text that must not be reinterpreted on the way in.

An empty file is an ERROR, which is where this parts company with `views/mix.yaml`. An empty desk map
is a desk with nothing bound yet — a real state every project starts in. An empty surface file is a
surface that does not say what it is, and the editor would have nothing to draw: `type` and `layout`
are the whole of what makes it one. Both lists in that message are spelled from the enums rather than
by hand, so a kind added never leaves the message offering fewer than there are — which would be a
message telling somebody the word they just wrote does not exist.

`.strict()` reports an unknown key on the OBJECT, so the offending name is in `keys` rather than in
the path — the same unwrapping `parseMixView` does, and what makes the message land on the line
somebody typed instead of on the file.

`ProjectSurface` is declared in the browser-safe file rather than beside the disk walk that produces
it, because it is a WIRE shape: the editor receives it over `/surfaces` and never opens the folder.
The Node side imports it back, so the two cannot describe the same payload differently.
