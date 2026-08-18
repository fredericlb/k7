# `surfaces/` — a special view the project asks for

An l8 project carries a `surfaces/` folder. One file, one surface:

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
# surfaces/desk.yaml
type: turntables
layout: view
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

The id defaults to the type. It stays an argument because it is what the header button and
`/surface/<id>` say, and `desk` reads better than `turntables` on a set.

Two things it refuses. The file already existing is the ordinary one. The other is **a second
`split` surface of the same type**: only the first is drawn — `App.tsx` takes it and the pane ring
has one slot — so a second is a file that changes nothing and shows nothing. A `view` surface is
not refused; each gets its own header button, so several are a real arrangement.

### It scaffolds the mapping

A `turntables` surface comes out with every component listed, each waiting for a module:

```yaml
type: turntables
layout: view
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
| `layout` | where it goes — `split` (a slot in the layout) or `view` (its own screen) | **yes**, an enum, **and the pair** |
| `mapping` | which module each of its components moves | shape only |

### Which pairs exist

`SURFACE_LAYOUTS_BY_TYPE` says which layouts each type can actually be drawn in:

| type | layouts |
|---|---|
| `timeline` | `split` |
| `viewport` | `split` |
| `turntables` | `view` |

The pair is checked for the same reason `type` is an enum at all. Both halves can be valid on
their own and still name something no component draws — a timeline asking for its own screen, a
desk asking for a slot — and the result is the blank screen this schema exists to prevent. It is
refused on the `layout` line, with the list of what that type can be.

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
[picture.md](picture.md) and `apps/l8/frontend/docs/picture.md`.

### `split` is not `view` drawn smaller

| | `view` | `split` |
|---|---|---|
| where | its own screen, off the header | a slot in the layout, sharing the window |
| drawn | only while open | whenever the layout shows it |
| in the pane ring | no | yes — number keys, `ui <pane>`, `full`, the mobile tabs |
| reached by | a header button, `/surface/<id>` | it is already there |

The row says **drawn**, not *mounted*, and the difference is load-bearing.

A surface's DOCUMENT is not its screen. A desk holds the loaded songs, the crossfader, the six
EQ knobs and a compiled project; a set does not stop existing because you went to look at the
graph. So `SurfaceTab` splits the two — the hooks above a line, the screen below it — and stays
mounted for as long as the project declares the surface, drawing only when its id is in the
address. Hold the document in the screen instead and a round trip re-centres the crossfader and
flattens the EQ while the sound stays where you put it. See
[../../ui-turntables/docs/deckSet.md](../../ui-turntables/docs/deckSet.md).

A `split` surface does not raise the question: the timeline holds a caret and a zoom stack, and
the viewport a GL context and a `<video>` per layer — cheap to keep, maddening to rebuild, which
is the invariant the panes obey (`apps/l8/frontend/docs/shell.md`).

That is also why a `split` surface gets **no header button** and cannot be named by
`/surface/<id>`: it is not a screen you open, so a button that "opened" it would name a place
there is none of.

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
  → useSurfaces            apps/l8/frontend/src/hooks/useSurfaces.ts
  → `view`  → SurfaceTab   which picks the component for `type`
    `split` → the layout   App.tsx: `timelineSurface` / `viewportSurface` decide the panes,
                           `viewPanes(view, timeline, viewport)` the ring
```

Malformed files are reported through the same array as `projectTypeIssues` and the dead-field
warnings, so a surface that will not parse is a squiggle in the editor rather than a blank
screen. One bad surface does not take the good ones down with it.

## In l8's shell: a screen, not a pane

*(This section is about a `view` surface. A `split` one is in the layout — see the table above.)*

`RouteState.surface` is its own field, beside `help`, and **not** a member of `Pane`. The panes
are a closed union the shell declares and the layout says what each does with them; a surface is
declared by the project, so the list is not knowable until one is open and a union could not name
it.

### The layout table is a function

`viewPanes(view, timeline, viewport)`, not a constant, because two of the panes are the
project's to declare: one that declares no timeline surface has no arrangement, and a list
naming one would name a pane that will not be mounted. The same flags reach `fromLocation`, so
`/timeline` typed at such a project falls through to the layout instead of parsing into a screen
that cannot be drawn — the same rule `live` follows, arriving from the other side.

The surface list lands a moment after the shell, so there is **one frame with no timeline** on
open, which is the same frame every other fact off the surface list flashes for.

So it behaves like the help page: it comes over the layout, which is left exactly as it was
underneath — the timeline keeps its caret and the graph its camera. The address is
`/surface/<id>`, and `fromLocation` deliberately **does not check that the id exists**: the list
arrives a moment after the shell, so a validated address would parse to "no surface" on every
deep link and quietly drop you on the layout. The screen resolves it when the list lands and says
so if there is no such file.

It is DRAWN only while open, unlike the panes — but its component is mounted for as long as the
project declares it, because the document behind a desk outlives the screen showing it. That is
the same invariant the panes obey rather than an exception to it.

## `turntables`

The DJ desk, drawn by `@studio/ui-turntables`. Its one seam is the engine (`./engine`), which l8
satisfies from the link its shell already holds; see that package's
[docs/hosting.md](../../ui-turntables/docs/hosting.md).

A turntables surface plays a **set**: `songs.yaml` at the project root, read through
`@studio/song/yaml/songsFile`. That file names médiathèque songs and nothing about it is
desk-specific, so an `.l8` folder with a `songs.yaml` beside its `surfaces/` is a set
([setProject.md](setProject.md)).

### One writer for one engine

The desk drives the engine by **sending a whole `ProjectDoc`**: `sendDecks` takes the compiled
project (`GET /engine-doc`), fills the decks' clips into it (`withDecks`) and plays the result.

**The file service is the only writer**, because it is what loads l8's project into the engine
in the first place. Two writers for one engine means whichever wrote last wins: a save during a
set drops the decks' clips, a deck gesture undoes a change the service just applied.
`Deck.sendProject` is the seam that keeps it to one — l8 posts to `POST /engine/project`, which
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
