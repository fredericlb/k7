# Corriger la grille

La grille d'un morceau est **déduite** : le moteur mesure un tempo, et
[beats.ts](../src/beats.ts) place le premier temps par un test de Rayleigh sur les transitoires.
Ça marche souvent. Quand ça rate, ça ratait **définitivement** — il n'existait aucun geste pour le
reprendre, alors que [bpm.md](bpm.md) montre lui-même un morceau (le Bashung) dont le tempo détecté
est faux.

On peut maintenant dire que l'analyse s'est trompée — et le dire au bon endroit.

## La correction appartient au DISQUE, pas au set

Elle vit dans le `song.yaml` du morceau, dans la médiathèque :

```yaml
title: "Osez Joséphine"
artist: "Alain Bashung"
bpm: 87            # l'analyse disait 174
key: "C# minor"    # saisie, jamais détectée
```

**Le test est simple : est-ce que ça change d'un mix à l'autre ?** Un tempo, non — 87 BPM sont
87 BPM dans tous les projets qui jouent ce disque. Une tonalité, non plus. Des REPÈRES, oui : deux
groupes qui reprennent le même morceau posent l'aiguille à des endroits différents, et c'est pour
ça qu'ils sont dans `mix.yaml` ([mixFile.md](../../song-schema/docs/mixFile.md)).

> Ces deux champs ont brièvement vécu dans `mix.yaml`, à côté des repères, au nom d'un raisonnement
> qui sonnait bien — « une grille est une opinion de ce pupitre-là ». Il ne survit pas au test
> ci-dessus. La généralisation venait des repères, où elle est juste, et personne n'avait vérifié
> qu'elle tenait un cran plus loin.

Et pl8 tenait déjà la place : `bpm:` y est **détecté une fois puis édité**, avec une règle qui dit
qu'une valeur présente gagne sur une nouvelle détection — écrite précisément parce que
« l'estimation du moteur descend d'une octave sur du matériel rapide »
([songs.md](../../mediatek/docs/songs.md)). C'est-à-dire exactement l'erreur que `÷2` corrige.

## `bpm` remplace ce que le disque EST

Pas l'étiquette : `Rate = cible / naturel`. Corriger le seul nombre affiché laisserait le plateau
tourner à la mauvaise vitesse en montrant la bonne valeur — le genre de panne qu'on ne trouve pas.

## Ce qu'un fader déjà bougé garde

Corriger le tempo **ne déplace pas un fader que quelqu'un a posé**. Un fader tiré à 176 pour rouler
contre l'autre platine est une décision ; l'analyse qui se corrige n'est pas une raison de la
jeter. Donc :

- fader au repos (`target === natural`) : il **suit** la correction ;
- fader déjà bougé : `natural` change, `target` reste.

Un test le fige, parce que c'est la ligne dont l'inverse s'entendrait en plein set.

## L'octave, qui est l'erreur qu'un détecteur fait vraiment

Sous le fader, `÷2` et `×2`. Ce ne sont pas des raccourcis parmi d'autres : le tempo détecté est
juste **ou faux d'un facteur deux**, presque jamais faux de 3 %. Un morceau à 87 lu comme 174 est
le cas ordinaire, et deux boutons le règlent sans rien taper.

Grisés tant qu'aucun tempo n'est mesuré, et tant qu'il n'y a pas de médiathèque à écrire : il n'y a
alors rien à corriger, et un bouton qui répondrait sur `0` écrirait `bpm: 0`.

L'écriture part vers pl8 **d'abord**, et la valeur locale ne suit qu'une fois acceptée — une
écriture qui échoue laisse donc le fader dire la vérité plutôt qu'un chiffre que personne n'a.

Quand la médiathèque porte un tempo corrigé, un `BPM ✎` apparaît sous les deux boutons. Seulement
alors : un badge toujours là ne dit rien.

## La tonalité, et la roue

`key: "C# minor"` dans le même fichier, **saisie et jamais détectée** : le détecteur a été écrit,
mesuré contre dix-sept morceaux étiquetés, et tombe à 53 % — assez pour mentir, pas assez pour
servir ([key-detection-plan.md](../../../docs/key-detection-plan.md)). Une tonalité saisie est
juste à 100 %, et une playlist fait douze à trente morceaux.

Le pupitre en affiche le code **Camelot** sous le fader — `12A` pour do dièse mineur. Le stockage
garde la tonalité et pas le code : la roue est un RENDU, et garder le rendu perdrait le nom du
mode. La conversion est dans `BpmFader`, et une chaîne qu'elle ne sait pas lire ressort telle
quelle plutôt que de disparaître.

## Ce que ça ne fait pas, et qu'il faut dire

- **Le downbeat ne se corrige pas.** Il reste la réponse du test de Rayleigh sur les transitoires.
  Il appartient lui aussi au disque et pourrait rejoindre `song.yaml` le jour où quelqu'un en a
  besoin ; ce jour n'est pas venu, et un champ que rien ne lit est un champ à remplir pour rien.
- **Le 4/4 reste supposé.** `BEATS_PER_BAR` est une constante, et une signature rythmique ne se
  corrige pas ici — pour la même raison : personne ne la lit.
- **Rien n'est détecté de plus.** Corriger n'est pas mesurer. Une meilleure détection de tempo est
  un travail du moteur, dans la passe qui écrit le sidecar.
- **Rien ne DÉTECTE la tonalité.** Elle se saisit dans la médiathèque ; le pupitre l'affiche et
  n'en devine aucune.
