# `RENDER` et `VIDEO_OUT` — les deux sorties de l'image

Un graphe a **quatre** sorties intégrées, et non deux. Les deux premières sont celles du son
([masterChain.md](masterChain.md)) ; celles-ci sont leurs jumelles pour l'image :

| nom | ce que c'est |
|---|---|
| `RENDER` | la **somme du compositeur** — là où arrivent toutes les pistes vidéo, exactement comme toutes les pistes audio arrivent à `MIX`. Ne porte aucun paramètre |
| `VIDEO_OUT` | l'**image qui sort**, celle que le `viewport` compose. Ne porte aucun paramètre non plus — une image n'a pas de niveau |

```yaml
# graph.yaml
modules:
  drums:  [ MIX ]
  MIX:    [ OUT ]            # la chaîne master du son
  RENDER: [ VIDEO_OUT ]      # …et celle de l'image
```

Le run entre les deux est la **chaîne master vidéo** : ses modules (`video_effects`,
`video_transitions`) traitent l'image entière. C'est la même raison qu'a eue la séparation
`MIX`/`OUT` — il n'y avait qu'un nom, et donc nulle part où poser un traitement sur l'ensemble.

## `VIDEO_OUT` n'est pas un nom neuf

Le modèle appelle le puits de l'image ainsi **depuis que les chaînes vidéo sont typées**. Trois
endroits l'écrivaient déjà en prose avant que ce fichier n'existe :

- `src/graph.ts`, la note de `sourceType` : « ce qui permet à une chaîne de faire passer une piste
  vidéo par `video_effects` jusqu'à `VIDEO_OUT` » ;
- `src/graph.ts` encore, dans `validate()` ;
- `src/videoDoc.ts`, au-dessus de `VideoPluginDoc` : « `VIDEO_OUT` est le puits ».

Ce n'était **aucune constante**. Le nom décrivait un chemin que rien ne pouvait emprunter : écrit
dans un `graph.yaml`, il tombait dans `isSink`, n'y était pas, et ressortait en « n'est ni une
chaîne ni un puits io ». Ce lot rend le nom réel ; il ne l'invente pas.

## Ce qui traverse ce trajet, et ce qui n'y passe pas

Ce lot est né en **notation** — le trajet dessiné, vérifié et complété, mais qu'aucun module ne
traversait vraiment. Ce n'est plus vrai pour un type de module : un **`shaders`** posé sur
`RENDER -> VIDEO_OUT` traite bel et bien la trame composée, en GLSL, jusqu'au pixel
([shaders.md](../../song-video/docs/shaders.md)). Le chemin manquant entre un `graph.yaml` et `@studio/ui-eyes` est
`src/videoChains.ts`, et il a été écrit pour lui.

Les deux **autres** formes de `VideoPluginDoc` restent modélisées et jamais compilées :
`video_effect` et `video_transition` n'ont toujours aucun format de plugin derrière elles, donc un
module de ces types-là est dessiné et vérifié sans rien changer à l'image.

Rien de tout cela ne touche le son : les deux compilations d'un dossier ne partagent aucun champ —
`loadProject` produit le `ProjectDoc` que lit le moteur C++, où nulle image n'arrive jamais, et
`loadVideoProject` produit le `VideoProjectDoc` que lit le compositeur ([picture.md](../../song-video/docs/picture.md)).
Le run vidéo n'a donc **aucun propriétaire** dans `nodeProject.ts`, et ce qu'il porte ne peut pas
atterrir sur un bus audio par accident.

## Pas de paramètre, et ce n'est pas un oubli

`OUT` est le seul des quatre noms qui porte quelque chose : son `Volume` est le niveau de sortie du
morceau ([masterVolume.md](masterVolume.md)). La symétrie s'arrête là.

Un fader sur `VIDEO_OUT` — une opacité globale, une luminosité — serait une commande **branchée sur
rien** : `@studio/ui-eyes` ne lit aucun niveau global, et écrire une valeur qu'aucun rendu ne
consulte est précisément le genre de contrôle qui se règle pendant dix minutes avant qu'on comprenne
qu'il ne fait rien. `node param "VIDEO_OUT" …` est donc refusé **par son nom**, avec la phrase qui
le dit, plutôt que laissé au message générique « aucun module plugin ».

