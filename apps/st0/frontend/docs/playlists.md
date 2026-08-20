# Les playlists — le seul écran qui tient les deux catalogues

Le format, et pourquoi une playlist vit dans le dépôt plutôt que sur le volume hébergé, sont
dans [`packages/song/docs/playlists.md`](../../../../packages/song/docs/playlists.md). Cette
page-ci est l'écran.

```
cog ▸ Playlists          la liste des .yaml de _playlists/
   └─ une playlist       ┌──────────────────┬────────────────────┐
                         │ le texte YAML    │ les lignes,        │
                         │ (YamlPane)       │ résolues et jouables│
                         └──────────────────┴────────────────────┘
```

## Sous le cog, et pas dans les panes

Les panes de ce shell sont le **morceau ouvert** — l'éditeur, la timeline, le graphe, le
viewport — et ce qu'ils dessinent, c'est ce que le projet DÉCLARE (`docs/shell.md`,
`packages/song/docs/surfaces.md`). Une playlist n'est déclarée par aucun projet et n'appartient
à aucun : elle est à la racine du dépôt et c'est la même quelle que soit la chanson qu'on
travaille. Elle est donc là où sont les autres écrans qui ne parlent pas du projet — sous le
cog, avec les réglages, en overlay au-dessus du shell.

Comme ses voisines, l'entrée du menu **dispatche une ligne de commande** (`ui settings
playlists`) plutôt que d'appeler une fonction à elle : tout ce qui est sur cet écran est
atteignable depuis la palette, et une implémentation unique est ce qui empêche les deux de
diverger (`docs/shell.md`).

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

## Deux boutons, parce que ce sont deux gestes

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
layout: view
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
