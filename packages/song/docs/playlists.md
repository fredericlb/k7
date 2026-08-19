# Une playlist, c'est un fichier — dans le dépôt

Une playlist est une liste ordonnée de morceaux que la **médiathèque** tient, chacun pouvant
nommer l'une des variantes de son morceau. Elle vit sous `_playlists/`, à la racine de l'espace
de travail, à la profondeur qu'on veut :

```
<espace>/_playlists/ete-2026.yaml
<espace>/_playlists/live/repet-du-jeudi.yaml
```

```yaml
# _playlists/live/repet-du-jeudi.yaml
title: Répèt du jeudi
items:
  - AC-DC/Back in Black/Hells Bells
  - song: Nirvana/Nevermind/Lithium
    variant: instrumental
  - song: Miles Davis/Kind of Blue/So What
    variant: sans-voix
```

## Pourquoi ici, et pas dans la médiathèque

C'était une **famille** du volume hébergé, la troisième à côté de `songs` et `samples`, et
l'écran qui l'ouvrait était celui de pl8. Rien n'allait mal : c'est simplement que
**une playlist ne porte aucun octet.**

C'est de la référence pure — des noms de choses qui, elles, restent exactement où elles sont.
Trois conséquences, et la troisième est celle qui a décidé :

- héberger de la référence ne rachète rien de ce que le volume sait faire. Un master, ce sont
  40 Mo qu'on sauvegarde ; une setlist, c'est trois cents octets qu'on écrit à la main ;
- une playlist se **relit** et se **corrige** comme un texte, ce qui la met du côté des
  documents qu'on édite plutôt que des octets qu'on dépose — la ligne que la médiathèque tient
  depuis que les modules et les chaînes en sont partis (`packages/mediatek/src/types.ts`) ;
- et surtout : c'est le document du **compte**, écrit pour un travail précis, et le volume ne
  pouvait pas le versionner avec ce travail. La setlist d'un concert appartient au dépôt qui
  tient les morceaux qu'on y joue. Dans `_playlists/`, elle se committe, se branche et se clone
  avec eux ; sur le volume, elle vivait à côté d'eux sans histoire commune.

**Les morceaux, eux, n'ont pas bougé.** C'est le point de la séparation et non un demi-chemin :
le fichier qui nomme est à nous, les octets nommés restent à pl8. l8 cherche dans ce
catalogue-là et y dépose ce qu'on lui donne — voir `apps/l8/frontend/docs/playlists.md`.

## `_playlists`, à côté de `_modules` et `_libraries`

Même **genre** de dossier, donc même endroit et même règle : trouvé par où il est, jamais par
une ligne qui le déclare (`docs/sharedFolders.md`). Une playlist n'est pas un projet et n'a rien
à faire dans un — on monte une setlist une fois et on l'ouvre depuis n'importe quel projet de
l'espace.

D'où le fait que `Workspace.playlists()` marche à la racine de l'espace et non à côté du projet
actif, contrairement à `_libraries`. Un espace de quatre morceaux aurait sinon quatre dossiers de
playlists distincts, ce qui est exactement ce qu'une playlist n'est pas.

Et d'où le fait que ce soit une **route à part** (`GET /playlists`) plutôt qu'un coin de
`/tree` : cet arbre-là est enraciné sur le projet actif, délibérément
(`packages/file-service/docs/activeProject.md`), donc aucun parcours du morceau ouvert ne peut
atteindre ce dossier. Même raison que `/module-libraries`, et la même erreur qu'il a fallu
corriger une fois.

## Le fichier EST l'entrée

Il n'y a pas de dossier autour d'une playlist, et pas de marqueur `playlist.yaml` dedans :
**c'est l'extension qui fait la règle** (`PLAYLIST_EXT`), là où un morceau, une chaîne et un
module sont des dossiers parce que chacun porte ce que son fichier nomme — un master, ses nodes,
ses assets. Une playlist ne porte que des renvois ; un dossier autour d'elle serait une boîte
vide.

## Deux écritures pour une ligne

Une ligne est soit une chaîne de caractères, soit une association :

| ce qu'on écrit | ce que ça veut dire |
|---|---|
| `- Nirvana/Nevermind/Lithium` | le master de ce morceau |
| `- {song: …, variant: instrumental}` | cette version-là de ce morceau |

