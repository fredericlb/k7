# La vue Mix — le pupitre

```
┌───┬──────────────┬───┬───┬──────────────┬───┐
│ ┃ │              │ ◍ │ ◍ │              │ ┃ │
│ ┃ │  PLATINE A   │ ◍ │ ◍ │  PLATINE B   │ ┃ │
│ ┃ │ (rempli à   │ ◍ │ ◍ │ (rempli à    │ ┃ │
│ ┃ │  40%, ● ● )  │ ◍ │ ◍ │  40%, ● ● )  │ ┃ │
│ ┃ │  ▁▃▇▅▂▃▇▅    │ ─ │ ─ │  ▁▃▇▅▂▃▇▅    │ ┃ │
│ ┃ │ ①②③④⑤⑥⑦⑧   │ ⬤ │ ⬤ │ ①②③④⑤⑥⑦⑧    │ ┃ │
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
([filter.md](filter.md)). Sous la waveform, les huit repères — appui court pour y aller, long
pour les poser : [cues.md](cues.md). **Un clic au centre d'un vinyle** ouvre le sélecteur de
morceaux : [songBrowser.md](songBrowser.md). À côté du transport, le métronome, qui n'est
proposé que lorsqu'il n'y a qu'un temps — une seule platine, ou deux synchronisées :
[metronome.md](metronome.md).

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
mouvement, comme les potentiomètres de st0. Renvoyer un projet entier par pixel ferait
diffuser au moteur un document qui ne change que de deux nombres.

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

## Un seul transport

Le moteur n'a **qu'un** transport. Les deux platines sont donc deux pistes d'un même
document, elles démarrent ensemble, et c'est le fader qui choisit ce qu'on entend. Le bouton
lecture du bas est global, et c'est pour ça qu'il est en bas et pas sur chaque platine.

Il n'interdit plus rien. **Chaque platine démarre seule** depuis qu'elle joue par un plateau qui
porte sa propre position — `engine/moteur/docs/turntable.md`. Le bouton du bas reste, et lance les
deux ; chaque platine a le sien à côté de ses repères.

Le bouton du bas n'est donc **plus un bouton de transport** : il lance les deux platines *et* le
transport, et il s'allume sur ce qui TOURNE, pas sur ce que le transport fait. La nuance a coûté une
régression — n'avoir déplacé que le transport allumait le bouton et ne démarrait rien, un plateau
n'en prenant pas les ordres. Un test la fige.

Il n'y a **plus d'exception**. Le keylock en a été une, le disque séparé aussi ; l'un tient sa
hauteur sur le plateau et l'autre est quatre plateaux
(`engine/moteur/docs/turntable.md`). Seule une platine vide n'a pas de bouton, n'ayant rien à lancer.

Il interdit moins qu'on ne croyait, en revanche. Trois choses qui semblaient en demander un second
n'en demandent aucun, parce qu'elles déplacent le **plateau** et non le transport :

- **caler les temps forts** — amener l'esclave sur la grille du maître, ce que fait le sync
  ([bpm.md](bpm.md)) ;
- **poser l'aiguille** — un repère, un needle-drop, un nudge ne bougent que leur platine
  ([scratch.md](scratch.md)) ;
- **écouter au casque** — les deux platines jouent déjà en même temps, il ne manquait qu'une
  seconde sortie ([cue.md](cue.md)).

La position est par plateau : c'est la propriété qui porte les trois.

## Ce qui attend une place

`ChainsPanel` et `deckGraph` — la chaîne d'effets d'une platine, dessinée — ne sont montés
par rien. Gardés parce qu'ils marchent, qu'ils sont testés, et que les options reviennent ; la
platine qu'ils dessinent est un **paramètre**, donc un panneau ouvert sur la platine B
n'étiquette pas ses effets platine A. Voir l'entrée dans
[docs/inventaire.md](../../../docs/inventaire.md).
