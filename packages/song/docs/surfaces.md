# `surfaces/` — a special view the project asks for

An k7 project carries a `surfaces/` folder. One file, one surface:

```k7x
// surfaces/timeline.k7x — the arrangement
type("timeline")
layout("split")
```

```k7x
// surfaces/viewport.k7x — the frame its video lanes composite onto
type("viewport")
layout("floating")
```

```k7x
// surfaces/desk.k7x — the DJ desk
type("turntables")
layout("split")
mapping({
  crossfade: { module: "crossfade", param: "Mix" },
  "deckA.tempo": { module: "tempoA", param: "Target BPM" },
  "deckA.eqLow": { module: "eqA", param: "Low" },
  // …
})
```

```k7x
// surfaces/master.k7x — the mastering strip, over ONE quick-master node
type("mastering")
layout("split")
mapping({
  "comp.low": { module: "master_qm_1", param: "Low Amount" },
  "comp.mid": { module: "master_qm_1", param: "Mid Amount" },
  "spread.width": { module: "master_qm_1", param: "Width" },
  "limiter.ceiling": { module: "master_qm_1", param: "Ceiling" },
  // …ten in all, every one of them the same module
})
```

The id is the **filename**, as in every flat entity folder here.

## Adding one

```
project surface new timeline           → surfaces/timeline.k7x
project surface new viewport           → surfaces/viewport.k7x
project surface new turntables desk    → surfaces/desk.k7x
project surface new mastering master   → surfaces/master.k7x
```

Under `project`, with the markers and the alternatives: a surface is a property of the **project**
— what it draws — rather than of a track, a node or a clip inside it.

**There is no `layout` argument**, and that is the point: the table below already says which one
each type is drawn in, and every type has exactly one — so an argument could only ever be right, or
be refused by the schema a moment later. Deriving it means `createSurfaceFile` writes a file the
parser accepts by construction, which is the whole job of a scaffold.

The id defaults to the type. It stays an argument because it is the filename you open and read, and
`desk` reads better than `turntables` on a set.

Two things it refuses. The file already existing is the ordinary one. The other is **a second
surface of the same type**: only the first is drawn — `App.tsx` takes it and the pane ring has one
slot per type — so a second is a file that changes nothing and shows nothing.

### It scaffolds the mapping

A `turntables` surface comes out with every component listed, each waiting for a module:

```k7x
type("turntables")
layout("split")
mapping({
  crossfade: null, // a crossfade module — its mix param
  "deckA.tempo": null, // a tempo module — deck A's stretch
  "deckA.eqLow": null, // an eq module — deck A's low band
  "deckA.eqMid": null, // the SAME eq module — its mid
  …
})
```

**`null`, not a comment.** A commented line is not something a parser will ever tell you that you
got wrong; a key that is *there* is validated the moment you fill it in. Absent and null mean the
same thing downstream — `unmappedControls` reports both, because both are unwired — so the skeleton
costs nothing and answers the question a bare `mapping:` leaves open, which is what the ids even
are. `MixViewSchema` takes `ViewBindingSchema.nullable()` for exactly this.

`timeline` and `viewport` get **no `mapping:` at all**, and that is not an omission: a mapping says
which module a component MOVES, and neither has a component that moves one. The arrangement draws
the project's own lanes; the frame composites its own layers.

A `mastering` surface scaffolds ten lines that all want the **same** module, which is what makes it
a different shape of declaration from the desk's. A desk is a room of appliances and its map says
which is which; this one is a picture of a single appliance, and its map says which one.

