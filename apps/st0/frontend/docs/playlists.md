# Les playlists — le seul écran qui tient les deux catalogues

Le format, et pourquoi une playlist vit dans le dépôt plutôt que sur le volume hébergé, sont
dans [`packages/song/docs/playlists.md`](../../../../packages/song/docs/playlists.md). Cette
page-ci est l'écran.

```
                                        ┌─ panneau, à DROITE ──┐
cog ▸ Playlists   (ou le bouton du set) │ ▾ été 2026     + ⤢ ✕ │  ← liste déroulante
                                        ├──────────────────────┤     avec recherche
                                        │ les morceaux,        │
                                        │ résolus et jouables  │
                                        └──────────────────────┘
        ⤢ ─────────────────────────────▸ la PAGE : le texte YAML | les morceaux
```

## Un panneau ancré à droite, pas une page

C'était une page plein écran : la liste des `.yaml`, puis un écran par playlist. Ce n'était pas
la bonne forme — on ouvre une set list **pendant** qu'on travaille, et une page oblige à quitter
le morceau pour aller la regarder. C'est donc un panneau **collé à droite**, dans la même rangée
que les panes : il pousse les panes au lieu de les couvrir, et on peut le laisser ouvert.

La playlist se choisit dans une **liste déroulante avec recherche** — le `TreePicker`, exactement
celui du sélecteur de modules. Pour la même raison qu'ailleurs : la liste est aussi longue que le
dépôt est vieux, et taper trois lettres est le geste que ce shell a partout. La recherche score
le titre ET le chemin, parce qu'on cherche une set list par l'un ou par l'autre (`live/repet`).

Les morceaux sont **en dessous**, résolus contre la médiathèque et jouables — c'est
`PlaylistPane`, la moitié droite de l'ancienne page, inchangée.

## Le texte reste, à un clic

Le panneau fait 24rem : il n'y a pas la place pour le YAML à côté des morceaux, et le texte est
toujours le seul moyen d'**enlever** une ligne ou d'en changer l'ordre — `PlaylistPane` sait
ajouter et rien d'autre. La page n'est donc pas supprimée, elle est rétrogradée : le bouton ⤢
l'ouvre en plein écran sur la playlist courante, et c'est la sortie de secours pour ce que le
panneau ne sait pas faire.

C'est le même composant des deux côtés. `PlaylistEditor` prend un `panel`, qui retire son
en-tête et la moitié YAML ; en dessous tout est identique — même chargement, même tampon, même
autosave, même liste résolue. Deux composants auraient été deux documents à garder en phase,
ce qui est précisément le bug contre lequel l'en-tête de ce fichier met en garde.

## Son propre panneau, pas un onglet des réglages, pas un pane

Les panes de ce shell sont le **morceau ouvert** — l'éditeur, la timeline, le graphe, le
viewport — et ce qu'ils dessinent, c'est ce que le projet DÉCLARE (`docs/shell.md`,
`packages/song/docs/surfaces.md`). Une playlist n'est déclarée par aucun projet et n'appartient
à aucun : elle est à la racine du dépôt et c'est la même quelle que soit la chanson qu'on
travaille. Elle n'est donc pas un pane, même maintenant qu'elle a une colonne — et elle n'est
pas non plus dans l'URL.

Elle a eu, le temps d'une itération, un **onglet sous le cog**. C'était classer par l'endroit
d'où elle venait : des réglages sont ce qu'on règle et qu'on laisse, une set list est ce à
partir de quoi on travaille. Elle partage donc la colonne de droite avec les réglages et le
partage (`rightPanel` dans `App`, `docs/shell.md`) sans être rangée dedans.

Comme tout le reste de ce shell, ce qui l'ouvre **dispatche une ligne de commande** —
`ui playlists`, qui bascule le panneau — plutôt que d'appeler une fonction à elle : tout ce qui
est sur cet écran est atteignable depuis la palette, et une implémentation unique est ce qui
empêche les deux de diverger (`docs/shell.md`).

## Un bouton dans la barre, sur un SET seulement

