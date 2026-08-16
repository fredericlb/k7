# Ce que la médiathèque sait compléter

Les trois écrans de st0 qui montrent du YAML — le constructeur de modules, l'éditeur de chaînes,
l'éditeur de playlists — partagent le même `YamlPane`. Le mécanisme est décrit dans
[packages/ui-editor/docs/completion.md](../../../packages/ui-editor/docs/completion.md) ; ce qui
suit est l'autre moitié, **d'où viennent les noms ici**, parce que la réponse n'est pas celle de
l8 et qu'elle ne pouvait pas l'être.

## Le problème de fond : ce backend n'a pas de disque de moteur

l8 remplit ses `Hints` depuis la machine où tourne son backend : les modules du projet, les
pistes, et le cache de scan (`~/.studio/exts.json`) que le moteur écrit à côté de lui.

La médiathèque est **hébergée**. Son backend sert un volume de fichiers ; il n'a jamais vu de
scan de greffons, et il ne verra jamais celui de la machine devant laquelle vous êtes. `hints()`
rendait donc un objet entièrement vide, et le constructeur de modules ne complétait rien.

Les noms viennent de trois sources différentes, chacune la seule qui puisse répondre :

| ce qu'on écrit | vocabulaire | qui répond |
|---|---|---|
| `extends:` d'un module | `@engine/…` | le **moteur**, par son socket (`engine/baseModules.ts`) |
| `extends:` d'un module | `@st0/…` | le **catalogue**, par `library.baseModules()` |
| une destination d'un `graph.yaml` | les nœuds déclarés | **le fichier lui-même** (`chainsVocabulary.ts`) |
| une ligne de playlist | les morceaux | la **famille songs**, déjà interrogée par l'écran |

### `@engine/…` — demandé à la machine

Les fichiers de la médiathèque disent bien `extends: "@engine/de-rez"`. Ce ref est *dérivé* d'un
greffon scanné, par `slugifyPluginName` puis `engineRef` — exactement ce que fait
`engineCatalogue.ts` côté Node. Les deux orthographes ne peuvent donc pas diverger : le
navigateur applique les mêmes deux fonctions, prises dans `@studio/song/moduleTypes`, la feuille
sans `node:fs` qui existe précisément pour ça.

`listPlugins` lit le cache du moteur et ne lance aucun scan, donc la question est bon marché.
Elle est reposée à chaque (re)connexion et non une fois pour toutes : le catalogue appartient à
la **machine**, un autre moteur en a un autre, et un rescan là-bas le change sous nous.

Les modules io que ce catalogue synthétise aussi — `@engine/IN`, `OUT`, `FILE` — sont
délibérément absents : ils s'utilisent directement et ne sont pas des cibles d'`extends`.

### `@st0/…` — l'autre moitié

Un module de la bibliothèque peut en étendre un autre, et un nœud de chaîne le fait tout le
temps (`extends: "@st0/audio/distortion/bitcrush"`). Le catalogue parle en chemins, les
fichiers en refs ; `moduleRefs.ts` est la conversion, et c'est tout ce qu'il est.

Le mot `@st0` y est **écrit en clair**. Le `MEDIATEK_REF` canonique vit dans
`@studio/song/mediatekRoot`, qui appelle `node:os` pour trouver le dossier — un navigateur ne
peut pas tirer ça pour apprendre un mot. `ChainEditor` déclare `graph.yaml` pour la même
raison : le vocabulaire est le contrat, le résolveur de chemin ne l'est pas.

Les deux listes sont **fusionnées** par le constructeur, pas substituées : elles répondent de
deux moitiés différentes de ce qu'`extends:` peut nommer.

## Les chaînes : le fichier est son propre vocabulaire

Un `graph.yaml` de la médiathèque est un **gabarit**. Ses nœuds sont les fichiers du dossier
`nodes/` à côté, et une destination nomme l'un d'eux ou `@out`.

Le listing d'une chaîne porte le **nombre** de ses nœuds, jamais leurs noms — et il n'y a
pas de route pour lister un dossier. Mais un nœud doit être déclaré sous `modules:` pour exister
dans le graphe : les clés de cette section **sont** la liste. Le vocabulaire est donc lu dans le
tampon, et pas demandé au serveur.

`chainNodes` rend `null` quand le texte ne parse pas, et l'écran garde le dernier jeu lisible —
comme le dessin à droite garde le sien. Une liste qui se viderait à chaque frappe n'offrirait
rien précisément pendant qu'on écrit la ligne qui en a besoin.

`@in` n'est pas proposé : c'est là qu'un parcours **commence**, rien ne l'alimente.

## Les playlists : le fichier que le schéma ne connaît pas

`fileKindFor` rend `null` pour `playlists/x.yaml`, et c'est correct — une playlist appartient à
la médiathèque, pas à un projet l8, et `@studio/song` n'a pas à savoir à quoi ressemble un
listing de morceaux. L'écran fournit donc son propre `YamlVocabulary`, construit sur le listing
qu'il interroge **déjà** pour résoudre ses lignes.

Un morceau est proposé sous sa forme **non ambiguë**, son chemin sous `songs/` — la même que
`songRef` écrit quand on ajoute une ligne depuis la recherche. `findSong` lit aussi le nom nu,
donc le fichier reste éditable à la main dans les deux orthographes.

`variant:` propose **tous** les noms de variantes de la bibliothèque, sans les restreindre au
`song:` de la ligne du dessus. Un vocabulaire répond d'une **position**, pas d'un document : il
n'a jamais vu cette ligne. L'union reste la bonne liste — ces noms se répètent par convention
(« live », « acoustic ») — et le panneau de droite signale un mauvais nom dès qu'il est tapé.
La restreindre voudrait dire reparser le tampon à chaque frappe pour économiser un défilement.

## Ce qui n'est pas couvert

**Le sidecar d'un morceau** (`SongEditor`) : ses champs ne sont pas un `FileKind` de projet non
plus, et personne n'a demandé. Ce serait un quatrième vocabulaire, sur le même modèle que celui
des playlists.

**Les fichiers de nœud d'une chaîne** : st0 ne les ouvre pas dans un éditeur, seulement le
`graph.yaml`. Leur `extends:` est pourtant exactement le champ dont il est question ici. Et le
jour où l'un s'ouvrira, il ne complétera pas tout seul : `fileKindFor` reconnaît un module à son
dossier `modules/`, et `chains/…/nodes/eq.yaml` n'en a pas. Il faudra le lui apprendre —
une ligne, mais une ligne dans `@studio/song`, pas ici.
