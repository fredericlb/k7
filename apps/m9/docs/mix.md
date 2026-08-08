# La vue Mix — le pupitre

```
┌───┬──────────────┬───┬───┬──────────────┬───┐
│ ┃ │              │ ◍ │ ◍ │              │ ┃ │
│ ┃ │  PLATINE A   │ ◍ │ ◍ │  PLATINE B   │ ┃ │
│ ┃ │  (vinyle)    │ ◍ │ ◍ │  (vinyle)    │ ┃ │
│ ┃ │  ▁▃▇▅▂▃▇▅    │ ─ │ ─ │  ▁▃▇▅▂▃▇▅    │ ┃ │
│ ┃ │              │ ⬤ │ ⬤ │              │ ┃ │
├───┴──────────────┴───┴───┴──────────────┴───┤
│ SYNC A  Écouter  A ═══╪═══ B  50%  ▶  ⟳  SYNC B │  10 %
└─────────────────────────────────────────────┘
   ↑ le fader BPM, bord extérieur   ↑ la tranche, bord intérieur :
                                      3 potards d'EQ, un trait, le filtre
```

Sous chaque vinyle, la waveform qui défile sous la tête de lecture, beats en jaune et
transitoires en gris — elle a ses propres règles, dans [waveform.md](waveform.md). Sur le
bord extérieur, le fader de tempo, et aux deux bouts de la barre du bas les boutons SYNC :
[bpm.md](bpm.md). Sur le bord intérieur, la tranche : l'EQ ([eq.md](eq.md)) et le filtre
([filter.md](filter.md)). **Un clic au centre d'un vinyle** ouvre le sélecteur de morceaux :
[songBrowser.md](songBrowser.md).

Pas d'arbre de fichiers ici. Ce n'est pas que Mix ignore le projet — il joue le `songs.yaml`
de ce projet — c'est que le pupitre veut la largeur. Les fichiers, c'est l'Édition.

## La disposition

Deux platines qui se font face, et rien entre elles. Chacune porte son **tempo sur le bord
extérieur** et sa **tranche sur le bord intérieur** — trois potards d'EQ puis le filtre, à la
verticale. Les deux tranches se regardent donc de part et d'autre du milieu : le pupitre se lit
comme un miroir plutôt que comme une répétition, et une main sait sur quelle platine elle est
sans lever les yeux.

La liste des morceaux occupait le milieu. Elle n'y est plus : on choisit un morceau **au disque
lui-même**, en cliquant le centre du vinyle, ce qui est déjà la façon dont on charge une platine
(voir [songBrowser.md](songBrowser.md)). Une colonne qui répétait ce que le disque sait déjà
prenait la place que les platines voulaient. Ce qui reste au milieu ne s'affiche que quand
quelque chose ne va pas — les cartes d'erreur, désormais en bandeau au-dessus des platines.

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

### Deck B est MUTÉE, et ce n'est pas optionnel

La ligne dont l'absence fait passer le crossfader pour mort — et ce n'était pas le
crossfader.

`out` compile comme un chemin **parallèle** : le signal sec continue vers le master à côté du
module qu'il alimente, c'est ce qui fait qu'un send est un send. Deck B n'alimente que le
second port du crossfade, donc non mutée elle atteignait le master aussi : entendue une fois
brute et une fois à travers le module, et pousser le fader vers deck A ne l'enlevait pas.
Tous les réglages sonnaient pareil.

Ça marche parce que le nœud de mute de Tracktion laisse **délibérément** passer les clips vers
les sends et les sidechains : le crossfade garde son second signal, le master cesse d'avoir un
doublon. Voir `engine/moteur/docs/sidechain.md`.

Mesuré sur le document compilé d'`example.m9`, deux morceaux de 20 s, en rendant deck A seule
comme référence :

| rendu | niveau | résidu contre deck A seule |
|---|---|---|
| Mix = 0, deck B mutée | −20,32 dBFS | **−120 dBFS** — identique |
| Mix = 1 | −23,26 dBFS | −18,55 dBFS — l'autre morceau |
| Mix = 0, deck B **non** mutée | −18,51 dBFS | **−23,26 dBFS** |

La dernière ligne est le bug : à Mix = 0, deck B est encore là, exactement à son propre
niveau. `scaffoldM9` écrit le mute désormais, et un test le fige.

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

Le tempo passe par son module lui aussi, par l'autre chemin. `tempo` est `offline` : aucun
plugin, donc rien à qui poser un paramètre — mais `offline` ne veut pas dire « ne fait rien »,
il veut dire « rendu vrai hors du graphe ». Ce qu'une liaison vers un tel module désigne, c'est
la PISTE dont il traite la matière, et l'étirement est un warp sur le clip que `withDecks` y
remplit — ce que Tracktion fait en direct. Voir [bpm.md](bpm.md).

## Un seul transport

Le moteur n'a **qu'un** transport. Les deux platines sont donc deux pistes d'un même
document, elles démarrent ensemble, et c'est le fader qui choisit ce qu'on entend. Le bouton
lecture du bas est global, et c'est pour ça qu'il est en bas et pas sur chaque platine.

Écouter une platine au casque pendant que l'autre passe demanderait deux transports
indépendants côté moteur. Ce n'est pas là.

Caler les temps forts, en revanche, **n'en demande pas** — et cette page a longtemps prétendu
le contraire. On ne décale pas le transport, on décale le **clip** : `start` est par clip, et
retarder l'esclave de moins d'un temps suffit. C'est ce que fait le sync maintenant, voir
[bpm.md](bpm.md).

## Ce qui attend une place

`ChainsPanel` et `deckGraph` — la chaîne d'effets d'une platine, dessinée — ne sont montés
par rien depuis cette refonte. Gardés parce qu'ils marchent, qu'ils sont testés, et que les
options reviennent ; la platine qu'ils dessinent est un **paramètre** maintenant, ce qui leur
manquait quand il n'y en avait qu'une. Voir l'entrée dans
[docs/inventaire.md](../../../docs/inventaire.md).
