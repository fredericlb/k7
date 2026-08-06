# Trouver des morceaux — de ce qu'on tape à un fichier rangé

« Trouver des morceaux », à côté d'« Ajouter » dans la section Morceaux, mène à **sa propre
page** (`/find`) : un champ de recherche en haut, et dessous l'historique de ce qu'on a déjà
demandé. On tape « nirvana lithium », et la chaîne complète se déroule toute seule :

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

### Cette étape se raconte dans les journaux

C'est ici que deux machines se rencontrent, donc c'est ici qu'on ne peut rien déduire après
coup. Chaque récupération écrit ce qu'elle vise et ce qu'elle voit :

```
⇣ sftp → fred@slskd.lan:22 (clé)
⇣ sftp connecté, dossier /downloads
⇣ sftp nom chez le pair : @ann\Music\Nirvana\Nevermind\05 Lithium.flac
⇣ sftp chemin visé      : /downloads/Nevermind/05 Lithium.flac
⇣ sftp /downloads : 3 entrée(s) → [d] complete, [d] incomplete, [-] readme.txt
⇣ sftp pas à l'endroit attendu (absent) — recherche par nom sur 3 niveaux
⇣ sftp descente dans /downloads/complete
⇣ sftp /downloads/complete : 1 entrée(s) → [d] Nevermind
⇣ sftp trouvé ailleurs  : /downloads/complete/Nevermind/05 Lithium.flac
⇣ sftp 40.1 Mo lus depuis /downloads/complete/Nevermind/05 Lithium.flac
```

Ce que cette trace donne, et qu'aucun message d'erreur ne donnerait : **le nom du pair et le
chemin déduit côte à côte**, donc un rangement inattendu de slskd se lit d'un coup d'œil ; et le
**contenu réel** du dossier, donc « mauvais `SLSKD_DOWNLOADS_DIR` », « droits qui manquent à
l'utilisateur SSH » et « slskd n'a rien écrit » cessent de se ressembler.

La première ligne est écrite **avant** la connexion : si c'est elle qui échoue, ce sont ces
valeurs-là qu'on veut relire, et l'exception de `connect` ne les porte pas. Elle dit qu'il y a une
clé, jamais laquelle — un test le vérifie.

Toujours écrites, pas seulement en cas d'échec : un téléchargement dure des minutes, donc une
dizaine de lignes par téléchargement n'est pas du bruit. Les listes sont coupées à quarante
entrées, un dossier de téléchargement pouvant en tenir des milliers.

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

## Ajouter automatiquement à une playlist

Sous le champ, un menu « Ajouter automatiquement à la playlist : », à **Non** par défaut. Tout
morceau trouvé pendant qu'une playlist est choisie y est ajouté une fois rangé.

**Le choix est figé sur la LIGNE, au lancement** — pas relu quand le téléchargement se termine.
C'est la décision qui compte ici : une recherche dure des minutes, donc le menu à l'écran
appartient déjà à la suivante. Quatre recherches lancées puis le menu changé atterriraient
autrement toutes dans la dernière playlist choisie, ce qui n'est l'intention de personne. La
ligne affiche donc sa playlist, sans quoi deux recherches aux choix différents se
ressembleraient.

Ça vaut aussi pour le **secours YouTube** : la ligne porte le choix, et le secours reprend la
ligne. Un morceau récupéré autrement manquerait sinon à la setlist sans le dire.

L'écriture passe par `appendPlaylistItem`, donc **au niveau du texte** : ces fichiers portent des
commentaires et un ordre choisis à la main, et repasser par un sérialiseur les jetterait sans
bruit (voir packages/mediatek/docs/playlists.md). La référence écrite est relative à `songs/`,
comme celles qu'écrit le panneau des playlists — sinon un même fichier tiendrait deux
orthographes de la même chose. Un morceau déjà présent n'est pas redoublé.

### Un demi-succès reste vert

