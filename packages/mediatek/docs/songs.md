# song.ts — notes étendues

Vocabulaire : le **stockage** et le **code** sont en anglais (`songs/`, `song.yaml`,
`addSong`), la **prose** et l'**interface** sont en français. Ce que `songs/` contient
s'appelle un **morceau**, et l'onglet s'appelle « Morceaux » à l'écran.

## `songs/` ne s'édite pas à la main

Les deux autres familles se laissent manipuler comme un dossier : l'arbre de la
médiathèque y crée, renomme, déplace, supprime. `songs/` non — sa forme est une
règle, pas une convention :

```
songs/<artiste>/<album>/<titre>/original.<ext>
                                song.yaml
```

Le scan part de la racine de la famille, s'arrête au premier dossier qui porte un
`song.yaml` ou un fichier audio, et prend ce dossier pour une entrée. Un dossier créé à la
main au mauvais niveau ne produit donc pas une entrée mal rangée : il produit une entrée
invisible, ou pire, il avale les dossiers en dessous de lui.

D'où le bouton, et d'où le fait qu'il soit la **seule** façon d'entrer dans cette
famille : on envoie trois champs, la bibliothèque construit le chemin.

Ce qui est verrouillé est l'**arborescence**, pas le contenu : `song.yaml` s'édite comme
n'importe quel YAML, dans l'écran scindé que st0 ouvre en cliquant un morceau (voir
`apps/st0/docs/songPlayer.md`). Le sidecar est la vérité — le titre affiché, le tempo, les
variantes — et le dossier n'est qu'une adresse ; corriger l'un ne déplace donc rien.

## Pas de niveau de provenance — trois segments, jamais quatre

L'arborescence a porté un quatrième niveau, tout en haut : `imported/` pour le master de
quelqu'un d'autre, `recorded/` pour ce que le studio avait produit. Il a été retiré, et
c'est la seule vraie décision de ce renommage.

Deux raisons, dans cet ordre :

1. **Il séparait la mauvaise chose.** Ce qui mérite d'être à part, ce n'est pas « qui a
   produit ce master » mais « est-ce que c'est catalogué ou est-ce que c'est de la matière
   brute ». Et cette séparation-là existe déjà : `recordings/`, les enregistrements, est une zone à la racine,
   avec son propre jeton de révision, hors de tous les manifestes
   (voir [recordings.md](recordings.md)). Le niveau `imported|recorded` doublait une
   frontière déjà tracée ailleurs, en la traçant moins bien.
2. **Presque rien ne le lisait.** Il arrivait dans `MediatekEntry.kind`, où la seule
   surface qui l'affichait était un badge dans la liste. En échange, il mettait chaque
   morceau un cran plus bas que son artiste, et obligeait chaque appelant capable d'écrire —
   k7 publiait sous `recorded`, le bouton envoyait sous `imported` — à choisir un mot pour
   décrire quelque chose que le sidecar disait déjà mieux.

Car ce qui reste, et qui suffit, c'est `source:` dans `song.yaml` : `upload` pour le bouton
de la médiathèque, `k7` pour une version publiée, `mirror` pour une copie rapatriée. Une
ligne dans un fichier, pas un niveau dans un chemin — donc lisible sans lister le dossier
parent, et modifiable sans déplacer des octets.

Conséquence directe : `songFolder()` rend toujours quatre segments (`songs` + les trois
tags), et deux tests le vérifient **par le compte** plutôt que par l'égalité avec un
chemin d'exemple — un cinquième niveau qui reviendrait le ferait en silence, sous la forme
d'un dossier imbriqué qu'une comparaison de chaîne n'aurait pas remarqué.

L'autre conséquence est que `kind` vaut `""` pour cette famille. C'est volontairement une
chaîne vide et non un mot d'emprunt : cette famille ne se divise pas, et une entrée qui le
dit est honnête là où « imported » par défaut aurait menti.

## Le client n'envoie jamais un chemin

`POST /api/mediatek/song?artist=…&album=…&title=…` porte les octets et trois chaînes.
Le chemin est construit côté serveur par `songFolder`, jamais reçu.

