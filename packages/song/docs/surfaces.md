# `surfaces/` — a special view the project asks for

An st0 project carries a `surfaces/` folder. One file, one surface:

```yaml
# surfaces/timeline.yaml — the arrangement
type: timeline
layout: split
```

```yaml
# surfaces/viewport.yaml — the frame its video lanes composite onto
type: viewport
layout: split
```

```yaml
# surfaces/desk.yaml — the DJ desk
type: turntables
layout: split
mapping:
  crossfade:   { module: crossfade, param: Mix }
  deckA.tempo: { module: tempoA,    param: Target BPM }
  deckA.eqLow: { module: eqA,       param: Low }
  # …
```

The id is the **filename**, as in every flat entity folder here.

## Adding one

```
project surface new timeline           → surfaces/timeline.yaml
project surface new viewport           → surfaces/viewport.yaml
project surface new turntables desk    → surfaces/desk.yaml
```

Under `project`, with the markers and the alternatives: a surface is a property of the **project**
— what it draws — rather than of a track, a node or a clip inside it.

**There is no `layout` argument**, and that is the point: the table below already says which one
each type is drawn in, and every type has exactly one — so an argument could only ever be right,
or be refused by the schema a moment later. Deriving it means `createSurfaceFile` writes a file
the parser accepts by construction, which is the whole job of a scaffold.

The id defaults to the type. It stays an argument because it is the filename you open and read,
and `desk` reads better than `turntables` on a set.

Two things it refuses. The file already existing is the ordinary one. The other is **a second
surface of the same type**: only the first is drawn — `App.tsx` takes it and the pane ring has one
slot per type — so a second is a file that changes nothing and shows nothing. That used to hold
for `split` only, because a `view` surface got a header button of its own and several were a real
arrangement. Every surface is `split` now, so the rule covers all of them.

### It scaffolds the mapping

A `turntables` surface comes out with every component listed, each waiting for a module:

```yaml
type: turntables
layout: split
mapping:
  crossfade: null # un module crossfade — son param de mélange
  deckA.tempo: null # un module tempo — l'étirement de la platine A
  deckA.eqLow: null # un module eq — le grave de la platine A
  deckA.eqMid: null # le MÊME module eq — son médium
  …
```

**`null`, not a comment.** A commented line is not something a parser will ever tell you that you
got wrong; a key that is *there* is validated the moment you fill it in. Absent and null mean the
same thing downstream — `unmappedControls` reports both, because both are unwired — so the
skeleton costs nothing and answers the question a bare `mapping:` leaves open, which is what the
ids even are. `MixViewSchema` takes `ViewBindingSchema.nullable()` for exactly this.

`timeline` and `viewport` get **no `mapping:` at all**, and that is not an omission: a mapping
says which module a component MOVES, and neither has a component that moves one. The arrangement
draws the project's own lanes; the frame composites its own layers.

**The list is duplicated, and a test is what keeps it true.** The rule below still holds —
`@studio/song` does not know what a `crossfade` is — but the two packages cannot import each other
in either direction: `@studio/ui-turntables`' `controls.ts` reaches `deck.ts` reaches
`@studio/engine-browser`, and `song/src/surfaces.ts` is the disk walk, so pulling it into a screen
package drags `node:fs` in. So `SURFACE_MAPPING_SKELETON` lives in **`yaml/surfaceSchema.ts`**,
the browser-safe module beside the other two tables — where `ui-turntables/mapping.test.ts` can
import it without the disk, and fail the day the desk grows a control the scaffold does not offer
or offers one it does not require. What the boundary protects against is the copy going stale;
only the enforcement moved. Each note is checked against the control's own `wants`, so an
expectation that changes takes the scaffold's sentence with it.

## The three fields

| field | what it says | validated |
|---|---|---|
| `type` | which component draws it — `timeline`, `viewport`, `turntables` | **yes**, an enum |
| `layout` | where it goes — `split` (a slot in the layout). `view` (its own screen) is still a word and nothing draws in it | **yes**, an enum, **and the pair** |
| `mapping` | which module each of its components moves | shape only |

### Which pairs exist

`SURFACE_LAYOUTS_BY_TYPE` says which layouts each type can actually be drawn in:

| type | layouts |
|---|---|
| `timeline` | `split` |
| `viewport` | `split` |
| `turntables` | `split` |

The pair is checked for the same reason `type` is an enum at all. Both halves can be valid on
their own and still name something no component draws, and the result is the blank screen this
schema exists to prevent. It is refused on the `layout` line, with the list of what that type
can be.

