# Ouvrir une playlist — le texte et ce qu'il fait sonner

Une playlist est un fichier YAML qui nomme des morceaux que la médiathèque tient déjà
(`packages/mediatek/docs/playlists.md` pour le format et pour pourquoi c'est un fichier et
non un dossier). L'écran est celui des chaînes et des morceaux, à l'identique :

```
┌────────┬─────────────────────┬─────────────────────┐
│ arbre  │ la playlist .yaml   │ les lignes, jouables│
│        │ (YamlPane)          │ dans l'ordre        │
└────────┴─────────────────────┴─────────────────────┘
```

C'est volontaire : `ChainEditor`, `SongEditor` et celui-ci posent la même question — on
édite un texte en entendant ce qu'il décrit — et un troisième agencement n'aurait rien
ajouté qu'une chose de plus à apprendre.

## Le panneau de droite suit les touches, pas les enregistrements

`items` est recalculé à chaque frappe, comme le graphe de `ChainEditor`. Mais il n'est
**remplacé que par quelque chose de lisible** : un YAML à moitié tapé ne parse pas à peu
près une frappe sur deux — un crochet qu'on n'a pas encore fermé — et un panneau qui se
viderait à chaque fois clignoterait sur toute la longueur de la ligne qu'on écrit. Le pied
de page dit quand ce qui est affiché est en retard sur le texte.

## Là où les deux familles se rencontrent

Le scan ne vérifie **pas** qu'un renvoi désigne un morceau qui existe : le catalogue
invalide une famille à la fois, donc une liste de playlists qui dépendrait de la liste des
morceaux se périmerait à chaque morceau déposé. Cet écran est donc le seul endroit qui
tient les deux listes, et par conséquent le seul où « ce morceau n'existe pas » est une
question à laquelle on puisse répondre. Même partage que `SongVariants` pour les variantes
de type chaîne.

D'où la deuxième requête, ici et nulle part ailleurs : `PlaylistEditor` interroge
`/list?family=songs` pour son compte, en parallèle de la section que `Library` affiche —
qui est `playlists`, pas `songs`.

La résolution elle-même est pure et testée à part (`playlistItems.ts`) : le chemin d'abord,
le nom ensuite, exactement comme `findChain`. Une ligne peut donc s'écrire
`AC-DC/Back in Black/Hells Bells` — ce que l'arbre vous donne — ou juste `Hells Bells` —
ce que quelqu'un tape.

## Une ligne qui ne résout rien reste à l'écran

Elle n'est pas jetée, et c'est le point : le fichier s'édite à la main, juste à gauche.
Une ligne qui disparaîtrait silencieusement du panneau de droite serait une faute de frappe
qu'on ne peut pas voir. Une rangée qui dit « introuvable » est une faute qu'on corrige.

Trois refus distincts, parce que les réponses diffèrent :

| ce qui est dit | ce qu'il faut faire |
|---|---|
| `morceau introuvable` | la référence ne désigne aucun morceau — corriger la ligne |
| `variante « x » introuvable` | le morceau est là, cette version-là n'y est pas |
| `ce morceau n'a pas de master` | dossier catalogué sans audio — le scan l'autorise |
| `pas encore rendue` | variante de type CHAÎNE : le bouton « Process » du morceau la rend |

## Une variante de chaîne n'est de l'audio qu'une fois rendue

`takesOf` donne le fichier d'une variante de type `file` ; une variante de type `chaîne` n'en
a pas — c'est un traitement, pas des octets. Le panneau demande donc à la médiathèque si le
rendu est là, sous les deux noms qu'il peut porter (`renderNames` : mp3 quand la machine
avait ffmpeg, wav sinon). Une requête d'un octet par version, faite d'avance, pour qu'une
rangée dise « pas encore rendue » **avant** le clic plutôt qu'après.

C'est aussi pourquoi ce panneau ne joue pas la chaîne lui-même : jouer un graphe de greffons
demande un moteur, et il y a déjà un écran pour ça — celui du morceau. Ici on joue un
fichier, et un fichier se joue des deux côtés du fil.

## Le transport n'est pas à nous

Rien ici ne tient de son. `playback.start(...)` charge, et c'est `PlaybackProvider` qui joue
— un `<audio>` ou le moteur selon la destination du compte, derrière un seul transport (voir
[miniPlayer.md](miniPlayer.md) et [playbackTarget.md](playbackTarget.md)). Conséquence
voulue : la playlist continue quand on quitte l'écran, et la barre du bas la suit.

### Enchaîner

`Playback.ended` est un compteur, ajouté pour ce panneau et lu par lui seul. Un compteur et
non un drapeau : ce qu'on veut est l'ÉVÉNEMENT, et un booléen devrait être remis à zéro par
qui l'a vu.

