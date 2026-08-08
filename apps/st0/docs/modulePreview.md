# The module editor's screen

## The tree stays

The editor used to `return` in place of the whole catalogue: header, tree and all. It sits
in the **middle** now, with the section tabs above it and the file tree beside it, so the
next module is one click away instead of a trip back through the catalogue and down the
tree again. Editing modules is rarely something you do to exactly one of them.

Three things follow from that, and none of them is cosmetic:

- **The engine picker is reachable while the editor is open.** It never used to be, and
  `useModuleEngine` was written on that assumption — it read the stored preference once and
  honoured it forever. A choice can now move under it, so the pick is threaded down from
  `Library` and the socket is rebuilt when it changes. A socket left on the previous machine
  would be answering for a plugin that is loaded somewhere else, which is worse than no
  engine at all: it looks like it is working.
- **The "un moteur est nécessaire" gate does not cover the editor.** It never did — the
  early return happened before it — and a deep link opens one past it either way. The
  builder already says for itself, in its footer, that an absent engine leaves the plugin's
  parameters empty.
- **The right-hand `ModuleParams` panel is hidden while editing.** The builder has a
  parameters pane of its own, and it is the one you can drag onto a widget. Two lists of the
  same thing, and the width belongs to the useful one.

## The four panes

```
┌───────────────┬───────────────┐
│  code   (70%) │ grid     (70%)│
├───────────────┼───────────────┤
│ params  (30%) │ graph    (30%)│
└───────────────┴───────────────┘
      50%              50%
```

Symmetric on purpose: each column is **the thing you edit** above and **what it produces**
below. On the left, the file's text and the parameters that text names. On the right, the
widget grid and the node that grid becomes.

The two halves of the width were already 50/50; the parameters pane went from 40% to 30% so
both bottom panes are the same height and the top two keep the majority.

## The graph preview

`ModulePreview.tsx` builds a `WebGraph` by hand — one source, one chain, one module, one
sink — and runs it through the same `buildGraph → layout → DomChains` pipeline l8 and
m9 run. m9 proved that shape works with no project folder behind it (see its
`docs/chains.md`); this is the second host to need it and the smallest one yet.

It is worth having beside the grid rather than instead of it because **the node is not the
grid**. `nodeSize` in `@studio/ui-chains` sizes a card from `cols × rows`, clamped to a
minimum width the header needs, so a panel that reads fine as an editing surface can come
out cramped or oddly proportioned as a card. The grid says where a knob goes; the preview
says what the module will look like to someone who never opens this screen.

Three details:

- It draws the grid **as edited, not as saved** — the whole point is to see a widget land
  before committing it. `renderPreview` is handed the builder's live `ui` state.
- `hidden` widgets are dropped here. A `WebModuleUI` has them resolved away already, by the
  compiler's merge of a module over the base it extends; there is no merge in this path, so
  without the filter the node would draw widgets the panel deliberately hides.
- The node carries the **real** engine address (`previewPluginId`), the one
  `useModuleEngine` loads the plugin at — not a look-alike. Nothing reads it back yet: the
  panel is read-only, and the widgets draw the values the file sets. Wiring
  `pluginParamsStore` / `setPluginParam` in is what would make it playable, and the address
  being right is what keeps that a small change rather than a rework.

## Le greffon est au bout d'`extends`, pas dans le fichier

