# Les contrôles du pupitre, et comment les lier à un paramètre

Aujourd'hui le crossfader de Mix est **câblé en dur** : il pose `Volume` sur `deckA:level` et
`deckB:level`, et le fader de tempo calcule un warp. Ni l'un ni l'autre n'est déclaré nulle
part, donc ni l'un ni l'autre ne peut être repointé sans toucher au code.

`controls.ts` est la première moitié de la sortie : **chaque contrôle a un identifiant**.

| id | quoi | plage |
|---|---|---|
| `crossfade` | le crossfader | 0..1 |
| `deck.tempo` | le fader de tempo d'une platine | 10..300 (le knob du module) |
| `deck.sync` | le bouton SYNC d'une platine | 0..1 |
| `transport` | lecture / arrêt | 0..1 |
| `listen` | écouter dans cet onglet | 0..1 |

## Deux sortes d'identifiants, et ce n'est pas cosmétique

`controller.yaml` appartient à un **module** et est partagé par toutes ses instances — c'est
écrit dans sa propre doc, et c'est ce qui fait qu'une map suit l'appareil. Or un set pose un
module `tempo` sur **chaque** platine : une seule map pour les deux.

Donc une liaison qui nommerait `deckA.tempo` piloterait l'étirement de la platine B depuis le
fader de la platine A. D'où :

- **globaux** — `crossfade`, `transport`, `listen` : un seul contrôle, aucune ambiguïté ;
- **par platine et RELATIFS** — `deck.tempo`, `deck.sync` : « la platine de cette instance »,
  résolu contre la chaîne où le step se trouve. Une map, deux platines, chacune répondant à sa
  propre main.

Le préfixe `deck.` est le seul marqueur de « à résoudre ».

## La plage, et pourquoi elle est déclarée ici

Une liaison doit transformer « où est ce contrôle » en « que vaut ce paramètre ». La seule
façon de le faire sans inventer d'échelle est de **normaliser le contrôle en 0..1** et de
laisser le `min`/`max` du widget cible le déployer — exactement le trajet que les 0..127 d'un
CC font déjà dans `useMidiControl` de l8. Un contrôle qui ne déclarerait pas sa plage
obligerait chaque consommateur à en deviner une.

C'est aussi pourquoi `deck.tempo` porte la plage du **knob du module** (10..300) et pas une
plage à lui : une liaison ne doit pas pouvoir demander un tempo que le panneau refuse de
dessiner.

## Ce qui reste à faire, et qui touche `controller.yaml`

La forme actuelle est `{ <param>: { ch, cc } }`. La proposition — **à valider avant que je
l'écrive** :

```yaml
# controller.yaml de @mediatek/audio/utility/crossfade
Mix: { control: crossfade }

# …et du module tempo, une map pour les deux platines
Target BPM: { control: deck.tempo }
```

Trois questions de conception, avec ce que je recommande :

1. **Union ou champs cumulables ?** Je propose une seule entrée par param pouvant porter les
   deux : `Mix: { ch: 1, cc: 20, control: crossfade }`. La règle « un param, une entrée »
   tient, et le fader à l'écran et le fader matériel bougent la même valeur — ce que le retour
   MIDI que vous avez déjà écrit (`hasFeedback`) rend cohérent plutôt que conflictuel. La doc
   actuelle dit « deux contrôles qui se disputent une valeur est un bug » ; ici les deux sont
   la même valeur, avec écho.
2. **Sur le graphe** : un champ `control?: Record<string, string>` à côté de `cc?`, plutôt
   qu'un `WebCc` élargi. Les consommateurs sont deux apps différentes — la boucle MIDI de l8,
   le pupitre de m9 — et une union obligerait chacune à écarter un cas qui ne la concerne pas.
3. **La jointure**, dans m9, est celle de `mappedParams` : `step.control` × le widget qui
   donne la plage × `step.pluginId`. Une liaison sans widget ou sans pluginId est laissée de
   côté en silence, pour les raisons déjà écrites là-bas.

Une fois ça en place, le crossfader ne pose plus `Volume` en dur : il pose `Mix` sur
l'instance de crossfade que la chaîne nomme, et le câblage en dur disparaît.
