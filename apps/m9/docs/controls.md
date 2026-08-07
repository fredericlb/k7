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

## Ce qui marche, et ce qui reste

Le crossfader passe par sa liaison : m9 joue le document **compilé** (voir [mix.md](mix.md)),
donc `deckA:crossfade` est un plugin que le moteur a chargé, et bouger le fader pose `Mix`
dessus. Le câblage en dur ne sert plus que de tenant-lieu, le temps que la compilation arrive.

Le fader de tempo, lui, se résout puis n'a personne à qui parler : le module `tempo` est
`offline` et ne compile vers aucun plugin. Ce n'est pas un trou dans la liaison, c'est ce que
`offline` veut dire — l'étirement reste un warp sur le clip jusqu'à ce que la passe froide
existe. m9 l'affiche par contrôle plutôt que de laisser un fader mort.