Un module dit rarement lui-même ce qu'il charge. Une **face** ne déclare que sa ref
(`@studio/song`'s engineFace.ts), et une **instance** de chaîne ne déclare que ses
surcharges — sur la vraie bibliothèque, `instances/bitcrush.yaml` est trois lignes de
`params:` sous un `extends`.

Lire `plugin:` dans le texte du fichier ne trouvait donc rien, et « rien » ne se distingue pas
d'un module qui n'a pas de greffon : `enginePlugin` retombe sur le nom du module, le moteur
reçoit un type vide, et l'écran affiche « le moteur n'a pas encore répondu » à propos d'une
réponse qui était arrivée. Il avait chargé ce qu'on lui avait demandé, c'est-à-dire rien.

`engine/resolvePlugin.ts` suit la chaîne, sur les **deux** niveaux que st0 peut voir :

| ce que dit `extends:` | comment st0 répond |
|---|---|
| rien, mais un `plugin:` est là | ce bloc gagne, à chaque niveau — un module qui déclare son greffon ne demande pas à en hériter |
| `@mediatek/…` | lit ce module-là par la route fichier et recommence |
| `@engine/…` | cherche dans le scan que la machine a rapporté par son socket |
| une ref nue, `@project/…` | rien, et c'est honnête : aucun projet n'est ouvert, il n'y a nulle part où regarder |

Pas de `resolveModule` ici : il lui faut une carte de refs construite depuis un espace de
travail, et cette app édite une bibliothèque. Les deux niveaux ci-dessus sont exactement ceux
dont elle dispose.

La règle qui nomme un greffon scanné — `engineModuleOf`, dans `@studio/song/moduleTypes` — est
**partagée** avec `engineCatalogue`, qui l'applique côté machine sur le cache de scan. Elle
devait l'être : une orthographe différente ici ferait auditionner un greffon que le document
compilé ne charge jamais, c'est-à-dire du silence avec un panneau dessiné par-dessus.

Trois écrans faisaient la même lecture naïve et sont passés par là ensemble — le panneau de
paramètres du catalogue (`ModuleParams`), le constructeur (`ModuleEditor`), et l'aperçu des
variantes de chaîne (`SongVariants`), dont **chaque étape** partait sans greffon.

Le scan est une **dépendance** et non une précondition de ces effets. Attendre qu'il arrive
ferait qu'une machine n'ayant jamais scanné n'afficherait rien non plus pour un module `jsdsp`,
qui nomme son greffon lui-même et n'a que faire d'un catalogue.

## Le nœud `in` : brancher une entrée de l'interface

Le nœud source du graphe était un décor — « ce qui alimentera ceci ». Il porte maintenant une
pastille : on clique, on choisit une entrée de l'interface, et ce qu'on joue arrive **devant**
le module, monitoré. Le panneau bouge et le traitement s'entend, ce qui est la seule façon de
savoir ce qu'un module fait.

### Deux contrôles, parce que ce sont deux questions

Le nœud source porte une **bande de mixage** depuis toujours — `TRACK_UI`, ses M / S / **A** et
ses deux potards — dessinée que l'hôte ait câblé les rappels ou non. Dans un aperçu, ils étaient
inertes : le graphe se lisait donc comme étant en lecture seule, ce qu'il était.

Le `A` est câblé maintenant, et c'est **lui** qui laisse passer l'entrée. La pastille à côté dit
**laquelle**. Les deux états sont distincts parce que les questions le sont : désarmer garde le
choix, donc retrouver la guitare est un clic et pas un aller-retour dans le menu — c'est
exactement pourquoi une console a un bouton d'armement plutôt qu'un câble à débrancher.

Armer sans avoir choisi ouvre le menu : ce serait un clic sans rien à faire. Et choisir arme,
parce que désigner l'entrée de sa guitare, c'est demander à l'entendre ; `aucune` désarme.

Les deux sont **aussi** dans le pied de page de l'éditeur, et ce n'est pas décoratif : un nœud
ne dessine son en-tête et ses widgets qu'au-delà d'un zoom de 0.6 (`far`, dans DomChains), et le
panneau d'aperçu ne fait que 30 % d'une colonne. Un contrôle qu'il faut zoomer pour trouver se
lit comme un contrôle absent.

Désarmé, le document ne porte **aucun canal** plutôt qu'un `monitor: "off"` : le moteur libère
alors l'entrée de la piste, et rien sur la machine ne reste à tenir une interface dont il ne se
sert pas — le mode de monitoring est une propriété du PÉRIPHÉRIQUE, partagée avec ce qui est
dessus (voir `EngineHost::applyTrackInput`).

Côté document, c'est deux champs sur la piste d'aperçu :

```
inputChannels: [3]      ← 1-based, un canal en mono, deux pour une paire
monitor: "on"
```

`"on"` et pas `"auto"` : auto ne monitore qu'une piste **armée**, et rien ici n'arme quoi que ce
soit — `recordDir` est vide précisément pour que ce soit impossible. On veut « laisse passer,
quoi que fasse le transport ». Le moteur fait le reste (`EngineHost::applyTrackInput`) : il
résout le périphérique, y cible la piste, et applique le mode de monitoring.

### La liste vient du MOTEUR, pas d'un compte de canaux

C'est le piège de cette fonctionnalité, et le moteur le dit lui-même :

> « an interface's inputs are usually paired into stereo devices, so asking for channel 2 alone
> matches nothing at all and reads as silence » — `Recording.cpp`, `channelTap`

`findWaveInput` retient un périphérique dont le jeu de canaux est **exactement** celui demandé.
Un menu « Entrée 1 … Entrée 20 » bâti sur `EngineAudioDevice.inputs` proposerait donc vingt
lignes sur un rack apparié et n'en routerait aucune.

La liste est donc bâtie sur la disposition réelle, que le moteur fait déjà voyager sur
`io-levels` — le navigateur la **jetait**. Mesuré sur la machine : la Focusrite y expose vingt
entrées mono avec ses propres noms, `Input 1`…`Input 8`, `SPDIF 1/2`, `Loop 1/2`, `ADAT 1`…`8`.
Le menu lit donc la façade de l'interface, et chaque ligne est routable par construction.

On la demande avec une liste de canaux **vide** : la réponse porte la disposition de toute
façon, et ne rien mesurer n'active aucun périphérique — le moteur n'active que ce qu'on lui
demande de mesurer.

### Les labels par-dessus, jamais à la place

`~/.studio/preferences.yaml` peut nommer un jeu de canaux (`arm`, `overheads`). Ce nom gagne sur
celui du périphérique — c'est tout l'intérêt de nommer une entrée. Mais un label qui désigne un
jeu qu'aucun périphérique n'offre est **écarté** : ce serait une ligne qu'on ne peut pas router,
exactement ce que cette liste existe pour éviter. Les préférences disent comment le rig
s'appelle ; le moteur dit ce qu'il sait atteindre.

Le choix n'est pas retenu sur le compte. Une entrée est un fait sur le rig devant lequel on est
**maintenant** ; un module rouvert la semaine suivante sur une autre machine se mettrait sinon à
monitorer un canal qui y veut dire autre chose.

## Why the builder does not own the graph

`ModuleBuilder` is shared with l8, and it takes `renderPreview` rather than importing
the graph itself. `DomChains` requires `icons` — the glyphs are the **app's** vocabulary,
not the graph's, which is exactly why the component demands them and provides the context
itself (see `@studio/ui-chains-react/docs/hosting.md`) — and a `command` line, which the
médiathèque does not have. A shared package can invent neither.

So the builder owns the box and its 30%; the host owns what goes in it. Pass nothing, as
l8 does today, and the grid keeps the whole column.