Playlist disparue, `items:` d'une forme que l'ajout ne sait pas étendre : le morceau **est**
rangé dans la médiathèque, seule la ligne de playlist manque. La ligne reste donc verte et dit
la plainte à côté. La rougir prétendrait que le téléchargement a échoué — c'est faux, et ça
enverrait le refaire alors qu'il n'y a qu'une ligne à taper à la main.

La route valide que le chemin ressemble à `playlists/….yaml` avant de lancer quoi que ce soit.
`writablePath` refuserait un `..` de toute façon, mais dix minutes plus tard : nommer la faute
tout de suite vaut mieux que la faire découvrir à l'arrivée.

## Le secours : « DL sur YouTube »

Quand Soulseek a été **interrogé et épuisé**, la ligne porte un bouton **DL sur YouTube**, qui
reprend le morceau avec `yt-dlp`.

### Épuisé, pas simplement rouge

Le bouton n'apparaît pas sur toute ligne rouge, et la distinction est le fond du sujet. Deux
échecs seulement disent quelque chose sur la **disponibilité du morceau** :

| l'échec | le bouton |
|---|---|
| personne ne partage ce morceau dans un format utilisable | **oui** |
| des pairs l'avaient, aucun n'a commencé à envoyer | **oui** |
| service redémarré, recherche annulée | non — Soulseek n'a rien dit |
| slskd pas configuré, MusicBrainz n'a rien reconnu | non — on n'a même pas cherché |
| téléchargé, mais introuvable en SFTP | non — et surtout pas |

La dernière ligne est celle qui compte : le fichier **a bien été téléchargé**, c'est la
récupération qui a échoué. Proposer YouTube là masquerait un défaut de configuration derrière un
fichier de moins bonne qualité — le genre de secours qui empêche de réparer la vraie panne.

C'est porté par `exhausted` sur la ligne, posé par le coureur au seul endroit qui le sait, et
d'après le **type** de l'erreur et non son texte : un `includes("aucun pair")` finirait par ne
plus rien reconnaître après une reformulation, donc par ne plus jamais proposer le secours, sans
que rien ne le signale.

La règle vit dans le contrat partagé (`canFallBackToYoutube`), et **la route l'applique aussi** :
un bouton visible que la route refuserait serait une impasse, et l'inverse une porte dérobée.

**Un bouton, jamais un repli automatique.** C'est un autre marché : un flux compressé tiré
d'une vidéo au lieu du fichier de quelqu'un. Savoir quel morceau le mérite est un jugement sur
le morceau — une reprise pour une playlist de répèt, oui ; une référence de mix, sûrement pas —
et un serveur n'a pas à le faire à votre place.

C'est **la même ligne** qui repart, pas une nouvelle. Elle porte déjà les tags résolus par
MusicBrainz, donc le morceau se range exactement où il serait allé ; et l'historique garde une
ligne par morceau voulu plutôt qu'une par tentative, ce qui est la question qu'on se pose en
relisant la liste. Le sidecar dit `source: youtube`, à côté de `slskd` et d'`upload` : une fois
le dossier rangé, c'est la seule trace qu'on écoute la piste audio d'une vidéo et non un disque.

### Ici l'artiste EST dans la requête

À l'inverse exact de slskd. Un titre de vidéo YouTube s'écrit « Artiste - Titre », donc
l'artiste est dans le champ même qu'on interroge ; chez Soulseek il était le dossier au-dessus
et ne restreignait rien. Même information, deux endroits différents, deux décisions opposées.

`ytsearch1:` transforme la phrase en une vidéo sans qu'on ait à interroger YouTube nous-mêmes.
Un seul résultat : le deuxième est déjà une reprise ou un live.

### On ne ré-encode pas

