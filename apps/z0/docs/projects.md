# Les projets de z0 — proposition

Une session de blindtest est aujourd'hui un sous-arbre de lignes Grist. Cette page propose
de la ranger comme l8 range un morceau : **un dossier de YAML**, versionné, ouvert sur un
projet. Elle est écrite à partir des trois sessions réelles du document Grist
`wBLP4e1P71vAW3T5zzfQtH` — les chiffres cités viennent de là, pas d'une supposition.

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
  - song: songs/Zaz/Paris/Je veux
    start: 24.78
    end: 212.6
    status: valid
  - song: songs/Britney Spears/In the Zone/Toxic
    start: 14.57
    end: 196.79
```

Deux lignes `Tracks` par morceau disparaissent au profit d'un mot : la piste de révélation
*est* le master de la même adresse. Même chose pour `8bit` et `handmade`.

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
      - song: songs/Nelly Furtado/Whoa Nelly!/I'm like a bird
        start: 54.68
      - song: songs/Séries/Génériques/The Sentinel
        start: 8.14
```

```yaml
name: Assourdissant
mode: multi
songs:
  - tracks:
      - { song: songs/REM/Out of Time/Losing my religion, start: 17.1 }
      - { song: songs/The Supermen Lovers/The Player/Starlight }
      - { song: songs/Daft Punk/Homework/Around the world, start: 24.9 }
  - effects: { overdrive: 5 }
    tracks:
      - { song: songs/Stardust/Music sounds better with you/Music sounds better with you }
      - { song: songs/Alizée/Gourmandises/Lolita, start: 81.45 }
```

`song:` et `tracks:` sont exclusifs : un morceau à une piste s'écrit à plat, un morceau à
plusieurs pistes ouvre une liste. C'est la seule règle de forme à retenir.

### Le vocabulaire complet

**Session** — `name`, `token`, `password`, `notice`, `order`.

**Entrée d'ordre** — `cat` + `songs` (plage), ou `pause` (+ message).

**Catégorie** — `name` (affiché), `mode`, `variant` (ex-`trackType`), `notice`,
`illustration`, `liveOnly`, `songs`.

`mode` vaut `one`, `free`, `slow`, `fusion`, `reversed`, `mystery`, `multi`, ou est absent
pour le mode normal — ce sont les valeurs que les joueurs lisent déjà, inchangées.

**Morceau** — `song` **ou** `tracks`, plus `label`, `answer`, `status`
(`valid` | `to_replace` | absent), `liveOnly`, `effects`.

`effects` remplace les neuf colonnes `fx_*` par une table dont seules les entrées non
nulles sont écrites : `{ speed: 5, overdrive: 5 }`. Elles ne servent qu'à 31 morceaux sur
279.

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

## Les décisions restées ouvertes

1. **Le mot de passe invité dans un fichier versionné.** Il voyage avec la session, ce qui
   est le comportement voulu, mais il finit en clair dans le dépôt. Une seule session sur
   trois en a un. Proposition : le laisser dans `session.yaml` et l'assumer — c'est un mot
   de passe de soirée, pas un secret — plutôt qu'inventer un fichier local que personne ne
   pense à copier.
2. **L'import des 1,35 Go.** Les MP3 sont nommés `Artiste - Titre.mp3` et portent leurs
   tags : `ingest` de la médiathèque sait les classer. Les variantes (`stems`, `8bit`,
   `handmade`) doivent en revanche être rangées à la main dans le `song.yaml` du morceau
   qu'elles doublent — 39 fichiers.
3. **Où vivent les dossiers `.z0`.** Le chemin l8 (dépôt git, résolution par
   `project-shell`, ouverture depuis st0) s'applique tel quel ; reste à dire si z0 ouvre
   *une* session à la fois comme l8, ou si le présentateur choisit dans une liste comme
   aujourd'hui.

Rien de tout cela n'est écrit dans le code : cette page est une proposition, et le
chargeur Grist (`backend/src/grist/`) est intact.
