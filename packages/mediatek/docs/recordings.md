# recordings.ts — notes étendues

## Une zone à la racine, pas une famille, pas un *kind*

```
<racine>/
  morceaux/     ← famille : imported/ et recorded/, catalogués
  samples/      ← famille
  modules/      ← famille
  library/      ← zone : les assets qu'un module nomme (ir/, nam/)
  recordings/   ← zone : <YYYY-MM-DD>/<HH-MM-SS>.<ext>
```

**Pas une quatrième famille.** `Family` est un type que tout le monde consomme — le scan,
les jetons, le manifeste, m9, le cache. En ajouter une pour quelque chose qui ne
produit aucune entrée coûterait un `switch` partout, pour des branches vides.

**Pas un `MORCEAU_KIND`.** Un *kind* est balayé en entrées de catalogue. Une capture n'a ni
titre, ni artiste, ni pochette : c'est une heure et des octets. Un millier de fichiers
`21-05-07.mp3` noierait trois cents morceaux dans la liste, et la recherche ne pourrait rien
en faire — aucun champ à interroger.

**Pas non plus un enfant de `morceaux/`.** C'était la première version, au motif que c'est
de la matière à morceaux. Le rangement disait alors le contraire de ce que l'écran montre :
`recordings` est une **section**, au même rang que les trois autres, et dans un dépôt où le
système de fichiers *est* le catalogue, une section qui vit dans le dossier d'une autre est
un mensonge qui finit par coûter. Deux bricoles ont d'ailleurs disparu avec le déplacement —
le trou à creuser dans le manifeste de `morceaux`, et le jeton emprunté à cette famille.

`library/` était déjà exactement cela : un dossier racine qui n'est pas une famille. La zone
suit le précédent plutôt que d'en inventer un.

Conséquence, et c'est ce qui a été choisi : `scanFamily("morceaux")` ne la voit pas,
`/list?family=…` n'en parle jamais, et rien de tout cela n'est un oubli — c'est testé
(`recordings.test.ts`, « what the zone is NOT »).

## Hors des manifestes, donc hors des caches

`manifest()` prend une **famille**. La zone n'en est pas une : aucun argument possible ne
l'atteint, donc elle ne se synchronise pas — structurellement, et non par un filtre qu'on
pourrait oublier de maintenir.

C'est voulu. Un cache télécharge ce qu'un manifeste liste ; ces fichiers n'entrent dans
aucun catalogue, donc les mirroiter remplirait chaque disque d'octets qu'aucune surface ne
sait ni nommer ni jouer. Le volume hébergé les garde, les machines ne les rapatrient pas.

Si un jour une capture doit se jouer depuis une platine, le chemin est de la **promouvoir**
en morceau — pas d'élargir le manifeste.

## L'heure vient de l'appelant, quand il la connaît

`POST /api/mediatek/recording?filename=…&at=<ISO>` — `at` est le moment de la **capture**,
pas celui de l'envoi, et il est facultatif :

| appelant | `at` | pourquoi |
|---|---|---|
| un enregistreur qui pousse en direct | absent | l'horloge du serveur dit la même chose |
| un lot rapatrié le lendemain | fourni | sinon la séance entière atterrit sous la mauvaise date |
| le bouton de la médiathèque | la mtime du fichier | pour une capture, c'est son heure d'enregistrement |

Un `at` illisible est un **400**, pas un repli silencieux sur maintenant : un appelant qui a
pris la peine d'en envoyer un se soucie de l'endroit où le fichier atterrit, et aujourd'hui
est la seule réponse qu'il ne voulait certainement pas.

Le jour et l'heure sont **locaux**, pas UTC. Une répétition qui finit à 00h30 se range au
jour que la personne qui jouait appellerait « hier soir ».

## Les moments sont dans le même dossier de jour

Un moment est un extrait découpé dans une séance : une heure, une durée et, parfois, un
nom. Les trois sont dans le nom du fichier.