**Nothing draws in `view` today.** The desk was the last one — its own screen off the header, over
the whole window — and it is a pane now: a fader on a desk is a param on a module, and a screen
that covered the graph made "which module is this one on" a round trip. As a pane it sits directly
over the chains, joins the ring, and `full` is how it gets the window when you want it whole,
which is the answer the frame already had.

The word stays in the enum on purpose. It is what lets the pair check answer a file that still
says `layout: view` with *"a 'turntables' surface draws in 'split', not in 'view'"* — a sentence
that names the fix. Dropped from the enum, the same file would get zod's own "invalid enum value",
which names the field and not the remedy. Deleting it is a one-line change the day nothing on any
disk says it any more.

### Why `type` is an enum and a control id is not

`views/mix.yaml` deliberately does **not** validate its control ids: they are the app's
vocabulary, and a schema that guessed would go stale the day a panel gains a knob
([viewBindings.md](viewBindings.md)). That reasoning is right and it does not extend to `type`.

A control id names a knob on a panel that already exists; getting it wrong is one dead control,
reported by whoever draws the panel, against the list it actually has. A `type` names a
**component that must exist in the editor**. A folder asking for one nothing can draw opens onto
a blank screen with no explanation — so it is refused at the schema, by name, with the list of
what there is.

`layout` is separate from `type` because the alternatives are real: the same turntables could be
a PANEL beside the graph or a band under the timeline. Those are layouts, not types. Two axes
means a new layout does not re-cut the type list, and vice versa.

## The arrangement is one of these

The timeline is a `type: timeline` surface: a song says it wants an arrangement the same way a
set says it wants a desk.

**There is no implicit one.** A folder with no timeline surface opens on its graph — its clips are
still on disk, its lanes still compile, nothing draws them. That absence is worth a sentence, so
`surfaceIssues` raises a **warning** (not an error: the project is valid, it opens, and the
editor you would add the file in is inside it). A `live` project is silent — a rig has no
arrangement to draw. `hasMaterial` is what makes them silent: a folder with no `clips/`, no
`sequences/` and no `video_tracks/` holds nothing a timeline would have drawn. `project_type:
live` used to answer this, and answered it worse — it was a second declaration, free to
disagree with the folder it described.

## …and so is the frame

`type: viewport` is the picture: a song asks for it exactly as it asks for its arrangement.

It gets the **same warning from the other side**: a folder holding `video_tracks/` and declaring
no viewport compiles its lanes, draws them on the timeline, and composites them nowhere. That
one is worth saying precisely because the lanes are visible — the project looks like it is
working. A song with no `video_tracks/` is silent, the way a rig is about its timeline.

### Why `viewport` is `split`-only

The sharpest version of the "`split` is not `view` drawn smaller" argument below. A viewport
owns a **WebGL context and one `<video>` element per layer**, and neither is state a host can
hold for it the way it holds a desk's document: they belong to the DOM the screen draws. As a
`view` it would tear both down whenever you looked at something else and rebuild them — with a
decoder flush and a visible hitch — whenever you came back.

Getting the picture big is `full` (its number key, or `ui viewport`), which is the pane ring
doing its job rather than a second mounting rule.

### It is the frame ALONE

A viewport surface draws the composited picture and nothing else. Where the picture's lanes are
*placed* is the timeline's business — the same timeline the song's audio lanes are on, whose
ruler reads bars or seconds. There is deliberately no second arrangement surface for picture:
one grid that can be read in two units beats two grids that must be kept in step. See
[picture.md](picture.md) and `apps/st0/frontend/docs/picture.md`.

### `split` was never `view` drawn smaller

| | `view` *(historic)* | `split` |
|---|---|---|
| where | its own screen, off the header | a slot in the layout, sharing the window |
| drawn | only while open | whenever the layout shows it |
| in the pane ring | no | yes — number keys, `ui <pane>`, `full`, the mobile tabs |
| reached by | a header button, `/surface/<id>` | it is already there |

Every surface is `split` today; the left column is kept because it is what the difference between
the two words *was*, and the argument is what a future `view` would have to answer.

The row says **drawn**, not *mounted*, and the difference is load-bearing.

A surface's DOCUMENT is not its screen. A desk holds the loaded songs, the crossfader, the six
EQ knobs and a compiled project; a set does not stop existing because you went to look at the
graph. While the desk was a `view`, `SurfaceTab` had to split the two itself — the hooks above a
line, the screen below it, mounted for as long as the project declared the surface and drawing
only when its id was in the address. Hold the document in the screen instead and a round trip
re-centres the crossfader and flattens the EQ while the sound stays where you put it. See
[../../ui-turntables/docs/deckSet.md](../../ui-turntables/docs/deckSet.md).

