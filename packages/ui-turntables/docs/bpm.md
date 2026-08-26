# Le tempo d'une platine, et le sync

Un fader vertical à côté de chaque vinyle, deux boutons SYNC aux extrémités de la barre du
bas. Le bouton dit **qui mène** : appuyer à gauche met les deux disques sur le tempo du
fader gauche, et le fader droit devient gris et bouge tout seul.

## Le fader est le paramètre d'un MODULE

Ce n'est pas une commande que le pupitre s'invente : le projet le dit. `example.st0` pose sur chaque
platine un nœud du module `@st0/audio/utility/tempo` de la médiathèque, et le
fader est le `Target BPM` de ce nœud. Un nœud par platine, parce que chaque
platine joue à son propre BPM et qu'un paramètre appartient à un **usage**, pas à un module.

Ce module est **froid**, et `plugin: {type: offline}` : il ne compile en aucun plugin du moteur.
Ce qu'il apporte est la DÉCLARATION que cette platine a un tempo — ce qui permet à un contrôle du
pupitre de le nommer. Voir `packages/song/docs/coldModules.md`.

Concrètement : la liaison ne donne pas un `pluginId` (il n'y en a pas) mais la **piste** dont
le module traite la matière, et c'est le plateau de cette piste qui change de vitesse. Repointer
`deckA.tempo` vers `tempoB` et c'est la platine B qui s'étire sous le fader de gauche.

## Comment un morceau change de tempo

Le document ne porte **qu'un** tempo, et il reste fixe (`DOC_TEMPO`, 120) — mais aucune platine
ne le lit : chacune est un **plateau** qui possède son disque et le lit à sa propre vitesse.

```
Rate = cible / naturel
```

C'est tout. `platterRate` écrit ce nombre, le plugin en fait un pas d'échantillon par échantillon
de sortie, et `Key` décide si un étireur tient la hauteur pendant ce temps
(`engine/moteur/docs/turntable.md`).

Ce qui a disparu avec les clips, ce sont les marqueurs de warp — `[temps de la timeline, seconde
du fichier]` — et l'arithmétique qui plaçait un fichier entre deux d'entre eux. Un plateau n'a rien
à placer : il est là où il est.

## KEY — la hauteur suit le tempo, sauf si on l'en empêche

Le bouton sous le fader est le **MASTER TEMPO** d'une CDJ, le **Keylock** de Traktor, de Serato et
de rekordbox. Il est **éteint par défaut**, comme sur le matériel : le fader de pitch d'une platine
fait ce que faisait la courroie d'une Technics, le morceau va plus vite ET monte en hauteur. Tenir
la tonalité est le geste supplémentaire, pas l'inverse.

KEY est **un paramètre du plugin**, `Key`, et rien d'autre ne change : même plateau, même position,
mêmes gestes. Le moteur met son étireur dans le chemin ou l'en sort, en interne, ce qui coûte une
branche (`engine/moteur/docs/turntable.md`). C'est ce qui a fait disparaître le second modèle de
position du pupitre.

Un disque séparé n'y échappe pas : ses quatre parties sont quatre plateaux, chacun avec son étireur.
Mesuré, les huit d'un pupitre plein coûtent **3 points de cœur** — ce n'est pas là qu'est le prix.

**Le défaut n'est pas qu'une question de goût.** Un étireur à hauteur constante est non linéaire :
il choisit ses trames en fonction du signal, donc quatre parties étirées séparément ne se somment
plus comme le disque le ferait. C'est ce qui a cassé la version du `stemcut` qui soustrayait
(`packages/dsp/docs/stemcut.md`), et ça reste vrai de la somme, en plus discret : à keylock allumé
les quatre parties se recollent moins bien. Le rééchantillonnage, lui, est linéaire — la même
combinaison d'échantillons pour les quatre fichiers — et ne coûte rien de ce côté-là.

Beaucoup de DJ laissent le bouton éteint pour les petits écarts : à ±3 % le décalage de hauteur
s'entend moins que les artefacts de l'étirement.

**C'est un réglage de la PLATINE, pas du disque.** Il survit au morceau qu'on pose, là où
`clearTempo` efface le tempo à chaque chargement — d'où `withKeylock`, qui le fusionne dans les
`DeckTempo` au lieu de l'y stocker. Le changer est un changement de DOCUMENT, donc il renvoie le
projet, comme un coup de fader relâché.

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

## Bouger le tempo ne bouge plus la MUSIQUE, et il n'y a plus rien à corriger

C'est ce qu'une platine fait sans y penser : on change la vitesse du plateau, l'aiguille reste
dans son sillon. C'est désormais littéralement ce qui se passe. `TurntablePlugin` garde sa
position dans un champ à lui et n'y touche que sur `Seek` ; `Rate` ne fait que changer le pas.
Écrire un nouveau tempo ne peut donc pas déplacer le disque — non parce qu'on le rattrape, mais
parce que rien ne le pousse.

### Ce que ça a coûté du temps des clips

Ça vaut d'être gardé, parce que c'est ce qui a payé le plateau. Une platine était un clip sur une
timeline et le transport une position sur cette timeline, donc ré-étirer le clip changeait
**quelle seconde du fichier se trouvait sous la tête de lecture**. Mesuré sans correction, avec
une source dont la fréquence encode sa propre position : **un seul pas d'un glissement de +8 %
mangeait 980 ms du morceau**, un glissement complet une seconde pleine, en une secousse par pas.

La correction — `slipToPlace`, `slipAfter`, et la marge de dix minutes (`TIMELINE_BASE`) qui leur
donnait de la place devant — ramenait ça à 19 ms. Ces 19 ms étaient le redémarrage de l'étireur à
chaque ré-insertion de clip : un plancher du mécanisme, pas une dérive. Tout ce lot a été supprimé
à l'étape 4 de `docs/platter-plan.md`, avec son banc (`tempo-drag.ts`) et sa page.

Et la marge avec : PLAY démarre à zéro comme partout ailleurs, puisque plus aucune musique ne vit
sur cette timeline. Il n'y reste que le clic (`metronome.md`).

## Pendant le glissement, mais pas à chaque pixel

Le crossfade bouge à chaque pixel parce que c'est un **paramètre de plugin** :
`set-plugin-param`, un message. Un tempo, lui, voyage dans le **document** — `platterRate` écrit
le `Rate` des plateaux de la platine, et un disque séparé en a quatre.

Donc le document part **cadencé** : au plus une fois par `LIVE_WARP_MS` (120 ms), et toujours
avec la dernière valeur. Le tempo suit la main au lieu d'arriver à la fin.

Et pas seulement cadencé : **seuillé en valeur** aussi. En dessous de `LIVE_WARP_BPM`
(0,05 BPM, soit quatre centièmes de pour cent à 120, moins d'un cent de hauteur) rien ne part.
Ce que ça rattrape, c'est la fin d'un glissement soigneux, quand la main avance par dixièmes et
demanderait sinon huit envois par seconde pour ne rien dire. Le relâchement est
exempté : la valeur qu'on lâche doit être vraie, si petit qu'ait été le dernier mouvement.

Ces deux nombres datent du temps où un pas de fader **reconstruisait un clip** et coûtait ~20 ms
de bavure. Un `Rate` ne coûte pas ça, et ils n'ont pas été remesurés depuis : ils sont
conservateurs, pas justifiés.

C'est un *throttle*, délibérément pas un *debounce* : un debounce annule son échéance à chaque
nouvelle valeur, donc un glissement continu n'enverrait rien tant que la main ne s'arrête pas
— exactement ce qu'il ne faut pas ici. Une échéance déjà posée est donc laissée
tranquille et lit la valeur courante quand elle se déclenche. Le relâchement envoie en plus la
valeur exacte : le dernier tick cadencé peut s'en écarter de 120 ms de geste.

## Ce qu'il faut savoir avant de l'essayer

Le tempo vient du sidecar `{fichier}.cache`, c'est-à-dire de la **même analyse** que la
waveform. Sur cette machine, **4 morceaux sur 279** en ont un. Pour tous les autres, charger
le morceau déclencherait l'analyse par le moteur — plusieurs secondes — et d'ici là le fader
afficherait `—` et le sync serait désactivé.

**C'est fait, et ça n'arrive plus** : le pupitre analyse la playlist que la surface nomme, un
morceau à la fois, dès qu'il a sa liste. Voir [prewarm.md](prewarm.md). Normal à un bureau,
rédhibitoire sur scène — la seconde où l'on pose un disque est celle où l'on n'a pas cinq secondes.

Et quand l'analyse se trompe, elle se corrige : [grid.md](grid.md).

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

Caler la phase ne demande pas un transport par platine : on ne décale jamais le **transport**. Ce
qu'on décale est la **position** de l'esclave — `alignSeek`, qui lit où les deux sont vraiment.
Un seul cas : tout joue par un plateau, disque séparé compris, et un disque séparé est quatre
plateaux qu'un seul saut atteint.

La différence avec ce qu'on faisait d'un clip n'était pas cosmétique. Deux clips partagent un début,
donc leur écart se calculait sur leurs seules phases ; deux plateaux ne partagent rien, chacun est où
il est, et la correction se lit sur leurs positions réelles. Un plateau se tire aussi bien en arrière
qu'en avant, donc `alignSeek` prend **le plus court chemin** — jamais plus d'un demi-temps — là où le
retard d'un clip n'était jamais négatif.

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
réponse est leur différence, repliée dans un demi-temps de part et d'autre — le plus court chemin,
que le retard d'un clip ne savait pas exprimer.

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
