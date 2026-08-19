# Ce que la médiathèque sait compléter

L'écran de pl8 qui montre du YAML — le sidecar d'un morceau — utilise le `YamlPane`. Ils étaient
quatre : le constructeur de modules et l'éditeur de chaînes sont partis avec leurs familles, et
l'éditeur de playlists avec le dossier `_playlists/`, tous vers l8. Le mécanisme est décrit dans
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
peut pas tirer ça pour apprendre un mot. Le vocabulaire des playlists, en l8, déclare son fichier
pour la même raison : le vocabulaire est le contrat, le résolveur de chemin ne l'est pas.

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

## Les playlists : parties, et le motif avec elles

`fileKindFor` rendait `null` pour `playlists/x.yaml`, et c'était correct — une playlist n'est pas
un fichier de projet l8, et `@studio/song` n'a pas à savoir à quoi ressemble un listing de
morceaux. L'écran fournissait donc son propre `YamlVocabulary`, construit sur le listing qu'il
interrogeait **déjà** pour résoudre ses lignes.

Cet écran est en l8 maintenant, et le motif est parti avec lui intact
(`apps/l8/frontend/docs/playlists.md`) : c'est **toujours** ce catalogue-ci qui répond, par
`/api/mediatek/list?family=songs`, seulement à travers l'origine plutôt que depuis la même app.
Ce qui vaut la peine d'être retenu ici est la forme — un écran qui tient déjà une liste pour
autre chose est le mieux placé pour en faire un vocabulaire, et n'a besoin de rien demander à
personne.

## Ce qui n'est pas couvert

**Le sidecar d'un morceau** (`SongEditor`) : ses champs ne sont pas un `FileKind` de projet non
plus, et personne n'a demandé. Ce serait un vocabulaire de plus, sur le modèle décrit au-dessus —
et c'est le seul écran YAML qui reste ici, donc le seul candidat.

**Les fichiers de nœud d'une chaîne** : pl8 ne les ouvre pas dans un éditeur, seulement le
`graph.yaml`. Leur `extends:` est pourtant exactement le champ dont il est question ici. Et le
jour où l'un s'ouvrira, il ne complétera pas tout seul : `fileKindFor` reconnaît un module à son
dossier `modules/`, et `chains/…/nodes/eq.yaml` n'en a pas. Il faudra le lui apprendre —
une ligne, mais une ligne dans `@studio/song`, pas ici.
