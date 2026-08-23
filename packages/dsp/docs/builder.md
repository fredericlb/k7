# Le constructeur de graphes — pourquoi trois types, et ce qu'ils empêchent

`packages/dsp/src/index.ts` est toute la bibliothèque : un `GraphBuilder` dont chaque méthode
ajoute un nœud, et un `graph(fn)` qui rend le JSON. Le JS tourne à la **construction** et ne
s'approche jamais du fil audio ; ce qui joue est le C++ de `engine/moteur/engine/DspGraph.h`.

Cette page tient les raisons que le code ne porte plus qu'en une ligne.

## Trois taux, trois types — et ce n'est pas de la décoration

`Scalar` (contrôle), `Audio` (fil) et `Midi` (le flux de notes) sont des types **distincts**.

Ils n'ont été qu'un seul `Signal` au départ, et le premier graphe à rétroaction écrit avec la
bibliothèque était silencieusement faux : `amul(fb, Feedback)` lisait le **paramètre** `Feedback`
comme un fil audio — un fil que personne n'écrit, donc zéro, donc la boucle ne se fermait pas et
l'écho ne répétait qu'une fois. Le moteur ne peut pas attraper ça : des deux côtés ce ne sont que
des noms dans un fichier texte, et le rendu avait l'air plausible.

`Midi` est distinct pour exactement la même raison : sans lui, `transpose(dry, Semitones)` passerait
le typage contre un fil audio et émettrait un nœud que le greffon MIDI ignore sans rien dire. Le
flux de notes est le tampon que le greffon a passé, il n'y en a **qu'un** dans un graphe et chaque
nœud MIDI le réécrit sur place — d'où un type qui ne porte aucun nom et qu'on ne peut ni bifurquer
ni mélanger.

Rendre les trois distincts déplace ces fautes vers une erreur de compilation, et c'est la seule
raison d'avoir une bibliothèque plutôt que d'écrire le JSON à la main. Le reste de la valeur est ce
qu'un langage donne : des noms au lieu de littéraux, des nombres vérifiés, des boucles pour les
parties répétitives, et un `wah()` qu'on appelle deux fois au lieu d'un fichier qu'on recopie.

## Un constructeur, pas des fonctions libres

Chaque aide est une **méthode** parce qu'un nœud doit être *enregistré* autant que rendu : un
graphe est une liste ordonnée, et son ordre est son ordre d'évaluation. `sr` est exporté au niveau
module *et* porté par le constructeur, parce que la source d'un module n'importe rien à l'exécution
— tout ce dont elle a besoin arrive par cet objet.

## `geolerp` refuse une paire descendante

Le nœud du moteur **trie** ses deux bornes avant d'interpoler (`jmin`/`jmax`, pour qu'un graphe ne
puisse jamais demander un rapport négatif). Le prix est qu'une paire descendante n'échoue pas : elle
se lit silencieusement comme son propre miroir. `geolerp(20000, 200, t)` s'assied donc à 200 Hz
quand `t` vaut 0 et **s'ouvre** quand `t` monte — l'exact contraire de ce que la ligne dit, sans
rien à l'écran pour le suggérer.

C'est refusé **ici**, là où l'auteur est, plutôt qu'absorbé là-bas. Pour balayer vers le bas, garder
la paire ascendante et inverser le trajet : `geolerp(200, 20000, g.sub(1, t))`. Le message d'erreur
porte cette forme-là, parce que « c'est faux » n'est pas actionnable quand c'est justement
l'orthographe évidente qui est la mauvaise.

Ça a coûté à ce dépôt un filtre DJ muet à sa position neutre — mesuré à −62 dBFS contre un témoin à
−24 dBFS — et un module `lowpass` publié dont le balayage part à l'envers (`docs/sweep.md`).

La garde ne parle que de ce qu'elle **voit** : deux littéraux. Les bornes du auto-wah sont des
potards (`packages/dsp/src/autowah.ts`), et laquelle est la plus grande regarde le musicien à
l'exécution ; deviner là refuserait un graphe légitime.

## `input(port)` — un indice, pas un nom

