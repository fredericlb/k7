# Le banc mesurait deux régimes à la fois

`docs/audit-perf-web.md` laissait un fil ouvert, et c'était le seul constat de perf du dépôt
sans explication : à 64 pistes, `compileNodeProject` variait de **±36-40 %**, min 17 ms contre
max 92 ms, avec la note « un cache qui tantôt touche et tantôt manque ». Le fil est tiré. Ce
n'était pas le produit — c'était le banc.

## La cause

`yamlCache` refuse délibérément de mettre en cache un fichier dont la mtime a moins de
`SETTLE_MS` (2 s). La raison est bonne et écrite dans `yaml/yamlCache.ts` : une mtime trop
jeune peut encore être reproduite par la réécriture suivante, donc la mettre en clé servirait
un contenu périmé — pour un fichier de clip, l'édition qu'on vient de faire, silencieusement
annulée.

Or `writeBenchProject` écrivait sa fixture puis mesurait **immédiatement**. Pendant les deux
premières secondes, chaque itération du banc lisait, parsait et jetait — le cache ne *pouvait*
pas toucher. Passé deux secondes, il touchait toutes les fois. Un banc qui tourne ~1,5 s à
64 pistes se trouvait donc exactement à cheval, et sa moyenne mélangeait deux populations.

Mesuré à la main, un compile après l'autre dans le même process :

| | 1er compile | après la fenêtre |
|---|---|---|
| 8 pistes | 19,2 ms | **4,5 ms** |
| 64 pistes | 109,4 ms | **21,5 ms** |

Un facteur cinq, et une moyenne qui ne décrivait ni l'un ni l'autre.

## Le correctif

`writeBenchProject` estampille chaque fichier une heure en arrière (`utimesSync`) juste après
l'avoir écrit. Une heure plutôt qu'un `sleep` de 2 s : ce qu'on veut n'est pas un banc plus
lent, c'est une fixture **dans l'état où est un vrai morceau** — des fichiers écrits il y a des
jours, que le cache a le droit de servir. C'est le régime dans lequel un musicien compile.

Les clés de la map de fichiers *sont* les chemins relatifs, donc l'estampillage ne fait aucun
parcours de dossier et n'appelle aucune option de `readdir` qui dépendrait de la version de
Node (le paquet déclare `>=18`).

## Ce que ça change aux chiffres

Même machine, deux bancs joués séquentiellement.

| banc | avant | après |
|---|---|---|
| `compileNodeProject` — 8 pistes | 14,40 ms, **rme ±2,11 %** | **3,68 ms**, rme ±1,64 % |
| `compileNodeProject` — 64 pistes | 67,75 ms, **rme ±41,61 %** | **21,36 ms**, rme ±1,74 % |
| `buildGraphDoc` — 8 pistes | 13,5 ms | **4,18 ms** |
| `buildGraphDoc` — 64 pistes | 68,5 ms | **35,65 ms** |

Trois choses valent d'être retenues.

**La variance a disparu** : ±41,61 % → ±1,74 %. Un banc à ±40 % ne peut valider aucun
changement de moins de 40 %, c'est-à-dire presque aucun — il ne servait qu'à repérer une
catastrophe.

**Les deux bancs ne mesurent plus la même chose.** Avant, `compileNodeProject` (68,1 ms) et
`buildGraphDoc` (68,5 ms) rendaient un chiffre identique à 0,6 % près, et l'audit en concluait
que le second ne coûtait rien de plus. C'était faux : les deux étaient dominés par les mêmes
lectures YAML non cachées, qui masquaient tout le reste. À découvert, `buildGraphDoc` coûte
**35,65 ms contre 21,36** — les ~14 ms d'écart sont le travail qui lui est propre, les extents
de clips. Un poste entier était invisible.

**La courbe est plus douce qu'annoncé.** 8× les pistes coûtent 5,8× (compile) et 8,5×
(graphDoc), là où les anciens chiffres disaient ×5 pour les deux. `compileNodeProject` est donc
sous-linéaire par piste, et c'est `buildGraphDoc` qui est le poste à surveiller quand un morceau
grossit.

## La leçon, qui dépasse ce banc

`audit-perf-web.md` ouvre sur « mesurer à travers deux compilations n'est pas mesurer ». Voici
le jumeau de cette phrase : **mesurer à travers un cache qui change d'état en cours de mesure
n'est pas mesurer non plus.** Un banc doit décider dans quel régime il travaille et s'y tenir,
sinon son écart-type est la seule chose honnête qu'il publie — et c'était le cas ici, ±41 %
disait exactement qu'il ne fallait pas croire la moyenne.

Un banc qui touche au disque dans ce dépôt doit donc vieillir sa fixture. Ce qui vaut aussi
pour toute mesure faite à la main : compiler deux fois de suite un projet qu'on vient d'écrire
donne deux nombres qui n'ont pas le même sens.

## Ce qui n'a PAS été fait, et pourquoi

Le `safeParse` de zod (`loader.ts`) n'est pas mis en cache alors que le parse YAML l'est, et
ça ressemblait au poste suivant. Mesuré avant d'y toucher : **1,0 % d'un compile à 64 pistes**,
1 à 2,5 % à 8. Et le mettre en cache casserait un invariant que `loader.ts` écrit noir sur
blanc — le parse caché n'est sûr *que parce que* `r.data` est une structure neuve que zod
rebâtit, si bien que rien de partagé ne sort de la boucle. Mettre `r.data` en cache reviendrait
à distribuer un objet partagé.

Constat retiré, donc, et inscrit ici pour que personne ne le repropose.
