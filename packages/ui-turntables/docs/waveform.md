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

Entre deux pushes, la position est **extrapolée**, sinon un push à 20 Hz donnerait un
défilement saccadé à 60 images par seconde. À l'arrêt, pas d'extrapolation : elle ferait
glisser une waveform que personne ne joue.

Mais extrapoler naïvement (`playhead + (now - at)`) ne suffit pas, et c'est ce que ce canvas
faisait. Les frames n'arrivent pas sur un battement régulier — entre le timer du moteur, le
socket et le parsing, chacune atterrit avec un délai différent — donc se ré-ancrer sur chacune
**recopie cette gigue** dans le défilement : on obtient 60 images par seconde de saccade au
lieu de 20. Le canvas lit maintenant `Deck.drawNow`. Le débit du transport étant CONNU — une seconde par
seconde, fader de pitch compris, puisque celui-ci étire le clip et non le transport — l'horloge
prédit depuis le temps local et n'estime que l'OFFSET, en retenant la frame la moins retardée
d'une fenêtre récente (`@studio/engine-browser/playhead-clock`). La position dessinée est donc
une droite, et un vrai seek fait reculer la fenêtre. Elle décide aussi seule de l'arrêt, ce qui est
pourquoi ce fichier ne teste plus `playing` pour savoir s'il faut extrapoler : les deux ne
peuvent plus être en désaccord sur ce que « à l'arrêt » veut dire.

`drawNow` est pour ce qu'on REGARDE. Ce qui s'écrit — un point de cue, qui mémorise où le doigt
est tombé — lit `Deck.playhead`, l'ancre brute, parce que le lissage échange de la justesse
contre de la continuité. Voir `apps/l8/frontend/docs/playhead.md`.

## Une seule tête pour les deux platines, mais deux horloges

Le moteur n'a qu'un transport (voir [mix.md](mix.md)), donc la même ref sert les deux bandes.

Ce que cette page a longtemps dit ensuite était faux : que la position du transport EST la
position dans chaque morceau, parce que les deux clips commencent à 0. Ils ne commencent pas à
0, et ils ne l'ont jamais tous les deux fait — une platine étirée court à son propre rythme,
une platine synchronisée est retardée pour rejoindre l'autre, et depuis le fader de pitch
chaque clip démarre une marge dans la timeline ([bpm.md](bpm.md)). Dessiner la tête brute
contre l'enveloppe dessinait donc le mauvais endroit du morceau, en silence et seulement une
fois qu'on avait touché à la platine.

La bande convertit maintenant, par le `sourceAt` que le disque et chaque repère utilisent déjà.
Une seule tête, deux horloges de fichier. Le jour où les platines auront des transports
indépendants, c'est la ref partagée qui saute, pas la conversion.

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

## La couleur dit ce qu'il y a DEDANS

Rouge où est la basse, vert dans la voix, bleu sur les cymbales, et les mélanges entre —
le vocabulaire d'une platine classique.

Ce n'était pas une question de dessin : l'enveloppe ne portait que `peak` et `rms`, donc
**aucune** donnée par fréquence. Il a fallu que l'analyse en produise. Le moteur découpe
maintenant le signal en trois bandes pendant qu'il le lit, et écrit `low` / `mid` / `high` dans
le sidecar, dans le même espace de buckets que `peak` — un consommateur indexe les quatre
pareil.

### Le découpage, côté moteur

Deux suiveurs à un pôle, à 200 Hz et 4 kHz, et les trois bandes sont leurs différences :

```
lpLow  += aLow  * (v - lpLow)     // sous 200 Hz
lpHigh += aHigh * (v - lpHigh)    // sous 4 kHz
low = lpLow        mid = lpHigh - lpLow        high = v - lpHigh
```

Complémentaires **par construction** : `low + mid + high` redonne le signal exactement, donc la
couleur d'une colonne ne peut pas inventer d'énergie qu'elle n'a pas. Un dessin n'a pas besoin
de filtres raides — il a besoin que les trois se recomposent.

200 Hz garde le kick et la basse d'un côté ; 4 kHz met les cymbales et le haut d'un charley de
l'autre ; ce qui reste au milieu est là où vivent les voix et la caisse claire.

Des **pics** par bucket et non des RMS, pour la raison qui vaut déjà pour l'enveloppe
principale : un kick est une attaque, et le moyenner sur un bucket est précisément la façon de
perdre ce qu'on voulait montrer.

### Le mélange, côté dessin

**Additif**, et c'est tout le truc. Basse en rouge, médium en vert, aigu en bleu : les mélanger
est de la lumière ordinaire, donc basse+médium donne jaune-orangé, basse+aigu donne violet, et
les trois ensemble donnent blanc. Exactement la palette décrite — et elle sort de l'arithmétique
au lieu d'être une table de cas particuliers que quelqu'un devrait tenir à jour.

Chaque bande est tirée vers sa teinte (le grave vers l'orange, l'aigu vers le violet) mais garde
un apport **faible** dans les deux canaux qu'elle ne possède pas. Une première tentative donnait
beaucoup de vert au rouge et au bleu réunis, et basse+aigu ressortait presque blanc au lieu du
violet attendu : ce qu'une bande apporte aux canaux qui ne sont pas les siens décide si les
mélanges tombent juste.

Normalisé par la bande la **plus forte**, pas par la somme. Ce qu'une waveform colorée dit est
quelle bande DOMINE ici, et ça doit se lire pareil dans un passage calme et dans un fort. Avec
une somme, une colonne qui n'est que basse sortirait au tiers de son intensité et se lirait
comme un brun boueux.

### Ce que ça coûte

Le sidecar passe en **v4**, et la porte de version est chargée de sens : un sidecar plus ancien
a une empreinte qui CORRESPOND — l'audio n'a pas changé — donc sans la bump chaque contrôle de
fraîcheur passerait et le morceau n'obtiendrait jamais ses bandes. Conséquence directe :
**tous** les morceaux déjà analysés sont ré-analysés à la demande.

Un fichier analysé avant v4 n'a pas de bandes du tout. Sa waveform reste dans le gris d'avant —
ce qui se lit comme « pas analysé comme ça » plutôt que comme du silence, et c'est pour ça que
les trois champs sont optionnels de bout en bout.
