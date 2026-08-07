# Les contrôles du pupitre, et comment les lier à un paramètre

Aujourd'hui le crossfader de Mix est **câblé en dur** : il pose `Volume` sur `deckA:level` et
`deckB:level`, et le fader de tempo calcule un warp. Ni l'un ni l'autre n'est déclaré nulle
part, donc ni l'un ni l'autre ne peut être repointé sans toucher au code.

`controls.ts` donne un identifiant à chaque contrôle ; un contrôle par platine est DÉRIVÉ des
platines, pour qu'une troisième platine ne soit pas silencieusement impossible à lier.

| id | quoi | plage |
|---|---|---|
| `crossfade` | le crossfader | 0..1 |
| `deckA.tempo`, `deckB.tempo` | le fader de tempo d'une platine | 10..300 (le knob du module) |
| `deckA.sync`, `deckB.sync` | le bouton SYNC d'une platine | 0..1 |
| `transport` | lecture / arrêt | 0..1 |
| `listen` | écouter dans cet onglet | 0..1 |

Les liaisons, elles, sont dans le **projet** : `views/mix.yaml`, décrit dans
[packages/song/docs/viewBindings.md](../../../packages/song/docs/viewBindings.md).

## Pourquoi pas le `controller.yaml` du module

`controller.yaml` appartient à un **module** et est partagé par toutes ses instances — c'est
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

## Ce qui reste

Les liaisons se résolvent et se vérifient ; **rien n'envoie encore la valeur**. Le mur est
celui de tout le reste de Mix : m9 construit son document dans le navigateur, donc les seuls
plugins chargés par le moteur sont les niveaux des platines. Un `crossfade` compile vers un
plugin graphe que le navigateur ne peut pas cuire, et le module tempo est `offline` et ne
compile vers aucun plugin — donc une liaison vers l'un ou l'autre se résout puis n'a personne
à qui parler. m9 le dit, par contrôle, plutôt que de laisser un fader mort.

Quand la lecture passera par le compilateur, l'envoi est un appel :
`setPluginParam(pluginId, param, valueFor(binding, position))`, et le crossfader câblé en dur
disparaît.