**The list is duplicated, and a test is what keeps it true.** The rule below still holds —
`@studio/song` does not know what a `crossfade` is — but the two packages cannot import each other
in either direction: `@studio/ui-turntables`' `controls.ts` reaches `deck.ts` reaches
`@studio/engine-browser`, and `song/src/surfaces.ts` is the disk walk, so pulling it into a screen
package drags `node:fs` in. So `SURFACE_MAPPING_SKELETON` lives in **`yaml/surfaceSchema.ts`**, the
browser-safe module beside the other two tables — where `ui-turntables/mapping.test.ts` can import
it without the disk, and fail the day the desk grows a control the scaffold does not offer or
offers one it does not require. Each note is checked against the control's own `wants`, so an
expectation that changes takes the scaffold's sentence with it.

### A mapping holds a node's NAME, so a rename asks first

`surfacesNaming(dir, module)` lists the surfaces whose `mapping` names a module — empty for almost
every project, and asked before a node is RENAMED. A mapping is the only place outside `graph.k7x`
where a node's name is a reference, and nothing writes one back: a desk pointing at a name that has
moved loses the knob silently, with a screen that draws and a control that does nothing. So the
rename declines instead, and says which file is holding the name. A surface that would not parse
contributes nothing, deliberately — it is already reported by `surfaceIssues`, and a file the reader
cannot understand is not evidence that a name is free.

## The three fields

| field | what it says | validated |
|---|---|---|
| `type` | which component draws it — `timeline`, `viewport`, `turntables`, `mastering` | **yes**, an enum |
| `layout` | where it goes — `split` (a slot in the layout). `view` (its own screen) is still a word and nothing draws in it | **yes**, an enum, **and the pair** |
| `mapping` | which module each of its components moves | shape only |

### Which pairs exist

`SURFACE_LAYOUTS_BY_TYPE` says which layouts each type can actually be drawn in:

| type | layouts |
|---|---|
| `timeline` | `split` |
| `viewport` | `floating` |
| `turntables` | `split` |
| `mastering` | `split` |

The pair is checked for the same reason `type` is an enum at all. Both halves can be valid on their
own and still name something no component draws, and the result is the blank screen this schema
exists to prevent. It is refused on the `layout` line, with the list of what that type can be.

**Nothing draws in `view`.** Every surface is a pane, the desk included: a fader on a desk is a
param on a module, and a screen covering the graph makes "which module is this one on" a round trip.
As a pane the desk sits directly over the chains, joins the ring, and `full` is how it gets the
window when you want it whole.

The word stays in the enum on purpose. It is what lets the pair check answer a file that says
`layout: view` with *"a 'turntables' surface draws in 'split', not in 'view'"* — a sentence that
names the fix. Dropped from the enum, the same file would get zod's own "invalid enum value", which
names the field and not the remedy. Deleting it is a one-line change the day nothing on any disk
says it.

### Why `type` is an enum and a control id is not

`views/mix.k7x` deliberately does **not** validate its control ids: they are the app's vocabulary,
and a schema that guessed would go stale the day a panel gains a knob
([viewBindings.md](viewBindings.md)). That reasoning is right and it does not extend to `type`.

A control id names a knob on a panel that already exists; getting it wrong is one dead control,
reported by whoever draws the panel. A `type` names a **component that must exist in the editor**,
and a folder asking for one nothing can draw opens onto a blank screen with no explanation — so it
is refused at the schema, by name, with the list of what there is.

`layout` is separate from `type` because the alternatives are real: the same turntables could be a
PANEL beside the graph or a band under the timeline. Two axes means a new layout does not re-cut the
type list, and vice versa.

## The arrangement is one of these

The timeline is a `type: timeline` surface: a song says it wants an arrangement the same way a set
says it wants a desk.

**There is no implicit one.** A folder with no timeline surface opens on its graph — its clips are
still on disk, its lanes still compile, nothing draws them. That absence is worth a sentence, so
`surfaceIssues` raises a **warning** (not an error: the project is valid, it opens, and the editor
you would add the file in is inside it). A bare rig is silent — it has no arrangement to draw.
`hasMaterial` is what makes it silent: a folder with no `clips/`, no `sequences/` and no picture
lane holds nothing a timeline would draw.

