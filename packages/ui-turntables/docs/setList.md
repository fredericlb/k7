# La vue Mix lit le projet

Mix était la seule vue qui ne parlait pas du projet ouvert : elle listait tout le cache de
la médiathèque sur la machine choisie, et l'arbre du projet disparaissait parce qu'il
montrait un projet que rien à l'écran ne concernait.

Ce n'est plus le cas. La liste vient de `songs.yaml`, le fichier du projet ouvert — donc
l'arbre reste, sur cette vue comme sur les autres, et `songs.yaml` est un fichier qu'on y
clique pour l'éditer.

## Deux sources, et c'est le projet qui décide

| source | ce qu'elle dit |
|---|---|
| `songs.yaml` du projet | **quels** morceaux font partie du set |
| `/mediatek/list?family=songs` du service de fichiers | lesquels cette machine sait jouer |

`resolveSet` croise les deux par l'**id** de la médiathèque — un ref est `@mediatek/` suivi
de l'id, mot pour mot, donc le croisement est une comparaison de chaînes et rien d'autre.

## Où la liste se lit maintenant

Elle a quitté le milieu du pupitre. Le set se choisit **au disque lui-même** — un clic au
centre d'un vinyle ouvre le sélecteur ([songBrowser.md](songBrowser.md)) — et c'est déjà la
seule façon dont on chargeait une platine. Une colonne qui répétait ce que le disque sait
prenait la largeur que les platines voulaient.

Rien de ce qui suit ne change pour autant : le croisement, les trois états et leurs phrases
sont ceux du sélecteur, qui lit le même `SetList`.

## Trois états, trois phrases

Un morceau nommé par le set et absent du cache **reste dans la liste**, en gris, avec son
icône de téléchargement. C'est un état ordinaire : la synchro tire ce que le projet ouvert
nomme, donc un morceau ajouté il y a une minute est en route. Le faire disparaître rendrait
un set auquel il manque trois morceaux identique à un set qui ne les a jamais eus — sur
l'écran précisément où cette différence compte.

Les trois raisons pour lesquelles le bouton Jouer ne marche pas sont donc dites séparément :
pas encore dans le cache, dossier catalogué sans audio, aucun moteur sur cette machine.

Et deux vides différents : un projet **sans** `songs.yaml` (une chanson l8 ouverte ici, ou
un set d'avant le fichier) et un `songs.yaml` **vide** (un set qu'on est en train de
construire). Le premier nomme le fichier manquant, le second dit où ajouter des morceaux.

## Ce que Mix ne fait pas encore

La platine envoie toujours un document d'**une** piste, construit dans le navigateur
(`deck.ts`). Le crossfade du projet n'y est pas, et ce n'est pas un oubli : un module
`jsdsp` est un graphe **cuit dans le document par le compilateur**, qui exécute la source du
module dans un processus fils. Le navigateur ne peut pas en produire un.

Jouer les vraies chaînes du set demande donc que le service de fichiers de la machine
compile le projet et l'envoie, et que charger un morceau sur une platine devienne une
**édition du projet** — ce que l8 fait déjà. C'est l'étape suivante. Voir
[packages/song/docs/m9Project.md](../../../packages/song/docs/m9Project.md).
