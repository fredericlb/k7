# La vue Mix lit une playlist

La liste des morceaux vient de la **playlist que la surface nomme** — une ligne `playlist:`
dans `surfaces/<desk>.yaml` — et non de tout le cache de la médiathèque sur la machine
choisie. C'est ce qui fait que cette vue parle du projet ouvert comme les autres, et que
l'arbre du projet y reste : il montre un projet que l'écran concerne.

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

## Les repères ne sont pas dans la playlist

Une playlist dit **quels** morceaux le set joue, et c'est le bon document pour ça : il a un
écran (le cog de st0 l'ouvre) et il se partage entre plusieurs sets.

Ce qu'il n'a pas où mettre, ce sont les **repères** de ce set-là, huit par morceau. Un cue
appartient au pupitre qui joue le morceau et non à une liste que d'autres lisent — deux groupes
qui reprennent le même titre ne posent pas l'aiguille au même endroit, et une playlist qui
porterait les marques de l'un les donnerait à l'autre. Les repères vivent donc dans
**`mix.yaml`**, à la racine du projet, sous la clé `cues:` ([cues.md](cues.md)).

## Deux sources, et c'est la playlist qui décide

| source | ce qu'elle dit |
|---|---|
| la playlist nommée par la surface | **quels** morceaux sont sous la main ce soir |
| `/mediatek/list?family=songs` du service de fichiers | lesquels cette machine sait jouer |

`resolveItems` croise les deux — **la même fonction que l'écran des playlists de st0**
(`@studio/mediatek/playlistItems`), et c'est le point : « le chemin d'abord, le nom ensuite »
est une règle, et deux copies divergeraient le jour où l'une apprendrait un cas.

D'où le fait qu'une ligne puisse nommer une **variante** : `SetEntry.file` porte le fichier
que la ligne demande, master ou pas. Lire `meta.master` directement ne saurait jouer que
l'original, donc une setlist qui dit `instrumental` mettrait le mauvais disque devant un
public.

## Trois états quand il n'y a pas de liste

| ce qui est vrai | ce que le pupitre dit |
|---|---|
| la surface ne nomme aucune playlist | « ajoutez une ligne `playlist:` dans `surfaces/…` » |
| elle en nomme une, absente du disque | « la playlist nommée par cette surface est introuvable » |
| elle en nomme une, vide | rien : une setlist qu'on est en train de remplir |

Trois phrases parce que le geste qui répare diffère à chaque fois. Un navigateur vide sans
explication se lit comme une médiathèque vide, ce qui envoie chercher au mauvais endroit.

## Où la liste se lit

Pas au milieu du pupitre : le set se choisit **au disque lui-même** — un clic au centre d'un
vinyle ouvre le sélecteur ([songBrowser.md](songBrowser.md)) — et c'est déjà la seule façon de
charger une platine. Une colonne qui répéterait ce que le disque sait prendrait la largeur que
les platines veulent.

Le croisement, les trois états et leurs phrases sont ceux de ce sélecteur, qui lit le même
`SetList`.

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

## Ce qui joue, une fois la ligne choisie

Le document **compilé** du projet, dans lequel `withDecks` pose les clips des deux platines —
donc les vraies chaînes du set, crossfade compris. Un module `jsdsp` est un graphe cuit dans le
document par le compilateur, qui exécute la source du module dans un processus fils : le
navigateur ne peut pas en produire un, et `deckDoc` n'est que le tenant-lieu d'une piste par
platine tant que la compilation n'est pas là. Voir [mix.md](mix.md) et
[packages/song/docs/setProject.md](../../song/docs/setProject.md).