Un projet qui déclare une surface `turntables` porte un bouton **Playlists** dans la barre, à
côté de Partager et de Réglages. Sur un pupitre la playlist EST la set list : c'est l'écran
qu'on ouvre en plein set, et le chercher dans la palette est la mauvaise forme pour la seule
chose qu'on cherche pendant la soirée.

Sur une chanson il n'y a pas de bouton — la barre est de la largeur, et les set lists ne sont
pas ce pour quoi on est venu. `ui playlists` les ouvre quand même : c'est la même ligne, donc un
seul comportement et une seule entrée dans le journal. Jamais sur un instantané partagé — un
partage n'a pas de dépôt, donc pas de `_playlists/`.

## Trois serveurs, dont un nouveau

C'est le premier écran de st0 qui parle à **pl8** autrement que pour la session. Le tableau que
`AGENTS.md` tient devient :

| | pour quoi | où |
|---|---|---|
| backend st0 | la session, le registre des moteurs | même origine, **à la racine** |
| service de fichiers | la playlist elle-même — `/playlists`, `/file`, `/file` (PUT) | machine du moteur, cross-origin |
| **médiathèque pl8** | les morceaux que la playlist nomme | même origine, sous `/pl8` |

Ce dernier point est le piège, et il vaut la peine d'être écrit : c'est **st0** qui répond à la
racine de l'origine, donc son `BASE` est la chaîne vide et un `/api/mediatek/*` écrit nu part
chez son propre backend — qui n'a pas cette route. Les appels à la médiathèque passent par
`serviceUrl(…, "pl8")`, jamais par `BASE` et jamais en dur : écrits nus, ils reviennent en 404
et le catalogue vide se lit comme « vous n'avez aucun morceau ».

C'était l'inverse avant que st0 ne prenne la racine — la médiathèque y répondait, et `/api/mediatek/*`
nu était juste. La faute a donc changé de camp sans changer de forme, ce qui est exactement
l'argument pour demander la table plutôt que d'écrire un préfixe. `/auth/*` en haut de `api.ts`
est le cas qui ne bouge pas : il reste nu, parce que l'IdP ne connaît qu'un `redirect_uri` sans
préfixe.

L'authentification est le cookie de session, ce qui est aussi ce qui fait marcher `songUrl` en
`<audio src>` : un élément média ne sait pas poser d'en-tête, et n'a pas à le faire quand les
octets sont sur la même origine.

## Une seule route nouvelle

`GET /playlists` liste ; **lire et écrire un fichier sont `/file` et `PUT /file`**, qui servent
déjà n'importe quel chemin de l'espace de travail. Une seconde paire qui épellerait `_playlists`
dans ses URL serait deux façons d'écrire un même fichier — et l'autosave sur lequel tourne cet
écran est bâti sur celle qui existe déjà.

Le listing est une route à part pour la raison que `/module-libraries` l'est : `/tree` est
enraciné sur le projet actif, exprès, donc le dossier lui est invisible.

Il y a eu un `POST /playlists` pour en créer une, et il est parti par le même raisonnement, un cran
plus loin : créer une playlist est une **commande** (ci-dessous), donc l'écriture passe par
`/command` avec tout le reste. `Workspace.createPlaylist` est parti avec la route ; ses règles —
le gabarit plutôt qu'un fichier vide, l'extension ajoutée, une playlist déjà là refusée — sont
maintenant celles du verbe, avec ses tests.

## Créer et ajouter sont des verbes

| ce qu'on fait | la commande |
|---|---|
| « Nouvelle playlist » | `playlist new <nom>` — sous-dossiers compris (`live/repet`) |
| ajouter un morceau, par son nom | `playlist song add <playlist> <morceau> [variante]` |

Les deux agissent sur le **dépôt** (`repoDir`) et non sur le projet : ce sont les seuls verbes du
catalogue qui marchent sans projet ouvert, ce qui est exactement ce qu'est une playlist. Le morceau
est **tout le reste de la ligne**, espaces compris, parce qu'une référence est un chemin dans les
dossiers de la médiathèque (`AC-DC/Back in Black/Hells Bells`) ; **entre guillemets**, une variante
peut le suivre. Une règle, et la seule qui distingue « un morceau avec des espaces » de « un
morceau et une version ».

