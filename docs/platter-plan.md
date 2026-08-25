# Plan — le plateau étire lui-même, et l'hybride disparaît

Une page de PLAN, comme [module-builder-plan.md](module-builder-plan.md) : elle dit où on va et
pourquoi, et elle s'efface quand elle est faite. L'état actuel, lui, est décrit par les pages
ordinaires — `engine/moteur/docs/turntable.md`, `packages/ui-turntables/docs/scratch.md`.

## Où on en est

Une platine joue par un **plateau** (`TurntablePlugin`) qui possède son disque et le lit à une
position qu'il porte lui-même. D'où, gratuitement : le scratch, le démarrage par platine, et des
repères qui ne déplacent plus l'autre platine.

Il reste **un** cas où elle repasse sur des clips étirés de la timeline : un **disque séparé en
stems**, décidé sur un coût qui s'est révélé faux — voir plus bas. KEY en était un second et n'en est
plus un.

C'est ce qu'on appelle ici **l'hybride**, et il coûte cher : deux modèles de position, donc **deux
implémentations de chaque geste** — repère, scrub, nudge, sync. `onPlatter(load)` est le prédicat qui
tranche, et il DOIT être posé par le document et par le pupitre à l'identique. L'avoir posé plus
étroitement d'un côté a donné une waveform figée avec du son dedans.

## Ce qu'on va faire

Mettre `tracktion::engine::TimeStretcher` **dans le plateau**, et supprimer l'hybride.

```
lecture, KEY allumé   -> l'étireur, ratio natural/target : la hauteur tient
lecture, KEY éteint   -> rééchantillonnage, comme aujourd'hui
SCRATCH               -> rééchantillonnage TOUJOURS, étireur contourné
```

Le troisième point n'est pas un compromis : **un scratch doit changer de hauteur**, c'est le son du
geste, et aucune platine ne fait autrement.

Ce qui rend ça possible sans le défaut de l'hybride : la bascule est **interne au plugin**, donc
instantanée. Basculer de représentation (clip ↔ plateau) coûtait un renvoi de document — 85 ms
mesurés — ce qui tue le geste. Contourner un étireur ne coûte rien.

## L'étape 1 est FAITE

Le plateau porte un paramètre `Key`, et les trois régimes ci-dessus sont mesurés :
`engine/moteur/scripts/keylock.ts`, les chiffres dans `engine/moteur/docs/turntable.md`. La hauteur
tient à 1000 Hz pendant que la période suit le débit ; le rééchantillonnage, lui, déplace les deux.

Trois choses que le plan disait mal :

- **Ce n'est pas Elastique, c'est SoundTouch.** C'est le seul backend compilé ici
  (`TRACKTION_ENABLE_TIMESTRETCH_SOUNDTOUCH`) — Elastique et RubberBand demandent leurs propres
  bibliothèques. `checkModeIsAvailable` est donc INTERROGÉ plutôt que nommé.
- **Un saut ne fait pas de trou.** 81 ms de silence après un `Seek` dans les deux modes, soit les
  80 ms qu'une salve tait de toute façon. La difficulté 1 n'existe pas.
- **L'étireur ne retarde rien non plus.** Ce qu'il fait, c'est lire EN AVANCE : il avale 60 ms de
  disque avant de rendre le premier échantillon. L'audio n'est pas en retard, mais l'aiguille
  rapportée l'était de 65,6 ms — et un repère se pose sur ce nombre. Le plateau retranche cette
  avance ; il reste 4,9 ms contre 1,7 en rééchantillonnage. La difficulté 4 était mal posée.

Et une leçon de banc à ne pas reperdre : **la période d'une salve se lit par autocorrélation, pas en
comptant les fronts.** Un étireur recolle, donc sa sortie creuse au milieu d'une salve et chaque creux
est un faux front — ça rapportait la moitié de la période et aucune dépendance au débit. Ce sont les
lignes en rééchantillonnage, exactes elles, qui ont désigné le banc plutôt que le moteur.

