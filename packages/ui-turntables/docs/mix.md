# La vue Mix — le pupitre

```
┌───┬──────────────┬───┬────────┬───┬──────────────┬───┐
│ ┃ │              │ ◍ │ ▮▯  ▮▯ │ ◍ │              │ ┃ │
│ ┃ │  PLATINE A   │ ◍ │ ▮▯  ▮▯ │ ◍ │  PLATINE B   │ ┃ │
│ ┃ │ (rempli à   │ ◍ │ ▮█  ▮█ │ ◍ │ (rempli à    │ ┃ │
│ ┃ │  40%, ● ● )  │ ◍ │ ▮█  ▮█ │ ◍ │  40%, ● ● )  │ ┃ │
│ ┃ │  ▁▃▇▅▂▃▇▅    │ ─ │  A   B │ ─ │  ▁▃▇▅▂▃▇▅    │ ┃ │
│KEY│ ①②③④⑤⑥⑦⑧   │A ═════╪═════ B│ ①②③④⑤⑥⑦⑧    │KEY│
│ ▶ │   titre      │   │  50%   │   │   titre      │ ▶ │
├───┴──────────────┴───┴────────┴───┴──────────────┴───┤
│ SYNC A ↺ ⟳ Écouter    🎧A 🎧B ♩ ⟳ ▬▬▬· ↺ ⟳ SYNC B │
└──────────────────────────────────────────────────────┘
   ↑ le fader BPM, bord extérieur   ↑ la tranche, bord intérieur :
      puis KEY et le ▶ de CETTE       TRIM, 3 potards d'EQ, le filtre,
      platine, deux blocs égaux       et l'écho quand il est câblé
```

Au **milieu**, les deux faders de voie avec leur vumètre, et le crossfader dessous : c'est la
disposition d'une table de mixage, et c'est ce que cette colonne attendait — elle ne portait
qu'un slider et trois espaceurs.

Sous chaque vinyle, la waveform qui défile sous la tête de lecture, beats en jaune et
transitoires en gris — elle a ses propres règles, dans [waveform.md](waveform.md). Sur le
bord extérieur, le fader de tempo, et aux deux bouts de la barre du bas les boutons SYNC :
[bpm.md](bpm.md). Sur le bord intérieur, la tranche : le trim, l'EQ ([eq.md](eq.md)), le filtre
([filter.md](filter.md)) et l'écho ([fx.md](fx.md)). Sous la waveform, les huit repères — appui
court pour y aller, long pour les poser : [cues.md](cues.md). **Un clic au centre d'un vinyle**
ouvre le sélecteur de morceaux : [songBrowser.md](songBrowser.md). Dans la barre du bas, le
métronome, qui n'est proposé que lorsqu'il n'y a qu'un temps — une seule platine, ou deux
synchronisées : [metronome.md](metronome.md) — le vumètre du master, et par platine les deux
boutons momentanés, censor et echo-out ([fx.md](fx.md)).

Pas d'arbre de fichiers ici. Ce n'est pas que Mix ignore le projet — il joue la playlist que la
surface de ce projet nomme — c'est que le pupitre veut la largeur. Les fichiers, c'est
l'Édition.

## La disposition

Deux platines qui se font face, et rien entre elles. Chacune porte son **tempo sur le bord
extérieur** et sa **tranche sur le bord intérieur** — trois potards d'EQ puis le filtre, à la
verticale. Les deux tranches se regardent donc de part et d'autre du milieu : le pupitre se lit
comme un miroir plutôt que comme une répétition, et une main sait sur quelle platine elle est
sans lever les yeux.

Aucune liste de morceaux au milieu : on choisit un morceau **au disque lui-même**, en cliquant
le centre du vinyle, ce qui est déjà la façon dont on charge une platine (voir
[songBrowser.md](songBrowser.md)). Une colonne qui répéterait ce que le disque sait déjà
prendrait la place que les platines veulent. Les cartes d'erreur sont un bandeau au-dessus des
platines, et ne s'affichent que quand quelque chose ne va pas.

## Les vinyles

