# Trouver des morceaux — de ce qu'on tape à un fichier rangé

« Trouver des morceaux », à côté d'« Ajouter » dans la section Morceaux, ouvre un champ de
recherche et, dessous, l'historique de ce qu'on a déjà demandé. On tape « nirvana lithium »,
et la chaîne complète se déroule toute seule :

```
  ce qu'on tape
        │
        ▼
  MusicBrainz  ──►  artiste / titre / album      (nommer AVANT de chercher)
        │
        ▼
  slskd (autre machine, REST)  ──►  « album titre », puis « titre » — jamais l'artiste
        │
        ▼
  filtrage : même artiste, même titre, format que la médiathèque sait ranger
  tri : qualité, puis qui enverra vraiment
        │
        ▼
  file d'attente chez le meilleur pair — 60 s pour commencer, sinon le suivant
        │
        ▼
  SFTP : st0 va chercher les octets sur la machine slskd
        │
        ▼
  addSong  ──►  songs/<Artiste>/<Album>/<Titre>/original.<ext>
```

## Nommer avant de chercher

MusicBrainz passe **en premier**, et ce n'est pas de la décoration. Le nom du dossier est
déduit des tags (`songFolder`), donc les tags ne sont pas une étiquette : ce sont le chemin.
Chercher d'abord sur Soulseek et lire les tags du fichier reçu reviendrait à laisser un inconnu
nommer un dossier de la médiathèque — et la moitié des fichiers du réseau sont tagués
`Track 05` ou pas tagués du tout.

C'est aussi ce qui donne au filtrage un artiste et un titre **canoniques** à comparer, au lieu
de la chaîne qu'on a tapée.

### Deux choses mesurées, contre-intuitives toutes les deux

**Le `score` de MusicBrainz est ici anti-corrélé.** Pour « nirvana lithium », la vraie prise de
Nirvana revient avec un score de **38**, tandis que des morceaux simplement *intitulés*
`Lithium(nirvana)` scorent **100**. Ce score répond à « ce document colle-t-il à la requête
Lucene », qui n'est pas la question posée. Il n'est donc **pas** utilisé comme filtre : n'importe
quel seuil aurait jeté la bonne réponse. C'est vérifié, pas supposé — ne pas le « réparer ».

**Une recherche plein texte ne suffit pas.** Pour « miles davis so what », les cent premières
réponses ne contiennent **aucune** prise de Miles Davis de So What : le classement est emporté
par des entrées dont le titre contient les quatre mots. On ne sait pas quels mots nomment
l'artiste, alors `buildQuery` demande **toutes les coupures à la fois**, en une seule requête :

```
(artist:"miles" AND recording:"davis so what") OR
(artist:"miles davis" AND recording:"so what") OR
(artist:"miles davis so" AND recording:"what")
```

Lucene score la clause qui colle. Effet de bord utile : la requête est assemblée à partir de
mots passés par `normalise`, donc seuls `a-z`, `0-9` et des espaces atteignent Lucene — un
guillemet tapé dans le champ est un séparateur de mots, jamais un opérateur.

Si aucune coupure ne ramène rien, on retombe sur la recherche plein texte. Une seconde de plus
coûte moins qu'une recherche morte.

### Le piège du bootleg

Une chanson connue revient sous forme de **cent prises différentes** — une par concert — chacune
ne portant que la sortie sur laquelle elle est parue. Prise une par une, la réponse est le
premier live venu, et *Lithium* se rangerait sous « 1991-10-21: Live in Austin, Texas ». Un
dossier que personne ne retrouve.

`chooseTags` met donc en commun les sorties de **toutes** les prises à égalité, et `pickAlbum`
choisit sur trois critères, dans cet ordre :

| critère | ce qu'il écarte |
|---|---|
| le **type** (`releaseScore`) | live, bootleg, compilation, remix — pénalisés, pas exclus |
| la **récurrence** | une compilation de chutes est typée *exactement* comme un album studio ; ce qui les sépare, c'est que le vrai disque revient sur toutes les prises et la curiosité une seule fois |
| la **date**, en dernier | elle ne peut pas être première : les lignes *Nevermind* que MusicBrainz renvoie pour Lithium sont toutes des rééditions 2021, donc « la plus ancienne » donnerait la compilation de 1996 |

