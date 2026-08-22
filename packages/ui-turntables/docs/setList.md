# La vue Mix lit une playlist

Mix était la seule vue qui ne parlait pas du projet ouvert : elle listait tout le cache de
la médiathèque sur la machine choisie, et l'arbre du projet disparaissait parce qu'il
montrait un projet que rien à l'écran ne concernait.

Ce n'est plus le cas. La liste vient de la **playlist que la surface nomme** — une ligne
`playlist:` dans `surfaces/<desk>.yaml` — donc l'arbre reste, sur cette vue comme sur les
autres.

## C'est un PARAMÈTRE de la surface

```yaml
# surfaces/desk.yaml
type: turntables
layout: split
playlist: ete-2026        # → <espace>/_playlists/ete-2026.yaml
mapping: { … }
```

Un **nom** et pas un chemin, pour la raison qu'un ref de module en est un : le dossier est
fixe, donc l'épeler dans chaque déclaration donnerait à un fichier le droit de se tromper sur
un emplacement que personne ne choisit. `playlistPathOf` fait la conversion, et refuse ce qui
sortirait du dossier.

Et un paramètre de la SURFACE, pas du projet : c'est l'écran qui a un navigateur de morceaux,
donc c'est lui qui doit dire dans quoi il fouille. Une `timeline` qui porterait la même ligne
la verrait ignorée — le schéma la refuse plutôt, pour la raison qu'il est `.strict()` : un
champ accepté et sans effet envoie celui qui l'a écrit chercher ailleurs.

## Ce que `songs.yaml` est devenu

Il disait **quels** morceaux le set jouait. Il ne le dit plus : deux fichiers répondaient à
une question, et la playlist est la meilleure des deux — c'est un document qui a un écran (le
cog de st0 l'ouvre), qui se partage entre plusieurs sets, et que quelqu'un avait déjà écrit.

Ce qui en reste est la moitié qu'une playlist n'a pas où mettre : les **repères** de ce set-là,
huit par morceau. Un cue appartient au pupitre qui joue le morceau et non à une liste que
d'autres lisent — deux groupes qui reprennent le même titre ne posent pas l'aiguille au même
endroit, et une playlist qui porterait les marques de l'un les donnerait à l'autre.

Et le fichier a changé de nom avec son métier : c'est **`mix.yaml`**, à la racine, sous la clé
`cues:` ([cues.md](cues.md)). Un fichier nommé `songs` ne portant plus de liste de morceaux
nommait ce qu'il avait été.

## Deux sources, et c'est la playlist qui décide

| source | ce qu'elle dit |
|---|---|
| la playlist nommée par la surface | **quels** morceaux sont sous la main ce soir |
| `/mediatek/list?family=songs` du service de fichiers | lesquels cette machine sait jouer |

`resolveItems` croise les deux — **la même fonction que l'écran des playlists de st0**
(`@studio/mediatek/playlistItems`), et c'est le point : « le chemin d'abord, le nom ensuite »
est une règle, et deux copies auraient divergé le jour où l'une aurait appris un cas.

D'où le fait qu'une ligne puisse nommer une **variante** : `SetEntry.file` porte le fichier
que la ligne demande, master ou pas. Lire `meta.master` directement — ce que faisait le code
d'avant — ne sait jouer que l'original, donc une setlist qui dit `instrumental` mettrait le
mauvais disque devant un public.

## Trois états quand il n'y a pas de liste

| ce qui est vrai | ce que le pupitre dit |
|---|---|
| la surface ne nomme aucune playlist | « ajoutez une ligne `playlist:` dans `surfaces/…` » |
| elle en nomme une, absente du disque | « la playlist nommée par cette surface est introuvable » |
| elle en nomme une, vide | rien : une setlist qu'on est en train de remplir |

Trois phrases parce que le geste qui répare diffère à chaque fois. Un navigateur vide sans
explication se lit comme une médiathèque vide, ce qui envoie chercher au mauvais endroit.

## Où la liste se lit maintenant

Elle a quitté le milieu du pupitre. Le set se choisit **au disque lui-même** — un clic au
centre d'un vinyle ouvre le sélecteur ([songBrowser.md](songBrowser.md)) — et c'est déjà la
seule façon dont on chargeait une platine. Une colonne qui répétait ce que le disque sait
prenait la largeur que les platines voulaient.

Rien de ce qui suit ne change pour autant : le croisement, les trois états et leurs phrases
sont ceux du sélecteur, qui lit le même `SetList`.

## Une ligne qui ne se joue pas reste à l'écran

Un morceau nommé par la playlist et absent du cache **reste dans la liste**, en gris, avec son
icône de téléchargement. C'est un état ordinaire : la synchro tire ce que la playlist du projet
ouvert nomme (`mediatekPull`), donc un morceau ajouté il y a une minute est en route. Le faire
disparaître rendrait un set auquel il manque trois morceaux identique à un set qui ne les a
jamais eus — sur l'écran précisément où cette différence compte.

Les raisons pour lesquelles le bouton Jouer ne marche pas sont donc dites séparément : pas
encore dans le cache, dossier catalogué sans audio, variante que le dossier n'a pas, aucun
moteur sur cette machine.

## Le doublon, lui, est retiré

Une playlist peut légitimement nommer deux fois le même morceau — l'écran de st0 dessine les
deux rangées, parce que là c'est un document qu'on édite. Ici c'est un **navigateur** : deux
rangées identiques sont deux chances de charger le même disque sans savoir lequel on a eu.

La variante fait partie de l'identité : le master d'un morceau et son instrumental sont deux
disques, et les confondre en jetterait un des deux.

## Ce que Mix ne fait pas encore

La platine envoie toujours un document d'**une** piste, construit dans le navigateur
(`deck.ts`). Le crossfade du projet n'y est pas, et ce n'est pas un oubli : un module
`jsdsp` est un graphe **cuit dans le document par le compilateur**, qui exécute la source du
module dans un processus fils. Le navigateur ne peut pas en produire un.

Jouer les vraies chaînes du set demande donc que le service de fichiers de la machine
compile le projet et l'envoie, et que charger un morceau sur une platine devienne une
**édition du projet** — ce que st0 fait déjà. C'est l'étape suivante. Voir
[packages/song/docs/setProject.md](../../song/docs/setProject.md).