**Le bouton « Ajouter un morceau » du volet de droite ne dispatche pas la seconde**, et c'est
délibéré. Ce bouton écrit dans le **tampon ouvert** à côté — le YamlPane montre le fichier, et
l'ajout est une modification comme une frappe, enregistrée par l'autosave quand le texte se lit
comme une playlist. Une commande qui écrirait le FICHIER pendant qu'un tampon modifié le tient
courrait contre cet enregistrement. Les deux chemins partagent la seule chose qui doit être
partagée, `appendPlaylistItem` — même relation que le préréglage du gate de `event trim` avec
`trimWindow` (`docs/shell.md`) : une implémentation, deux appelants, à deux niveaux différents.

Le verbe est donc ce qu'on utilise **depuis la palette, une touche ou le CLI**, c'est-à-dire quand
l'écran n'est pas ouvert — et c'est là qu'il rend le plus service : monter une setlist sans quitter
la timeline.

## Le volet de droite suit les touches, pas les enregistrements

`items` est recalculé à chaque frappe, mais n'est **remplacé que par quelque chose de lisible** :
un YAML à moitié tapé ne parse pas à peu près une frappe sur deux — un crochet qu'on n'a pas
encore fermé — et un panneau qui se viderait à chaque fois clignoterait sur toute la longueur de
la ligne qu'on écrit. Le pied de page dit quand ce qui est affiché est en retard sur le texte.

Il n'y a pas de bouton « Enregistrer » : le fichier est écrit dès que le tampon **se lit comme
une playlist**. Une ligne à moitié tapée ailleurs dans le fichier retient donc aussi l'ajout —
c'est le but, le fichier s'écrit entier ou pas du tout. Voir
[autosave.md](../../../../packages/ui-editor/docs/autosave.md).

## Là où les deux catalogues se rencontrent

`parsePlaylist` garde ses renvois verbatim, parce que les résoudre demande la liste des
morceaux. Cet écran est le seul de l'app qui tient les deux, et donc le seul où « ce morceau
n'existe pas » est une question à laquelle on puisse répondre.

La résolution elle-même est pure et testée à part (`playlistItems.ts`) : le chemin d'abord, le
nom ensuite. Une ligne peut donc s'écrire `AC-DC/Back in Black/Hells Bells` — ce qu'un clic
écrit — ou juste `Hells Bells` — ce que quelqu'un tape.

Une ligne qui ne résout rien **reste à l'écran**, et c'est le point : le fichier s'édite à la
main, juste à gauche. Une ligne qui disparaîtrait silencieusement serait une faute de frappe
qu'on ne peut pas voir. Une rangée qui dit « introuvable » est une faute qu'on corrige.

| ce qui est dit | ce qu'il faut faire |
|---|---|
| `morceau introuvable` | la référence ne désigne aucun morceau — corriger la ligne |
| `variante « x » introuvable` | le morceau est là, cette version-là n'y est pas |
| `ce morceau n'a pas de master` | dossier catalogué sans audio — le scan l'autorise |
| `introuvable` (sur la rangée) | le sidecar déclare un fichier que le dossier n'a pas |

## Trois boutons, parce que ce sont trois gestes

**« Chercher un morceau »** ouvre un champ au-dessus de la liste — au-dessus et non par-dessus :
ce qu'on remplit reste visible, et le voir s'allonger est la seule confirmation qu'il y ait. La
recherche cherche dans le titre, l'artiste et le chemin (donc l'album), et **chaque mot doit
tomber quelque part, pas au même endroit** : « nirvana lithium » trouve un morceau dont l'un est
l'artiste et l'autre le titre. Entrée prend le premier résultat, Échap ferme. Le champ **reste
ouvert** après un clic : monter une setlist, c'est ajouter huit morceaux à la suite.

Une rangée ajoute le **master** ; les pastilles à côté ajoutent une **variante** — sans elles,
mettre `instrumental` dans une setlist voudrait dire aller taper le mapping à la main, alors que
le format existe précisément pour le porter.

**« Ajouter un morceau »** prend un fichier du disque. pl8 n'avait que la recherche, parce que
son propre onglet Morceaux était à un clic ; d'ici la médiathèque est une autre application, et
une setlist qu'on ne peut pas finir sans en sortir est une setlist qu'on quitte.