A `split` surface does not raise the question, which is the quiet reason the desk moving over was
a simplification rather than a port: **a pane is mounted once and never unmounted**, `hidden`
takes it off screen, and that one invariant covers what the prop was protecting. The timeline
holds a caret and a zoom stack, the viewport a GL context and a `<video>` per layer, the desk its
document — all cheap to keep, all maddening to rebuild
(`apps/st0/frontend/docs/shell.md`).

## `mapping` is `views/mix.yaml`'s binding, reused

Key for key: control id → `{ module, param }` **or `null`** for one that is named and not wired
yet — the same `ViewBindingSchema`, nullable. It is the same map
because it is the same question, asked by a surface instead of by m9's desk — and reusing it is
what keeps `module` meaning "the name the **chains file** uses" in both places. A second shape
that happened to agree would drift the first time one of them grew a field.

Read [viewBindings.md](viewBindings.md) for why a binding cannot live in the module's own
`controller.yaml`: a set puts a tempo module on each deck, one `controller.yaml` serves every
node of a module, and "deck A's fader drives deck A's stretch" is unsayable in it.

## An unwired component is a SCREEN error, not a load error

`mapping` is optional and a missing component does not stop the project opening. It could have:
the schema knows the field is absent. It does not, because the two places say different things
to different people.

- **Refusing the file** would refuse to open a project because one knob is unwired — and the
  editor you would fix it in is inside that project.
- **Saying it on the screen** puts the sentence next to the thing that does not work:

  > Le composant `deckA.eqLow` de cette vue n'est pas mappé à un module

The check is a **gate** rather than a per-knob badge: the components required are the ones that
make a desk a desk — a crossfade, three EQ bands and a filter per deck. A desk missing its
crossfade is not a desk with one feature off. `unmappedControls` in
`@studio/ui-turntables/mapping` owns the list, because which components a type needs is the
surface's own business and `@studio/song` does not know what a `crossfade` is.

### Which components are required

Those that drive a module **param**: `crossfade`, and per deck `tempo`, `eqLow`, `eqMid`,
`eqHigh`, `filter`. Not `transport`, `sync` or `listen` — those are actions of the application
(play the set, align two beats, monitor in this tab). They name no param, so requiring a mapping
for them would print an error nobody can clear.

Derived from `DECKS` rather than listed, so a third deck does not silently arrive with its knobs
unrequired — which reads as "already fine" rather than "not wired yet".

### Two failures, two sentences

A component with **no line** is this check. A line that IS there but names a module the chains do
not have is `resolveBindings`' business, against the compiled graph, and it can say which name was
not found. Keeping them apart is what lets each say something true: *"you have not wired this"*
and *"you wired this to something that is not there"* are different fixes.

## How it reaches the screen

Parsed by the **file service**, not the browser — unlike `views/mix.yaml`, which m9's desk reads
itself because m9's desk is the only thing that wants it. A surface decides what the shell
*draws*, so its validity belongs with the project's other diagnostics, and two parsers would be
two answers to "is this surface valid".

```
surfaces/<id>.yaml
  → SurfaceSchema          packages/song/src/yaml/surfaceSchema.ts   (browser-safe)
  → projectSurfaces(dir)   packages/song/src/surfaces.ts             (the disk walk)
  → GET /surfaces          a derived view, like /graph beside it
  → useSurfaces            apps/st0/frontend/src/hooks/useSurfaces.ts
  → the layout             App.tsx: `timelineSurface` / `viewportSurface` /
                           `turntablesSurface` decide the panes, `viewPanes({…})` the ring
  → the component          TimelineTab and ViewportTab are the shell's own; the desk goes
                           through SurfaceTab, which picks the component for `type`
```

Malformed files are reported through the same array as `projectTypeIssues` and the dead-field
warnings, so a surface that will not parse is a squiggle in the editor rather than a blank
screen. One bad surface does not take the good ones down with it.

## In st0's shell: every surface is a pane

Each `split` surface is a member of `Pane` — `timeline`, `viewport`, `turntables` — beside the
`editor` and `chains` the shell owns outright. So a surface is reached the way any pane is: its
number key, `ui <pane>`, `full`, the mobile tabs, `/<pane>`.

`RouteState.surface` was a field of its own beside `help`, holding the open `view` surface by
FILENAME, because the list was the project's and a union could not name it. That reasoning was
sound and it stopped applying when the last `view` became a pane: there is exactly one surface
per type, so the type IS the name.

### The layout table is a function

`viewPanes({ timeline, viewport, turntables, frozen })`, not a constant, because three of the
panes are the project's to declare: one that declares no timeline surface has no arrangement, and
a list naming one would name a pane that will not be mounted. An object rather than positional
flags — there are four now and they are all booleans, so `viewPanes(true, false, true)` said
nothing about which pane was which.

