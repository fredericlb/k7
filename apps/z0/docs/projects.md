# Les projets de z0

Une session de blindtest est aujourd'hui un sous-arbre de lignes Grist. Cette page dit
comment elle se range désormais comme l8 range un morceau : **un dossier de YAML**,
versionné, ouvert sur un projet. La forme est déduite des trois sessions réelles du document
Grist `wBLP4e1P71vAW3T5zzfQtH` — les chiffres cités viennent de là, pas d'une supposition —
et les trois sessions ont été migrées (voir « Ce qui a été migré », en bas).

## Ce que disent les sessions existantes

| table | lignes | ce qu'on en apprend |
|---|---|---|
| `Sessions` | 3 | `name`, `guestPassword`, `urlToken`, et l'ordre en `RefList` |
| `OrderEntries` | 49 | 45 catégories jouées, 4 pauses |
| `Categories` | 38 | **chacune n'appartient qu'à une seule session** (38/38) |
| `Songs` | 279 | 9 seulement sont partagés entre deux catégories |
| `Tracks` | 307 | 12 partagés entre deux morceaux |
| pièces jointes | 305 | **1,35 Go de MP3**, nommés `Artiste - Titre.mp3` |

Cinq observations décident de la forme :

1. **Rien n'est vraiment partagé entre sessions.** Le schéma Grist est un graphe de
   références parce qu'une table est un graphe ; les données, elles, sont un arbre. Une
   session peut donc être un dossier autonome sans rien perdre.
2. **L'ordre est une suite de tranches.** Session 1 : `Stems [0:5]`, puis plus tard
   `[5:10]`, puis `[10:]` — un bac de 15 morceaux joué en trois passages. La catégorie
   apparaît trois fois dans l'ordre, avec une fenêtre différente. C'est une vraie
   intention (« ce bac tient ensemble »), pas un artefact : il faut la garder.
3. **`trackType` est une variante, et la médiathèque sait déjà les modéliser.** Une
   catégorie `Stems` joue la piste `type: stems` et révèle la piste `type: ""` du même
   morceau — deux lignes `Tracks` avec le *même* artiste et le *même* titre. C'est
   exactement `variants:` dans `song.yaml`
   (voir [packages/mediatek/docs/variants.md](../../../packages/mediatek/docs/variants.md),
   dont l'exemple de chaîne s'appelle déjà `blindtest/vocal-strip`). Les 9 morceaux
   partagés entre deux catégories sont d'ailleurs le même cas : « Take on me » sert de
   `8bit` dans une catégorie et de `handmade` dans une autre.
4. **`notice` est du boilerplate.** 24 catégories sur 38 portent exactement la même phrase
   (`À TROUVER: ARTISTE ET TITRE`) — elle veut un défaut au niveau de la session.
   `illustration` est vide partout : optionnelle, jamais écrite.
5. **1,35 Go n'entrent pas dans un dépôt git.** L'audio va dans la médiathèque, le YAML
   ne porte que l'adresse.

## Le partage : ce que le YAML garde, ce que la base garde

La ligne est nette et elle vaut la peine d'être écrite :

> le YAML tient **ce qu'un auteur écrit**, la base tient **ce qu'une partie produit**.

Restent donc en base — Grist ou SQLite, ce débat est ailleurs — `Games`, `GamePlayers`,
`Scores`, `SoloProgress`, `Buzzers`, `Guests`, `Counters`, `Playlists`, `PlaylistScores`.
Aucune de ces tables ne décrit une session ; toutes décrivent une partie jouée.

## La forme

Comme un `.l8` : un dossier, un fichier d'en-tête, un fichier par entité, et **le nom du
fichier est l'identifiant**.

```
blindtest-2304.z0/
  session.yaml
  categories/
    la-chauffe.yaml
    stems.yaml
    moderne.yaml
    …
```

