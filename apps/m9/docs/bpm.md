# Le tempo d'une platine, et le sync

Un fader vertical à côté de chaque vinyle, deux boutons SYNC aux extrémités de la barre du
bas. Le bouton dit **qui mène** : appuyer à gauche met les deux disques sur le tempo du
fader gauche, et le fader droit devient gris et bouge tout seul.

## Le fader est le paramètre d'un MODULE

Ce n'est pas une commande que m9 s'invente : le projet le dit. `example.m9` pose sur chaque
platine une instance du module `@mediatek/audio/utility/tempo` de la médiathèque, et le
fader est le `Target BPM` de cette instance. Une instance par platine, parce que chaque
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

## Pendant le glissement, mais pas à chaque pixel

Le crossfade bouge à chaque pixel parce que c'est un **paramètre de plugin** :
`set-plugin-param`, un message. Un warp est dans le **document**, il n'y a pas de message pour
ça, et le moteur y répond en **réinsérant le clip**
(`engine/moteur/docs/engineHost.md`). Reconstruire le nœud d'étirement à chaque pas d'un
glissement — sur les deux platines quand elles sont synchronisées — passerait le geste à
bégayer.

Donc le document part **cadencé** : au plus une fois par `LIVE_WARP_MS` (120 ms), et toujours
avec la dernière valeur. Le tempo suit la main au lieu d'arriver à la fin.

C'est un *throttle*, délibérément pas un *debounce* : un debounce annule son échéance à chaque
nouvelle valeur, donc un glissement continu n'enverrait rien tant que la main ne s'arrête pas
— exactement le comportement qu'on remplace. Ici une échéance déjà posée est laissée
tranquille et lit la valeur courante quand elle se déclenche. Le relâchement envoie en plus la
valeur exacte : le dernier tick cadencé peut s'en écarter de 120 ms de geste.

## Ce qu'il faut savoir avant de l'essayer

Le tempo vient du sidecar `{fichier}.cache`, c'est-à-dire de la **même analyse** que la
waveform. Sur cette machine, **4 morceaux sur 279** en ont un. Pour tous les autres, charger
le morceau déclenche l'analyse par le moteur — plusieurs secondes — et d'ici là le fader
affiche `—` et le sync est désactivé. Ce n'est pas une panne, c'est l'état normal d'un cache
qui n'a jamais été analysé ; l'endroit naturel pour préchauffer, plus tard, c'est la liste du
set (`songs.yaml` nomme déjà exactement les morceaux concernés).

## Le sync aligne aussi les temps

Deux platines à 128 BPM dont les temps forts sont à 200 ms l'un de l'autre ne sont pas
synchronisées, elles *flamment*. Le sync fait donc **deux** choses : donner son tempo à
l'esclave, puis caler sa grille sur celle du maître.

Cette page a longtemps dit que caler la phase demanderait un transport par platine, que le
moteur n'a pas. C'était l'erreur : on ne décale pas le **transport**, on décale le **clip**.
`ClipDoc.start` est par clip, il est en beats du document, et retarder l'esclave de moins d'un
temps suffit — ça ne coûte rien qu'on entende en tête de platine.

Deux morceaux à savoir mesurer pour ça :

- **Où commence la grille.** `beats.ts` en fait une **moyenne circulaire** : chaque transitoire
  est replié sur une période de temps et devient un angle, et on moyenne les vecteurs
  unitaires. Ce qui tombe sur le temps s'additionne, le reste s'annule. La longueur du
  résultat dit à quel point les attaques étaient d'accord, ce qui permet de refuser de
  répondre plutôt que d'inventer une phase à partir de bruit. Ça remplace `transients[0]` :
  une seule attaque est une seule mesure, et un clic dans une intro calme déplaçait toute la
  grille — y compris les lignes jaunes de la waveform, qui lisent maintenant le même nombre.
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

Sur les trois morceaux d'`example.m9`, ça sépare franchement au lieu de tergiverser :

| morceau | bpm | attaques | force | `n·R²` | grille |
|---|---|---|---|---|---|
| Daft Punk — Around the world | 121,36 | 404 | 0,591 | **141** | oui |
| Stromae x Pomme — Ma meilleure ennemie | 87,93 | 236 | 0,268 | **17** | oui |
| Alain Bashung — La nuit je mens | 123,31 | 292 | 0,027 | **0,2** | non |

La dernière ligne est *sous* le niveau du hasard : le tempo détecté est simplement faux, et
c'est exactement le cas qui ne doit pas déplacer un disque. Le bouton SYNC reste actif — la
moitié du sync vaut le coup — et son infobulle dit laquelle il fera.