The same flags reach `fromLocation`, so `/timeline` typed at such a project falls through to the
layout instead of parsing into a screen that cannot be drawn.

`timeline` defaults **true** there and false in `viewPanes`, and that asymmetry is deliberate: the
surface list lands a moment after the shell, so there is one frame in which the address has to be
read against a guess, and almost every project has an arrangement. `viewport` and `turntables` get
no such optimism — both are the exception, so the same default would make `/viewport` and
`/turntables` briefly parse for every ordinary song.

### Where the desk goes in the column

Directly over the graph: the ring is built top-down as the panes are stacked — frame, arrangement,
desk, chains. A set declares no timeline, so in practice the desk and the graph *are* its column,
each taking half, which is the point of the desk being a pane at all. A fader on the desk is a
param on a module in the graph, and the two are now readable at once; `full` is how either gets
the whole window.

## `turntables`

The DJ desk, drawn by `@studio/ui-turntables`. Its one seam is the engine (`./engine`), which st0
satisfies from the link its shell already holds; see that package's
[docs/hosting.md](../../ui-turntables/docs/hosting.md).

A turntables surface plays a **set**, and it says which one: `playlist:`, a name under the
workspace's `_playlists/` ([playlists.md](playlists.md)). That is what the desk's song browser
lists — the twelve songs to hand tonight rather than the two hundred on the volume.

**The only surface type with parameters of its own**, and the schema refuses them on the other
two: a `timeline` or a `viewport` draws no song browser, so a playlist on one names something
nothing reads. Refused rather than ignored, for the reason the object is `.strict()` — a field
that is accepted and does nothing sends whoever wrote it looking elsewhere.

It is OPTIONAL, like `mapping` and for the same reason: a desk that names none still draws and
says so on its browser, which is a sentence you can act on. Refusing the file would refuse to
open the project over a set list nobody has chosen yet.

`stems:` is the second, and follows every one of those rules. `stems: true` lets a record put on a
deck unprepared get separated then and there, with the progress shown on the knobs that will use
it. Absent is again a state rather than a fault: the knobs grey with the reason, and the whole set
list can be prepared in advance with `playlist stems` instead.

It is a BOOLEAN, and it named a chain for exactly one afternoon. Which module separates and which
model it wants is one answer for the machine — `system stems`, kept in `~/.studio/preferences.yaml`
— and asking a project for it made three surfaces spell the same thing. What a set decides is
whether an hour of arithmetic may start because somebody put a record on, which is worth deciding
per set: a rehearsal rig and a stage rig answer it differently. See
[ui-turntables/docs/stems.md](../../ui-turntables/docs/stems.md).

A playlist is not desk-specific and is not the project's either — it is a document in the
repository, shared by every project in the workspace and written in st0 under the cog. That is
why bringing the desk to st0 needed no set-list concept invented for st0: an `.st0` folder whose
`surfaces/` names a playlist is a set ([setProject.md](setProject.md)).

### One writer for one engine

The desk drives the engine by **sending a whole `ProjectDoc`**: `sendDecks` takes the compiled
project (`GET /engine-doc`), fills the decks' clips into it (`withDecks`) and plays the result.

**The file service is the only writer**, because it is what loads st0's project into the engine
in the first place. Two writers for one engine means whichever wrote last wins: a save during a
set drops the decks' clips, a deck gesture undoes a change the service just applied.
`Deck.sendProject` is the seam that keeps it to one — st0 posts to `POST /engine/project`, which
the service forwards on its own link. Taking a `Deck` rather than an `EngineClient` is what
makes this a parameter rather than a fork: `sendDecks` knows nothing about a socket.

#### The ordering rule, in one place

Inside the service (`engineLink.ts`) a browser-supplied document is held as `clientDoc` and
becomes the **pattern clock's base**, so it goes out through the same single `sendProject` the
disk-driven push uses — a strudel lane still overlays its events onto it. While one is in force:

| event | what happens | why |
|---|---|---|
| the project is re-served from disk | **the push is skipped** | pushing the bare compile would drop the decks and the surface would blink empty; the browser polls `/revision`, rebuilds from the fresh compile and hands its own back, so the new state arrives once and complete |
| `reloadActiveProject` (explicit) | **dropped, disk wins** | somebody asked for what is on disk, and that command exists to force exactly this |
| a different project is served | **dropped** | a document naming the previous set's tracks must not play over the next project |
| the engine is unloaded | **dropped** | nothing is being served |

`clientProject.test.ts` pins all four. The rule is tested; the *screen* is not — nothing here
mounts a component, so the desk has to be watched running.