Un disque en SVG : un dégradé radial (un vrai disque se lit parce que la lumière s'y
déplace), des sillons, et une étiquette au centre qui porte **l'artiste et le titre** de ce
qui est chargé. Vide, l'étiquette dit « platine A » ou « platine B ».

Le disque **se remplit** au fil du morceau — vide à 0 %, plein à 100 % — et porte les repères
en cercles, chacun dans la couleur de son bouton. Les deux vivent sur une couche qui ne tourne
PAS, et sont redessinés par frame plutôt que par React : [vinyl.md](vinyl.md).

Le disque tourne quand le transport tourne **et** que cette platine tient quelque chose.
Deux détails qui ne sont pas décoratifs :

- **Un sillon plus clair, en pointillé**, décalé dans la pile. Un disque parfaitement
  uniforme qui tourne a l'air parfaitement immobile ; c'est ce sillon-là qui rend la
  rotation visible.
- **L'étiquette ne tourne pas.** Sur une vraie platine si, mais un titre qu'il faut suivre
  de la tête se lit mal — les logiciels de DJ font le même compromis.

`prefers-reduced-motion` arrête l'animation : un disque qui tourne en boucle est exactement
ce que ce réglage vise, et la platine reste lisible à l'arrêt.

L'artiste vient des tags du morceau ; à défaut — un morceau pas encore dans le cache, donc
sans sidecar à lire — du **deuxième segment de l'id** (`songs/<artiste>/<album>/<titre>`),
qui est le dossier sous lequel la médiathèque l'a rangé. Ce n'est pas une devinette.

## Le crossfade

### Il est ENTRE les deux platines, d'un rang de repères à l'autre

Pas en bas. Un crossfader passe d'une platine à l'autre, et le geste se lit s'il a lieu **dans
l'espace qui les sépare** — la main va de A vers B et le fader va dans le même sens, à la même
hauteur que les repères qu'elle vient de quitter.

**En hauteur**, il tient cette ligne sans rien mesurer : sa colonne **répète les pièces** de la
colonne d'à côté — une rangée de la hauteur du disque, puis une de la hauteur de la waveform, puis
lui. Les trois valeurs viennent du même `deskLayout` que les platines lisent, donc les trois lignes
ne peuvent pas se désaligner ([deskLayout.md](deskLayout.md)).

**En largeur**, il va de la droite des repères de A à la gauche de ceux de B — donc il dépasse sa
propre colonne, par-dessus les deux tranches. C'est un débord assumé (`CROSSFADE_BLEED`), et la
valeur n'est pas devinée : c'est le `gap-4` de la rangée, la tranche (`w-16`) et le `gap-2` de la
platine, soit exactement la distance du bord de cette colonne au bord d'un rang de repères. Les
tranches centrent leurs potards verticalement, donc à la ligne des repères il n'y a rien sous le
fader.

> La seule colonne où ça se dispute est une colonne **si courte** que la tranche remplit toute sa
> hauteur — l'échelle de `stripLayout` choisissant alors son plus petit cran sans y arriver. C'est
> le même cas que `deskLayout` traite déjà en laissant la waveform déborder, et il est déjà
> inutilisable pour d'autres raisons.

Le pourcentage sous le fader suit la même règle que le titre : il ne gagne sa ligne que dans une
colonne assez haute (`layout.title`). Lui ne déborde pas — il reste centré sur la colonne.

### La loi

Le fader commande le niveau des deux platines, selon la loi **exacte** que le module
`crossfade` du projet écrit dans son `jsdsp.ts` :

```
gain(A) = 1 - mix        gain(B) = mix
```

Gain constant, pas puissance constante : ça creuse d'environ 3 dB au centre pour deux
sources décorrélées. C'est la forme connue d'un fondu à gain constant, pas un bug — la
puissance constante demande une racine carrée, et le module n'a pas cette primitive.

Le `Volume` d'une tranche est en **décibels** (−60 à +6, 0 = unité), jamais en 0..1 : une
surface qui enverrait 0,5 pour « moitié » aurait l'air de marcher et se tromperait de six
décibels. `VOLUME_DB` dit la plage, `gainToDb` fait la conversion, et le silence est le
**plancher** et non −∞ — un fader a un bas.

