# `bus_only:` — retirer le chemin à sec d'un bus

Une quatrième section de `graph.yaml`, à côté de `modules:`, `bypassed:` et `positions:` :

```yaml
bus_only: [ eqA, eqB ]
```

Elle dit : **ce bus est entendu par ses destinations et nulle part ailleurs.** Son propre chemin
à sec vers la somme du mixeur est retiré.

## Pourquoi ce n'est pas `bypassed:`

C'est la question qu'on se pose en la lisant, et la réponse est une collision de noms bien réelle.

`bypassed:` fait déjà **deux** choses selon ce qu'on y met : le mute d'une **lane**, et le contournement
d'un **module**. Or une chaîne de bus porte le nom de son premier module — la chaîne `eqA` commence
au point de rendez-vous `eqA`, donc ses pas sont `[eqA, filterA]`.

Écrire `bypassed: [ eqA ]` muterait bien le bus… **et couperait l'EQ**, silencieusement. Les deux
lectures sont légitimes et le fichier ne peut pas trancher. Deux questions, deux mots.

| mot | ce qu'il dit | ce que ça donne dans le document |
|---|---|---|
| `bypassed:` | ce module est contourné / cette lane est mutée | `enabled: false` sur le pas, ou `mute` sur la lane |
| `bus_only:` | ce bus n'est entendu que par ses destinations | `mute` sur la piste de bus, ses plugins intacts |

## Pourquoi il en faut un du tout

`out` compile en chemin **parallèle** — c'est ce qui fait qu'un send est un send : le signal sec
continue vers le master à côté. C'est le bon défaut pour une reverb.

Ça ne l'est pas pour un strip de platine qui alimente une fade *et* un cue : sa sortie à sec
arriverait au master **sans passer par le crossfader**, et tous les réglages sonneraient pareil.
C'est exactement la panne que [ports.md](ports.md) décrit pour une platine câblée sur un seul
crossfade, et que `scaffoldSet` évite pour les lanes en les mutant.

Une lane le dit avec `bypassed:` parce qu'une lane n'est le nom d'aucun module. Un bus ne le peut
pas. D'où ce mot-ci.

## Ce que le moteur en fait

`mute` sur une piste qui a des départs déclenche `feedsBusOnly` dans `EditBuilder.cpp` : la
**première** destination devient un ROUTAGE de sortie — ce qui est ce qui enlève le chemin à sec —
et les suivantes restent des départs aux ordinaires.

L'ordre n'est pas cosmétique, et il est mesuré : **un mute seul ne suffit pas.** Une piste mutée
n'alimente pas ses départs aux — elle est silencieuse partout, pas seulement au sec.

| forme | crête au master |
|---|---|
| deux destinations, source mutée, sans le routage | **−100 dBFS** — rien nulle part |
| deux destinations, source mutée, première routée | −1,6 dBFS |
| deux destinations, source non mutée | 0,0 dBFS — dont le chemin à sec |

`npx tsx engine/moteur/scripts/cue-bus.ts` rejoue les trois.

C'est aussi pour ça qu'une piste ne peut avoir qu'**une** destination sans chemin à sec au sens
strict : elle n'a qu'une sortie. Les autres passent par des départs, qui sont post-plugins et
post-fader sur la piste source — ce qui est correct ici, le fade et le cue étant tous deux en aval du
strip entier.

## Qui l'écrit

Le gabarit d'un set (`scaffoldSet.ts`) et la migration (`scripts/migrateSetCue.ts`), qui partagent
la note posée au-dessus de la clé — `BUS_ONLY_NOTE`, un seul texte, pour que les deux produisent le
même fichier à l'octet près.

À la main, sinon : c'est une ligne, et le graphe ne l'écrit pas encore depuis un clic.

## Ce que ça n'est pas

Ce n'est **pas** une décision sur tous les bus du dépôt. `out` reste parallèle partout ailleurs, et
un bus qui ne nomme pas ce mot garde son chemin à sec. [ports.md](ports.md) pose la question plus
large — rendre `out` en série — et elle reste ouverte : c'est une décision sur chaque bus du dépôt,
pas sur les ports ni sur le casque.

Voir [cue.md](cue.md), qui est la raison pour laquelle ce mot existe aujourd'hui.