`hasMaterial` is cheap on purpose: two `existsSync` calls and `isVideoProject`, which asks the
module map for a `@meta/picture-track` lane. A folder is asked what it HOLDS rather than what it calls itself — a root key answering the
same question is a second declaration free to disagree with the folder it describes. Material and
not placement, deliberately: reading every lane for an `events:` key would be the exact answer and
would cost a load of the whole `nodes/` folder on a path running beside the other diagnostics. The
two answers differ only for a project somebody emptied out — which warns about a timeline they can
delete rather than staying silent about one they need.

`isVideoProject` lives in `@studio/song` rather than beside the compiler it guards
(`@studio/song-video`) because it is a question about lanes and nothing more: asking it must not cost the
reader the video document model, and that is also what keeps this package from depending on the one
that compiles a picture.

The missing-surface warnings name the COMMAND rather than the file to write. Spelling the two lines
out means reading a diagnostic, opening a folder that may not exist, and typing a pair the schema is
about to check — for a file whose whole content is derivable from the word `timeline`.

## …and so is the frame

`type: viewport` is the picture: a song asks for it exactly as it asks for its arrangement.

It gets the **same warning from the other side**: a folder holding a picture lane and declaring no
viewport compiles its lanes, draws them on the timeline, and composites them nowhere — worth saying
precisely because the lanes are visible, so the project looks like it is working. A song with no
picture lane is silent, the way a rig is about its timeline.

And it is the only surface that **writes into the graph**: declaring a viewport adds the run
`RENDER: [ VIDEO_OUT ]` to `graph.k7x`, the picture's two outputs, which `createSurfaceFile` lays
down straight away and which opening a project catches up if it is not there. A surface that
composites a picture with no way for the picture to get out would be a half-made declaration. See
[videoOutputs.md](videoOutputs.md).

### Why `viewport` is `floating`-only

A picture is something you watch WHILE you work on what draws it — the lanes on the timeline, the
shader node on the graph, the text of a layer. As a page it would be what you look at INSTEAD, and
every edit would be a trip to another page to see what it did. So it is a window over the layout,
moved by its title bar and sized by any edge, over whichever page is on screen.

It is mounted for as long as the project declares it, like every `split` surface and for the
sharpest version of the reason: a viewport owns a **WebGL context and one `<video>` element per
layer**, and neither is state a host can hold for it the way it holds a desk's document. Closing
the window hides it; showing it again (`ui viewport`, or its button beside the pages) costs nothing.

Where the window sits is the BROWSER's, in localStorage, and not the project's: it is a habit of
one screen, and in the project it would be a diff on every drag and wrong on every other screen.

### It is the frame ALONE

A viewport surface draws the composited picture and nothing else. Where the picture's lanes are
*placed* is the timeline's business — the same timeline the song's audio lanes are on, whose ruler
reads bars or seconds. There is deliberately no second arrangement surface for picture: one grid
that can be read in two units beats two grids that must be kept in step. See
[picture.md](../../song-video/docs/picture.md) and `apps/k7/frontend/docs/picture.md`.

### `split` is not `view` drawn smaller

A surface's DOCUMENT is not its screen. A desk holds the loaded songs, the crossfader, the six EQ
knobs and a compiled project; a set does not stop existing because you went to look at the graph.
Hold the document in the screen and a round trip re-centres the crossfader and flattens the EQ while
the sound stays where you put it. See
[../../../packages/k7-plugins/docs/turntables/deckSet.md](../../../packages/k7-plugins/docs/turntables/deckSet.md).

A `split` surface does not raise the question: **a pane is mounted once and never unmounted**,
`hidden` takes it off screen, and that one invariant covers it. The timeline holds a caret and a
zoom stack, the viewport a GL context and a `<video>` per layer, the desk its document — all cheap
to keep, all maddening to rebuild (`apps/k7/frontend/docs/shell.md`).

