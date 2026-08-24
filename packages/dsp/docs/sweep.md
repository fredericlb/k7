# Le filtre DJ — un potard, deux filtres, et une résonance qui voyage

`modules/audio/filter/sweep/` et `packages/dsp/src/sweep.ts` sont le même graphe écrit deux fois :
un module est un **dossier qu'on copie**, donc il porte sa propre source plutôt qu'un renvoi vers
la bibliothèque, et `packages/dsp/src/sweep.test.ts` tient les deux à la même forme.

Un seul potard qui descend un coin **résonant** vers la gauche et le remonte vers la droite, muet au
milieu. Cette page tient les nombres et les raisons ; le code n'en garde qu'une ligne chacun.

## Un potard, parce qu'un pupitre n'en donne qu'un

Une commande de pupitre pilote **au plus un paramètre**
(`packages/song/docs/viewBindings.md`), donc « passe-bas ou passe-haut » ne peut pas être un second
réglage. Les deux filtres sont donc toujours dans la chaîne et ce qui bouge est l'endroit où chacun
se tient — ce qui est aussi la façon dont marche le matériel que ça imite. Le paramètre est signé,
−100..+100, pour que la position neutre soit le **milieu de la course** et pas un bout.

## La résonance est toute la différence avec un correcteur de tonalité

Un coin plat qui glisse sur un morceau ne fait que l'assourdir, progressivement et sans intérêt :
« un filtre normal ». Le swoosh est un **pic qui voyage avec le coin**, et le pic est l'effet.

| | valeur | pourquoi |
|---|---|---|
| `Q_REST` | `0.707` | Butterworth, maximalement plat : un filtre qui ne fait rien ne colore rien non plus |
| `Q_MAX` | `6` | mesuré : à `Q = 4` il ne restait qu'environ +4 dB au coin une fois que l'étage plat au-dessous avait pris ses 3 dB — audible, mais ce n'est pas ce que quiconque appelle un balayage de filtre |

À mi-course, `Q = 6` donne **+3,9 dB au coin et −21 dB une octave et demie plus haut**.

La rampe compte autant que la valeur : un filtre résonant en permanence sonne même garé hors du
chemin, et un filtre plat en permanence est le « filtre normal » que celui-ci remplace.

**Chaque moitié a sa propre résonance.** En partager une laisserait le passe-haut résonner à 20 Hz
pendant que quelqu'un descend le passe-bas — un pic garé sur le grave, c'est-à-dire un boum que
personne n'a demandé.

## Les bornes du balayage

| | ouvert | fermé |
|---|---|---|
| `LOW_SWEEP` (passe-bas, moitié gauche) | 20 kHz | 30 Hz |
| `HIGH_SWEEP` (passe-haut, moitié droite) | 20 Hz | 10 kHz |

Au repos les deux coins sont **hors de la matière** : 20 kHz est au-dessus de tout ce qu'il y a dans
un morceau, 20 Hz au-dessous. L'effet est donc éteint parce qu'il est **inaudible**, pas parce qu'il
est court-circuité — il n'y a pas de bypass dans ce vocabulaire, et un module qu'il faut retirer
pour qu'il se taise est un module qu'une chaîne ne peut pas automater à partir de rien.

Ça ferme **beaucoup plus loin** qu'un correcteur de tonalité. Un filtre qui s'arrêterait quelques
centaines de hertz plus bas laisse un boum boueux ; un filtre DJ est censé emporter le morceau, et
la dernière partie de la course — là où il ne reste que le pic à siffler — est celle qu'on utilise
vraiment.

## La paire est ASCENDANTE, et c'est le trajet qu'on inverse

Jamais `geolerp(20000, 30, down)`. Le moteur trie les bornes d'un `geolerp`, donc une paire
descendante se lit comme son propre miroir : écrite de la façon évidente, elle pose ce filtre à
30 Hz **au repos** et l'ouvre quand on balaie, c'est-à-dire le silence avec le potard au neutre —
mesuré à −62 dBFS contre un témoin à −24 dBFS. Le constructeur refuse cette paire
(`docs/builder.md`), et le test épingle en plus la forme écrite ici, parce qu'un graphe pourrait
être réécrit de façon à passer la garde et à balayer quand même à l'envers.

`glide` sur les deux coins : un biquad recalcule ses coefficients **par bloc**, et c'est un potard
qu'on jette — un saut entre deux blocs est un clic, et un balayage de sauts est le bruit de
fermeture éclair qui fait sonner un filtre comme cassé plutôt que rapide.

## Deux étages par côté, dont un seul résonne

24 dB/octave plutôt que 12 : une paire de pôles assourdit, deux sont le mur qu'un filtre DJ dresse,
et c'est ce qui fait que le dernier tiers de la course sonne comme un retrait et non comme une
couverture. Les deux étages d'un côté **partagent un coin** — deux étages à des fréquences
différentes n'est pas une pente.

Le premier de chaque paire reste **plat** et seul le second résonne : deux étages résonants à une
même fréquence multiplient leurs pics — Q² — ce qui donne un filtre qui hurle avant de balayer.

## Le trim, en dernier

`SWEEP_TRIM = 0.7`, soit −3 dB aux extrêmes, et il vient **après** les étages pour reprendre une
part de ce qu'ils viennent d'ajouter.

Mesuré, pas deviné, et l'excès est le piège. Une rampe jusqu'à −6 dB mange le pic exactement là où
le pic est le sujet : du bruit blanc à mi-course ne montre alors plus que +1,2 dB au coin. Et il
n'y a pas d'écrêtage contre quoi se protéger — à ce réglage le filtre enlève déjà 14 dB au signal
entier.

Ce qui reste est assez pour qu'un `Q` de 6 assis sur un coup de grosse caisse à 30 Hz ne coûte pas
son master à quelqu'un, et assez petit pour que le swoosh y survive.