Pénaliser plutôt qu'exclure, parce qu'un morceau dont personne n'a catalogué l'album studio
mérite mieux qu'« Album inconnu » : le live sur lequel il est vraiment paru.

La sortie **retenue** dans le groupe gagnant est la plus ancienne, pour que la date affichée soit
celle du disque et non d'une réédition.

## Ce qu'on demande à slskd : l'album et le titre, jamais l'artiste

Deux tentatives, dans cet ordre (`searchTexts`) :

| # | la requête | pourquoi |
|---|---|---|
| 1 | `Nevermind Lithium` | l'album est la moitié précise de la paire |
| 2 | `Lithium` | ce qui reste quand personne ne range par album |

**L'artiste n'y est jamais.** Une recherche Soulseek porte sur le chemin partagé en entier, et
l'artiste y est presque toujours le dossier *au-dessus* de l'album : il ne restreint rien que
l'album n'ait déjà restreint, et chaque terme ajouté est une façon de plus pour une copie
légitime d'être manquée.

Il n'a pas disparu pour autant — il est le **filtre** sur ce qui revient. C'est toute la forme
de cette étape : **demander largement, juger strictement.** Un terme dans la requête ne peut que
perdre des résultats ; un terme dans le filtre s'applique à ce que les pairs ont réellement
envoyé, et peut donc être exigeant sans rien coûter.

Conséquence à connaître : quelqu'un qui partage `…/Nevermind/05 Lithium.flac` sans dossier
d'artiste au-dessus sera trouvé par la recherche puis **écarté par le filtre**. C'est le prix
assumé d'un filtre sur l'artiste ; le cas est minoritaire, les chemins Soulseek étant très
majoritairement `Artiste/Album/Piste`.

Sans album, une seule tentative : relancer le titre seul deux fois de suite ne ferait que
dépenser un second tour de la patience de quelqu'un.

Et le budget des dix pairs est **global aux deux recherches**, pas dix par tentative — sinon le
repli doublerait discrètement le pire cas à vingt minutes d'attente, et les dix de la demande ne
voudraient plus rien dire. Un pair déjà essayé est sauté plutôt que remis en file : les deux
recherches se recouvrent beaucoup, et redonner une minute à la même file immobile est
exactement ce que le changement de pair existe pour éviter.

## Choisir un pair

`rank.ts` est pur et testé, parce que c'est lui qui décide de ce qui entre dans la bibliothèque.

**Filtrer.** Même artiste (cherché dans tout le chemin, où il est presque toujours un dossier
parent) et même titre (cherché dans le **nom de fichier** seulement — le dossier d'album nomme
onze autres morceaux). Par mots entiers et non par sous-chaîne : `includes("air")` donnerait à
une recherche sur *Air* tous les fichiers d'*Airbourne*. Une recherche qui ne trouve rien le
dit ; une qui range le mauvais groupe, non.

Et surtout : le format doit passer `isAudio`, **la porte de la médiathèque elle-même**. Le `.ape`
est partout sur Soulseek et `masterName` le refuse — le télécharger, ce serait une heure de
transfert pour un fichier impossible à ranger. Une seule règle, aux deux bouts.

**Trier.** La qualité d'abord, comme demandé : flac, puis wav/aiff, puis 320, 256, 192, en
dessous. Quand le pair ne dit pas son débit — le champ est optionnel dans le protocole et
beaucoup de clients l'omettent — il est **mesuré** sur les octets, taille sur durée. Un fichier
dont on ne peut rien dire passe *sous* tous les débits connus, sinon il gagnerait en étant muet.

**La disponibilité départage à qualité égale**, et ce n'est pas un raffinement : un
téléchargement est abandonné après soixante secondes, donc un pair avec trois cents personnes
dans sa file ne vaut rien, si bonne que soit sa copie. Deux fichiers du même palier sont le même
fichier ; il ne reste à choisir que qui l'enverra.

**Une entrée par pair.** C'est sur cette liste qu'opère le changement d'utilisateur : un pair
partageant une discographie remplirait sinon les dix premières places à lui seul, et les dix
changements retomberaient sur la même file immobile.

## Soixante secondes, dix pairs

Lecture exacte : le compteur monte d'un cran chaque fois qu'un pair est abandonné, et atteindre
dix arrête la recherche — **dix pairs essayés**, le dixième abandon étant l'échec.