## `mapping` is `views/mix.k7x`'s binding, reused

Key for key: control id → `{ module, param }` **or `null`** — the same `ViewBindingSchema`,
nullable. The same map because it is the same question, asked by a surface instead of by the desk's
own file, and reusing it is what keeps `module` meaning "the name the **chains file** uses" in both
places. A second shape that happened to agree would drift the first time one of them grew a field.

Read [viewBindings.md](viewBindings.md) for why a binding cannot live in the module's own
`controller.k7x`: a set puts a tempo module on each deck, one `controller.k7x` serves every node of
a module, and "deck A's fader drives deck A's stretch" is unsayable in it.

## An unwired component is a SCREEN error, not a load error

`mapping` is optional and a missing component does not stop the project opening. It could have: the
schema knows the field is absent. It does not, because the two places say different things to
different people.

- **Refusing the file** would refuse to open a project because one knob is unwired — and the editor
  you would fix it in is inside that project.
- **Saying it on the screen** puts the sentence next to the thing that does not work:

  > Le composant `deckA.eqLow` de cette vue n'est pas mappé à un module

The check is a **gate** rather than a per-knob badge: the components required are the ones that make
a desk a desk — a crossfade, three EQ bands and a filter per deck. A desk missing its crossfade is
not a desk with one feature off. `unmappedControls` in `packages/k7-plugins/src/turntables/mapping.ts` owns
the list, because which components a type needs is the surface's own business and `@studio/song`
does not know what a `crossfade` is. It is internal to the desk — the package publishes four
subpaths, and this is not one of them.

The mastering strip has its own `unmappedControls`, in `apps/k7/frontend/src/mastering/`, and it
requires **all ten**. That is not a stricter mood; it is what the surface is. A desk with no stem
cuts is a complete desk, so those are offered and not required — there is no smaller mastering
strip, because every control on it names one node, and a missing line is the same strip with a dead
knob.

### Which components are required

Those that drive a module **param**: `crossfade`, and per deck `tempo`, `eqLow`, `eqMid`, `eqHigh`,
`filter`. Not `transport`, `sync` or `listen` — those are actions of the application (play the set,
align two beats, monitor in this tab). They name no param, so requiring a mapping for them would
print an error nobody can clear.

Derived from `DECKS` rather than listed, so a third deck does not silently arrive with its knobs
unrequired — which reads as "already fine" rather than "not wired yet".

### Two failures, two sentences

A component with **no line** is this check. A line that IS there but names a module the chains do
not have is `resolveBindings`' business, against the compiled graph, and it can say which name was
not found. Keeping them apart is what lets each say something true: *"you have not wired this"* and
*"you wired this to something that is not there"* are different fixes.

## How it reaches the screen

Parsed by the **file service**, not the browser — unlike `views/mix.k7x`, which the DJ desk reads
itself because the desk is the only thing that wants it. A surface decides what the shell *draws*,
so its validity belongs with the project's other diagnostics, and two parsers would be two answers
to "is this surface valid".

```
surfaces/<id>.k7x
  → SurfaceSchema          packages/song-schema/src/yaml/surfaceSchema.ts   (browser-safe)
  → projectSurfaces(dir)   packages/song/src/surfaces.ts             (the disk walk)
  → GET /surfaces          a derived view, like /graph beside it
  → useSurfaces            apps/k7/frontend/src/hooks/useSurfaces.ts
  → the layout             App.tsx: `timelineSurface` / `viewportSurface` /
                           `turntablesSurface` / `masteringSurface` decide the panes,
                           `viewPanes({…})` the ring
  → the component          TimelineTab, ViewportTab and MasteringTab are the shell's own; the
                           desk goes through SurfaceTab, which picks the component for `type`
```

