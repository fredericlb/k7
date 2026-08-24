# Vingt minutes sans personne — la session se ferme, et se rouvre d'un bouton

Un onglet ouvert sur un projet n'est pas passif : il tient une socket vers le moteur, il tient un
**bail** sur la machine, et le moteur tient le projet chargé — les plugins instanciés, le graphe
construit, l'audio prêt. C'est ce qu'il faut pour jouer une note tout de suite. C'est aussi ce
qu'un onglet oublié derrière trois fenêtres garde pour lui toute la nuit.

Au bout de **vingt minutes** sans le moindre geste, cet onglet cesse d'être un client de ce
moteur : il se démonte, le projet est déchargé, le bail est rendu. Un écran le dit, avec un bouton
« Reprendre la session ».

## Ce que « inactif » veut dire, et ce que ça ne veut pas dire

`src/idle.ts` tient un **horodatage**, remis à `Date.now()` par cinq événements sur `window`, en
capture : `pointerdown`, `pointermove`, `keydown`, `wheel`, `touchstart`. Un `setInterval` de
quinze secondes le compare au délai.

**Une date plutôt qu'un `setTimeout` qu'on annule et repose.** Trois raisons, et la troisième est
celle qui décide :

1. `pointermove` doit compter — promener la souris sur une forme d'onde en écoutant est de
   l'activité — et il tire des dizaines d'événements par seconde. Contre un horodatage c'est une
   affectation ; contre un minuteur c'est un `clearTimeout` plus un `setTimeout` à chaque fois.
2. Un onglet en arrière-plan voit ses minuteurs bridés à environ une minute par le navigateur. À
   l'échelle de vingt minutes le retard est du bruit, mais il faut que le retard soit **borné**
   plutôt que cumulé, ce qu'un intervalle grossier garantit et une chaîne de timers non.
3. **Une machine qui s'endort.** Le portable qu'on referme ne fait tourner aucun minuteur ; au
   réveil, un `setTimeout` de vingt minutes reprend là où il en était et attendra encore. Une date
   dit la vérité tout de suite : deux heures se sont écoulées, la session est finie.

### Un morceau qui joue n'est pas une session inactive

C'est le cas qui n'a aucun événement d'entrée et qui est pourtant l'usage le plus évident de cette
application : on écoute. Couper un set de quarante minutes à la vingtième, en déchargeant le
projet — donc en coupant le son — serait le pire bug que cette page puisse produire.

`markActive()` est la porte, et elle est volontairement bête : une fonction exportée qui pose
l'horodatage, sans aucun état React à faire remonter depuis le fond de l'application. st0 la bat
une fois par minute tant que le transport joue (`App.tsx`, à côté de `playing`). Une minute contre
vingt : le battement ne peut pas rater la fenêtre, et il ne coûte rien.

Tout ce qui se passe sans qu'on touche à rien et qui doit compter passe par là. Rien d'autre ne
devrait avoir à connaître ce module.

### Le minuteur n'est armé que pendant la phase `open`

`ProjectGate` passe `0` dans toutes les autres. Un clone en cours, une erreur, l'écran qui renvoie
choisir : ce sont déjà des cartes derrière lesquelles rien ne tourne, et les expirer remplacerait
une carte par une autre sans rien libérer.

## Ce qui se ferme, dans cet ordre

La phase `idle` de `ProjectGate` est un écran comme les autres : elle **remplace** `children`.
C'est de là que vient l'ordre, et il n'est pas un détail.

| | ce qui se passe | qui le fait |
|---|---|---|
| 1 | `children` se démonte | React, au commit qui pose la phase |
| 2 | le hook moteur de l'app nettoie → `EngineClient.dispose()` → la WebSocket se ferme | l'application |
| 3 | `onIdle()` — ce que l'app tient et que le gate ne voit pas | l'application |
| 4 | `POST /engine/unload` : stop, flush, `served.delete`, `drop-session` | le service de fichiers |

Les étapes 3 et 4 sont dans un **effet** et non dans le rappel du minuteur, précisément pour
qu'elles arrivent après le commit de l'étape 1. Appelé depuis le minuteur, le flush courrait
contre une socket encore ouverte, qui aurait très bien pu repousser un document derrière lui.

`unloadEngine` est exactement l'appel que fait `quit()` — quitter un projet et s'endormir dessus
sont la même fermeture, et il n'y en a qu'une écrite.

