# Choisir un morceau

**On clique au centre du vinyle.** Le milieu d'un disque est là où son nom est écrit, donc
c'est là qu'on appuie pour en changer. Le disque lui-même reste `pointer-events-none` : seule
l'étiquette prend le clic, ce qui laisse le sillon extérieur libre pour le jour où l'attraper
voudra dire scratcher.

Une boîte s'ouvre, avec les morceaux **du set** — pas de la médiathèque entière. C'est
`songs.yaml` qui dit ce qui est à portée de main ce soir ; chercher dans 279 morceaux quand
le set en compte douze serait chercher dans la mauvaise liste.

## Le tri : artiste, puis titre

`localeCompare` en français, pas l'ordre des points de code. `Alizée` se range entre `Alain`
et `Daft`, là où une comparaison brute classe tous les artistes accentués après `Z` — c'est-à-dire
la moitié de cette médiathèque. `numeric` au passage, pour que `Track 2` précède `Track 10`.

L'artiste est affiché **au-dessus** du titre et en plus petit : la liste est triée par
artiste, donc c'est la colonne que l'œil suit en descendant.

## La recherche

Elle filtre la **liste entière**, jamais ce qui est à l'écran.

Deux choses la rendent utilisable à un pupitre :

- **Les accents sont pliés.** `alizee` trouve `Alizée`, `rose` trouve `Rosé`. Personne ne
  compose un é en plein mix, et sans ça la moitié de la bibliothèque devient introuvable.
- **Les termes comptent dans n'importe quel ORDRE**, à travers l'artiste et le titre :
  `bashung nuit` trouve *La nuit je mens* sans savoir quel champ porte quel mot. Une simple
  sous-chaîne sur les deux champs collés échouerait là-dessus, et chercher champ par champ
  échouerait deux fois.

`Entrée` charge le premier résultat **jouable** — pas le premier tout court, pour qu'une
frappe visant la ligne du dessous n'aille pas charger un morceau encore en cours de synchro.

## Ce qui n'est pas chargeable reste visible

Un morceau que le cache n'a pas encore est affiché, grisé, avec son icône de téléchargement
et la raison en infobulle. Les mêmes trois états que la liste du milieu (voir
[setList.md](setList.md)) : pas encore dans le cache, dossier sans audio, aucun moteur. Le
faire disparaître rendrait un set auquel il manque trois morceaux identique à un set qui ne
les a jamais eus.

## Une seule boîte pour les deux platines

`browsing` tient la platine concernée, ou `null`. Deux dialogues seraient deux états capables
de se contredire sur lequel est ouvert. La recherche est vidée **en sortant** et non en
entrant : rouvrir pour l'autre platine doit repartir propre, et une recherche laissée derrière
cacherait le set derrière le dernier mot de quelqu'un.

## Redondance assumée, pour l'instant

La liste du milieu du pupitre fait déjà charger un morceau sur A ou B, avec ses deux boutons.
Le navigateur ne la remplace pas — elle n'a pas été demandée en retrait. Les deux coexistent :
la liste du milieu est le set qu'on voit d'un coup d'œil, le navigateur est celui qu'on
fouille. Si le milieu doit servir à autre chose, c'est là qu'il faudra trancher.
