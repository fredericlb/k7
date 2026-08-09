# La waveform des platines

Sous chaque vinyle, une bande qui **défile sous la tête de lecture** : le morceau glisse, la
tête reste au milieu. Ce n'est pas la waveform des autres surfaces du dépôt et ça ne doit pas
le devenir — `@studio/ui-waveform` dessine un morceau **entier** dans une largeur donnée, avec
la tête qui le traverse. Ici c'est l'inverse : une fenêtre de durée fixe, et c'est l'audio qui
bouge. Les deux répondent à deux questions différentes — « à quoi ressemble ce morceau » contre
« qu'est-ce qui arrive dans quatre secondes ».

```
        passé  ←            │            →  à venir
   ▁▂▃▅▇▅▃▂▁▂▃▅▇▇▅▃▁▂▃▅▇▅▃▂│▁▂▃▅▇▅▃▂▁▂▃▅▇▇▅▃▁▂▃▅
   │  ╎  │  ╎  │  ╎  │  ╎  │  ╎  │  ╎  │  ╎  │      │ jaune = beats
                            ▲                        ╎ gris  = transitoires
                       tête de lecture
```

## La fenêtre ne se recadre pas

`window(at)` rend `[at - 4s, at + 4s]`, sans jamais borner aux limites du morceau. Au début,
la moitié gauche est avant zéro et se dessine **vide** ; à la fin, la moitié droite dépasse.
Ce vide est l'information : « on est au tout début », « le morceau va manquer ». Une fenêtre
qui glisserait pour rester dans le fichier déplacerait la tête ailleurs qu'au centre, et
casserait en silence la seule promesse de cette vue.

## Jaune = déduit, gris = mesuré

- **Les transitoires** sont ce que le moteur a réellement détecté, en secondes du fichier,
  dans le sidecar `{fichier}.cache`. On les affiche telles quelles.
- **Les beats** sont une **grille déduite** d'un tempo. Le sidecar donne un BPM ; il ne donne
  pas de *phase*, et rien dans la médiathèque n'en porte — `song.yaml` a un `bpm` qu'on peut
  corriger à la main, pas d'offset de premier temps.

D'où l'ancrage : **la grille est calée sur la première transitoire**. Un morceau qui commence
sur le temps tombe juste ; un morceau avec une intro floue tombera à côté, et c'est assumé.
Une grille calée sur 0 serait fausse pour presque tout ce qui a une amorce. Le jour où un
vrai offset arrive dans le sidecar, `anchor` est le seul argument à changer dans `beatsIn`.

Le gris est plus discret que le jaune bien que ce soit lui qui soit **mesuré** : le jaune est
ce sur quoi on aligne, c'est-à-dire ce qu'on regarde.

**Pas de tempo, pas de grille.** `bpm: 0` est le « je n'ai rien trouvé » du moteur. Aucune
ligne jaune, et la mention « tempo inconnu » dans le coin — parce qu'une grille tracée à 120
au hasard serait un mensonge confiant, et que des lignes absentes sans explication se lisent
comme un bug.

## D'où viennent les données

`GET /mediatek/envelope?path=…` sur le service de fichiers de la machine choisie. C'est
`ensureFileEnvelope` : le sidecar est déjà à côté de l'audio dans le cache, donc c'est une
**lecture** tant que l'empreinte correspond. Sinon — un morceau arrivé sans avoir jamais été
analysé — le moteur de cette machine le calcule, ce qui prend plusieurs secondes ; d'où
« analyse du morceau… » plutôt qu'une bande vide, les deux étant indiscernables autrement.

En JSON et pas les octets bruts du sidecar : c'est un format interne avec une version et une
empreinte dedans, et un navigateur qui le parserait serait une deuxième implémentation de
`readSidecar` qui attendrait de diverger. ~120 ko pour cinq minutes, 8192 seaux.

Un seau couvre une durée qui **dépend de la longueur du morceau** — 8192 seaux quel que soit
le fichier. `bucketAt` en tient compte ; supposer un taux fixe dessinerait un morceau à la
vitesse d'un autre.

## La tête de lecture ne passe pas par React

Le moteur pousse `playhead` plusieurs fois par seconde. Le mettre dans un état React
re-rendrait tout le pupitre — deux waveforms, la liste, les deux platines — pour bouger une
ligne. `useEngine` l'écrit donc dans une **ref**, et le canvas la lit dans sa propre boucle
`requestAnimationFrame`.

Entre deux pushes, la position est **extrapolée** avec l'horloge locale (`playhead + (now -
at)`), sinon un push à 20 Hz donnerait un défilement saccadé à 60 images par seconde. À
l'arrêt, pas d'extrapolation : elle ferait glisser une waveform que personne ne joue.

## Une seule tête pour les deux platines

Le moteur n'a qu'un transport (voir [mix.md](mix.md)), et les deux clips commencent à 0 dans
le document — donc la position du transport EST la position dans chaque morceau, et la même
ref sert les deux bandes. Le jour où les platines auront des transports indépendants, c'est
cette hypothèse-là qui saute.

## Les mesures, en orange plus épais

Une ligne tous les quatre temps, plus large que les jaunes et d'une **teinte différente** : d'un
coup d'œil on compte des mesures, on ne lit pas quel jaune est lequel. Dessinées APRÈS les
temps, donc un temps fort est orange plutôt qu'une ligne jaune bordée d'orange.

**4/4 est supposé, pas détecté.** Rien dans le sidecar ne dit où commence une mesure, et
l'analyse mesure un tempo et non une métrique. Le premier temps de la grille est donc pris pour
un temps fort, et un sur quatre ensuite. Sur le quatre-à-la-mesure qu'une platine joue la
plupart du temps, c'est juste — ou à une rotation près, et une rotation donne quand même une
ligne par mesure pour compter, ce à quoi une barre de mesure SERT. Sur du 3 ou du 7, c'est de la
décoration, et le code le dit plutôt que de faire semblant.

`barsIn` et `beatsIn` passent par la même grille et le même ancrage : une grille de mesures avec
son propre ancrage dériverait contre les lignes jaunes qu'elle est censée souligner. Un test le
fige — chaque barre tombe SUR un temps, jamais entre deux.
