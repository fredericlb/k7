# Un banc doit vieillir sa fixture

`yamlCache` refuse délibérément de mettre en cache un fichier dont la mtime a moins de
`SETTLE_MS` (2 s). La raison est écrite dans `yaml/yamlCache.ts` : une mtime trop jeune peut
encore être reproduite par la réécriture suivante, donc la mettre en clé sert un contenu
périmé — pour un fichier de clip, l'édition qu'on vient de faire, silencieusement annulée.

Un banc qui écrit sa fixture puis mesure **immédiatement** se trouve donc à cheval sur deux
régimes : pendant les deux premières secondes chaque itération lit, parse et jette — le cache ne
*peut* pas toucher — et passé la fenêtre il touche toutes les fois. À 64 pistes un banc dure
~1,5 s, exactement la largeur de la fenêtre, et sa moyenne mélange les deux populations. L'écart
entre elles est un facteur cinq :

| | 1er compile | après la fenêtre |
|---|---|---|
| 8 pistes | 19,2 ms | **4,5 ms** |
| 64 pistes | 109,4 ms | **21,5 ms** |

## Ce que fait `writeBenchProject`

Il estampille chaque fichier une heure en arrière (`utimesSync`) juste après l'avoir écrit. Une
heure plutôt qu'un `sleep` de 2 s : ce qu'on veut n'est pas un banc plus lent, c'est une fixture
**dans l'état où est un vrai morceau** — des fichiers écrits il y a des jours, que le cache a le
droit de servir. C'est le régime dans lequel un musicien compile.

Les clés de la map de fichiers *sont* les chemins relatifs, donc l'estampillage ne fait aucun
parcours de dossier et n'appelle aucune option de `readdir` qui dépendrait de la version de
Node (le paquet déclare `>=18`).

## Les chiffres, une fois le régime tenu

Même machine, deux bancs joués séquentiellement.

| banc | temps | rme |
|---|---|---|
| `compileNodeProject` — 8 pistes | 3,68 ms | ±1,64 % |
| `compileNodeProject` — 64 pistes | 21,36 ms | ±1,74 % |
| `buildGraphDoc` — 8 pistes | 4,18 ms | |
| `buildGraphDoc` — 64 pistes | 35,65 ms | |

Deux choses valent d'être retenues.

**Les deux bancs ne mesurent pas la même chose.** `buildGraphDoc` coûte **35,65 ms contre
21,36** — les ~14 ms d'écart sont le travail qui lui est propre, les extents de clips. À régime
mêlé les deux sont dominés par les mêmes lectures YAML non cachées, qui rendent un chiffre
identique à 0,6 % près et masquent ce poste entier.

**La courbe est douce.** 8× les pistes coûtent 5,8× (compile) et 8,5× (graphDoc).
`compileNodeProject` est donc sous-linéaire par piste, et c'est `buildGraphDoc` qui est le poste à
surveiller quand un morceau grossit.

## La règle, qui dépasse ce banc

`audit-perf-web.md` ouvre sur « mesurer à travers deux compilations n'est pas mesurer ». Voici le
jumeau de cette phrase : **mesurer à travers un cache qui change d'état en cours de mesure n'est
pas mesurer non plus.** Un banc doit décider dans quel régime il travaille et s'y tenir, sinon son
écart-type est la seule chose honnête qu'il publie — et un banc à ±40 % ne peut valider aucun
changement de moins de 40 %, c'est-à-dire presque aucun : il ne sert qu'à repérer une catastrophe.

Un banc qui touche au disque dans ce dépôt doit donc vieillir sa fixture. Ce qui vaut aussi pour
toute mesure faite à la main : compiler deux fois de suite un projet qu'on vient d'écrire donne
deux nombres qui n'ont pas le même sens.

## Ce qu'il ne faut PAS mettre en cache

Le `safeParse` de zod (`loader.ts`) n'est pas mis en cache alors que le parse YAML l'est, et ça
ressemble au poste suivant. Mesuré : **1,0 % d'un compile à 64 pistes**, 1 à 2,5 % à 8. Et le
mettre en cache casserait un invariant que `loader.ts` écrit noir sur blanc — le parse caché n'est
sûr *que parce que* `r.data` est une structure neuve que zod rebâtit, si bien que rien de partagé
ne sort de la boucle. Mettre `r.data` en cache reviendrait à distribuer un objet partagé.
