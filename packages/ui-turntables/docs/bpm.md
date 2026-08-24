# Le tempo d'une platine, et le sync

Un fader vertical à côté de chaque vinyle, deux boutons SYNC aux extrémités de la barre du
bas. Le bouton dit **qui mène** : appuyer à gauche met les deux disques sur le tempo du
fader gauche, et le fader droit devient gris et bouge tout seul.

## Le fader est le paramètre d'un MODULE

Ce n'est pas une commande que le pupitre s'invente : le projet le dit. `example.st0` pose sur chaque
platine un nœud du module `@st0/audio/utility/tempo` de la médiathèque, et le
fader est le `Target BPM` de ce nœud. Un nœud par platine, parce que chaque
platine joue à son propre BPM et qu'un paramètre appartient à un **usage**, pas à un module.

Ce module est **froid**, et `plugin: {type: offline}` : un changement de tempo est un
étirement temporel, un étirement doit savoir où le fichier se termine, et **le moteur n'a
aucun plugin qui étire le temps** — `PluginScan.cpp` enregistre un Pitch Shifter et rien
d'autre de cet ordre. Tracktion étire un CLIP, par des marqueurs de warp, pas dans un
insert. Voir `packages/song/docs/coldModules.md`.

Et ce n'est **pas** un tenant-lieu en attendant une passe froide. Une passe rendrait un
fichier étiré sur le disque, ce qu'une platine ne peut justement pas se permettre : on ne
re-rend pas quatre minutes d'audio entre deux nudges de pitch. Tracktion étire un clip en
direct, et c'est le bon mécanisme ; ce que le module apporte, c'est la DÉCLARATION que cette
platine a un tempo — ce qui permet à un contrôle du pupitre de le nommer.