Bouger le fader n'envoie **pas** un document : c'est `set-plugin-param`, un message par
mouvement, comme les potentiomètres de st0. Renvoyer un projet entier par pixel ferait
diffuser au moteur un document qui ne change que de deux nombres.

## La tranche est une table de mixage, pas trois EQ

Le crossfader n'est **pas** la commande de niveau d'une platine, et pendant longtemps il a été
la seule. C'est le manque que cette page décrivait : on pouvait fondre A vers B, et rien
d'autre. L'essentiel des transitions se fait à la **voie**.

Trois choses ont été ajoutées, et elles se lisent dans l'ordre du signal :

```
deckA ─┐
stems ─┼→ trimA → eqA → filterA ─┬→ levelA → echoA → fadeA → MIX → OUT
       ┘                          └→ cueA → CUE
        ↑ le gain d'entrée         ↑ le fader de voie    ↑ le crossfade
```

### Le trim est en TÊTE, et la raison n'est pas le goût

Une platine est **cinq lanes** — le disque, et une par stem séparé — qui se rejoignent sur un
bus ([stems.md](stems.md)). Un trim posé sur la lane du disque ne ferait donc **rien du tout**
sur un morceau séparé, dont les quatre parties jouent à la place du disque. En tête du bus, il
les atteint toutes les cinq.

Conséquence à connaître : c'est le trim qui **nomme la chaîne** maintenant, donc les plugins
d'une tranche sont adressés `trimA:eqA` et non plus `eqA:eqA`, et `bus_only:` nomme `trimA`.
Nommer l'EQ y désignerait une ÉTAPE au lieu d'une tête, et le chemin sec reviendrait
([busOnly.md](../../song/docs/busOnly.md)). `migrateSetStrip` porte ce renommage.

Ce qu'il sert : **rien ici ne normalise la loudness**. Deux morceaux gravés à dix ans d'écart
n'arrivent pas au même niveau, et le trim est ce qui les met d'accord pour que 0 dB sur les deux
faders de voie veuille dire la même chose.

### Le fader de voie, et pourquoi le cue passe AVANT

`levelA` est en **décibels** (−60 à +6, 0 = unité), comme tout niveau ici et pour la même
raison : une surface qui enverrait 0,5 pour « moitié » se tromperait de six décibels. Le bas de
la course est le **silence** et non −∞ — un fader a un bas.

Le départ casque est branché sur `filterA`, donc **avant** ce fader : baisser une voie ne doit
pas la retirer de vos oreilles, alors que couper sa basse doit s'entendre au casque avant la
salle. C'est la définition du pre-fade listen ([cue.md](cue.md)).

## Les vumètres

Ils viennent du moteur sans rien coûter : la trame d'état porte déjà `levels[]` par piste,
`master` et `masterClipped`, vingt fois par seconde. Ce qui manquait n'était pas la mesure,
c'était de la dessiner.

**Par voie, le vumètre est PRE-fader.** Il lit la piste de la tranche — celle que la liaison
`deckA.trim` adresse, donc `trimA` — c'est-à-dire après l'EQ et le filtre et **avant** le fader
de voie. C'est ce qu'il faut pour régler un trim : on le monte jusqu'à ce que le vumètre
approche du haut, fader baissé, et seulement ensuite on ouvre la voie. Un vumètre post-fader
mesurerait ce qu'on a décidé d'envoyer, pas ce qu'on a à envoyer.

**Le master, lui, est post-tout**, dans la barre du bas : c'est le seul qui répond du mélange,
et le seul endroit où l'on voit qu'on écrête. Son témoin rouge **tient** — l'écrêtage est
rapporté pour une fenêtre de 50 ms, et une lampe qui ne dirait la vérité que pendant ce
temps-là est une lampe que personne ne voit.

L'échelle et les deux règles de mémoire (`meterFill`, `clipLatch`, `peakHold`) sont dans
`@studio/engine-browser/meter`, partagées avec le vumètre d'en-tête de st0 : deux copies de
« la lampe est-elle encore allumée » sont deux réponses.