### L'ordre est la fonctionnalité

Le fichier part **d'abord** à la médiathèque, et la ligne est écrite **ensuite, depuis le chemin
qu'elle répond**. Jamais depuis les tags envoyés : le dossier est déduit là-bas (`songFolder`), et
une seconde déduction ici serait une seconde orthographe d'un même morceau — fausse dès le
premier tag accentué.

Les tags sont **devinés du nom de fichier** et non demandés. L'upload de pl8 a un dialogue à
trois champs, et il a raison : c'est l'écran où l'on *range* une bibliothèque. Ici la question
posée est « mets ça dans mon set », et s'arrêter pour remplir un formulaire au milieu est
l'interruption. Une devinette fausse se corrige dans pl8, sur le morceau.

Le catalogue ayant bougé sous nos pieds, le panneau le redemande tout de suite (`onFiled`) — sans
quoi la ligne qu'il vient d'écrire resterait « morceau introuvable » jusqu'au prochain poll.

Un 409 (« ce morceau y est déjà ») est **rapporté et pas rattrapé** : la moitié utile marcherait,
sauf qu'on ne sait pas OÙ sans la réponse, et deviner le dossier ici est exactement la seconde
orthographe que le paragraphe au-dessus refuse.

### « Séparer les stems » — préparer toute la set list

Le troisième bouton, et le seul qui coûte des heures. Chaque morceau est découpé en batterie /
basse / reste / voix, pour qu'on puisse en **retirer** un sur le pupitre pendant le set
([ui-turntables/docs/stems.md](../../../../packages/ui-turntables/docs/stems.md)).

C'est ici et pas sur le pupitre parce que c'est une question de **set list** et pas de disque : le
pupitre rattrape le morceau qu'on vient de poser, cet écran-ci prépare les douze qu'on va poser.

Le bouton ouvre une barre au-dessus de la liste — au même endroit que la recherche, et pour la
même raison : ce sur quoi elle travaille reste visible en dessous.

- **La chaîne n'est pas demandée ici.** Elle est AFFICHÉE — la barre montre celle qui va tourner et
  rien de plus. Quel module sépare et quel modèle il veut est une réponse unique pour la machine :
  elle se donne une fois dans les réglages, sous I/O, et vit dans `~/.studio/preferences.yaml`
  (`system stems`). Un sélecteur ici posait la même question à la même personne à chaque set list,
  et trois écrans qui la posent, ce sont trois endroits où se tromper. La préférence est relue à
  chaque ouverture de la barre, parce que les réglages sont à un clic.
- **Un morceau à la fois.** Deux séparations en parallèle sur une machine, ce sont deux heures
  d'arithmétique qui se disputent les mêmes cœurs et ne finissent pas plus tôt — la règle que
  `runColdPasses` énonce déjà pour la commande.
- **La barre compte deux choses.** Les morceaux finis PLUS l'avancement de celui en cours : une
  barre qui ne compterait que les morceaux resterait immobile quatre minutes à chaque fois, et
  une qui n'afficherait que le pourcentage du job reviendrait douze fois à zéro.
- **Relancer ne coûte rien.** Un morceau déjà séparé est sauté — la route interroge le DOSSIER,
  pas un drapeau — et l'identifiant du job hache le TRAVAIL, donc une passe interrompue rejoint le
  calcul en vol au lieu d'en commencer un second.
- **Fermer le panneau arrête la boucle, pas le calcul.** Une séparation est un job sur la machine
  et va au bout ; ce que le bouton Arrêter interrompt, c'est l'enchaînement des morceaux suivants.

Deux natures d'échec, distinguées par le statut HTTP et traitées différemment :

| ce qui échoue | statut | ce que fait la boucle |
|---|---|---|
| le morceau — cette machine ne l'a pas tiré | 404 | une ligne rouge, et on passe au suivant |
| la course — aucune chaîne réglée, la chaîne ne sépare pas, pas de modèle, pas de projet ouvert | 400 / 409 | tout s'arrête |