Côté navigateur, `onEnded` est exact — il ne se déclenche que pour une fin de morceau. Côté
moteur, il n'y a qu'un bit, `playing`, qui tombe aussi bien quand la machine arrive au bout
que quand on lui dit de s'arrêter ; `weStopped` est ce qui distingue les deux, posé par
chaque transition qu'on a demandée.

Et seulement si ce qui s'est terminé est **le nôtre** : la barre du bas survit à cet écran,
donc un morceau lancé depuis sa propre page ne doit pas faire avancer une playlist que
personne ne regarde.

Une ligne injouable est **sautée**, pas bloquante. Une playlist qui s'arrêterait à sa
troisième ligne à cause d'une faute de frappe serait une playlist qu'on ne peut pas écouter
pendant qu'on la corrige. La rangée dit toujours ce qui ne va pas ; elle n'arrête plus la
soirée. Une machine sans cache, en revanche, arrête tout et le dit en haut : c'est un défaut
de la **destination** et non de la ligne, et parcourir toute la playlist pour ça
ressemblerait à une playlist cassée.

## Ajouter un morceau

« Ajouter un morceau », à côté de « Tout jouer », ouvre un champ de recherche au-dessus de la
liste — au-dessus et non par-dessus : ce qu'on remplit reste visible, et le voir s'allonger
est la seule confirmation qu'il y ait.

La recherche cherche dans le titre, l'artiste et le chemin (donc l'album), et **chaque mot
doit tomber quelque part, pas au même endroit** : « nirvana lithium » trouve un morceau dont
l'un est l'artiste et l'autre le titre, ce qu'une simple sous-chaîne sur toute la requête ne
ferait jamais. Entrée prend le premier résultat, Échap ferme.

Le champ **reste ouvert** après un clic. Monter une setlist, c'est ajouter huit morceaux à la
suite ; un panneau qui se refermerait à chaque fois en ferait huit allers-retours par le même
bouton.

Une rangée ajoute le **master** ; les pastilles à côté ajoutent une **variante** — sans elles,
mettre `instrumental` dans une setlist voudrait dire aller taper le mapping à la main, alors
que le format existe précisément pour le porter.

### Ce qui est écrit, et pourquoi c'est du texte

Le clic n'ajoute rien à une liste que ce composant tiendrait : il écrit **la ligne dans le
tampon**, et le panneau de droite se redessine parce que le texte a changé. Autrement il y
aurait deux sources de vérité pour un seul document, et le YamlPane à gauche continuerait
d'afficher l'ancienne.

`appendPlaylistItem` travaille donc sur le texte et ne repasse jamais par le sérialiseur —
même soin que `withVariant` prend avec le sidecar d'un morceau, et pour la même raison : ces
fichiers portent des commentaires et un ordre que quelqu'un a choisi. Faire un aller-retour
d'une setlist par un sérialiseur, c'est exactement le changement que personne ne remarque
avant que ses notes aient disparu.

La référence écrite est le **chemin** (`AC-DC/Back in Black/Hells Bells`), pas le titre nu :
celui-ci est écrit par une machine, et un clic sur une rangée désigne CE morceau-là et pas ce
qui porte le même nom. `findSong` lit les deux, donc le fichier reste éditable à la main.

Les valeurs sont citées quand il le faut et seulement là (`yamlScalar`) : un titre qui
commence par `-`, qui contient `: `, ou qui s'appelle « No » deviendrait autre chose qu'une
chaîne. Tout citer serait plus simple et mettrait deux conventions dans un fichier qu'on écrit
aussi à la main.

Le bouton se désactive, en le disant, quand le fichier a un `items:` que l'ajout textuel ne
sait pas étendre — une séquence en flot sur plusieurs lignes, par exemple. Inventer un
deuxième `items:` plus bas ferait un fichier dont les deux moitiés se contredisent, ce qui est
pire que de s'entendre dire de taper la ligne soi-même.

L'ajout **n'enregistre pas**. C'est une édition comme une frappe en est une, et c'est
« Enregistrer * » qui en fait un fichier — sinon un clic écrirait sur le disque la ligne à
moitié tapée qui traîne à côté.

## Créer

« Nouvelle playlist… » dans le menu de l'arbre, à côté du « Nouveau fichier… » générique qui
en créerait un **vide**. Le panneau de droite se dessine à partir du texte, donc un fichier
vide s'ouvrirait sur un échec de parsing pour une playlist que personne n'a encore eu
l'occasion de rater. Celui-ci écrit le gabarit, ajoute l'extension si elle manque — c'est
elle qui fait le fichier, il n'y a pas de marqueur dedans — et ouvre l'écran.

L'arbre de cette famille sait écrire, contrairement à celui des morceaux : ici rien n'est
déduit de tags, un dossier est un dossier et un renommage est un renommage.
