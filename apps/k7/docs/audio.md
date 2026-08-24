# L'audio des séances — notes étendues

## Grist garde les faits, la médiathèque garde les octets

Une séance est une ligne Grist, et son audio vit dans la zone `RECORDINGS` de la
médiathèque ; la ligne n'en garde que le chemin.

| | où ça vit |
|---|---|
| durée, gain, enveloppe, tags, marqueurs | Grist |
| une séance | `recordings/<jour>/<HH-MM-SS>.<ext>` |
| un moment | `recordings/<jour>/moment-…` |
| une version publiée | `songs/K7/…` |
| ce que la ligne pointe | un chemin (`RecordingPath`, `ClipPath`, `AudioPath`) |
| les partitions | pièce jointe `Songs.SheetFiles` — ce n'est pas de l'audio |

Le cache local sert la lecture en Range, et il se remplit depuis la médiathèque. Une séance
déjà en cache ne fait aucun aller-retour.

## Pourquoi

Grist est une base de données, et des heures de wav n'y ont pas leur place. Une médiathèque
est faite pour ça : un volume, des chemins, du Range natif, et une zone dont c'est exactement
le rôle — voir `packages/mediatek/docs/recordings.md`. Le reste du studio sait lire cette
zone ; une pièce jointe Grist n'est lisible que par k7.

## Le client est celui du package

`@studio/mediatek/remote` porte `remoteLibrary` (télécharger en flux), `remoteWriter`
(écrire, supprimer) et `pushRecording`. K7 n'écrit pas un deuxième client HTTP :
`src/mediatek.ts` est une façade de trente lignes au-dessus de celui-là.

`pushRecording` est délibérément séparé de `remoteWriter` : un *writer* écrit au chemin
qu'il a choisi, tandis qu'un enregistrement envoie des octets **et l'instant**, à charge pour la
bibliothèque d'en déduire le chemin.

## Une séance est UN fichier

`storeBytes` couvre les trois entrées — première sauvegarde, ré-enregistrement, séance
prolongée — avec une règle unique : si la séance possède déjà un fichier **du bon format**,
il est réécrit sur place.

Sans ça, prolonger une séance pousserait un second enregistrement, et la zone montrerait deux
prises là où il n'y a qu'un enregistrement. C'est l'unique endroit où quelque chose nomme
un chemin de la zone au lieu de le recevoir : le fichier existe déjà et appartient à cette
séance-là.

Le changement de format est l'exception : la prise recollée est toujours du webm, donc une
séance commencée en ogg reçoit un nouveau fichier et l'ancien part — **après** que les
nouveaux octets ont atterri, jamais avant, pour qu'un envoi raté laisse le fichier jouable.

## Recoller une prise sur une séance

Prolonger une séance ne concatène pas des octets : du WebM/Opus ne se colle pas bout à bout,
donc les deux prises sont re-muxées en un seul fichier par le filtre `concat` de ffmpeg, qui
ré-encode. Ce filtre exige des paramètres identiques d'un segment à l'autre, d'où le passage
de chaque entrée par un format commun : deux prises venues de deux appareils se joignent
quand même.

Trois conséquences en cascade :

- **L'enveloppe** des nouveaux échantillons se pose à la suite de l'ancienne. Chaque prise est
  normalisée sur son propre pic, donc les deux moitiés peuvent différer légèrement d'échelle
  verticale — acceptable pour une vue d'ensemble de niveau, ce que l'enveloppe est.
- **Le gain** retenu est le plus petit des deux. Il vaut `0.9 / truePeak` : la plus petite
  valeur dégage donc le plus fort des deux pics, et la lecture combinée reste sous l'écrêtage.
- **Le cache disque** est réécrit en `.webm` quel que soit le format d'avant, et l'ancien
  fichier de cache — d'un autre type — est effacé au lieu d'être laissé à traîner.

Une séance sans chemin n'a rien à quoi recoller : la prise devient alors la première, plutôt
que d'échouer.

## Effacer : les octets d'abord

Supprimer une séance ou un moment retire les octets de la zone **avant** la ligne Grist, parce
que c'est la ligne qui porte le chemin : l'inverse laisserait dans la zone une prise que plus
rien ne désigne.

Le retrait n'est jamais fatal. Si la bibliothèque est injoignable, la ligne part quand même :
un orphelin dans la zone se voit et se supprime, une séance qui refuse de disparaître non.

Les moments, eux, **survivent** à la séance dont ils sont issus — ils ont leur propre extrait
et leur propre vue ; ils y perdent seulement le lien de retour. Les marqueurs, qui n'existent
que sur la timeline d'une séance, partent avec elle.