Chaque barre **s'abonne pour elle-même** au store, et se dessine par `transform` plutôt que par
une largeur : une trame toutes les 50 ms qui remonterait jusqu'au pupitre le redessinerait vingt
fois par seconde pour bouger huit pixels.

Un hôte qui ne fournit **aucun** store est prévu : les barres restent au plancher au lieu de
faire échouer la vue. C'est ce que `SILENT` est — un store jamais écrit, pour que les hooks
restent inconditionnels.

### Deck B est MUTÉE, et ce n'est pas optionnel

La ligne dont l'absence fait passer le crossfader pour mort — alors que ce n'est pas le
crossfader.

`out` compile comme un chemin **parallèle** : le signal sec continue vers le master à côté du
module qu'il alimente, c'est ce qui fait qu'un send est un send. Deck B n'alimente que le
second port du crossfade, donc non mutée elle atteint le master aussi : entendue une fois
brute et une fois à travers le module, et pousser le fader vers deck A ne l'enlève pas.
Tous les réglages sonnent pareil.

Ça marche parce que le nœud de mute de Tracktion laisse **délibérément** passer les clips vers
les sends et les sidechains : le crossfade garde son second signal, le master cesse d'avoir un
doublon. Voir `engine/moteur/docs/sidechain.md`.

Mesuré sur le document compilé d'`example.st0`, deux morceaux de 20 s, en rendant deck A seule
comme référence :

| rendu | niveau | résidu contre deck A seule |
|---|---|---|
| Mix = 0, deck B mutée | −20,32 dBFS | **−120 dBFS** — identique |
| Mix = 1 | −23,26 dBFS | −18,55 dBFS — l'autre morceau |
| Mix = 0, deck B **non** mutée | −18,51 dBFS | **−23,26 dBFS** |

La dernière ligne est le symptôme : à Mix = 0, deck B est encore là, exactement à son propre
niveau. `scaffoldSet` écrit le mute, et un test le fige.

## La lecture passe par le compilateur

Le pupitre ne construit pas le document : il **récupère celui que le projet compile** (`/engine-doc`
sur le service de fichiers), y met les morceaux des platines, et l'envoie par son propre
socket. Ce qui joue est donc le projet : les chaînes, le `sidechainFrom: deckB`, et le graphe
DSP du crossfade **cuit par le compilateur** — 768 octets pour `example.st0`.

Conséquence directe : le crossfader ne bouge pas deux niveaux, il pose `Mix` sur
`deckA:crossfade` — le module de la médiathèque, via la liaison déclarée dans
`views/mix.yaml`. Rien n'est câblé en dur sur ce chemin.

`withDecks` ne touche **que** les clips des pistes qui portent une platine chargée. Un
plugin, un send, une automation que le projet déclare restent au projet ; y toucher
remettrait le pupitre dans le métier de décider ce qu'un set sonne.

**Un tenant-lieu existe**, et c'est délibéré : le temps que la compilation arrive, ou pour un
projet qui ne compile pas, `deckDoc` construit deux pistes avec un niveau chacune et
le crossfader déplace les niveaux. Une platine doit pouvoir jouer avant que tout soit prêt ;
c'est l'imitation du set, et elle le dit.

Le tempo passe par son module lui aussi, par l'autre chemin. `tempo` est `offline` : aucun
plugin, donc rien à qui poser un paramètre — mais `offline` ne veut pas dire « ne fait rien »,
il veut dire « rendu vrai hors du graphe ». Ce qu'une liaison vers un tel module désigne, c'est
la PISTE dont il traite la matière, et l'étirement est un warp sur le clip que `withDecks` y
remplit — ce que Tracktion fait en direct. Voir [bpm.md](bpm.md).

## Un seul transport, et plus aucun bouton pour lui

Le moteur n'a **qu'un** transport, et il ne reste **rien de la musique dessus** : chaque platine
est un plateau qui porte sa propre position (`engine/moteur/docs/turntable.md`), et le seul
habitant de cette timeline est le clip du métronome ([metronome.md](metronome.md)).