`port` indexe les ports d'entrée du module (`inputs:` de son `module.yaml`) : 0 est le flux de la
chaîne, 1 la première entrée latérale — voir `packages/song/docs/ports.md`.

Un indice et pas un nom parce que le graphe et le fichier de module sont **deux documents** : le
graphe est du JSON généré que le moteur lit sans aucun module en vue, et un nom devrait être
rapproché par-dessus ce fossé par quelqu'un. La position est ce que la liste de ports est déjà (la
validation vérifie ses sources positionnellement), donc l'indice est le seul fait que les deux côtés
peuvent tenir seuls.

Le premier port n'émet **aucun champ** : tout graphe écrit avant l'existence des ports reste
octet pour octet identique, ce qui compte parce que les `graphs/*.json` committés et la copie collée
dans le moteur sont ce qui tourne vraiment.

Un port que personne n'alimente lit le silence au lieu d'échouer : `mandatory: false` dit que câbler
un côté et laisser l'autre muet est un état légitime, et voilà ce que ça donne à entendre.

## La phase échantillon, et la rétroaction

Les nœuds `a*` portent de l'**audio**, pas des scalaires, et tournent dans une seule boucle par
échantillon, dans l'ordre déclaré. Lire un fil écrit par un nœud **plus loin** dans la liste rend
l'échantillon précédent — le retard unitaire sur lequel une boucle de rétroaction est bâtie — et
c'est pourquoi `delay()` peut être nourri de quelque chose qui dépend de sa propre sortie.

`wire(name)` ne réserve rien et ne vérifie rien : le nom **est** tout le mécanisme, et le lire avant
son écrivain est exactement ce qui donne l'échantillon d'avant.

Un nœud de phase échantillon range ses fils dans `in` et ses scalaires dans `k`. Cette séparation
est toute la raison d'être des deux types.

`lfo()` tourne au taux **échantillon** et non contrôle, exprès : un scalaire ne change qu'une fois
par bloc, et sur un temps de retard c'est un escalier de ~10 ms, audible comme une fermeture éclair
sur exactement les effets pour lesquels la modulation existe.

`delay()` alloue `maxMs` une fois au `prepare` : c'est un plafond, pas une suggestion. Le temps de
lecture peut être un paramètre ou n'importe quel signal de contrôle, et la lecture est interpolée
pour que le déplacer ne fasse pas de fermeture éclair.

## Ce que le vocabulaire refuse de faire pousser

Il n'y a pas de `sqrt` parmi les primitives, et le crossfade
(`packages/dsp/src/crossfade.ts`) en aurait voulu un : un crossfader DJ prend d'ordinaire la racine
de chaque côté, pour que deux morceaux décorrélés gardent une sonie stable au passage du milieu. En
inventer une pour un seul effet est exactement la façon dont un langage de graphe finit avec un nœud
par effet (`engine/moteur/engine/DspGraph.h`). Le gain égal creuse donc d'environ 3 dB au centre pour
de la matière décorrélée : c'est une forme connue, pas un défaut.

Même raison pour l'absence de `max`, que le filtre DJ contourne par une somme parce qu'une seule de
ses deux moitiés est jamais non nulle.

## Les nœuds MIDI

Ils tournent une fois par bloc sur la liste de notes, avant toute phase audio. Ce sont des méthodes
du **même** constructeur parce qu'un module MIDI déclare quand même des paramètres et les mappe
quand même avec l'arithmétique de contrôle ci-dessus : un transpositeur piloté par un LFO, c'est le
même `param` et le même `lerp`.

Ils prennent des **scalaires et aucun fil** — le flux sur lequel ils agissent est le tampon du
greffon, pas une valeur qu'ils lisent — donc pas de `out` : il n'y a rien à nommer. Et un littéral
passe comme un **nombre**, pas comme son texte : le `ref()` du moteur donne à un nombre son propre
registre préchargé et à une chaîne un registre nommé, donc `"2"` irait chercher un registre que
personne n'écrit.

Une note poussée au-delà des bords du clavier par `transpose` est **écrêtée, pas jetée** : la jeter
laisserait son note-off orphelin et la voix suspendue. `velocity` n'atteint jamais zéro, parce
qu'une vélocité 0 est un note-off en MIDI.