La forme courte existe parce que c'est ce que quelqu'un tape réellement pour le cas courant, et
la forme longue parce qu'une variante a besoin d'un deuxième mot. Une ligne qui ne nomme
**aucun** morceau est jetée plutôt que rattrapée : `- [x]` est une ligne mal écrite, et fabriquer
`"[object Object]"` comme référence mettrait à l'écran une rangée qui ne pointe vers rien qu'on
puisse aller regarder.

Le renvoi est **relatif à `songs/`** — `AC-DC/Back in Black/Hells Bells` et non
`songs/AC-DC/…` — parce que c'est ce que la médiathèque appelle un morceau une fois la famille
retirée, et parce qu'un fichier qui tiendrait les deux orthographes n'en aurait aucune.

## Les renvois ne sont pas vérifiés ici

`parsePlaylist` garde `song` **verbatim**. Résoudre un renvoi demande de tenir le catalogue des
morceaux, et ce fichier n'ouvre rien — pas même `node:fs` : c'est ce qui permet au service de
fichiers et au navigateur d'aller par exactement les mêmes règles.

C'est donc le travail de celui qui tient les deux listes, et il n'y en a qu'un : l'écran de l8
(`apps/l8/frontend/docs/playlists.md`), qui a la playlist d'un côté et la médiathèque de l'autre,
et qui est par conséquent le seul endroit où « ce morceau n'existe pas » est une question à
laquelle on puisse répondre.

## Ce que le listing lit quand même

Deux choses, dont aucune n'est porteuse : `title:` pour ce que la liste affiche, et le nombre
d'items. Sans titre, c'est le nom du fichier qui sert.

Un fichier qui **ne parse pas** est listé tout de même, avec `ok: false`. Il est sur le disque :
un listing qui le cacherait vous laisserait incapable de cliquer sur la chose qu'il faut aller
réparer. `parsePlaylist` rend `null` dans ce cas, et non une playlist vide — les deux sont des
faits différents et une surface les dit différemment : un fichier qui ne parse pas est à
corriger, un `items:` vide est à remplir.

## Écrire une ligne, sans repasser par le sérialiseur

`appendPlaylistItem` ajoute une ligne **au texte**. C'est la même discipline que `yaml/edit.ts`
prend avec les fichiers d'un projet, et pour la même raison : ces fichiers portent des
commentaires et un ordre que quelqu'un a choisi, et parser vers un objet pour le re-sérialiser
jetterait les deux sans bruit. Faire un aller-retour d'une setlist par un sérialiseur, c'est le
changement que personne ne remarque avant que ses notes aient disparu.

Il rend `null` — plutôt qu'une approximation — pour les formes qu'il ne sait pas étendre : une
séquence en flot répartie sur plusieurs lignes, ou un `items:` qui n'est pas une liste. La
surface désactive alors son bouton et dit pourquoi ; écrire un deuxième `items:` plus bas
produirait un fichier dont les deux moitiés se contredisent.

`yamlScalar` cite **quand il le faut et seulement là**. Les chemins de morceaux sortent de
`segment()` et portent donc légitimement des espaces, des `&` et des parenthèses — tout cela va
très bien sans guillemets au milieu d'un scalaire, et pas du tout en tête. Sont cités : ce qui
commence par un indicateur, ce qui contient `: ` ou ` #`, et ce que YAML lirait comme autre chose
qu'une chaîne (`No`, `null`, `42`). Tout citer serait plus simple à écrire et mettrait deux
conventions dans un fichier qui s'édite aussi à la main.

## Créer

`Workspace.createPlaylist` écrit le **gabarit**, pas un fichier vide : l'écran dessine son volet
de droite à partir du texte, donc un fichier vide s'ouvrirait sur un échec de parsing pour une
playlist que personne n'a encore eu l'occasion de rater. Il ajoute l'extension si elle manque —
c'est elle qui fait le fichier — et refuse un nom déjà pris plutôt que de l'ouvrir : un
« créer » qui rendrait discrètement la setlist de quelqu'un d'autre, c'est ainsi qu'on édite la
mauvaise.
