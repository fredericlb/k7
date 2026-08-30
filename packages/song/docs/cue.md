# `CUE` — le casque, et pourquoi c'est un nœud du graphe

Un cinquième nœud intégré, à côté de `MIX`, `OUT`, `RENDER` et `VIDEO_OUT` :

| nom | ce que c'est |
|---|---|
| `CUE` | **une seconde paire de l'interface** — le casque. La seule sortie qui quitte vraiment la somme du mixeur |

```yaml
# graph.yaml
modules:
  filterA: [ fadeA, cueA ]   # DEUX destinations : la salle, et le casque
  fadeA:   [ MIX ]
  cueA:    [ CUE ]
```

C'est ce qui manquait au pupitre pour être une table à deux platines : préécouter la platine B
pendant que la A passe. Voir [ui-turntables/docs/cue.md](../../ui-turntables/docs/cue.md).

## Ce que ça règle, et ce que ça ne règle PAS

Le moteur n'a **qu'un** transport, et ça ne change pas. Mais préécouter n'en demandait pas deux :
les deux platines jouent déjà **en même temps** sur la timeline, et le crossfader décide de ce que
la salle entend. Il ne manquait qu'une seconde sortie pour entendre l'autre.

Ce qui reste hors de portée avec un transport unique : lancer une platine indépendamment, et un
repère qui ne déplace qu'elle. Voir [ui-turntables/docs/mix.md](../../ui-turntables/docs/mix.md).

## `OUT` était une notation ; `CUE` est une vraie destination

[masterChain.md](masterChain.md) le disait : router une piste sur `OUT` ne court-circuitait rien,
parce que **toute** piste alimente le bus master de Tracktion. Les deux noms étaient une notation
qui rendait la chaîne master exprimable.

`CUE` est le premier nom qui désigne réellement autre chose, et c'est le mécanisme que cette page-là
donnait pour manquant : une piste routée **hors** du bus master, sur un device de sortie séparé.
`OUT` reste ce qu'il était.

## Où sort le casque : une question de MACHINE

Le projet dit `CUE`. Il ne dit pas quelle paire — une interface a une prise casque quel que soit le
morceau ouvert, donc c'est un fait sur le rig, rangé avec les autres :

```yaml
# <state>/preferences.yaml
cueOutput: [3, 4]      # ou "casque", un label de `channels.out`
```

```bash
system cue 3+4          # ou : system cue casque
system cue ""           # « cette machine n'envoie de cue nulle part »
```

Exactement le trajet qu'un `input:` de piste fait déjà : les deux formes sont acceptées, le label est
résolu **avant** le moteur, qui ne voit jamais que des nombres (`resolveCueOutput`).

## Le silence est le repli, jamais le master

La règle qui compte, et elle vaut trois fermetures indépendantes :

> Un bus `CUE` que cette machine ne peut pas sortir joue **nulle part**.

Le replier sur la somme mettrait le retour casque dans la salle, au niveau plein, sans que rien ne
le signale. C'est la panne qu'on ne veut pas découvrir en public. Les trois portes :

| quand | où c'est fermé |
|---|---|
| aucune `cueOutput` sur la machine | le compilateur sort le bus avec `mute: true` |
| une paire nommée, absente à l'exécution | le moteur route vers un id qui ne correspond à rien — `canPlayAudio()` devient faux |
| un rendu offline (mixdown, freeze) | `tracksOnTheMix()` exclut la piste du bounce |

La troisième n'est pas de la ceinture-bretelles : le routage de piste est une notion de **lecture**,
et `tracksToDo` ne le consulte pas. Sans elle un mixdown livré contiendrait le casque.
Voir [engine/moteur/docs/cueOutput.md](../../../engine/moteur/docs/cueOutput.md).

## Le bouton CUE n'est pas un interrupteur

Il n'y a **aucune** commutation dans le moteur. `cueA` est un nœud du module `fade`, son `Mix` est
combien de cette platine part au casque, et le bouton du pupitre est cette liaison-là passant de 0 à
1 — la même mécanique que le crossfader et que les coupes de stems. Un chemin de moins.

Au repos `Mix: 0` : un set commence avec rien dans les oreilles.

## Le point de tap, et pourquoi il est là

`filterA`, donc **après l'EQ et le filtre, avant le fade**. C'est ce que veut dire pre-fade listen :