## `mp4` devient `.m4a`

Le `MediaRecorder` de Safari produit de l'`audio/mp4`. La médiathèque classe `.mp4` en
**vidéo** : la zone refuserait le fichier, et le refus arriverait à l'utilisateur comme
« l'envoi a échoué » sans autre explication.

Un mp4 sans image est un `.m4a` — même conteneur, nom honnête, et extension que la zone
reconnaît. Le cache disque, lui, garde `mp4` : c'est un nom local, personne ne le lit.

## L'heure est celle de la séance

`RecordingPath` est déduit de `Sessions.CreatedAt`, pas de l'heure d'envoi. Une prise
sauvegardée après minuit appartient à la soirée où elle a été jouée, et c'est la date sous
laquelle la zone la range.

## Le chemin ou rien : aucun repli

k7 n'atteint l'audio d'une séance que par son chemin dans la médiathèque. Il n'y a pas de
second recours : les colonnes `Sessions.Recording`, `Comments.Clip`, `Versions.Audio` et
`Versions.TrackFiles` ne sont ni déclarées ni lues, et rien ici ne sait ouvrir une pièce
jointe audio.

Deux conséquences visibles, et voulues :

- **`hasRecording` se déduit du CHEMIN**, pas d'un drapeau `HasRecording` posé à côté. Une
  séance qui annonce un enregistrement qu'elle ne peut pas jouer est pire qu'une séance qui
  admet n'en avoir aucun.
- **Une séance sans chemin qu'on prolonge recommence** au lieu d'échouer : sans chemin, il
  n'y a rien à quoi recoller, donc la prise devient la première.

`migrateSchema` ne fait qu'ajouter ce qui manque, donc une colonne non déclarée reste
présente dans le document Grist. La vider, ou vider les tables, est une opération à faire à
la main, sciemment.

Les **partitions** (`Songs.SheetFiles`) sont des pièces jointes Grist : ce ne sont pas des
enregistrements, et `uploadAttachment` / `downloadAttachment` ne servent qu'à elles.

## Les moments vont dans la même zone

Un moment est un extrait découpé dans une séance. Il se range dans le **dossier du jour de
cette séance**, à côté d'elle, sous un nom qui porte les trois choses qu'il est :

```
recordings/2026-08-03/21-00-00.webm                       ← la séance
recordings/2026-08-03/moment-21-01-30--15--Le solo.webm   ← 90 s plus tard, 15 s, nommé
recordings/2026-08-03/moment-21-01-30--15.webm            ← le même, sans nom
```

L'heure est celle où l'extrait a été **joué** — `Sessions.CreatedAt` plus `StartSec` — et
non celle de l'annotation, qui peut arriver trois jours après. Le nom est le texte du
moment quand il y en a un.

Ré-extraire remplace : la borne ou le nom ont pu bouger, donc le nom de fichier déjà écrit
est faux. `Comments.ClipPath` porte ce chemin.

## Les versions publiées sont des morceaux

Une version publiée n'est pas un enregistrement : c'est un mixdown que quelqu'un a décidé
fini. Elle va donc dans les **MORCEAUX** (`songs/`), sous l'artiste `K7` :

```
songs/K7/<titre de la release>/<nom de la version>/
    original.mp3        ← le mixdown
    song.yaml           ← title, artist: K7, album, source: k7
    stems/guitare.wav   ← les pistes séparées, quand l'import en apporte
```

Quatre décisions dedans :

- **`recorded`, pas `imported`.** C'est le studio qui l'a produite ; cette distinction dit
  ce qui peut être re-fabriqué et ce qui est le master de quelqu'un d'autre.
- **La release est l'album, la version est le titre.** Trois niveaux pour trois niveaux, et
  chaque version garde son propre dossier — ce qu'il lui faut, puisqu'elle a son propre
  audio. L'artiste de la release, lui, survit dans ses métadonnées Grist.
- **Les stems sont dans `stems/`, pas à côté du master.** Le scan prend le premier fichier
  audio du dossier pour master et ne descend pas : une piste posée à côté pourrait être
  jouée à la place du mixdown.
- **Republier remplace.** Le 409 de la médiathèque protège une personne qui envoie deux
  fois le même morceau, pas un service qui republie sciemment.

Renommer une version **ne déplace pas le dossier** ; seul le sidecar est réécrit, pour cette
raison : un chemin de dossier est l'identifiant d'une entrée et la clé d'un manifeste de
cache, donc le faire bouger coûterait à chaque machine le re-téléchargement d'octets qui
n'ont pas changé.

`Versions.AudioPath` porte le chemin du mixdown, et `TrackMeta` porte
`{id, path, name, mime}`.

