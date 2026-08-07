# La vue Mix — le pupitre

```
┌───┬──────────┬───────────────────────┬──────────┬───┐
│ ┃ │          │                       │          │ ┃ │
│ ┃ │ PLATINE A│  le set — songs.yaml  │PLATINE B │ ┃ │
│ ┃ │ (vinyle) │  une ligne, A · B     │(vinyle)  │ ┃ │
│ ┃ │ ▁▃▇▅▂▃▇▅ │                       │ ▁▃▇▅▂▃▇▅ │ ┃ │
├───┴──────────┴───────────────────────┴──────────┴───┤
│ SYNC A  Écouter  A ═══╪═══ B  50%  ▶  ⟳     SYNC B  │  10 %
└─────────────────────────────────────────────────────┘
   ↑ les faders BPM, sur le bord extérieur de chaque platine
```

Sous chaque vinyle, la waveform qui défile sous la tête de lecture, beats en jaune et
transitoires en gris — elle a ses propres règles, dans [waveform.md](waveform.md). Sur le
bord extérieur, le fader de tempo, et aux deux bouts de la barre du bas les boutons SYNC :
[bpm.md](bpm.md). **Un clic au centre d'un vinyle** ouvre le sélecteur de morceaux :
[songBrowser.md](songBrowser.md).

Pas d'arbre de fichiers ici. Ce n'est pas que Mix ignore le projet — il joue le `songs.yaml`
de ce projet — c'est que le pupitre veut la largeur. Les fichiers, c'est l'Édition.

## Les vinyles

Un disque en SVG : un dégradé radial (un vrai disque se lit parce que la lumière s'y
déplace), des sillons, et une étiquette au centre qui porte **l'artiste et le titre** de ce
qui est chargé. Vide, l'étiquette dit « platine A » ou « platine B ».

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

Le fader du bas commande le niveau des deux platines, selon la loi **exacte** que le module
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
mouvement, comme les potentiomètres de l8. Renvoyer un projet entier par pixel ferait
diffuser au moteur un document qui ne change que de deux nombres.

## La lecture passe par le compilateur

m9 ne construit plus le document. Il **récupère celui que le projet compile** (`/engine-doc`
sur le service de fichiers), y met les morceaux des platines, et l'envoie par son propre
socket. Ce qui joue est donc le projet : les chaînes, le `sidechainFrom: deckB`, et le graphe
DSP du crossfade **cuit par le compilateur** — 768 octets pour `example.m9`.

Conséquence directe : le crossfader ne bouge plus deux niveaux, il pose `Mix` sur
`deckA:crossfade` — le module de la médiathèque, via la liaison déclarée dans
`views/mix.yaml`. Le câblage en dur a disparu du chemin normal.

`withDecks` ne touche **que** les clips des pistes qui portent une platine chargée. Un
plugin, un send, une automation que le projet déclare restent au projet ; y toucher
remettrait m9 dans le métier de décider ce qu'un set sonne.

**Le tenant-lieu reste**, et c'est délibéré : le temps que la compilation arrive, ou pour un
projet qui ne compile pas, `deckDoc` construit encore deux pistes avec un niveau chacune et
le crossfader déplace les niveaux. Une platine doit pouvoir jouer avant que tout soit prêt ;
c'est l'imitation du set, et elle le dit.

Ce qui ne passe **toujours pas** par un module : le tempo. Le module `tempo` est `offline`,
donc il ne compile vers aucun plugin — vérifié sur `example.m9`, la piste deckA n'a que le
crossfade. L'étirement reste un warp sur le clip que `withDecks` remplit, ce qui est la seule
chose qui s'étire en direct. Le fader `deckA.tempo` est donc une liaison qui se résout puis
n'a personne à qui parler, et m9 le dit.

## Un seul transport

Le moteur n'a **qu'un** transport. Les deux platines sont donc deux pistes d'un même
document, elles démarrent ensemble, et c'est le fader qui choisit ce qu'on entend. Le bouton
lecture du bas est global, et c'est pour ça qu'il est en bas et pas sur chaque platine.

Écouter une platine au casque pendant que l'autre passe demanderait deux transports
indépendants côté moteur. Ce n'est pas là.

## Ce qui attend une place

`ChainsPanel` et `deckGraph` — la chaîne d'effets d'une platine, dessinée — ne sont montés
par rien depuis cette refonte. Gardés parce qu'ils marchent, qu'ils sont testés, et que les
options reviennent ; la platine qu'ils dessinent est un **paramètre** maintenant, ce qui leur
manquait quand il n'y en avait qu'une. Voir l'entrée dans
[docs/inventaire.md](../../../docs/inventaire.md).