## L'étape 2 est FAITE

Le pupitre allume `Key` au lieu de repasser sur un clip, et l'éteint tant qu'une main tient le disque.
La règle est écrite une fois, `platterKey(tempo, holding)`, et lue par le document comme par le geste.
`onPlatter` ne demande plus qu'une chose : le disque est-il séparé.

La difficulté qu'on redoutait — *le raccord étiré → varispeed quand la main saisit* — **ne s'est pas
présentée**, et il vaut mieux dire pourquoi que se féliciter : le moteur retombe déjà sur le
rééchantillonnage hors de la plage de l'étireur, donc le pupitre et le plugin disent la même chose
par deux chemins, et une bascule interne au plugin ne change ni la position ni le disque. Il reste à
l'ÉCOUTER : que le raccord ne saute pas est un jugement qu'aucun banc ne rend.

**Et un vrai bug trouvé au passage, sur le chemin par défaut.** `platterRate` renvoyait
`natural / target` — l'ÉTIREMENT, ce que veut le warp d'un clip — là où un débit est son inverse. Un
morceau à 120 qu'on poussait à 140 recevait 0,86 et **ralentissait** : le fader de pitch d'un plateau
tournait à l'envers. Le chemin par clip, lui, était juste depuis le début, et c'est ce qui tranche.
Le test qui couvrait ça affirmait la valeur inversée, et son propre commentaire la contredisait.

## L'étape 3 est FAITE

Les quatre parties d'un disque séparé sont quatre **plateaux**. Elles partagent une position, un
débit et un `Key` ; `plattersOf(deck, load)` les nomme, et `place`, `scratch` et l'aiguille passent
par cette liste. **Plus rien ne joue par un clip** — la branche clip de `withDecks` a disparu, et
avec elle le second modèle de position.

Le chiffre du plan était juste, et il est maintenant rejouable
(`packages/ui-turntables/scripts/put-on.ts`, qui chronomètre la réponse `applied`) :

| poser un disque sur une platine qui en tient déjà un | simple | séparé | surcoût |
|---|---|---|---|
| 2 minutes | 21 ms | 102 ms | **+81 ms** |
| 4 minutes | 42 ms | 200 ms | **+157 ms** |

Ça suit la longueur, donc à la longueur d'un vrai morceau c'est **un cinquième de seconde**, au-delà
des ~100 ms où un geste se sent comme un à-coup. C'est payé sur la platine qu'on CHARGE, qui par
définition n'est pas celle qui joue.

Deux inquiétudes levées au passage :

- **Le CPU n'en est pas une.** Huit plateaux coûtent ~30 % d'un cœur, et allumer KEY sur les huit —
  donc huit étireurs — en ajoute **3 points**.
- **Les stems ne sont pas des fichiers float.** `wavPcm24` écrit du 24 bits ENTIER, donc les quatre
  parties passent par la lecture directe du moteur. J'avais écrit le contraire dans `turntable.md` ;
  un banc qui les écrivait en float mesurait 192 ms au lieu de 102, ce qui chiffre l'erreur.

## Ce que ça efface

- le mode clip d'une platine, et donc `onPlatter`
- **tout le lot slip** : il devient du code mort, à supprimer et non à garder « au cas où »
- la limite « un disque séparé ne se scratche pas », et sa page

## La décision à rouvrir en même temps

Les stems restent sur des clips à cause d'un chiffre que j'avais mal lu. Ce que j'avais présenté —
441 ms contre 267 — était un apply **à froid sur un moteur vide**, c'est-à-dire le chargement de la
page, une fois. Le geste réel, poser un disque sur une platine qui en tient déjà un :

| | |
|---|---|
| un disque simple | 85 ms |
| un disque séparé (4 plateaux) | 166 ms |
| **surcoût** | **81 ms** |