- éloigner le crossfader de cette platine ne doit pas la retirer des oreilles — sinon on ne peut pas
  préparer ce qui va arriver ;
- couper son grave doit s'entendre **avant** que ça touche la salle.

La conséquence en cascade : `filterA` a deux destinations, donc la chaîne `eqA` ne les absorbe plus,
et `fadeA` comme `cueA` deviennent des bus à part. Ce qui oblige à retirer le chemin **à sec** de la
piste de strip — et c'est ce que `bus_only:` dit, pour une raison de collision de noms qui est dans
[busOnly.md](busOnly.md).

## Migrer un set qui n'en a pas

```bash
npx tsx packages/song/scripts/migrateSetCue.ts <projet.st0> [autres…]
npx tsx packages/song/scripts/migrateSetCue.ts <projet.st0> --write
```

À blanc par défaut, idempotent, et par l'API `Document` du paquet `yaml` — les commentaires du
scaffold et l'ordre des clés reviennent à l'octet près.

Par platine : une seconde destination sur son filtre, une ligne `cue<X>: [ CUE ]`, un fichier de
nœud, une ligne de mapping, et son **strip** dans `bus_only:`. Ce dernier est le seul point non
évident, et l'oublier ne casse rien de visible — ça fait juste sonner toutes les positions du
crossfader pareil.

Tout est lu sur le projet plutôt que supposé : le point de tap vient de `<deck>.filter` et le strip
de `<deck>.eqLow`. Une platine dont le mapping ne nomme ni l'un ni l'autre est **refusée nommément**
plutôt qu'à moitié câblée — inventer un nom de nœud écrirait un départ que personne n'a demandé.

Il ne touche **pas** `<state>` : la paire du casque appartient à une machine, et un projet qui
voyage ne doit pas en porter une. `system cue` reste à faire, une fois par machine.

Un test fige la propriété qui pourrirait en silence — un set migré est **exactement** le set que le
scaffold écrit aujourd'hui (`src/migrateSetCue.test.ts`), le « avant » étant dérivé en retirant le
cue d'un scaffold neuf, pour que la fixture ne puisse pas dériver du gabarit.

## Les couches traversées

| | |
|---|---|
| écrit | `graph.yaml` — une destination `CUE` |
| le mot | `CUE_NODE` dans `@studio/song-schema`'s `moduleTypes.ts`, dans `BUILTIN_OUTPUTS` |
| la machine | `cueOutput` dans `preferences.yaml`, écrit par `system cue`, lu par `resolveCueOutput` |
| compilé | `nodeProject.ts` : la piste de bus porte `outputChannels`, ou `mute` s'il n'y a pas de paire |
| le fil | `TrackDoc.outputChannels`, miroir exact d'`inputChannels` |
| décodé | `docFromJson` dans `server/main.cpp` |
| posé | `routeTrackOutput` — depuis `populateEdit` ET depuis le diff vivant |
| diffé | `ChangeKind::TrackOutputChanged` — appliqué en place, aucune reconstruction |
| exclu | `tracksOnTheMix()` dans `OfflineRender.cpp` |
| mesuré | `engine/moteur/scripts/cue-bus.ts` |

## Le vérifier

```bash
npx tsx engine/moteur/scripts/cue-bus.ts
```

Deux sources, une sur le mix et une sur le cue, rendues en ne changeant que l'`outputChannels` du
bus de cue :

| rendu | crête |
|---|---|
| cue routé sur la paire 3+4 | **−7,5 dBFS** |
| la source de cue RETIRÉE du document | **−7,5 dBFS** — identique |
| le même bus laissé sur le mix | −1,7 dBFS |

L'assertion est une **identité**, pas un « plus faible » : routé ailleurs doit être indiscernable de
jamais avoir été là. Un seuil sur la crête de la somme mesurerait comment deux notes se recouvrent,
ce qui n'est pas la question — et deux notes IDENTIQUES faisaient osciller ce chiffre de 7 dB d'une
passe à l'autre, la phase de départ d'un 4osc n'étant pas fixée. D'où deux notes différentes.

Un bus laissé silencieux ne prouverait rien non plus : un mixdown vide, c'est aussi à quoi ressemble
un rendu cassé. D'où la source qui reste sur le mix dans les trois passes.

**Ce qui n'est pas vérifiable ici, c'est l'écoute.** Qu'un rendu ne contienne pas le cue se mesure ;
que le casque sorte bien en 3/4 sur l'interface, non.
