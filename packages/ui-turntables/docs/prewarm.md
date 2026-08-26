# Préchauffer la playlist

Le tempo et la grille d'une platine viennent d'un sidecar `{fichier}.cache` que le moteur écrit à
la première lecture. Sur cette machine, **4 morceaux sur 279** en ont un.

Pour tous les autres, poser le disque déclenchait l'analyse **à ce moment-là** : plusieurs
secondes pendant lesquelles le fader affiche `—` et SYNC est éteint. [bpm.md](bpm.md) décrivait
ça comme l'état normal d'un cache jamais rempli, et nommait le préchauffage comme un « plus
tard » — en désignant déjà le bon endroit :

> l'endroit naturel pour préchauffer, plus tard, c'est la liste du set (la playlist que la surface
> nomme désigne déjà exactement les morceaux concernés).

C'est fait, et c'est là. **Normal à un bureau, rédhibitoire sur scène** : le moment où l'on pose
un disque est exactement celui où l'on n'a pas cinq secondes.

## Ce que ça fait

Dès que la surface a résolu sa liste, le pupitre analyse les morceaux **un par un**, en tâche de
fond, dans l'ordre de la playlist. Un morceau analysé pose son tempo et allume SYNC **tout de
suite**.

L'appel est **exactement celui qu'un chargement fait** — `service.envelope`, la même route. D'où
deux propriétés qu'on n'a pas eu à construire :

- un morceau préchauffé ne coûte rien à un chargement ;
- un morceau chargé avant son tour ne coûte rien au préchauffage.

La route est un cache des deux côtés, donc **rien n'est sauté ici** : demander EST la façon de
savoir, et demander est bon marché une fois que c'est chaud.

## Un par un, et c'est le point

L'analyse appartient au **moteur**. Une liste entière lancée en parallèle entrerait en concurrence
avec le disque que quelqu'un est en train de poser — c'est-à-dire qu'elle rendrait pire exactement
la seconde qu'elle existe pour rendre meilleure.

Le test le fige en comptant les appels **en vol** : jamais plus d'un.

## Ce qui l'arrête

`alive()` est consulté **entre deux morceaux**, jamais pendant. Changer de playlist ou fermer le
pupitre arrête donc la marche au morceau suivant, sans interrompre celui qui est en cours de
lecture côté moteur — un travail à moitié fait ne laisse rien de cassé, juste un sidecar de moins.

Un fichier illisible est **compté et enjambé** : un morceau que la playlist nomme mais que la
machine n'a pas ne doit pas coûter les vingt-neuf suivants.

## Ce que ça dessine

Une seule ligne, dans la barre du bas, et **seulement tant qu'il reste quelque chose à faire** :

```
♪ 12/24
```

Rien avant, rien après. Une jauge qui reste à `24/24` toute la soirée serait du bruit ; ce qui
compte est « est-ce que c'est encore en train de travailler ». L'infobulle donne le compte des
illisibles quand il y en a, parce que c'est la seule chose ici sur laquelle on peut agir.

## Ce que ça ne fait pas

- **Ça n'analyse pas la médiathèque**, seulement ce que la playlist nomme. Les 279 morceaux du
  volume ne sont pas le sujet : douze le sont.
- **Ça ne sépare pas les stems** — c'est `playlist stems`, des minutes par morceau, et la commande
  qu'on lance la veille ([stems.md](stems.md)).
- **Ça ne corrige pas une grille fausse.** Analyser plus tôt ne rend pas l'analyse plus juste ;
  c'est [grid.md](grid.md) qui s'en occupe.