## Ajoutées toutes seules — la seule vraie différence avec le son

C'est le point où cette paire ne se comporte **pas** comme l'autre.

`MIX: [ OUT ]` a été rétro-ajouté par un script (`scripts/migrateMixOut.ts`) qu'il fallait lancer à
la main, et les projets qui ne l'ont jamais reçu existent toujours. L'image ne repasse pas par là :

| quand | où |
|---|---|
| un projet `video` est créé | `scaffold.ts` — `videoGraph()` ajoute la ligne au graphe commun |
| `project surface new viewport` | `surfaces.ts` — `createSurfaceFile` la pose dans la foulée |
| un projet est **ouvert** | `file-service`'s `setActiveProject` → `repairVideoOutputs` |

La troisième est celle qui compte : tout projet déclarant un `viewport` a le trajet au moment où
quoi que ce soit lit son graphe, **y compris ceux écrits avant que ces noms n'existent**. Un projet
sans `viewport` n'en reçoit rien, et ne voit jamais ni l'un ni l'autre des deux noms — y compris
dans la complétion, qui ne les propose qu'à un projet qui a des pistes vidéo.

L'écriture est **textuelle** et non un YAML relu-réémis, pour la raison habituelle ici : un
`graph.yaml` est commenté et édité à la main, et le re-sérialiser reformaterait tout le fichier pour
ajouter une ligne. La ligne va à la **fin** de la carte `modules:`, où arrive le signal.

`ensureVideoRun` est **best-effort** de bout en bout : pas de `graph.yaml`, pas de carte `modules:`,
un dossier en lecture seule — le projet est laissé tel quel et s'ouvre quand même. Gagner une
commodité n'est pas une condition pour ouvrir un morceau.

## Aucun câble n'est dessiné VERS `RENDER`

La même nuance que pour `MIX`, et le même motif. Toutes les pistes vidéo y arrivent — c'est ce
qu'est un compositeur — donc ces flèches ne diraient rien que la forme ne dise déjà. Seul le run
qui en **PART** est dessiné, `RENDER → [ chaîne ] → VIDEO_OUT`.

Et comme `MIX`, `RENDER` est dessiné en puits mais **se tient là où se tient une source** :
`alignModuleRank` l'exempte de la poussée qu'il applique aux vrais puits, sans quoi il se
retrouverait sous le run qu'il alimente.

`buildGraph` synthétise la paire quand le fichier ne déclare aucun run — ce que le service de
fichiers devrait avoir rendu impossible. Ce n'est pas une ceinture et des bretelles : le même code
dessine un graphe **en train d'être tapé**, l'éditeur re-parsant à chaque frappe, et une piste
pointée sur `RENDER` une seconde avant que la ligne ne soit écrite ne doit pas perdre sa carte
entre-temps.

## Les couches traversées

| | |
|---|---|
| écrit | `graph.yaml` — un run de `RENDER` vers `VIDEO_OUT`, ajouté sans qu'on le demande |
| ajouté | `src/videoOutputs.ts` — `ensureVideoRun`, appelé à la création de la surface et à l'ouverture |
| dérivé | `src/chainsGraph.ts` : `RENDER` démarre un run, comme `@in`, comme `MIX` et comme une piste |
| validé | `src/graph.ts` : `isSink` prend les quatre noms au mot, `validate()` exempte `from: RENDER` |
| compilé | **nulle part** — et `nodeProject.ts` le dit à l'endroit où il compile l'autre paire |
| dessiné | les cartes `RENDER` et `VIDEO_OUT` (`@studio/ui-chains`), la seconde sans fader |
| refusé | `@studio/commands`' `setBuiltinOutParam` — les deux, par leur nom |

## Le vérifier

```bash
npx vitest run packages/song/src/videoOutputs.test.ts
npx vitest run packages/ui-chains/src/graph.test.ts
```

Et à la main, ce qui est le vrai test de l'ajout automatique : prendre un projet avec un
`viewport` et sans la ligne, l'ouvrir, relire son `graph.yaml`.
