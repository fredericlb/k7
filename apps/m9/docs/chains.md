# The chains view in m9 — and what a second host proved

Étape 5 moved the chains graph into `@studio/ui-chains-react` and inverted its couplings,
with l8 as the only witness. The plan was explicit that this was not proof:

> m9 (second consommateur des étapes 5 et 6 : **c'est là qu'on découvre si les
> coutures étaient réelles**)

This is that discovery. Three findings, in descending order of how much they changed.

## 1. The throwaway project folder was not needed

The plan carried this as tension #3, unresolved:

> Le modèle de chaînes est celui du compilateur de chansons. `graphDoc.ts` construit le
> `WebGraph` **côté serveur, à partir d'un dossier de projet compilé**. Une chaîne st0
> ou m9 sans dossier YAML ne peut pas produire de `WebGraph` aujourd'hui. Pour la v1 :
> ces apps écrivent un dossier de projet jetable — **moche, immédiat**.

It is wrong, and pleasantly so. **`WebGraph` is a wire type, not a compiler output.** Every
field in it is plain data; nothing in it names a file, a project or a disk. l8 produces
one from a compiled folder because that is where l8' truth lives — nothing ever said the
compiler was its only producer.

So `deckGraph()` builds one from m9's own state, in the browser, and the *same*
`buildGraph → layout → DomChains` pipeline draws it. No folder, jetable or otherwise. A test
pins the whole pipeline running on browser-built data.

The lesson generalises: when a shared type is reachable only through one producer, check
whether that is the type's fault or the producer's. Here it was the producer's.

## 2. The seam held, and required exactly what it claimed

`DomChains` needs five things: `icons`, `graph`, `selected`, `onSelect`, `command`.
`ChainsPanel` is about sixty lines and typechecked on the first attempt — no prop had to be
added, nothing had to be exported that was not, and no l8-shaped assumption leaked
through. That is the inversion of étape 5a doing its job.

One honest note on `command`: m9 has no command bar, and the prop is required. Rather
than pass a no-op, it logs a warning — so a node's command menu doing nothing here is
visible rather than swallowed. A package that made it optional would let a host ship a menu
that silently does nothing.

## 3. `moduleIcons` belonged in the package after all

Étape 5 planned to move `moduleIcons`/`trackIcons` into the graph package and then didn't;
l8' `chainsIcons.ts` argued they were "the APP's vocabulary".

That argument is **true for `TrackIcon`** — l8 draws the same lanes in its mixer and its
timeline, so a graph package owning it would have those two importing one — and **false for
`ModuleIcon`**, which is keyed on `WebModuleCategory`, the graph's own vocabulary, and whose
only consumer anywhere was that icon table.

m9 needing module glyphs and having no mixer is what made the difference visible. So
`moduleIcons.tsx` moved to `@studio/ui-chains-react/module-icons`; `trackIcons` stayed. Its
one tie to l8 — the `TrackGlyph` type, two fields — became a local `Glyph`, which is a
cheaper duplication than the coupling.

m9's own `TrackIcon` is a turntable, because a deck is not a lane: l8' reads a name
*prefix* to choose between drums and vocals, and m9 has no such convention.

## The graph is not decorative

The modules `deckGraph` draws are the same list, in the same order, with the same
`chain:module` ids, that `deckDoc` puts into the `ProjectDoc`. Four tests hold the two
together.

That identity is the whole value. A graph showing a filter the engine never loaded is a
picture of a signal path that does not exist — worse than no graph, because it is
believable. Bypassing a node re-sends the document; the engine diffs, so the chain changes
under a running transport without reloading the song.

## What had to be added underneath

**A read route on the local file service** (`GET /mediatek/file`). The catalogue says where
a module *is* and never what it *runs*, so a browser that must read a `plugin:` block had no
way in — the cache had no reader at all. It is read-only on purpose: writing to a cache is
what a sync is for, and a route that let a caller edit it would produce files the next sync
silently deletes. `safePath` confines it, the same guard the hosted service uses.

**`readPluginBlock` moved to `@studio/engine-protocol/build`**, beside `enginePlugin` —
which consumes exactly what it produces, and which lives there for the same stated reason: a
browser that needs to know what a module runs should not drag in a YAML parser, nor a module
that reads the filesystem, for two scalars. st0 re-exports it so its own tests and
callers are unchanged.

## Not done

* **One chain, one deck.** A second is a second track and a crossfade.
* **No context menu, no edge insert, no canvas insert.** All optional props; m9 passes
  none, so a right-click does nothing. Adding a module goes through the dropdown under the
  graph instead, which is honest for a v1 and ugly.
* **No module parameters.** `pluginParamsStore` and `setPluginParam` are wired in l8 and
  not here, so a node's widgets draw nothing. That is the next thing worth doing, and it
  needs the engine's live params — which st0's builder already knows how to ask for.
* **Never run end to end.** 21 tests and a clean typecheck; whether the graph draws what
  these numbers say has not been seen on screen.
