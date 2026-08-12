# Les contrôles du pupitre, et comment les lier à un paramètre

Rien sur ce pupitre n'est câblé en dur. Chaque contrôle porte un identifiant, et ce qu'il
DÉPLACE est écrit dans le projet — repointer une ligne de `views/mix.yaml` suffit à envoyer le
fader de gauche sur la platine de droite.

(Cette page a longtemps commencé par le contraire : le crossfader posait `Volume` sur
`deckA:level` et `deckB:level` depuis le code de m9, sans que rien ne le dise. C'est ce que la
déclaration a remplacé.)

`controls.ts` donne un identifiant à chaque contrôle ; un contrôle par platine est DÉRIVÉ des
platines, pour qu'une troisième platine ne soit pas silencieusement impossible à lier.

| id | quoi | plage |
|---|---|---|
| `crossfade` | le crossfader | 0..1 |
| `deckA.tempo`, `deckB.tempo` | le fader de tempo d'une platine | 10..300 (le knob du module) |
| `deckA.sync`, `deckB.sync` | le bouton SYNC d'une platine | 0..1 |
| `deckA.eqLow`, `deckB.eqLow` | le grave d'une platine | −20..+20 dB |
| `deckA.eqMid`, `deckB.eqMid` | le médium | −20..+20 dB |
| `deckA.eqHigh`, `deckB.eqHigh` | l'aigu | −20..+20 dB |
| `deckA.filter`, `deckB.filter` | le filtre de balayage | −100..+100 |
| `transport` | lecture / arrêt | 0..1 |
| `listen` | écouter dans cet onglet | 0..1 |

Les trois bandes d'EQ sont en **décibels**, le filtre en pourcentage de course, et tous
symétriques pour que le neutre tombe au milieu : voir [eq.md](eq.md) et [filter.md](filter.md).

Les liaisons, elles, sont dans le **projet** : `views/mix.yaml`, décrit dans
[packages/song/docs/viewBindings.md](../../../packages/song/docs/viewBindings.md).

## Pourquoi pas le `controller.yaml` du module

`controller.yaml` appartient à un **module** et est partagé par tous ses nœuds — c'est
écrit dans sa propre doc. Or un set pose un module `tempo` sur **chaque** platine : une seule
map pour les deux, donc une ligne ne peut pas dire « le fader de la platine A pilote
l'étirement de la platine A ».

Un CC est une propriété de l'appareil qu'on a branché ; quel fader de VOTRE pupitre bouge le
crossfade de CE set est une propriété du set. Deux questions différentes, deux fichiers.

C'est aussi pourquoi les ids sont **absolus** — `deckA.tempo` et non un `deck.tempo` relatif à
résoudre : le fichier du projet nomme `tempoA` et `tempoB` sur des lignes séparées, donc il
n'y a plus rien à résoudre.

## La plage, et pourquoi elle est déclarée ici

Une liaison doit transformer « où est ce contrôle » en « que vaut ce paramètre ». La seule
façon de le faire sans inventer d'échelle est de **normaliser le contrôle en 0..1** et de
laisser le `min`/`max` du widget cible le déployer — exactement le trajet que les 0..127 d'un
CC font déjà dans `useMidiControl` de l8. Un contrôle qui ne déclarerait pas sa plage
obligerait chaque consommateur à en deviner une.

C'est aussi pourquoi `deckA.tempo` porte la plage du **knob du module** (10..300) et pas une
plage à lui : une liaison ne doit pas pouvoir demander un tempo que le panneau refuse de
dessiner.

## Les deux chemins

Le crossfader et les six potards d'EQ passent par leur liaison vers un PARAMÈTRE : m9 joue le
document compilé (voir [mix.md](mix.md)), donc `deckA:crossfade` et `deckA:eqA` sont des
plugins chargés par le moteur, et bouger la commande pose le paramètre dessus. Un message par
mouvement, à chaque pixel. Voir [eq.md](eq.md).

Le fader de tempo passe par sa liaison vers une PISTE. Le module `tempo` est `offline` : il
n'a pas de plugin, il est rendu vrai hors du graphe — ici par l'étirement du clip, que
Tracktion fait en direct. La liaison donne donc la piste dont le module traite la matière, et
c'est ce clip-là qui est warpé.

Les deux sont déclarés. Repointer `deckA.tempo` vers `tempoB` dans `views/mix.yaml` et c'est
la platine B qui s'étire sous le fader de gauche — ce qui est exactement la différence entre
un contrôle déclaré et un contrôle câblé.

Le fader appartient toujours à une platine (son échelle vient du morceau chargé, un fait sur
ce qui joue et non sur le câblage) ; ce qu'il DÉPLACE vient du fichier.

### Qui décide du chemin — et pourquoi ce n'est pas le graphe

C'est le DOCUMENT COMPILÉ, jamais le graphe, et la nuance a coûté un commit entier.

`buildGraphDoc` donne un `pluginId` à CHAQUE étape d'une chaîne : l'adresse
`chaîne:module` que l'étape *aurait*. Y compris aux étapes dont le compilateur n'émet aucun
plugin — il fait littéralement `if (rawType === OFFLINE_TYPE) continue`. Un module `offline`
ressort donc du graphe avec `deckA:tempoA` sur le dos, et le document n'a rien de tel.

Décider « paramètre ou piste » en regardant si l'étape a un `pluginId` classe donc tous les
faders de tempo du côté paramètre, et `set-plugin-param` part vers une adresse que le moteur
ne connaît pas. Aucune erreur, aucun log : le fader bouge et rien ne se passe.

`enginePluginIds(compiled)` collecte les identifiants que le moteur aura vraiment une fois le
document envoyé, et `hasPlugin()` est la question à poser. Règle générale : le graphe décrit
ce qu'on DESSINE, le document décrit ce qui JOUE — pour savoir quoi envoyer au moteur, on
interroge le second.