Un pair qui **refuse** (erreur, rejet, annulation) n'attend pas la minute : il a déjà répondu.
De même, un transfert qui *disparaît* de la liste de slskd après y avoir figuré est un abandon
de sa part, pas une file d'attente — le traiter comme « toujours en attente » brûlerait la
minute pour une réponse déjà donnée.

Une fois le transfert **commencé**, il a trente minutes. Ce plafond n'est pas dans la demande,
mais un pair qui envoie deux kilo-octets puis boude laisserait sinon une ligne bleue tourner
indéfiniment.

### Lâcher la recherche : arrêter avant de supprimer

Une recherche **survit à l'intérêt qu'on lui porte** : on classe ce qui est arrivé au bout de
quelques secondes, pendant que Soulseek continue de répondre une demi-minute.

Supprimer une recherche encore en cours fait donc lever une exception à slskd, qui met à jour
la ligne de cette recherche au fil des réponses :

```
Failed to execute search for 'Lady Gaga Telephone':
The database operation was expected to affect 1 row(s), but actually affected 0 row(s)
```

L'`UPDATE` porte sur une ligne qu'on a effacée sous ses pieds. `releaseSearch` fait donc les
choses dans l'ordre : `PUT /searches/{id}` **arrête** la recherche — c'est ce que ce verbe fait
chez slskd —, puis le `DELETE` attend qu'elle ne soit plus en cours.

Et si elle ne se termine jamais, **la ligne est laissée**. Une ligne de trop dans la liste de
slskd ne coûte rien ; une trace de pile dans les journaux à chaque recherche coûte la confiance
qu'on a dans l'outil. Pour la même raison la fonction ne lève jamais et n'est pas attendue :
c'est du ménage, pas le résultat de la recherche.

## Les octets : slskd ne peut pas les servir

Point vérifié dans le source de slskd, et c'est lui qui décide de toute l'architecture : son
`FilesController` expose du `GET` pour **lister** les répertoires de téléchargement et du
`DELETE` pour supprimer — **aucune route ne rend le contenu d'un fichier**.

st0 ne peut donc pas récupérer le fichier par l'API. Il va le chercher en **SFTP**, et c'est st0
qui tire plutôt que la machine slskd qui pousse. Conséquences voulues : aucun script à faire
tourner là-bas (donc aucune donnée hostile passée à un shell distant), st0 n'a pas besoin d'être
joignable depuis cette machine, et il reste le seul demandeur — comme pour le plan de contrôle.

Un **client** SFTP et non un montage : pas de FUSE, donc pas de `CAP_SYS_ADMIN` sur le conteneur
qui détient les fichiers de tout le monde ; pas de montage à remonter après un redémarrage ; pas
d'appel bloquant capable de geler la boucle d'événements ; et le même code en dev sous Windows
qu'en production sous Linux. Le raisonnement complet est dans l'historique de cette décision —
l'essentiel est que le montage aurait demandé **deux** mécanismes à faire marcher au lieu d'un.

`localPathFor` reconstruit le rangement que slskd documente : `<downloads>/<dossier>/<fichier>`.
Si le fichier n'y est pas — slskd est configurable — on le cherche par son nom sur trois niveaux,
parce qu'un échec dû à *ça* serait indistinguable d'un morceau que personne ne partage.

## Ce qui vient du réseau est hostile

La documentation de slskd le dit elle-même : les noms de fichiers viennent du réseau Soulseek et
peuvent contenir n'importe quoi. Ils traversent ici deux endroits, et chacun a sa défense :

1. **Le chemin distant** → `localPathFor` retire les segments `.` et `..` avant de garder les
   deux derniers, donc le résultat est **toujours** sous le dossier de téléchargement. Un test le
   vérifie sur trois formes d'échappement.
2. **Le nom du fichier rangé** → il ne sert qu'à donner son extension au master, via `masterName`
   qui refuse tout ce que le scan ne verrait pas comme de l'audio. Le dossier, lui, vient des
   tags MusicBrainz passés par `segment`, qui jette tout ce qui n'est pas nommable et coupe à 80
   caractères. `putFile` refuse un `..` par-dessus, et `writablePath` un segment initial en `.`.

Rien de ce qu'un inconnu a tapé ne devient donc un chemin.

## L'historique