## k7 POUSSE ; la médiathèque ne tire rien

Au moment de la publication, k7 envoie lui-même les octets dans la zone : il n'y a rien à
tirer de l'autre côté, aucune route de synchronisation, et la médiathèque ne dépend pas de
Grist — `@frediverse/db-grist` n'est pas dans ses dépendances.

## Ce qui reste dans Grist

Aucun audio : les séances, les moments et les versions sont tous dans la médiathèque.
Grist garde les faits — qui, quand, combien de temps, quels tags, quel gain, quelle
enveloppe — et les fichiers de partition (`Songs.SheetFiles`), qui ne sont pas de l'audio.

## Prendre une prise dans le navigateur

Le hook `useRecorder` enregistre l'audio et construit son enveloppe de niveau (RMS) en même
temps, par la Web Audio API. Il sait mettre en pause et reprendre, pour qu'on puisse s'arrêter
d'écouter un moment et continuer la même prise ; le tableau `samples` vivant alimente la
détection de moments au fil de l'eau.

Cinq précautions, chacune payée par un bug :

- **Le contexte audio est repris à la main.** On démarre automatiquement après une navigation,
  donc le contexte peut être créé hors d'un geste utilisateur direct, et il naît alors
  `suspended` : l'analyseur ne lirait que du silence — vumètre mort, aucun moment détecté.
- **C'est la piste micro BRUTE qui est enregistrée**, pas la sortie du graphe audio. Le
  `MediaRecorder` est ainsi indépendant de l'état du contexte, et un contexte suspendu ne peut
  pas produire un enregistrement vide. Le niveau d'entrée est laissé à l'`autoGainControl` de
  `getUserMedia`.
- **Le gain est déduit du pic observé** et appliqué uniformément à l'arrêt, pas pendant : c'est
  ce qui garde l'enveloppe stockée cohérente d'un bout à l'autre. `TARGET_PEAK = 0.9` vise le
  moment le plus fort juste sous la pleine échelle, ~ -1 dBFS.
- **La durée est réécrite dans l'en-tête WebM.** `MediaRecorder` l'omet, ce qui rend le fichier
  non-seekable : `duration` vaut `Infinity` et les affectations de `currentTime` sont ignorées.
- **Le verrou d'écran est redemandé au retour au premier plan.** L'OS le révoque dès que
  l'onglet passe en arrière-plan et ne le rend jamais tout seul ; sans ce rattrapage une longue
  prise se fait couper par le verrouillage de l'appareil.

Les contraintes de `getUserMedia` sont essayées non traitées d'abord, puis en repli : Safari
en particulier refuse certaines combinaisons avec un `NotFoundError` (« The object can not be
found here. ») alors même qu'un micro existe.

L'arrêt demande un **appui maintenu** de deux secondes, bouton ou barre d'espace, pour qu'une
touche effleurée ne termine pas une prise d'une heure. La barre d'espace est avalée à chaque
`keydown` tant que la prise tourne — sinon la page défile — mais ne lance le maintien qu'au
premier ; et elle est ignorée tant que le recorder est réduit, parce que le bouton d'arrêt
n'est alors pas à l'écran.

## Détecter les moments

Le même détecteur existe deux fois : `apps/k7/backend/src/detect.ts` sur l'enveloppe stockée,
et `apps/k7/packages/recorder/src/detect.ts` côté client, pour faire apparaître les moments en
direct pendant la prise.

Le modèle tient en trois phrases, et la première est celle qu'on lit de travers :

- `threshold` est le volume **minimum** dont l'algorithme se soucie : un plancher de silence,
  pas une barre de « fort ».
- Un **non**-moment est toute portion d'au moins `minSilenceSec` secondes passée
  continûment sous ce plancher.
- Tout le reste est un moment. Un creux plus court que `minSilenceSec` ne coupe donc pas le
  moment qui l'entoure.

Après un recollage, la re-détection tourne sur l'enveloppe **stockée** — la timeline entière —
et non sur le segment qui vient d'être envoyé.

## Le dessin ne doit pas manger l'audio

Le canvas de la forme d'onde est redessiné à chaque changement d'identité de l'enveloppe. Une
enveloppe recréée à chaque rendu le faisait donc redessiner à chaque tic de tête de lecture,
d'où la mémoïsation de l'objet.

Le **playhead de lecture est un calque DOM**, pas un tracé sur le canvas, pour la même raison
poussée plus loin : le suivre à 60 images par seconde forçait un redessin complet, dont les
allocations provoquaient un hoquet audible par le ramasse-miettes.