Les clés sont en **anglais** et la prose en français : c'est la règle que la médiathèque
énonce déjà pour `song.yaml` (« le stockage et le code sont en anglais, la prose et
l'interface sont en français », [songs.md](../../../packages/mediatek/docs/songs.md)).

### `session.yaml`

```yaml
name: Blindtest 2304
token: blue                              # l'URL publique (ex-urlToken)
password: "…"                            # ex-guestPassword, absent = pas de mot de passe
notice: "À TROUVER : ARTISTE ET TITRE"   # le défaut de toutes les catégories

order:
  - cat: la-chauffe
  - cat: stems
    songs: 1-5
  - cat: moderne
  - cat: extraits
    songs: 1-5
  - pause:
  - cat: citoyens-du-monde
  - cat: stems
    songs: 6-10
  - cat: fusion
  - cat: stems
    songs: 11-
```

`cat:` nomme un fichier de `categories/`, pas le nom affiché : deux entrées qui se suivent
sur `stems` sont bien la même catégorie découpée. `songs:` est une plage **1-basée et
inclusive**, bornes ouvertes acceptées (`11-`) ; absente, la catégorie est jouée en entier.
Elle se lit à l'endroit où on la corrige, ce que `[5:10]` ne fait pas. La conversion depuis
Grist est mécanique : `start = n-1`, `end = m`.

Une pause est `- pause:` — la valeur, si elle est là, est le message affiché à l'écran
(`- pause: Entracte`).

**Le mot de passe invité est en clair**, et c'est un choix : il voyage avec la session, une
session sans lui n'ouvre à personne, et un fichier local à côté serait celui que personne ne
pense à copier. C'est un mot de passe de soirée, pas un secret — mais il est en clair dans un
dépôt git, ce qui veut dire que le changer c'est un commit.

### `categories/<slug>.yaml`

Le cas courant, une piste par morceau :

```yaml
name: La Chauffe
songs:
  - song: songs/Michael Sembello/Flashdance/Maniac
    start: 6.43
    end: 246.29
    status: valid
  - song: songs/Daft Punk/Discovery/Harder Better Faster Stronger
```

`song:` est l'identifiant médiathèque, c'est-à-dire le chemin relatif à sa racine — le seul
identifiant stable qu'elle offre (`MediatekEntry.id`). L'artiste et le titre viennent du
sidecar : ils ne sont plus recopiés ici.

Une catégorie à variante — c'est là que le gain est le plus visible :

```yaml
name: Stems
variant: stems          # ce qui est JOUÉ ; le master est ce qui est RÉVÉLÉ
songs:
  - song: songs/Zaz/Album inconnu/Je veux
    start: 24.78
    end: 212.6
    status: valid
  - song: songs/Britney Spears/Album inconnu/Toxic
    start: 14.57
    end: 196.79
```

Deux lignes `Tracks` par morceau disparaissent au profit d'un mot : la piste de révélation
*est* le master de la même adresse. Même chose pour `8bit` et `handmade`.

Le mot `variant:` porte **deux axes sur une seule ligne**, et c'est voulu : une version
enregistrée (`stems`, `8bit`, `handmade` — un fichier à côté du master) ou un traitement
(`deformees` — une chaîne que la médiathèque tient). Les deux répondent à la même question,
« quelle version de ce morceau joue-t-on », et le sidecar sait laquelle des deux il a. Une
catégorie ne peut pas demander les deux à la fois, et la migration l'a vérifié.

**La règle de résolution est « la version demandée si elle existe, sinon le master ».** Elle
n'est pas un repli poli, c'est ce que fait déjà le chargeur Grist : un morceau dont la
catégorie réclame `8bit` alors qu'aucune piste de ce type n'existe se joue tel quel, sans
audio de révélation distinct. Treize entrées sont dans ce cas, toutes des reprises dont
personne n'a jamais rangé l'original à côté — leur `original.mp3` **est** la reprise.

Une catégorie à plusieurs pistes par morceau — `fusion` (deux extraits, un jeu de mots) et
`multi` (cinq extraits joués ensemble) :

```yaml
name: Fusion
mode: fusion
liveOnly: true
notice: "À TROUVER : JEU DE MOTS ENTRE ARTISTE OU TITRE ET SÉRIE"
songs:
  - label: The Senti-Nelly Furtado
    status: valid
    tracks:
      - song: songs/Nelly Furtado/Album inconnu/I'm like a bird
        start: 54.68
      - song: songs/Artiste inconnu/Album inconnu/The Sentinel
        start: 8.14
```

Le générique de série n'a pas d'artiste dans Grist, et personne ne lui en a inventé un : il
est filé sous `Artiste inconnu`, ce qui est vrai et se corrige d'un renommage. Onze pistes
sont dans ce cas, toutes des génériques des catégories `fusion`.

```yaml
name: Assourdissant
mode: multi
songs:
  - tracks:
      - song: songs/REM/Album inconnu/Losing my religion
        start: 17.1
      - song: songs/The Supermen Lovers/Album inconnu/Starlight
      - song: songs/Daft Punk/Album inconnu/Around the world
        start: 24.9
  - effects: { overdrive: 5 }
    tracks:
      - song: songs/Stardust/Album inconnu/Music sounds better with you
      - song: songs/Alizee/Album inconnu/Lolita
        start: 81.45
```

`song:` et `tracks:` sont exclusifs : un morceau à une piste s'écrit à plat, un morceau à
plusieurs pistes ouvre une liste. C'est la seule règle de forme à retenir.

### Le vocabulaire complet

**Session** — `name`, `token`, `password`, `notice`, `order`.

**Entrée d'ordre** — `cat` + `songs` (plage), ou `pause` (+ message).

**Catégorie** — `name` (affiché), `mode`, `variant`, `notice`, `illustration`, `liveOnly`,
`songs`.

`mode` vaut `one`, `free`, `slow`, `fusion`, `reversed`, `mystery`, `multi`, ou est absent
pour le mode normal — ce sont les valeurs que les joueurs lisent déjà, inchangées.

**Morceau** — `song` **ou** `tracks`, plus `label`, `answer`, `status`
(`valid` | `to_replace` | absent), `liveOnly`, `speed`.

Les neuf colonnes `fx_*` de Grist ont disparu, et pas au profit d'un champ : **les
traitements sont partis avec l'audio**, dans la médiathèque, sous forme de chaînes que le
sidecar de chaque morceau nomme comme variantes. La catégorie dit le nom une fois
(`variant: deformees`) et chaque morceau le résout vers sa propre chaîne, avec ses propres
valeurs. Reste ici `speed`, qui n'est pas un traitement mais une vitesse de lecture : aucune
chaîne n'a d'horloge. Tout est détaillé dans [effects.md](effects.md).

**Piste** — `song` (adresse médiathèque) **ou** `file` (chemin relatif au dossier du
projet) **ou** `youtube`, plus `start`, `end`, et `artist` / `title` en dérogation quand
l'adresse ne les donne pas.

`file:` est la porte de sortie : tout ce que la médiathèque n'a pas — un générique de
série, un extrait bricolé — peut rester un fichier dans le projet, avec son artiste et son
titre écrits sur place. Sans elle la migration bute sur les 11 pistes qui n'ont même pas
d'artiste — les génériques de série des catégories `fusion`.

## Ce qui disparaît

- **`OrderEntries`** : 49 lignes deviennent une liste de dix lignes dans `session.yaml`.
- **Les pistes de révélation** : 23 lignes `Tracks` qui ne disaient que « le même morceau,
  sans traitement », en face des 39 pistes à variante.
- **`artist` / `title` recopiés** sur chaque piste.
- **Les neuf colonnes `fx_*`.**
- **Le va-et-vient des identifiants** : l'éditeur relit et réécrit chaque `id` Grist pour
  que le réconciliateur distingue une ligne existante d'une nouvelle
  (`editor/handlers.ts`). Le nom de fichier étant l'identifiant, tout cela tombe.

## Ce qui a été migré

Les trois sessions Grist ont été écrites sous cette forme, et leurs 1,35 Go d'audio versés
dans la médiathèque :

| | |
|---|---|
| `session-2304.z0` | 15 catégories, 24 manches, mot de passe invité `blue` |
| `session-beta-2.z0` | 19 catégories, 20 manches |
| `offboarding-bedrock.z0` | 4 catégories, 4 manches |
| médiathèque | **279 morceaux** filés, **26 variantes** (`stems`, `8bit`, `handmade`) |

L'import est passé par `addSong` / `addSongVariant` de `@studio/mediatek` — le code que pl8
appelle lui-même — et non par un écrivain maison : la forme du dossier et le sidecar sont
donc exactement ceux que la médiathèque écrit. `songs/A-Ha/Album inconnu/Take on me/` tient
maintenant `original.mp3`, `8bit.mp3` et `handmade.mp3` sous un seul `song.yaml`, ce qui est
la démonstration que le modèle tient.

Le contrôle qui compte : les 38 fichiers de catégorie se relisent, chaque `cat:` de chaque
ordre trouve son fichier, chaque plage `songs:` correspond à la tranche Grist, et **chacune
des 304 adresses citées existe sur le volume avec un master**.

### Les trois verrues, dans l'ordre d'urgence

1. **`Album inconnu` partout.** Les MP3 sont des rips ré-encodés qui ne portent aucun tag
   ID3 — pas d'album à en tirer, et Grist n'en a jamais eu. La médiathèque range donc tout
   sous son propre libellé de trou, qui est fait pour ça et se renomme. Deux morceaux
   portent `Album inconnu (2)` parce que deux enregistrements différents revendiquaient
   artiste et titre identiques : « Larusso — Tu m'oublieras » (un rip et un clip) et
   « OST — Star Trek » (le générique et une version à la bouche).
2. **Treize `original.mp3` qui sont des reprises**, décrit plus haut. Poser le vrai original
   à côté et la reprise redevient une variante — c'est une opération par morceau, sans
   toucher au YAML.
3. **`.z0` n'est pas encore un suffixe de projet.** `packages/web-protocol/projects.ts` dit
   `l8` et `m9`, et écrit noir sur blanc que « k7 et z0 ne possèdent pas de projets ». Les
   dossiers sont donc dans le dépôt et invisibles dans la liste de pl8 tant que z0 n'y est
   pas ajouté — un `ProjectApp` de plus, et le routage vers `/z0` qui va avec.

Le chargeur Grist (`backend/src/grist/`) est intact : rien ne lit encore ces YAML.