`onIdle` est tenu dans une **ref**, et celle-là porte : une application qui passe une fermeture
écrite sur place donnerait un `onIdle` neuf à chaque rendu, et avec lui dans les dépendances,
l'effet se rejouerait — rendant le bail et vidant le moteur à chaque image de l'écran de veille.

Un échec est **ignoré**. Le moteur éteint ou la machine partie est une des raisons pour lesquelles
un onglet reste vingt minutes sans qu'on y touche ; l'écran qui propose de rouvrir est le bon dans
les deux cas.

### Le bail est à l'app, pas ici

`onIdle` / `onResume` sont des rappels et pas un import, pour la raison que
[`ProjectTakenOver`](../src/ProjectGate.tsx) écrit déjà : ce paquet **ne dépend délibérément pas**
de `@studio/engine-browser`. Chez st0, c'est `EngineGate` qui tient `holdEngine`, un cran au-dessus
de `ProjectGate` ; il passe un drapeau `asleep` dans les dépendances de son effet, dont le nettoyage
est `release`. Un onglet sans socket, sans projet chargé, qui renouvellerait quand même la
revendication toutes les cinq secondes ne serait pas déconnecté — il squatterait.

## Reprendre, c'est rouvrir

Le bouton fait trois choses : `onResume()`, la phase `resolving`, et `attempt + 1`. Ce dernier
relance **l'effet de mise en place complet** — résoudre le nom du dépôt chez pl8, cloner si la
machine a oublié l'espace de travail entre-temps, `POST /open`. C'est ce qui rend cet écran aussi
plat : rouvrir un projet est une route que le gate possédait déjà, et être en veille ne fait que
la reprendre.

Deux choses qui ne se font PAS, et les deux sont voulues :

- **aucune reprise automatique.** Le but est de cesser d'être client de ce moteur ; un onglet qui
  se reconnecterait au premier mouvement de souris aurait passé vingt minutes à ne rien obtenir.
  C'est une main sur un bouton qui rouvre.
- **aucune garantie de récupérer la machine.** Reprendre est une réouverture délibérée, donc une
  reprise en règle du bail : si quelqu'un s'est installé pendant la nuit, `onLost` répond et
  `ProjectTakenOver` s'affiche — l'écran qui existe déjà pour ça, avec les bons mots.

## Ce que ça ne couvre pas

**La session de connexion, elle, ne bouge pas.** Le cookie `studio.sid` vaut sept jours et n'est
pas glissant ; rien ici ne le touche. C'est délibéré et il faut le dire, parce que « déconnecter »
peut s'entendre des deux façons : ce qui se ferme est le lien avec le MOTEUR, pas l'identité. Se
déconnecter pour de bon reste `ui logout`.

Et ça ne pouvait pas être autrement dans ce sens-là : le service de fichiers ne connaît pas ce
cookie — il s'authentifie sur les en-têtes `x-studio-*` — et le moteur sur un jeton. Expirer la
session ne stopperait donc rien du tout ; il fallait se déconnecter explicitement, ce que fait
cette page.

**`0` désactive.** Une application qui ne passe pas `idleTimeoutMs` ne pose aucun écouteur et
n'atteint jamais cette phase. Les trois chaînes de l'écran sont optionnelles pour la même raison —
c'est le motif du banc d'essai, plus haut dans `ProjectGateStrings`. st0 est le seul à l'activer.

## Ce qu'il faut vérifier dans un navigateur

Rien ici n'est couvert par une suite : le minuteur mesure vingt minutes et l'écran ne se monte dans
aucun test.

- ouvrir un projet, ne rien toucher vingt minutes → l'écran de veille, et le moteur ne joue plus
  rien ; « Reprendre » ramène le projet ;
- pendant la veille, demander ses sessions au moteur → celle-ci ne tient plus de projet ;
- pendant la veille, lister les moteurs depuis un autre onglet → celui-ci n'est plus « en cours
  d'utilisation » ;
- **lancer la lecture d'un morceau long et ne rien toucher** → au bout de vingt minutes il joue
  toujours. C'est le contrôle qui tient tout le paragraphe sur `markActive` ;
- reprendre depuis un autre onglet ayant pris la machine entre-temps → « Ce projet a été ouvert
  ailleurs », pas une erreur ;
- refermer le portable pendant une heure, le rouvrir → l'écran de veille tout de suite, et non
  vingt minutes plus tard.