Le second est la même réponse pour les douze lignes : continuer serait douze refus identiques et
aucun travail fait. Le bouton **Lancer** est d'ailleurs éteint tant qu'aucune chaîne n'est réglée,
avec la phrase qui dit où aller et un raccourci vers les réglages — trouver ça au premier morceau
serait le trouver trop tard.

**Ce bouton ne dispatche pas `playlist stems`**, et c'est la même exception que « Ajouter un
morceau » avec une raison à elle. Le verbe existe et fait le même travail — c'est lui qu'on
utilise depuis la palette ou le CLI. Mais une commande rend ses lignes **quand elle a fini**, et
finir, pour trente morceaux, c'est une heure d'écran vide. Le bouton fait donc un
`POST /pl8/api/stems` par ligne et sonde le job entre les deux, ce qui est la seule forme qui ait
une barre. Sur **pl8** : c'est lui qui détient les masters, donc c'est lui qui mène la découpe et
qui garde les stems, en empruntant le modèle du moteur (`apps/pl8/docs/stems.md`). Ce que la
règle exige reste vrai : l'ACTE est atteignable depuis la barre de commandes.

## Le transport est à nous, et il est minuscule

Un `<audio>`, une ligne à la fois, sur une URL de même origine.

pl8 pilotait un `PlaybackProvider` partagé — un mini-lecteur qui survit à l'écran, avec une
destination navigateur/moteur derrière. Rien de tout ça n'a suivi, délibérément : cette
machinerie existe parce que pl8 est une application d'**écoute** dont la barre du bas vous suit
de section en section, alors que ce shell-ci est un éditeur qui a déjà un transport à lui,
pilotant le moteur sur un projet. Deux choses qui revendiquent le mot « en lecture » sur un même
écran, ce sont deux transports. Ce dont une setlist a besoin pendant qu'on la monte, c'est
d'entendre la ligne qu'on vient d'ajouter.

Une ligne injouable est **sautée**, pas bloquante : une playlist qui s'arrêterait à sa troisième
ligne à cause d'une faute de frappe serait une playlist qu'on ne peut pas écouter pendant qu'on
la corrige. La rangée dit toujours ce qui ne va pas ; elle n'arrête plus la soirée.

## Ce qu'une playlist sert, une fois écrite

Elle n'est pas seulement une liste qu'on relit : c'est le **paramètre d'une surface**. Une
surface `turntables` — le pupitre DJ — porte une ligne `playlist:`, et c'est cette playlist-là
que son navigateur de morceaux liste :

```yaml
# <projet>.st0/surfaces/desk.yaml
type: turntables
layout: split
playlist: ete-2026
```

Deux conséquences, et la seconde est celle qui compte :

- le pupitre fouille dans les douze morceaux du soir plutôt que dans les 279 du volume ;
- la machine qui joue **tire ces morceaux sur son disque à l'avance** (`mediatekPull`), parce
  que le moteur ouvre des chemins de fichiers et que la salle n'a pas de wifi.

C'est aussi ce qui donne à cet écran-ci son enjeu : la playlist qu'on remplit ici est celle
qu'on jouera. Voir `packages/ui-turntables/docs/setList.md`.

Une ligne qui nomme une **variante** vaut sur les deux écrans : le pupitre charge le fichier que
la ligne demande, pas le master. C'est la même résolution des deux côtés — littéralement la même
fonction, `@studio/mediatek/playlistItems` — parce que « le chemin d'abord, le nom ensuite » est
une règle, et que deux copies auraient divergé au premier cas appris d'un seul côté.

## Ce qui est parti de pl8 avec l'écran

La chasse (« Trouver des morceaux ») pouvait **viser une playlist** : le morceau trouvé y était
ajouté dès qu'il était rangé. Ce n'est plus possible et ne le redeviendra pas de ce côté-là — les
playlists sont sur le disque du service de fichiers, et donner à pl8 les moyens d'y écrire ferait
du service qui tient la session et l'unique clé de déploiement un écrivain dans le dépôt de
chacun, ce que `apps/pl8/docs/projects.md` refuse explicitement. La chasse range donc le morceau
dans la médiathèque, et l'ajouter à une setlist est un clic ici, sur ce même catalogue.