Three of the four are the shell's because of what they need beyond the declaration: the first two
need most of `App`, and the mastering strip needs the **engine link** — `setPluginParam`,
`watchPluginParams` and the params store — which `SurfaceTab` has not got and should not grow. Its
switch keeps an arm for each of them all the same, so the file says which road every type takes
rather than falling off the end. Malformed files are reported through the same array as
the dead-field warnings (`deadProjectFields`), so a surface that will not parse is a squiggle in
the editor rather than a blank screen, and one bad surface does not take the good ones down with it.

## In k7's shell: every `split` surface is a pane

Each `split` surface is a member of `Pane` — `timeline`, `turntables`, `mastering` — beside the
`editor` and `chains` the shell owns outright. So a surface is reached the way any pane is: its
number key, `ui <pane>`, `full`, the mobile tabs, `/<pane>`. The `floating` viewport is in none of
them: it has no address, and `ui viewport` shows or hides it over whichever page is up.

`RouteState` needs no field of its own for the open surface. Holding one by FILENAME is what a
project-defined list of `view` surfaces would force, since a union cannot name it — but there is
exactly one surface per type, so the type IS the name and the pane union carries it.

### The layout table is a function

`viewPanes({ timeline, turntables, mastering, frozen })`, not a constant, because three of the
panes are the project's to declare: one that declares no timeline surface has no arrangement, and a
list naming one would name a pane that will not be mounted. An object rather than positional
flags — there are four and they are all booleans, so `viewPanes(true, false, true)` would say nothing
about which pane was which.

The same flags reach `fromLocation`, so `/timeline` typed at such a project falls through to the
layout instead of parsing into a screen that cannot be drawn.

`timeline` defaults **true** there and false in `viewPanes`, and that asymmetry is deliberate: the
surface list lands a moment after the shell, so there is one frame in which the address has to be
read against a guess, and almost every project has an arrangement. The other two get no such
optimism — each is the exception, so the same default would make `/turntables` and `/mastering`
briefly parse for every ordinary song.

### Where the desk goes in the ring

The shell shows one pane at a time, and the ring is their order — arrangement, desk, master,
chains — which is the order Tab walks and the project bar lists. A set declares no timeline, so its desk
comes first among what it declares and is the page it opens on. A fader on the desk is a param on a
module in the graph; the bottom panel's `graph` is how both are read at once.

The **master strip is last** before the graph: it is the last thing the signal meets, so the ring
reads in signal order.

## `mastering`

A picture of ONE node: the three appliances inside a `quick-master` — a three-band compressor, a
stereo spreader and a limiter — drawn as three boxes in the order the signal meets them.

That is what makes it different in kind from every other surface here. The others draw something the
PROJECT is: its lanes, its picture, its decks. This one draws a single module's parameters, and
needs a mapping for the same reason the desk does — the node's *name* is the project's to choose, so
nothing but the file can say which of them this is.

The vocabulary is `apps/k7/frontend/src/mastering/controls.ts`, ten ids in three groups (`comp.*`,
`spread.*`, `limiter.*`), and `SURFACE_MAPPING_SKELETON.mastering` is the scaffold's copy of it under
the same duplication rule as the desk's — held to it by `mastering/controls.test.ts` over there.

**Nothing normalises on this surface**, and that is where it parts company with
[viewBindings.md](viewBindings.md). A desk control declares a range of its own and the widget's
expands it, because a crossfader is a gesture that could drive anything. Here the control IS the
param: the slider's ends are the module's own widget's when it draws one, and the number under the
slider is the number sent. A ceiling reading −0.3 dB sends −0.3 dB. A mastering value that had been
through two scales could not be checked against a meter, and a meter is the only way anybody knows
whether a master is right.

There is **no `surfaceIssues` warning** for a project that has a quick-master node and no mastering
surface, unlike the timeline's and the viewport's. Those two exist because material on disk is drawn
nowhere without them; a node with no surface is drawn perfectly well — its panel is on the graph,
where every other module's is. The strip is a convenience, not a missing half.

