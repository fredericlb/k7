# `surfaces/` — a special view the project asks for

An l8 project may carry an optional `surfaces/` folder. One file, one surface:

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

The id is the **filename**, as in every flat entity folder here. The folder is optional and its
absence is not a diagnostic: almost no project has one.

## The three fields

| field | what it says | validated |
|---|---|---|
| `type` | which component draws it — `turntables` so far | **yes**, an enum |
| `layout` | where it goes — `view` so far, its own screen off the header | **yes**, an enum |
| `mapping` | which module each of its components moves | shape only |

### Why `type` is an enum and a control id is not

`views/mix.yaml` deliberately does **not** validate its control ids: they are the app's
vocabulary, and a schema that guessed would go stale the day a panel gains a knob
([viewBindings.md](viewBindings.md)). That reasoning is right and it does not extend to `type`.

A control id names a knob on a panel that already exists; getting it wrong is one dead control,
reported by whoever draws the panel, against the list it actually has. A `type` names a
**component that must exist in the editor**. A folder asking for one nothing can draw opens onto
a blank screen with no explanation — so it is refused at the schema, by name, with the list of
what there is.

`layout` is separate from `type` because the alternatives are already visible: the same
turntables could be a PANEL beside the graph or a band under the timeline. Those are layouts,
not types. Keeping the two axes apart from the first file means adding the second layout does
not have to re-cut the first.

## `mapping` is `views/mix.yaml`'s binding, reused

Key for key: control id → `{ module, param }`, the same `ViewBindingSchema`. It is the same map
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
  → SurfaceTab             which picks the component for `type`
```

Malformed files are reported through the same array as `projectTypeIssues` and the dead-field
warnings, so a surface that will not parse is a squiggle in the editor rather than a blank
screen. One bad surface does not take the good ones down with it.

## In l8's shell: a screen, not a pane

`RouteState.surface` is its own field, beside `help`, and **not** a member of `Pane`. A pane is
one of three the shell has always had and `VIEW_PANES` says what each layout does with them; a
surface is declared by the project, so the list is not knowable until one is open and a union
could not name it.

So it behaves like the help page: it comes over the layout, which is left exactly as it was
underneath — the timeline keeps its caret and the graph its camera. The address is
`/surface/<id>`, and `fromLocation` deliberately **does not check that the id exists**: the list
arrives a moment after the shell, so a validated address would parse to "no surface" on every
deep link and quietly drop you on the layout. The screen resolves it when the list lands and says
so if there is no such file.

It is mounted only while open, unlike the three panes. That invariant is about state expensive to
rebuild and cheap to keep; a surface holds a compiled document and a set list, and a project may
declare several — keeping every one alive behind the layout would pay that for screens nobody has
opened.

## The first type: `turntables`

m9's desk, drawn by `@studio/ui-turntables` — the same component m9 mounts, extracted for this.
Its one seam is the engine (`./engine`), which l8 satisfies from the link its shell already
holds; see that package's [docs/hosting.md](../../ui-turntables/docs/hosting.md).

A turntables surface plays a **set**: `songs.yaml` at the project root, read through
`@studio/song/yaml/songsFile`. Nothing about that file is m9-shaped — it names médiathèque songs
— so an `.l8` folder with a `songs.yaml` beside its `surfaces/` is a set, in the same words, and
bringing the desk to l8 required inventing no set-list concept for l8.

### One writer for one engine

The desk drives the engine by **sending a whole `ProjectDoc`**: `sendDecks` takes the compiled
project (`GET /engine-doc`), fills the decks' clips into it (`withDecks`) and plays the result.
In m9 that goes straight out of the browser's socket, because m9's browser is the only thing that
ever hands that engine a document.

In l8 it is not. **The file service loads l8's project into the engine itself** — which is why
`projectApi.engineDoc()` carries the note "l8 never calls it". A surface makes l8 call it, so for
one commit there were two writers for one engine and whichever wrote last won: a save during a set
dropped the decks' clips, a deck gesture undid a change the service had just applied.

**The file service is now the only writer**, and `Deck.sendProject` is the seam that says so:

| host | who writes | how |
|---|---|---|
| m9 | the browser, alone | `engine.sendProject` — unchanged |
| l8 | the file service, alone | `POST /engine/project`, forwarded on the service's own link |

Taking a `Deck` rather than an `EngineClient` is what let this be a parameter instead of a fork:
`sendDecks` no longer knows what a socket is, and each host answers for itself.

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

`clientProject.test.ts` pins all four. What is still unobserved is the *screen*: the rule is
tested, the desk in l8 has not been watched running.