D'où la conséquence, qui est une SUPPRESSION : **le pupitre n'a plus de bouton de transport.**
Ni celui du bas, qui lançait les deux platines, ni ceux de l'en-tête de st0, qui sont masqués tant
que la surface Mix est seule à l'écran. Ils ne commandaient plus que le clic, en le présentant
comme la lecture — et un bouton qui a l'air de lancer la musique sans la lancer est pire qu'aucun
bouton.

Ce qui les remplace : **chaque platine démarre seule**, par son ▶ au pied de sa colonne de tempo,
sous KEY. C'est la colonne des choses qui appartiennent à cette platine seule, et démarrer en est
une. Les deux boutons y font la même hauteur, parce qu'une main les cherche sans regarder.

Et le transport **suit** : dès qu'une platine tourne il roule depuis zéro, quand plus aucune ne
tourne il s'arrête. C'est ce qui garde le métronome audible sans lui rendre un bouton — le clic
appartient à la musique, pas à une commande séparée. La règle vit dans `useDeckSet`, en un seul
effet, plutôt que dans chaque geste qui démarre une platine.

Ce que ça n'enlève pas : dans un projet qui déclare AUSSI une timeline ou un viewport, l'en-tête
garde son transport dès que l'un des deux est à l'écran. Il y commande alors quelque chose qu'on
voit.

Il n'y a **plus d'exception** au démarrage par platine. Le keylock en a été une, le disque séparé
aussi ; l'un tient sa hauteur sur le plateau et l'autre est quatre plateaux.

Une platine **vide** garde son bouton, **grisé**. C'est la règle que les repères énoncent déjà
([cues.md](cues.md)) : grisé dit « pas encore », absent dit « cherche-le ». Elle est devenue
visible en déplaçant le bouton au pied de la colonne de tempo — caché dans la rangée des repères,
son absence ne laissait pas de trou ; sous KEY, elle en laisse un, et on lit ça comme une panne.

Il interdit moins qu'on ne croyait, en revanche. Trois choses qui semblaient en demander un second
n'en demandent aucun, parce qu'elles déplacent le **plateau** et non le transport :

- **caler les temps forts** — amener l'esclave sur la grille du maître, ce que fait le sync
  ([bpm.md](bpm.md)) ;
- **poser l'aiguille** — un repère, un needle-drop, un glissement de bande ne bougent que leur
  platine ([scratch.md](scratch.md)) ;
- **écouter au casque** — les deux platines jouent déjà en même temps, il ne manquait qu'une
  seconde sortie ([cue.md](cue.md)).

La position est par plateau : c'est la propriété qui porte les trois.

## Sous les repères, la rangée des boucles

Une rangée de plus dans chaque colonne : saut de temps `◀ ▶`, `IN` / `OUT` manuels, les trois
longueurs `4 8 16`, `÷2` et `×2` de part et d'autre de la longueur en cours, et `⟲` qu'on
**maintient** pour un roulement. Grisée sans tempo mesuré, comme les repères sont grisés sans
disque — une boucle est une longueur en *temps*.

Elle **ne tombe pas** quand la colonne se serre. Le disque part le premier, le titre ensuite ; la
rangée des boucles reste, parce qu'un pupitre qui ne boucle pas est exactement ce qu'elle est venue
réparer. Le quantise, lui, est dessiné **une seule fois**, sous le crossfader : il vaut pour les
deux platines, et deux boutons toujours d'accord diraient moins qu'un.

Tout le raisonnement — pourquoi c'est dans le plateau et plus dans un clip, et l'ordre des
paramètres qui déplace le disque si on l'inverse — est dans [loop.md](loop.md).

## Ce qui attend une place

`ChainsPanel` et `deckGraph` — la chaîne d'effets d'une platine, dessinée — ne sont montés
par rien. Gardés parce qu'ils marchent, qu'ils sont testés, et que les options reviennent ; la
platine qu'ils dessinent est un **paramètre**, donc un panneau ouvert sur la platine B
n'étiquette pas ses effets platine A. Voir l'entrée dans
[docs/inventaire.md](../../../docs/inventaire.md).