Ce n'est pas de la cosmétique. `PUT /file` accepte un chemin parce que ses deux appelants
en ont un légitime (un éditeur qui sauve son YAML, une machine qui pousse une arborescence
qu'elle possède déjà). Un upload n'en a pas : il a des tags, qui viennent d'un fichier
téléchargé quelque part. Les laisser devenir un chemin, c'est laisser `AC/DC` ouvrir un
dossier et `../..` en remonter deux — `safePath` attraperait le second, rien n'attraperait
le premier.

`segment()` réduit donc chaque tag à un segment nommable : accents décomposés puis
supprimés (« Café » → « Cafe », et non « Caf » comme le ferait un simple filtre `\w`),
séparateurs et caractères interdits sur les trois systèmes remplacés par une espace, point
ou espace final retiré parce que Windows refuse silencieusement un tel nom au moment du
rename, 80 caractères au plus.

L'orthographe exacte, elle, survit dans `song.yaml` : c'est de là que le catalogue tire
le nom affiché. Le dossier est une adresse, le sidecar est la vérité.

## Un champ vide nomme le trou

Un fichier sans tag d'album se range sous « Album inconnu ». Refuser l'envoi serait plus
propre sur le papier et inutilisable en pratique : la moitié d'un disque téléchargé n'a
pas de tag d'album, et un morceau rangé sous un nom qu'on peut lire est un morceau qu'on
retrouve et qu'on renomme. Un morceau refusé n'est nulle part.

## Les tags sont lus dans le navigateur

`music-metadata` tourne côté frontend, sur le `File` choisi, et remplit le dialogue. Trois
conséquences voulues :

- **on voit le chemin avant l'envoi.** Le dialogue affiche exactement ce que le serveur
  construira, en appelant les mêmes fonctions de ce module — pas une deuxième version de
  la règle, qui finirait par en diverger ;
- **on corrige avant l'envoi**, ce qui vaut mieux que renommer trois dossiers après ;
- **le backend n'a pas la dépendance.** Il reçoit trois chaînes et ne parse aucun
  conteneur audio, donc un mp3 malformé ne peut pas le faire tomber : au pire il devient
  un formulaire à remplir à la main, ce que le dialogue permet déjà.

Un fichier illisible par la bibliothèque n'est pas une erreur non plus : le nom de fichier
est alors la meilleure source disponible, et `tagsFromFilename` en tire « 01 - Artiste -
Titre » quand la convention est respectée.

## Rien n'est ré-encodé

Le master s'appelle `original.<ext>` — l'extension de ce qui a été envoyé. Un flac reste un
flac. Nommer le fichier `original.mp3` quoi qu'il arrive supposerait un transcodage, donc
`ffmpeg` dans l'image, une perte de qualité sur un master, et une attente à chaque envoi.

Le radical est fixe pour la raison inverse : un consommateur qui tient le dossier trouve
l'audio sans lister. `master()` du scan reste néanmoins ce qui fait autorité — c'est lui
qui remplit `meta.master`, parce qu'un dossier peut aussi venir du miroir k7, où le
fichier s'appelle `master.<ext>`.

## Déjà là est un 409, pas un écrasement

Deux envois qui déduisent le même dossier sont presque toujours le même morceau envoyé
deux fois. Le second est refusé avec un 409 : l'écrasement silencieux est le seul résultat
que la personne qui envoie ne peut pas défaire, et « c'est déjà là » est une information
qu'elle veut.

Le dialogue transforme ce 409 en question — remplacer, ou changer un des trois champs pour
ranger ailleurs. Un remplacement dans un autre format supprime l'ancien master : deux
`original.*` dans un dossier, et le scan joue celui que `readdir` rend en premier.

C'est la règle inverse de celle d'`ingest.md`, où un PUT remplace sans demander. La
différence est l'appelant : pousser un workspace est un acte délibéré visant un dossier
nommé, envoyer un fichier depuis un navigateur ne l'est pas.

## Les deux autres familles : on dépose un dossier

`modules/` et `samples/` se manipulent comme une arborescence, et un **module est un
dossier** — `module.yaml`, `ui.yaml`, `presets.yaml` (voir `@studio/song`'s
`docs/uiLibrary.md`). « Ajouter un module » est donc un dépôt de dossier, pas de fichiers.

Le navigateur ne le donne pas gratuitement : `dataTransfer.files` est une liste plate qui
ne peut pas porter un répertoire, ce qui faisait qu'un dossier déposé n'arrivait
**nulle part, sans erreur**. L'arbre partagé lit maintenant le dépôt par
`webkitGetAsEntry` et rend chaque fichier avec le chemin qu'il occupait
(`onDropTree` — les deux pièges sont dans `commons/packages/ui/docs/file-tree.md`).

Côté ici, `uploadTree` fait un `PUT /file` par fichier sous `<dossier déposé>/<chemin>` :
`putFile` crée les répertoires intermédiaires, et `writablePath` refuse ce qui sort de la
racine. Un `..` est donc arrêté au même endroit que d'habitude, pas dans le client.

Et un **choix de dossier** dans le menu contextuel de l'arbre, à côté du glisser : un
glisser-déposer qui échoue le fait en silence, ce qui en fait une mauvaise seule-entrée.
C'est un second `<input type="file">` avec `webkitdirectory` — la propriété est celle de
l'input, pas du clic, d'où deux champs cachés plutôt qu'un.