Quand on prolonge une séance, la forme d'onde montre l'ancienne prise **devant** la nouvelle :
la timeline d'affichage est décalée de la longueur de l'enveloppe existante, pour que les deux
tronçons se rejoignent bord à bord. La timeline propre au recorder — moments détectés, écoute,
annotations en attente — reste, elle, relative à la nouvelle prise.

## Le micro distant : un pont Web Audio

Un second appareil peut servir de micro : la signalisation passe par une WebSocket vers le
relais du backend, l'audio par un flux WebRTC direct entre les deux appareils. Le
`MediaStream` obtenu est ensuite remis au recorder normal, donc tout ce qui suit est identique
à un micro local.

Un serveur STUN public suffit pour deux appareils sur le même réseau, et pour beaucoup de NAT ;
un NAT symétrique demanderait un TURN, hors sujet ici.

Deux détours, tous deux mesurés :

- **Le `MediaRecorder` n'enregistre pas fiablement une piste WebRTC distante.** Il rend souvent
  un fichier vide ou silencieux alors que le vumètre — un analyseur Web Audio sur la même
  piste — montre du signal. L'audio distant est donc re-routé par l'`AudioContext` local vers
  un `MediaStreamDestination` neuf, et c'est ce flux fabriqué localement qui est enregistré.
- **Ce contexte-pont doit tourner**, sinon sa sortie est du silence. La politique d'autoplay ne
  laisse le reprendre que depuis un geste utilisateur, et quand `ontrack` se déclenche le clic
  est loin derrière : il est donc créé et repris tout de suite, en premier pas synchrone, tant
  que le clic qui a appelé est encore le geste actif.

### Changer d'entrée sans couper le flux

L'appareil distant choisit son périphérique et, s'il en a plusieurs, son canal d'entrée — une
seule entrée d'une interface audio, par exemple ; `"mix"` somme tous les canaux en mono. La
capture demande le périphérique **brut**, sans traitement et avec beaucoup de canaux, pour que
les canaux individuels survivent, et retombe progressivement sur des contraintes plus modestes
pour les appareils ou navigateurs qui refusent les riches.

Changer de périphérique ou de canal **recâble le graphe en amont** d'un nœud de destination
fixe : la queue gain → destination → analyseur ne bouge pas, donc la piste du `MediaStream` de
sortie ne change jamais et l'émetteur WebRTC qui alimente le recorder continue sans coupure.

Un élément `<audio>` muet reçoit en plus le flux distant : certaines versions de Chrome ne font
tourner leur pipeline de réception qu'une fois la piste attachée à un élément média.

Côté relais, il y a **une salle de signalisation par utilisateur**, avec au plus une socket par
rôle : la règle « un seul appareil distant » tombe du seul emplacement `remote`. Un nouvel
arrivant remplace celui qui occupait son rôle — typiquement l'appareil distant qui se
reconnecte après un rafraîchissement : le plus récent gagne, et l'ancien est fermé pour qu'il
cesse de se croire en ligne. Les charges utiles de signalisation (`offer`, `answer`, `ice`,
`want`) sont relayées telles quelles, sans que le serveur les regarde.

## Configuration

**Rien ne se configure à la main.** `npm run tokens` écrit les deux lignes ; voir
`docs/tokens.md` à la racine.

`MEDIATEK_URL` a pour défaut l'adresse **fixe** du service — pl8 répond sous `/pl8`, donc
c'est `https://studio.frediver.se/pl8` :
une origine, un chemin par service, donc un déploiement n'a rien à choisir. Un **checkout** est
l'exception, et c'est le script qui l'écrit : le nom public sort jusqu'au proxy du LAN pour
revenir aussitôt sur cette machine, et tombe dès que ce proxy est injoignable alors que les deux
services vont bien — donc cet appel de serveur à serveur prend le port en loopback
(`http://127.0.0.1:8795`). L'autre moitié de la raison est la CA privée du checkout, que le
magasin de node ne connaît pas : mesuré, un `fetch` de `https://st0.priv.frediver.se` depuis
node échoue en `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` alors que le navigateur d'à côté y arrive.

`MEDIATEK_TOKEN` n'a pas de défaut, et sans lui la bibliothèque répond 401 : ses routes sont
derrière une session ou un jeton, jamais ouvertes. Le script le frappe hors ligne, signé avec
l'`API_TOKEN_SECRET` de la médiathèque, avec `sub: "service:k7"`.

Une machine sans checkout — un portable qui synchronise la bibliothèque hébergée — n'a pas
d'`env.yaml` et frappe donc le sien par la route prévue, connecté à la médiathèque :

```bash
curl -X POST https://studio.frediver.se/pl8/api/token -b "studio.sid=<votre cookie>"
```
