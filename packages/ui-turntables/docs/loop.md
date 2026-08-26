# Boucler

Le pupitre n'avait **aucune boucle** : ni 4/8/16 temps, ni loop in/out, ni roulement, ni saut de
temps, ni quantise. C'est ce qui répare un mix qui glisse et ce qui étire une intro trop courte —
sans ça on n'a qu'un seul essai par transition.

## Ce n'est plus un clip, donc c'est le plateau

Le constat d'origine disait « techniquement c'est à portée : `clickBar` pose déjà
`loopStart`/`loopEnd` sur un clip ». C'était vrai et ça ne l'est plus. `clickBar` boucle le clip
MIDI du **métronome** ([metronome.md](metronome.md)) ; depuis que le plateau est un nœud
([platter-node-plan.md](../../../docs/platter-node-plan.md)), les pistes d'une platine portent
`clips: []`. Il n'y a plus de clip à boucler.

La boucle est donc **dans le plateau**, en C++ : deux paramètres `LoopStart` / `LoopEnd`, en
fraction du disque comme `Seek`, et l'enroulement dans les deux chemins de rendu
([turntable.md](../../../engine/moteur/docs/turntable.md)). Ça coûte plus de C++ et **moins de tout
le reste** : une boucle est un geste de plateau comme `censor`, `place` et `scratch`, dont aucun
n'est dans `MIX_CONTROLS`. Pas de module, pas de liaison dans `mix.yaml`, pas de migration de
surface.

## Une longueur est en TEMPS, et les temps sont ceux du disque

`beatSeconds` lit `natural`, jamais `target`. Une platine tirée à 174 boucle quand même quatre
temps de sa propre grille à 120 : c'est le disque qui a une mesure, pas le fader. L'erreur inverse
s'entend seulement une fois qu'on a pitché — donc jamais pendant qu'on l'écrit — et un test la fige.

C'est aussi pourquoi les boutons sont **gris sans tempo mesuré** : une longueur en temps sur un
disque sans grille n'existe pas. `canLoop` demande le tempo *et* la durée, les bords étant une
fraction du disque.

## L'ordre sur le fil est le contrat

Les paramètres arrivent **un par un** et le plateau les relit à chaque bloc. Un changement à deux
messages a donc un état intermédiaire, et l'un des ordres possibles **déplace le disque** :

| geste | ce qui part | pourquoi cet ordre |
|---|---|---|
| ouvrir | `Roll`, `LoopStart`, `LoopEnd` | `Roll` d'abord parce que le plateau le **verrouille à l'engagement** ; `[nouveauDébut, ancienneFin]` est `fin < début`, donc inerte |
| redimensionner | `LoopEnd` seul | la boucle ne se désengage pas, donc l'ombre d'un roulement lui survit |
| fermer | `LoopEnd` seul, à zéro | avec n'importe quel début c'est `fin < début`, donc OFF — **et un seul message ne peut pas être à moitié appliqué** |

Le piège est la dernière ligne. Fermer en envoyant `LoopStart = 0` d'abord laisserait `[0, fin]`
debout pendant un bloc : une boucle sur le premier tiers du disque, dans laquelle le plateau
ramènerait l'aiguille. On l'entendrait comme un saut au début du morceau, en plein set, une fois
sur deux. `loopParams` est une fonction pure pour cette raison, et son ordre est testé.

## Le roulement rend le disque là où il en SERAIT

Un roulement (`⟲`, maintenu) est une boucle momentanée : au relâchement, le disque reprend là où il
serait allé s'il n'avait jamais bouclé. C'est le plateau qui tient cette position — une « ombre »
qui avance au vrai débit pendant que la lecture, elle, s'enroule. Le pupitre n'a pas le droit de la
calculer : il faudrait multiplier un temps d'horloge murale par un débit, ce qui dérive de quelques
millisecondes et **donne une réponse fausse si le fader bouge pendant le roulement**.

Et la décision « ceci est un roulement » est **verrouillée à l'engagement**, jamais relue au
relâchement. Sinon deux paramètres arrivant l'un après l'autre suffisent à transformer un roulement
en boucle simple entre les deux. `TurntableLoop::aim` est le seul endroit qui lit `Roll`, et
`the_roll_decision_is_LATCHED_at_the_engage` est le test qui le dit.

## Quantise est un interrupteur, pour tout le pupitre

Dessiné **une seule fois**, sous le crossfader : deux boutons qui seraient toujours d'accord
diraient moins qu'un. Il attire sur la grille le début d'une boucle, celui d'un IN manuel, et
l'arrivée d'un saut de temps.

Sur le temps **le plus proche**, jamais le suivant : une main est en retard d'un cheveu, et
`firstBeatAfter` sauterait un temps entier pour ça. Un disque sans grille n'est pas quantisé du
tout — `snapToBeat` rend alors la position telle quelle plutôt que d'inventer une mesure.

## Ce qui ferme une boucle sans qu'on le demande

- **Un repère.** Sauter sur un cue pendant qu'on boucle réenroulerait l'aiguille aussitôt : on
  aurait appuyé sur le repère sans l'entendre. Donc `jumpCue` ferme d'abord.
- **Un nouveau disque.** Les bords sont des secondes du disque qui vient de partir ; sur le suivant
  ils ne désignent rien.

## Ce que ça ne fait pas, et qu'il faut dire

- **La couture n'est pas fondue.** Un enroulement est une discontinuité, et sur une boucle calée sur
  le temps elle tombe sur un transitoire, qui la masque — c'est ce que fait le matériel courant.
  Hors grille, ça claque. Un fondu court de part et d'autre du bord serait la réponse ; il n'est pas
  écrit.
- **En KEY, la couture passe dans l'étireur.** Elastique tient un tampon qui enjambe le bord, donc
  la jonction est lissée plutôt que nette. Ni mesuré ni jugé : on ne peut pas écouter d'ici.
- **Un saut de temps refuse pendant un roulement.** Le roulement doit déjà une position au disque ;
  la déplacer serait deux réponses à une seule question.
- **Le downbeat reste supposé en 4/4.** Comme partout ici, `BEATS_PER_BAR` est une constante
  ([grid.md](grid.md)).
- **Rien n'est enregistré.** Une boucle vit le temps du set. Elle n'est pas dans `mix.yaml`, et le
  test de [grid.md](grid.md) dit pourquoi ce serait discutable dans les deux sens : la longueur est
  un choix de mix, mais elle n'a de sens qu'avec l'endroit, qui en est un aussi.