`--audio-format best` ne convertit pas, il **conserve** : YouTube sert de l'Opus autour de
130 kbps, et le passer en mp3 serait un transcodage lossy vers lossy — nettement pire que l'un
ou l'autre, pour rien. Ce qui sort est donc du `.opus` ou du `.m4a`, que `AUDIO_EXT` accepte
déjà. Si yt-dlp rend autre chose, on refuse en le disant plutôt que de ranger un fichier que
`masterName` rejetterait de toute façon.

Le débit est inscrit dans la ligne comme pour un téléchargement Soulseek : un morceau à
130 kbps qui s'annonce ne sera pas pris pour une référence six mois plus tard.

### Ce qui est hostile, ici, c'est la requête

Elle vient de ce que quelqu'un a tapé, et elle part vers un processus. `ytdlpArgs` rend un
**tableau**, et `execFile` est appelé **sans shell** : un `;`, un `$(…)` ou un guillemet dans la
recherche reste des caractères dans une recherche. C'est la même discipline que pour les noms
de fichiers venus de Soulseek, à l'autre bout de la chaîne.

Le travail se fait sous `.hunts/tmp/<id>` — sur le volume, donc de la vraie place, et derrière
un point, donc invisible aux scans. Effacé quoi qu'il arrive : un téléchargement raté laisserait
sinon des octets que plus rien ne nomme.

### Ce que ça demande à l'image

`yt-dlp` **et** `ffmpeg`, tous deux dans le Dockerfile. ffmpeg n'est pas un supplément : yt-dlp
n'en embarque pas et ne sait pas séparer un flux de son conteneur sans lui, donc les deux ne
font qu'une fonctionnalité.

Et il faut le savoir : **yt-dlp est une cible mouvante**. YouTube le casse tous les quelques
mois, donc la version figée dans une image vieillit et finit par échouer ; reconstruire est le
correctif. C'est le coût de cette porte de sortie, et la raison pour laquelle elle est une porte
de sortie et non le chemin principal.

L'écran demande au backend si le binaire est là (`GET /api/hunt` → `youtube`), sondé une fois.
Sans lui, le bouton est grisé et le dit, plutôt que d'échouer au clic.

## Une page, pas un dialogue

`/find` est une **section** au sens de `routes.ts`, comme `engine` : sans onglet dans l'en-tête,
atteinte par un bouton depuis la section à laquelle elle appartient, et dessinée bord à bord.

Un dialogue aurait été le réflexe — c'est ce que fait « Ajouter » juste à côté — et il aurait été
le mauvais choix : **l'historique s'allonge**. Cent lignes dans une fenêtre de 85 % de hauteur,
c'est un écran qui défile dans un écran. Et une page apporte trois choses qu'une boîte modale ne
peut pas donner : une adresse qu'on recharge et qu'on met en signet, un bouton « précédent » qui
ramène aux morceaux, et toute la hauteur disponible.

Le champ de recherche est en haut et **ne défile pas** : monter une bibliothèque, c'est enchaîner
les titres, et un champ qu'il faudrait aller rechercher après trente lignes serait un
aller-retour par morceau.

Deux conséquences dans `Library.tsx`, toutes deux faciles à manquer :

- `find` doit être **retiré de `FamilyId`**, qui se calcule par soustraction sur `SECTION_IDS`.
  Sans ça la nouvelle section deviendrait une famille, et le poll irait demander au serveur une
  liste de `find`. C'est le prix de la soustraction : chaque section qui n'est pas une famille
  doit être nommée là.
- Le rafraîchissement du catalogue après un morceau rangé ne peut pas être le `refresh` général,
  qui invalide le jeton de la section **ouverte** — laquelle est `find`. Ce qui vient d'arriver
  est dans `songs` : c'est ce jeton-là qu'il faut effacer, sinon le morceau n'apparaîtrait qu'au
  prochain changement de section.

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
- Le secours YouTube ne **choisit pas** la vidéo : c'est la première réponse, point. Proposer
  une liste serait un autre écran, et le premier résultat d'une requête « artiste titre » est
  la bonne piste bien plus souvent qu'il ne l'est pour une recherche Soulseek.