See `apps/k7/frontend/docs/mastering.md` for the screen, and
`engine/k7-runtime/docs/quickMaster.md` for what the node actually does to the sound.

## `turntables`

The DJ desk, drawn by `@studio/ui-turntables`. Its one seam is the engine (`./engine`), which k7
satisfies from the link its shell already holds; see that package's
[docs/hosting.md](../../../packages/k7-plugins/docs/turntables/hosting.md).

A turntables surface plays a **set**, and it says which one: `playlist:`, a name under the
workspace's `_playlists/` ([playlists.md](playlists.md)). That is what the desk's song browser lists
— the twelve songs to hand tonight rather than the two hundred on the volume.

**The only surface type with parameters of its own**, and the schema refuses them on the other two:
a `timeline` or a `viewport` draws no song browser, so a playlist on one names something nothing
reads. Refused rather than ignored, for the reason the object is `.strict()` — a field that is
accepted and does nothing sends whoever wrote it looking elsewhere.

It is OPTIONAL, like `mapping` and for the same reason: a desk that names none still draws and says
so on its browser, which is a sentence you can act on. Refusing the file would refuse to open the
project over a set list nobody has chosen yet.

`stems:` is the second, and follows every one of those rules. `stems: true` lets a record put on a
deck unprepared get separated then and there, with the progress shown on the knobs that will use it.
Absent is again a state rather than a fault: the knobs grey with the reason, and the whole set list
can be prepared in advance with `playlist stems` instead.

It is a BOOLEAN. Which module separates and which model it wants is one answer for the machine —
`system stems`, kept in `<state>/preferences.yaml` — and asking a project for it would make three
surfaces spell the same thing. What a set decides is whether an hour of arithmetic may start because
somebody put a record on, which is worth deciding per set: a rehearsal rig and a stage rig answer it
differently. See [packages/k7-plugins/docs/turntables/stems.md](../../../packages/k7-plugins/docs/turntables/stems.md).

A playlist is not desk-specific and is not the project's either — it is a document in the
repository, shared by every project in the workspace and written in k7 under the cog. So an `.k7`
folder whose `surfaces/` names a playlist is a set ([setProject.md](setProject.md)), with no set-list
concept invented for k7.

### One writer for one engine

The desk drives the engine by **sending a whole `ProjectDoc`**: `sendDecks` takes the compiled
project (`GET /engine-doc`), fills the decks' clips into it (`withDecks`) and plays the result.

**The file service is the only writer**, because it is what loads k7's project into the engine in
the first place. Two writers for one engine means whichever wrote last wins: a save during a set
drops the decks' clips, a deck gesture undoes a change the service just applied. `Deck.sendProject`
is the seam that keeps it to one — k7 posts to `POST /engine/project`, which the service forwards on
its own link. Taking a `Deck` rather than an `EngineClient` is what makes this a parameter rather
than a fork: `sendDecks` knows nothing about a socket.

#### The ordering rule, in one place

Inside the service (`engineLink.ts`) a browser-supplied document is held per session in `clientDocs` and becomes
the **pattern clock's base**, so it goes out through the same single `sendProject` the disk-driven
push uses — a strudel lane still overlays its events onto it. While one is in force:

| event | what happens | why |
|---|---|---|
| the project is re-served from disk | **the push is skipped** | pushing the bare compile would drop the decks and the surface would blink empty; the browser polls `/revision`, rebuilds from the fresh compile and hands its own back, so the new state arrives once and complete |
| `reloadActiveProject` (explicit) | **dropped, disk wins** | somebody asked for what is on disk, and that command exists to force exactly this |
| a different project is served | **dropped** | a document naming the previous set's tracks must not play over the next project |
| the engine is unloaded | **dropped** | nothing is being served |

`clientProject.test.ts` pins all four. The rule is tested; the *screen* is not — nothing here mounts
a component, so the desk has to be watched running.