Une ligne par recherche, la plus récente en haut, dans `.hunts/<slug>-<hash>.json` sur le volume
— un dot-dossier, donc invisible aux scans de familles et à l'API fichier, exactement comme
`.prefs` et `.projects`. Cent lignes gardées : c'est une mémoire pour reconnaître ce qu'on a
déjà demandé, pas une archive, et le fichier est lu en entier à chaque interrogation.

Trois couleurs pour quatre états, parce que « on cherche » et « ça télécharge » sont tous deux
« en cours » pour qui regarde. Le détail affiché change avec l'état : au téléchargement c'est
**qui** envoie et le combien-ième pair, à l'échec c'est **pourquoi**, une fois rangé c'est
**où** — et le format obtenu, dit sans détour, pour qu'un 128 kbps ne soit pas pris pour une
référence de mix six mois plus tard.

Une recherche vit dans la mémoire d'un processus. Un redéploiement la perd alors que sa ligne dit
encore « en cours » — une ligne bleue qui tournerait pour toujours. `reconcile` marque en échec
tout ce qui est dans un état vivant sans qu'aucun coureur ne le revendique, à la première lecture
suivante, qui est aussi le premier moment où quelqu'un aurait pu s'en apercevoir.

Le dialogue **n'interroge que lorsqu'il est ouvert** : le travail est sur le serveur, et un
onglet qui demanderait en continu pour un écran fermé paierait un aller-retour pour rien.

## Garde-fous

Quatre recherches simultanées par personne au maximum. Une recherche occupe une place dans la
file d'un pair pendant dix minutes ; quarante d'un coup seraient un bon moyen de faire bannir le
compte. MusicBrainz est limité à **une requête par seconde**, en file plutôt que rejetée — deux
personnes qui cherchent en même temps, c'est normal.

La route est en **session seule**, contrairement à la médiathèque et aux projets qui acceptent un
jeton de machine : celle-ci dépense la bande passante et la réputation d'un compte sur un réseau
tiers, ce qu'un jeton de service n'a pas à pouvoir déclencher.

Un morceau déjà dans la médiathèque est reconnu **avant** le téléchargement. `addSong` le
refuserait de toute façon à la fin, et l'apprendre après quarante mégaoctets est une plus
mauvaise façon de l'apprendre.

Le sidecar porte `source: slskd`, à côté d'`upload` et de `k7` — le champ existe précisément pour
dire à qui lit le dossier d'où il vient.

## Configuration

| variable | ce que c'est |
|---|---|
| `SLSKD_URL` | l'adresse de l'instance slskd, par exemple `https://slskd.lan:5031` |
| `SLSKD_API_KEY` | sa clé d'API — à restreindre par CIDR côté slskd, la machine étant distante |
| `SLSKD_SFTP_HOST` / `SLSKD_SFTP_PORT` | la même machine, en SSH (22 par défaut) |
| `SLSKD_SFTP_USER` | l'utilisateur qui peut lire le dossier de téléchargement |
| `SLSKD_SFTP_KEY` / `SLSKD_SFTP_PASSPHRASE` | la clé privée **elle-même**, pas un chemin — un conteneur reçoit ses secrets par l'environnement |
| `SLSKD_SFTP_PASSWORD` | à défaut de clé |
| `SLSKD_DOWNLOADS_DIR` | où slskd dépose, vu depuis cette machine |
| `MUSICBRAINZ_USER_AGENT` | leurs conditions demandent un client qui se nomme et dit comment le joindre |

Tant qu'il en manque, l'écran s'ouvre et **dit lesquelles** au lieu d'échouer à chaque frappe :
un déploiement pas encore configuré est l'état normal d'un déploiement neuf.

Une clé SSH **distincte** de celle des dépôts git : joindre un hébergeur git et ouvrir un shell
sur la machine slskd sont deux confiances différentes.

## Ce qui n'est pas fait

- Le morceau est cherché **seul**. Prendre l'album entier demanderait de choisir entre des
  éditions et des ordres de pistes, ce qui est un autre écran.
- Aucune reprise après redémarrage : une recherche interrompue est marquée en échec et se
  relance à la main. Reprendre supposerait de retrouver l'état d'un transfert chez un pair, ce
  que slskd ne garantit pas après une coupure.
- Rien n'est **partagé** en retour. Beaucoup de pairs bannissent automatiquement qui ne partage
  rien, donc la moisson sera moins bonne qu'avec un client qui partage — c'est une décision à
  prendre, pas un oubli.