81 ms, sous le seuil où un geste se sent comme un à-coup. Et depuis le passage en 16 bits, quatre
plateaux tiennent dans 199 Mo. **Donc les stems vont sur des plateaux**, et les quatre parties
partagent une position, un `Rate` et un sync — le même code, appliqué aux lanes.

L'argument du commit `7404ce67` joue dans le même sens : un étirement à hauteur constante est non
linéaire, donc quatre parties étirées séparément se recollent moins bien, tandis que le
rééchantillonnage est linéaire. **Un scratch en varispeed sur des stems est donc plus juste qu'un
tempo en keylock sur des stems.**

## L'ordre

1. ~~`TimeStretcher` dans le plateau, KEY allumé le branche — mesurer la latence et le clic d'un
   saut.~~ **Fait**, voir plus haut.
2. ~~Le pupitre allume `Key` au lieu de repasser sur un clip, et l'éteint pendant qu'une main tient
   le disque.~~ **Fait**, voir plus haut.
3. ~~Les stems passent sur des plateaux.~~ **Fait**, voir plus haut.
4. ~~Supprimer le lot slip et leurs pages.~~ **Fait**, voir ci-dessous.

Les trois premières sont mesurées ; la quatrième est une suppression.

## L'étape 4 est FAITE

Sont partis : `slipToPlace`, `slipAfter`, `startSeconds`, `clipStartBeats`, `warpFor`,
`TIMELINE_BASE`, `playFrom`, `transportAt`, `sourceAt`, `alignDelay`, les champs `slip` et `align`
d'un `DeckTempo`, et `KEYLOCK_ALGORITHM` / `VARISPEED_ALGORITHM`. `nudgedTempos` ne fait plus que
poser une cible ; `syncedTempos` ne fait plus que la donner à l'esclave, `alignSeek` s'occupant des
temps depuis l'étape 3.

Trois choses que le plan n'avait pas listées, et qui tombaient avec :

- **`align` autant que `slip`.** Le retard en temps de timeline n'avait plus qu'un lecteur — le
  début du clip qui n'existe plus. `alignDelay` est parti avec lui, `alignSeek` restant.
- **`playFrom` et la marge.** PLAY partait à dix minutes parce que la musique y était. Elle n'y est
  plus : le transport repart de zéro, dans le pupitre comme dans st0, et la ligne du bouton
  « retour au début » qui traitait un set à part a simplement disparu.
- **Trois bancs sur quatre.** `tempo-drag.ts` mesurait la correction, `metronome.ts` la phase
  qu'elle portait, `scratch-drag.ts` le déplacement de clip lui-même. Aucun ne pose plus une
  question qui ait une réponse. Leurs chiffres sont conservés là où ils décident encore quelque
  chose : `docs/bpm.md`, `docs/metronome.md`, et une section entière de `docs/scratch.md` pour le
  scratch par clip, qui est ce qui a payé le plateau. Reste `put-on.ts`.

Une chose vérifiée plutôt que supposée, parce que c'était l'argument entier de la correction :
`TurntablePlugin` garde sa position dans un champ à lui et n'y touche que sur `Seek` ; `Rate`
n'entre que dans le pas. **Changer le tempo ne peut donc pas déplacer le disque**, non parce qu'on
le rattrape, mais parce que rien ne le pousse.

### Ce qui reste ouvert, et qui n'est pas de la suppression

Le **métronome**. Son clip est le dernier habitant du transport ; il a le bon écartement entre deux
temps et un décalage arbitraire contre la musique. C'était déjà vrai avant cette étape — le
`transportAt(phase)` qui le plaçait lisait un début de clip qui n'existait plus, donc le nombre était
faux mais avait l'air d'être quelque chose. Il démarre maintenant à zéro, et
`packages/ui-turntables/docs/metronome.md` dit que la phase manque plutôt que de la simuler. Les deux
remèdes envisagés — un plateau de plus, ou une ancre calculée sur l'aiguille — y sont écrits ; aucun
n'est décidé, et aucun n'a été écouté.
