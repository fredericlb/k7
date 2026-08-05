# Ouvrir un morceau — l'écran scindé

Cliquer un morceau ne sélectionnait rien de visible. Au mieux, si le sidecar déclarait
des `variants:`, une quatrième colonne apparaissait sur la droite ; sinon l'écran ne
bougeait pas, et la liste du milieu restait la liste du milieu.

Un morceau s'ouvre maintenant comme un module et comme une chaîne : l'arbre reste à
gauche, et le reste de la largeur se coupe en deux.

```
┌────────┬─────────────────────┬─────────────────────┐
│ arbre  │ song.yaml           │ lecteur + forme     │
│        │ (YamlPane)          │ d'onde              │
│        │                     ├─────────────────────┤
│        │                     │ variantes (si le    │
│        │                     │ sidecar en déclare) │
└────────┴─────────────────────┴─────────────────────┘
```

C'est `ChainEditor` à l'identique — texte à gauche, ce que le texte décrit à droite — et
volontairement : les deux familles posent la même question, et un troisième agencement
n'aurait rien ajouté qu'une chose de plus à apprendre.

## Le navigateur ne décode pas l'audio

La forme d'onde ne vient pas d'un `decodeAudioData` : elle vient du sidecar `.cache` que
le moteur écrit **à côté** du master (`packages/file-service/src/routes/mediatek.ts`, et
`packages/file-service/docs/waveformCache.md` pour ce qu'il contient). `songWaveform.ts`
le lit par la route de fichiers ordinaire — pour ce service, un `.cache` est un fichier
comme un autre — et n'en garde que trois champs :

| champ | ce qu'on en fait |
|---|---|
| `rms[]` | les échantillons de `Envelope`, déjà linéaires 0..1 |
| `seconds` | la durée, et donc `intervalMs = seconds × 1000 / rms.length` |
| `transients`, `bpm` | deux nombres en pied de panneau |

Trois raisons de ne pas décoder ici :

1. **Le master pèse ce qu'il pèse.** Un flac de quatre minutes est une trentaine de Mo à
   télécharger *entièrement* avant de dessiner le premier pixel, sur une médiathèque qui
   est hébergée ailleurs. Le `.cache`, lui, fait quelques ko.
2. **Le moteur a déjà décodé.** Il l'a fait au moment de l'envoi, et il a détecté les
   onsets et le tempo pendant qu'il sous-échantillonnait. Refaire la moitié du travail
   dans le navigateur produirait une deuxième vérité, moins bonne.
3. **C'est la règle de ce dépôt.** « Le service hébergé ne décode pas d'audio » n'est pas
   une limite de ce panneau : c'est pourquoi `/mediatek/analyse` existe.

## L'analyse est demandée, pas attendue

Un morceau peut n'avoir aucun `.cache` — déposé quand aucune machine n'était joignable,
ou rapatrié du miroir k7. `AddSong` le dit en toutes lettres : « avec aucune machine
joignable il ne se passe rien ici, et la première surface qui a besoin du cache le calcule
alors ». Ce panneau **est** cette surface. Il appelle donc `engineMachine.analyse` lui-même
et relit le sidecar, une seule fois, à l'ouverture.

Sans moteur choisi, il le dit et s'arrête là. Le morceau se joue quand même : un `<audio>`
sur `library.fileUrl(master)` n'a besoin de personne, et la route sert du Range, donc le
déplacement dans le fichier marche aussi. Ce qui manque alors est le dessin, pas le son —
ce qui est exactement l'ordre d'importance.

## Le transport est à nous

Pas de `controls` sur l'élément `<audio>`. La forme d'onde **est** la barre de défilement
(`onSeek` écrit `currentTime`), et deux barres de défilement se contredisent dès qu'on
tire l'une des deux. Le bouton et l'horloge du bandeau sont donc les seuls contrôles, et
la tête de lecture suit un `requestAnimationFrame` plutôt que `timeupdate`, qui tombe
quatre fois par seconde et se lit, sur un canvas de cette largeur, comme un sursaut.

## Les variantes ont changé de place

Elles étaient une quatrième colonne, affichée seulement quand *rien* n'était ouvert.
Cliquer un morceau ouvre maintenant quelque chose, donc cette condition ne pouvait plus
jamais être vraie : elles seraient devenues inatteignables. Elles sont sous le lecteur,
dans la même moitié d'écran — le master et ses autres versions sont une seule question.

## Une adresse pour un morceau

`/songs/<artiste>/<album>/<titre>/song.yaml` est maintenant une adresse, comme
`/modules/audio/reverb/ui.yaml` l'était déjà. Voir [routing.md](routing.md) : `CARRIES` y
a remplacé les deux tests `head === …`, et en passant a réparé `chains`, qui écrivait une
URL qu'il ne savait pas relire.

## Le sidecar peut ne pas exister

Un dossier trouvé sur le disque sans `song.yaml` est listé quand même — `catalogued:
false`, « un morceau que personne n'a rangé ». L'éditeur s'ouvre alors sur un gabarit
(`# <chemin>` et `title:`) plutôt que sur une erreur, et le premier enregistrement crée le
fichier par la route d'écriture ordinaire. C'est ce que fait déjà `library.moduleUi` pour
un panneau absent, et pour la même raison : refuser d'ouvrir laisse la personne devant un
écran qui ne propose rien.
