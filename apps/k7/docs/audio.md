# L'audio des séances — notes étendues

## Grist garde les faits, plus les octets

Une séance était une ligne Grist **et** une pièce jointe Grist. L'audio vit maintenant dans
la zone `RECORDINGS` de la médiathèque ; la ligne n'en garde que le chemin.

| | avant | maintenant |
|---|---|---|
| durée, gain, enveloppe, tags, marqueurs | Grist | Grist |
| une séance | pièce jointe `Sessions.Recording` | `recordings/<jour>/<HH-MM-SS>.<ext>` |
| un moment | pièce jointe `Comments.Clip` | `recordings/<jour>/moment-…` |
| une version publiée | pièce jointe `Versions.Audio` | `morceaux/recorded/K7/…` |
| ce que la ligne pointe | un `attachmentId` | un chemin (`RecordingPath`, `ClipPath`, `AudioPath`) |
| le cache disque | inchangé | inchangé |
| les partitions | pièce jointe `Songs.SheetFiles` | inchangé — ce n'est pas de l'audio |

Le cache local ne bouge pas : c'est lui qui sert la lecture en Range, et il se remplit
depuis la médiathèque au lieu de Grist. Une séance déjà en cache ne fait aucun aller-retour.

## Pourquoi

Grist est une base de données à qui on demandait de porter des heures de wav. Une
médiathèque est faite pour ça : un volume, des chemins, du Range natif, et une zone dont
c'est exactement le rôle — voir `packages/mediatek/docs/recordings.md`. Le reste du studio
sait déjà lire cette zone ; les pièces jointes Grist n'étaient lisibles que par k7.

## Le client est celui du package

`@studio/mediatek/remote` portait déjà `remoteLibrary` (télécharger en flux),
`remoteWriter` (écrire, supprimer) et il a gagné `pushRecording`. K7 n'écrit pas un
deuxième client HTTP : `src/mediatek.ts` est une façade de trente lignes au-dessus de
celui-là.

`pushRecording` est délibérément séparé de `remoteWriter` : un *writer* écrit au chemin
qu'il a choisi, tandis qu'une capture envoie des octets **et l'instant**, à charge pour la
bibliothèque d'en déduire le chemin.

## Une séance est UN fichier

`storeBytes` couvre les trois entrées — première sauvegarde, ré-enregistrement, séance
prolongée — avec une règle unique : si la séance possède déjà un fichier **du bon format**,
il est réécrit sur place.

Sans ça, prolonger une séance pousserait une seconde capture, et la zone montrerait deux
prises là où il n'y a qu'un enregistrement. C'est l'unique endroit où quelque chose nomme
un chemin de la zone au lieu de le recevoir : le fichier existe déjà et appartient à cette
séance-là.

Le changement de format est l'exception : la prise recollée est toujours du webm, donc une
séance commencée en ogg reçoit un nouveau fichier et l'ancien part — **après** que les
nouveaux octets ont atterri, jamais avant, pour qu'un envoi raté laisse le fichier jouable.

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

## On repart de zéro : il n'y a plus de repli

Une première version de ce changement gardait les pièces jointes en second recours, pour
que l'ancien continue de jouer. **Ce repli a été retiré**, et avec lui les colonnes
`Sessions.Recording`, `Comments.Clip`, `Versions.Audio` et `Versions.TrackFiles`, le
miroir de la médiathèque, et la fonction `attachmentIdOf` qui les lisait.

Ce qui est enregistré à partir de maintenant vit dans la médiathèque. Ce qui existait avant
n'a plus d'audio nulle part que k7 sache atteindre — c'est la décision, pas un oubli.

Deux conséquences visibles, et voulues :

- **`hasRecording` se déduit du CHEMIN**, plus du drapeau `HasRecording` posé à côté. Une
  ligne d'avant porte `true` et ne pointe sur rien ; une séance qui annonce un
  enregistrement qu'elle ne peut pas jouer est pire qu'une séance qui admet n'en avoir
  aucun.
- **Prolonger une telle séance recommence** au lieu d'échouer : sans chemin, il n'y a rien
  à quoi recoller, donc la prise devient la première.

Les colonnes ne sont pas *supprimées* dans Grist — `migrateSchema` ne fait qu'ajouter ce
qui manque — elles ne sont simplement plus déclarées ni lues. Les vider, ou vider les
tables, est une opération à faire à la main, sciemment.

Les **partitions** (`Songs.SheetFiles`) restent des pièces jointes Grist : ce ne sont pas
des enregistrements, et `uploadAttachment` / `downloadAttachment` ne servent plus qu'à
elles.

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

Ré-extraire remplace : la borne ou le nom ont pu bouger, donc l'ancien nom de fichier est
devenu faux. `Comments.ClipPath` remplace la pièce jointe `Clip`.

## Les versions publiées sont des morceaux

Une version publiée n'est pas une capture : c'est un mixdown que quelqu'un a décidé fini.
Elle va donc dans **MORCEAUX**, sous l'artiste `K7` :

```
morceaux/recorded/K7/<titre de la release>/<nom de la version>/
    original.mp3        ← le mixdown
    morceau.yaml        ← title, artist: K7, album, source: k7
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

Renommer une version **ne déplace pas le dossier** ; seul le sidecar est réécrit. C'est la
règle du miroir, pour sa raison : un chemin de dossier est l'identifiant d'une entrée et la
clé d'un manifeste de cache, donc le faire bouger coûterait à chaque machine le
re-téléchargement d'octets qui n'ont pas changé.

`Versions.AudioPath` remplace la pièce jointe `Audio`, et `TrackMeta` porte maintenant
`{id, path, name, mime}` au lieu de `{id, attachmentId, …}`.

## Le miroir de la médiathèque a été retiré

`apps/mediatek/backend/src/mirror/k7.ts`, sa route `POST /api/mirror/k7` et sa
page de doc tiraient ces versions depuis Grist, une par une, en les retrouvant par leur clé
amont. Rien de tout cela n'a plus de sens : k7 **pousse** au moment de la publication, donc
il n'y a plus rien à tirer. La médiathèque n'a plus de dépendance sur Grist du tout —
`@frediverse/db-grist` a quitté ses dépendances.

## Ce qui reste dans Grist

Plus aucun audio : les séances, les moments et les versions sont tous dans la médiathèque.
Grist garde les faits — qui, quand, combien de temps, quels tags, quel gain, quelle
enveloppe — et les fichiers de partition (`Songs.SheetFiles`), qui ne sont pas de l'audio.

## Configuration

`MEDIATEK_URL` a une valeur par défaut qui vise le backend médiathèque **en direct**
(`http://127.0.0.1:8795`) et non `https://studio.test/mediatek` : c'est un appel de serveur
à serveur, et le certificat de Caddy vient d'une autorité locale que Node ne connaît pas
sans qu'on la lui donne.

`MEDIATEK_TOKEN` n'a pas de défaut, et sans lui la bibliothèque répond 401 : ses routes
sont derrière une session ou un jeton, jamais ouvertes. On le frappe une fois, connecté à
la médiathèque :

```bash
curl -X POST https://studio.test/mediatek/api/token -b "studio.sid=<votre cookie>"
```