Concrètement : la liaison ne donne pas un `pluginId` (il n'y en a pas) mais la **piste** dont
le module traite la matière, et c'est ce clip-là qui est warpé. Repointer `deckA.tempo` vers
`tempoB` et c'est la platine B qui s'étire sous le fader de gauche.

## Comment un morceau change de tempo

Le document ne porte **qu'un** tempo, et il reste fixe (`DOC_TEMPO`, 120). C'est là tout le
montage : chaque platine atteint sa cible par son **propre warp**, donc un seul document
peut jouer deux morceaux à deux BPM différents.

Un `WarpDoc` est une liste de marqueurs `[temps de la timeline, seconde du fichier]`. Deux
marqueurs = un étirement linéaire, et le second suffit à tout dire :

```
secondes réelles = secondes × naturel / cible
temps occupés    = secondes réelles × DOC_TEMPO / 60
```

d'où `beats = secondes × DOC_TEMPO × naturel / (60 × cible)`. Le fichier passe entier entre
les deux marqueurs ; seul le **beat d'arrivée** change.

`elastique` **préserve la hauteur** : un disque étiré ne monte pas en tonalité, contrairement
au plateau d'une platine. C'est le comportement moderne, et ça se sait plutôt que ça se
suppose.

Pas de warp du tout quand la cible est le tempo du morceau : un étirement identité mettrait
le moteur d'étirement dans le chemin pour ne rien changer — du CPU et de la qualité dépensés
pour rien.

## La plage est celle du knob du module

Le module déclare son panneau : un **knob BPM de 10 à 300**, plus un afficheur du tempo
mesuré, en `ui.yaml`. Le fader de Mix **est** ce knob, et sa plage est donc celle-là. Une
surface qui offrirait moins refuserait en silence des valeurs que le module accepte ; une qui
offrirait plus enverrait des valeurs que le panneau ne sait pas dessiner.

C'est large — 290 BPM sur une hauteur d'écran, donc un glissement grossier. Trois choses le
rattrapent : le cran au tempo du morceau, le pas de 0,1, et le double-clic qui y ramène.

Les **±16 %** d'une vraie platine survivent uniquement comme seuil d'alerte : le pourcentage
sous le fader passe en **ambre** au-delà. Ça arrive vite — caler un morceau à 90 BPM sur un
morceau à 123 est un étirement de **+37 %**, légitime et audible. Mieux vaut le voir que le
découvrir dans les enceintes. Et le sync ne borne rien : « synchronisées » veut dire le même
tempo, borner laisserait les deux platines à des BPM différents pendant que le bouton prétend
le contraire.

## Reprendre la main annule le sync

Le fader de l'esclave est **grisé mais saisissable**. Le griser dit « ce n'est pas à toi en ce
moment », pas « tu n'as pas le droit » : sur toutes les machines qui ont un bouton SYNC,
attraper le pitch de la platine asservie est *la* façon d'en sortir. Un knob qui refuserait la
main obligerait à un second aller-retour jusqu'au bouton.

Donc bouger le fader esclave met `master` à `null` et cette platine repart de là où le knob
était — c'est-à-dire de la valeur **synchronisée**, pas de celle qu'elle avait avant. C'est le
détail qui compte : remettre `master` à `null` d'abord et lire la valeur ensuite ferait sauter
le morceau à son ancien tempo au premier pixel.

Bouger le fader du **maître** ne casse rien : les deux suivent, c'est ce que mener veut dire.

Une platine sans tempo détecté ne mène rien et ne suit rien — il n'y a pas de nombre auquel
se synchroniser, et en inventer un serait le mensonge confiant qu'on évite partout ici. Les
deux boutons sont désactivés tant que les deux platines n'ont pas de tempo.

## Bouger le tempo ne doit pas bouger la MUSIQUE

C'est ce qu'une platine fait sans y penser : on change la vitesse du plateau, l'aiguille reste
dans son sillon. Le disque ne saute pas. Ici la platine est un clip sur une timeline et le
transport est une position sur cette timeline — donc ré-étirer le clip change **quelle seconde
du fichier se trouve sous la tête de lecture**, et si le clip ne bouge pas avec, la musique
saute.

Mesuré sans la correction, avec une source dont la fréquence encode sa propre position (le
banc ci-dessous) : **un seul pas d'un glissement de +8 % mange 980 ms du morceau**, et un
glissement complet en mange une seconde pleine, livrée en une secousse par pas. Aucun
silence, aucun clic — le morceau bondit simplement en avant. C'est ça, « abrupt ».

Le montant n'est pas mystérieux : à 8 % près de la cible, la position dans le fichier saute de
8 % de là où on en est. À douze secondes du début ça fait un tiers de mesure ; à trois minutes,
quatorze secondes.

### La correction, et pourquoi elle a cette forme-là

Tenir la seconde `s` du fichier sous la seconde `T` du transport veut dire `T = début + s·ratio`
avant **et** après. D'où :

```
début' = début + s · (ratio_avant − ratio_après)
```

et `T` **disparaît**. C'est tout l'intérêt. La seule estimation qui reste est *où on en est dans
le fichier*, et elle entre **multipliée par l'écart de ratio** — de l'ordre du centième. Une
tête de lecture vieille de 50 ms coûte donc une demi-milliseconde. Calculer au contraire une
nouvelle position de transport et y sauter rendrait ces 50 ms telles quelles, en bafouillage.

Et `seek` serait faux deux fois : **il n'y a qu'un transport pour deux platines**. Déplacer
le transport pour tenir une platine immobile jetterait l'autre. La correction est donc par clip,
et elle vit dans le document — un seul message, rien qui puisse arriver dans le désordre.

`slip` est **stocké**, contrairement à `align` qui est redérivé à chaque rendu. Parce que c'est
une histoire : le même tempo atteint par deux chemins ne laisse pas le disque au même endroit,
exactement comme sur une vraie platine.

### La marge au début de la timeline

Ralentir demande que le clip commence **plus tôt**. Depuis zéro, il n'y a pas de plus tôt : le
moteur accepte bien un `start` négatif (mesuré), mais un repère près du début du morceau tombe
alors sur un transport négatif que le moteur ramène à zéro — le repère envoie ailleurs, en
silence.

D'où `TIMELINE_BASE` : chaque clip de platine démarre **dix minutes** dans la timeline. Ça
couvre une heure de morceau pliée de ±16 %, ça ne coûte rien (la timeline n'appartient qu'au
pupitre et ne porte que ces deux clips), et c'est la même valeur pour les deux platines, donc elles
partent toujours ensemble. Le prix est que le transport ne commence plus où la musique commence
— c'est pourquoi charger le premier morceau y saute, et pourquoi la waveform lit `sourceAt` au
lieu du transport brut : sinon elle dessine le mauvais endroit du morceau, en silence, dès
qu'une platine est étirée.

Le slip est borné : jamais avant le début de la timeline. `TIMELINE_BASE` est dimensionné pour
que cette borne soit hors d'atteinte en pratique ; elle est là parce qu'un fader qui descend à
10 BPM peut demander n'importe quoi.

### Et donc, où PLAY démarre

Les dix premières minutes de cette timeline sont du silence garanti, et un transport laissé
dedans transforme Play en bouton qui ne fait visiblement rien : la tête de lecture avance, les
vumètres restent morts, et rien à l'écran ne dit pourquoi. Mesuré sur un vrai set : master à
−100 dB depuis 0, −11,8 dB depuis `TIMELINE_BASE`, même document et même graphe.

`putOn` saute déjà là sur le PREMIER morceau, et ça ne suffit pas tout seul — voir
[deckSet.md](deckSet.md). La règle vit donc aussi sur PLAY (`playFrom`), où elle est un fait
sur la timeline plutôt que sur une suite de gestes : sous la musique, on démarre à la musique.

Délibérément le cas AVANT seulement. Après la fin des deux morceaux c'est aussi du silence, et
on le laisse tranquille : c'est un état qu'un DJ voit sur la waveform et corrige avec un repère,
là où être avant le début montre une bande vide qui ressemble à un moteur en panne. Ramener
quelqu'un en haut du set parce qu'il a débordé d'un disque serait la pire surprise.

### Le sync est concerné aussi

Le retard que le sync impose à l'esclave est **fonction du tempo**. Tirer le fader du maître le
change donc, sous une platine que la main n'a jamais touchée. Un retard qui bouge sous une
platine est une platine qui saute — la correction absorbe ce déplacement-là en plus du sien.
Appuyer sur SYNC, lui, est laissé tranquille : mettre les grilles ensemble est précisément un
déplacement voulu.

### Le banc

`packages/ui-turntables/scripts/tempo-drag.ts`, pointé sur un moteur qui tourne. C'est la question
qu'un test unitaire ne peut pas trancher, parce que la réponse est un son.

Il joue un fichier dont la **fréquence dit la position** — 300 Hz + 80 Hz par seconde. Comme
`elastique` préserve la hauteur, l'étirement ne déplace pas le ton : ce qu'on entend dit de
quelle seconde du fichier ça vient, indépendamment de la vitesse. Une secousse devient un
palier dans ce nombre, et la dérive totale se lit en comparant où on est arrivé à où une
lecture ordinaire aurait mené, en intégrant la suite des vitesses.

Il appelle le **vrai** `nudgedTempos` et le **vrai** `deckDoc`, donc il mesure ce qui part en
production et pas une imitation. `--raw` jette la correction et garde tout le reste, ce qui
donne les deux chiffres côte à côte :

| glissement de 8 pas | musique mangée |
|---|---|
| sans la correction | **1008 ms** |
| avec, vers le haut | 19 ms |
| avec, vers le bas | 17 ms |

Ce qui reste — quelques dizaines de millisecondes — est le redémarrage du moteur d'étirement à
chaque reconstruction du clip, mesuré à ~20 ms même quand le tempo ne bouge presque pas. C'est
un plancher du mécanisme, pas une dérive : il ne s'accumule pas.

## Pendant le glissement, mais pas à chaque pixel

Le crossfade bouge à chaque pixel parce que c'est un **paramètre de plugin** :
`set-plugin-param`, un message. Un warp est dans le **document**, il n'y a pas de message pour
ça, et le moteur y répond en **réinsérant le clip**
(`engine/moteur/docs/engineHost.md`). Reconstruire le nœud d'étirement à chaque pas d'un
glissement — sur les deux platines quand elles sont synchronisées — passerait le geste à
bégayer.

Donc le document part **cadencé** : au plus une fois par `LIVE_WARP_MS` (120 ms), et toujours
avec la dernière valeur. Le tempo suit la main au lieu d'arriver à la fin.

Et pas seulement cadencé : **seuillé en valeur** aussi. Une reconstruction de clip coûte un
redémarrage du moteur d'étirement — ~20 ms de bavure mesurées même pour un changement inaudible
— donc un pas trop petit pour s'entendre est du coût pur. En dessous de `LIVE_WARP_BPM`
(0,05 BPM, soit quatre centièmes de pour cent à 120, moins d'un cent de hauteur) rien ne part.
Ce que ça rattrape, c'est la fin d'un glissement soigneux, quand la main avance par dixièmes et
demanderait sinon huit reconstructions par seconde pour ne rien dire. Le relâchement est
exempté : la valeur qu'on lâche doit être vraie, si petit qu'ait été le dernier mouvement.

C'est un *throttle*, délibérément pas un *debounce* : un debounce annule son échéance à chaque
nouvelle valeur, donc un glissement continu n'enverrait rien tant que la main ne s'arrête pas
— exactement ce qu'il ne faut pas ici. Une échéance déjà posée est donc laissée
tranquille et lit la valeur courante quand elle se déclenche. Le relâchement envoie en plus la
valeur exacte : le dernier tick cadencé peut s'en écarter de 120 ms de geste.

## Ce qu'il faut savoir avant de l'essayer

Le tempo vient du sidecar `{fichier}.cache`, c'est-à-dire de la **même analyse** que la
waveform. Sur cette machine, **4 morceaux sur 279** en ont un. Pour tous les autres, charger
le morceau déclenche l'analyse par le moteur — plusieurs secondes — et d'ici là le fader
affiche `—` et le sync est désactivé. Ce n'est pas une panne, c'est l'état normal d'un cache
qui n'a jamais été analysé ; l'endroit naturel pour préchauffer, plus tard, c'est la liste du
set (la playlist que la surface nomme désigne déjà exactement les morceaux concernés).

## Le nœud dans le graphe montre les deux nombres

Le pupitre n'est pas le seul écran où ce tempo se lit : le **nœud** du module est juste en
dessous, dans le graphe, avec son knob `Target BPM` et son afficheur `Source BPM`. Comme le
module est `offline`, il ne compile en aucun plugin — le moteur n'a rien à rapporter et aucune
adresse sous laquelle le rapporter. La valeur n'existe que sur la surface qui la **réalise**,
et c'est `useDeckSet` qui la prête au graphe, via `deck.setModuleParam`.

Trois choses sont nécessaires pour ça, et sans l'une d'elles le nœud reste figé sur ce que
`project.yaml` déclare — ce qui se lit exactement comme « le BPM ne se met pas à jour quand on
charge un morceau » :

| | ce qu'il faut |
|---|---|
| l'hôte | st0 passe `moduleParams` **et** `onModuleParam` à `DomChains` : ce sont les deux qui **allument** ces widgets. Sans eux le graphe dessine `–`, inerte. |
| `Source BPM` | `views/mix.yaml` lie un paramètre par contrôle, donc seul `Target BPM` y est nommé ; l'autre est mesuré et n'a aucun écrivain dans le fichier. C'est la publication ci-dessous qui l'écrit, sinon l'afficheur reste à 0 pour tous les morceaux. |
| le trou | poser un disque **efface** le fader (`clearTempo`) et la mesure arrive un instant plus tard. Sauter la publication pendant ce trou laisse le nœud sur les nombres du morceau **sortant** — au moment précis où on le regarde pour voir ce qu'on vient de poser. |

Les deux dernières règles sont dans `offlinePublish` (`mixBindings.ts`), à côté des autres
lectures du même fichier, pour qu'un test les tienne. Une platine sans tempo publie **0**, qui
est le « ne touche à rien » du module lui-même — et non le silence.

`offlinePublish` ne répond que pour les contrôles de **tempo** : sa liste est tirée des tempos
et ne tient rien d'autre. Une règle plus large — « toute liaison sans plugin », publiant la
cible de la platine — ferait lire à un module `offline` lié à autre chose, une coupure de stem,
le BPM de sa platine comme sa propre valeur.

Le widget reste **en lecture seule** dans le graphe : `moduleParams` allume l'affichage,
`onModuleParam` seul rendrait le knob actionnable, et le chemin retour n'existe pas encore —
`fromGraph`, ici, n'a aucun appelant. Lecture seule est honnête ; tournable-et-ignoré ne
l'est pas.

## Le sync aligne aussi les temps

Deux platines à 128 BPM dont les temps forts sont à 200 ms l'un de l'autre ne sont pas
synchronisées, elles *flamment*. Le sync fait donc **deux** choses : donner son tempo à
l'esclave, puis caler sa grille sur celle du maître.

Caler la phase ne demande pas un transport par platine, que le moteur n'a pas : on ne décale
pas le **transport**, on décale le **clip**.
`ClipDoc.start` est par clip, il est en beats du document, et retarder l'esclave de moins d'un
temps suffit — ça ne coûte rien qu'on entende en tête de platine.

Deux morceaux à savoir mesurer pour ça :

- **Où commence la grille.** `beats.ts` en fait une **moyenne circulaire** : chaque transitoire
  est replié sur une période de temps et devient un angle, et on moyenne les vecteurs
  unitaires. Ce qui tombe sur le temps s'additionne, le reste s'annule. La longueur du
  résultat dit à quel point les attaques sont d'accord, ce qui permet de refuser de
  répondre plutôt que d'inventer une phase à partir de bruit. Et non `transients[0]` : une
  seule attaque est une seule mesure, et un clic dans une intro calme déplacerait toute la
  grille — y compris les lignes jaunes de la waveform, qui lisent le même nombre.
- **Où elle est ENTENDUE.** Une seconde source `s` est jouée à `s · natural / target` : un
  morceau à 90 BPM étiré à 120 arrive un tiers plus tôt. Prendre la phase du fichier au lieu
  de celle de la platine décalerait le temps fort de 100 ms — un flam audible.

Les deux platines sont au même `target` au moment où la question se pose (c'est ce que le sync
a fait en premier), donc leurs périodes coïncident déjà et seuls les décalages diffèrent. La
réponse est leur différence, repliée dans un temps : jamais plus d'un temps de retard, jamais
négatif — ce qu'un `start` de clip ne saurait pas exprimer.

### Savoir se taire, et le dire

C'est la décision la moins évidente du lot, et elle est mesurée. Une phase est publiée
seulement si les attaques l'ont vraiment dite ; sinon la platine reçoit le **tempo** et aucun
décalage. Égaler la vitesse vaut le coup toute seule, et une phase inventée déplacerait le
disque pour rien.

La force brute ne peut pas trancher toute seule, parce que ce qui compte comme « élevé »
dépend du nombre d'attaques : en disperser `n` au hasard laisse quand même une résultante
d'environ `0,886/√n` — 0,04 pour 400 attaques, 0,09 pour 100. Un seuil fixe classerait donc
les morceaux par leur **longueur**. Le test de **Rayleigh** est cette comparaison faite
proprement : `n·R²` contre 4,6, soit p ≈ 0,01 contre « les attaques sont réparties
uniformément, il n'y a pas de grille ».

Sur les trois morceaux d'`example.st0`, ça sépare franchement au lieu de tergiverser :

| morceau | bpm | attaques | force | `n·R²` | grille |
|---|---|---|---|---|---|
| Daft Punk — Around the world | 121,36 | 404 | 0,591 | **141** | oui |
| Stromae x Pomme — Ma meilleure ennemie | 87,93 | 236 | 0,268 | **17** | oui |
| Alain Bashung — La nuit je mens | 123,31 | 292 | 0,027 | **0,2** | non |

La dernière ligne est *sous* le niveau du hasard : le tempo détecté est simplement faux, et
c'est exactement le cas qui ne doit pas déplacer un disque. Le bouton SYNC reste actif — la
moitié du sync vaut le coup — et son infobulle dit laquelle il fera.