```
recordings/2026-08-03/21-05-07.webm                          ← la séance
recordings/2026-08-03/moment-21-01-30--15--Le solo.webm      ← un extrait, nommé
recordings/2026-08-03/moment-21-01-30--15.webm               ← un extrait, anonyme
```

Le même dossier que les captures, et non un sous-dossier : **un moment EST une capture**,
plus courte. Les séparer ferait de « qu'est-ce qu'on a joué ce soir-là » deux endroits.

L'heure est celle où l'extrait a été **joué** — le début de la séance plus sa position
dedans — et non celle où quelqu'un l'a annoté, qui peut être trois jours plus tard. La zone
range par heure de jeu ; un moment n'y fait pas exception.

`--` sépare les champs, donc un nom qui porte sa propre suite de tirets est réduit à un
seul. Rien ne re-parse ce nom — les métadonnées restent chez l'appelant — mais quelqu'un
qui lit `moment-21-05-07--15--Solo` ne doit pas avoir à deviner où finit la durée.

## Deux fichiers à la même seconde ne sont pas un conflit

Le nom pris gagne `-2`, `-3`… Deux micros qui s'arrêtent ensemble, c'est un après-midi
ordinaire, pas une erreur à signaler.

C'est l'inverse de `addMorceau`, qui répond 409 quand le dossier déduit est occupé — et les
deux ont raison, parce que le doublon ne veut pas dire la même chose : là-bas, deux envois
qui déduisent un même dossier sont presque toujours **le même morceau** deux fois ; ici,
deux fichiers à la même seconde sont **deux fichiers**.

## L'API est la voie principale

La route est derrière le même `bearerOrSession` que le reste de la bibliothèque (voir
`apps/mediatek/backend/src/server.ts`). Un enregistreur sans navigateur n'a donc rien de
particulier à faire : il présente un jeton d'API — celui que `POST /api/token` délivre — et
pousse ses octets bruts.

```bash
curl -X POST \
  -H "Authorization: Bearer $STUDIO_TOKEN" \
  -H "content-type: application/octet-stream" \
  --data-binary @take.mp3 \
  "https://studio.test/mediatek/api/mediatek/recording?filename=take.mp3&at=2026-08-03T21:05:07"
# → { "ok": true, "path": "recordings/2026-08-03/21-05-07.mp3", "day": "…", "name": "…" }
```

Corps brut et non multipart, pour la raison qui vaut déjà pour `PUT /file` : une capture
d'une heure ne doit jamais devenir un champ dans un parseur de formulaire.

Le bouton de la médiathèque envoie exactement la même requête, une par fichier. Un envoi
partiel est un vrai résultat : les fichiers passés sont dans la zone, et l'interface les
montre malgré l'erreur sur les suivants.

## Son propre jeton, dans la même carte

`revisions()` rend un jeton par famille **plus celui de la zone**, et `/revision` les sert
ensemble. L'écran garde donc un seul sondage pour ses quatre onglets, et chacun ne recharge
que quand le sien a bougé.

C'est ce qui a remplacé la première version, où la zone empruntait le jeton de `morceaux` :
chaque capture faisait alors recharger une liste de morceaux identique. Un dossier à la
racine répond de lui-même.

Même raison pour le compte du résumé : `summary()` renvoie quatre nombres, pas trois, sinon
le quatrième onglet afficherait zéro jusqu'à ce qu'on clique dessus.

## Ce que la section montre

Un onglet à côté des trois familles. L'arbre de gauche liste les jours puis les captures ;
le panneau central les reprend jour par jour, du plus récent au plus ancien, avec la taille
— et rien d'autre, parce qu'une capture n'a ni titre, ni artiste, ni *kind* à afficher.

L'arbre n'y écrit pas : renommer une capture produirait un fichier à une heure à laquelle il
n'a pas été enregistré. C'est la même décision que pour `morceaux/`, pour une raison
différente, et dans les deux cas la porte est un bouton d'en-tête.
