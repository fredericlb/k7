# Le stem cut — enlever un instrument d'un mix

`stemcut` prend un stem et le rend **inversé et mis à l'échelle**, pour que la lane qui le porte,
sommée au morceau d'origine à côté, produise une **soustraction** :

```
sortie = mix + (−Cut · stem)     Cut = 0 → le mix, échantillon pour échantillon
                                 Cut = 1 → le mix sans cet instrument
```

Deux nœuds : `sub(0, Cut)` puis `gain`. Tout le reste de cette page explique pourquoi c'est cette
forme-là et pas une autre.

## Pourquoi soustraire, plutôt que jouer les stems

La réponse tient dans un fait sur le modèle : **la somme des quatre stems ne redonne pas le
morceau.** HT-Demucs sort quatre formes d'onde apprises à ressembler chacune à sa source, sans
aucune contrainte de conservation. Le résidu est petit et jamais nul.

Notre passe, elle, n'ajoute rien : les stems sont écrits en float32 sans le moindre gain, et
l'overlap-add divise les quatre par **le même** registre de poids
(`packages/file-service/src/separateAudio.ts`, `OverlapAdd.weight`). L'écart est celui du modèle.

Donc une platine qui jouerait les quatre stems sonnerait déjà autrement que le disque, **avant
qu'on ait touché quoi que ce soit**. En soustrayant, le cas au repos est exact par construction :
à `Cut: 0` cette lane est silencieuse, et ce qu'on entend est le fichier d'origine.

Ce qui reste — et qui ne peut pas être supprimé — ce sont les artefacts **proportionnels à ce
qu'on retire** : ce qui a fui d'un instrument dans un autre reste quand on coupe le premier. La
basse et la batterie sont les deux stems que ce modèle sépare le mieux ; `other` est le fourre-tout
et le plus fragile.

## Pourquoi un module, et pas un fader

Une soustraction demande un gain **négatif**, et rien d'autre dans ce dépôt n'en porte un :

| | ce qu'il accepte |
|---|---|
| `MixerPlugin` (`Volume`) | des dB, plancher −60 — pas de signe |
| un send (`SendDoc.level`) | passé par `gainToDecibels`, donc ≤ 0 devient −∞ |
| `Kind::gain` du graphe DSP | `buffer.applyGain(start, n, r(n.in[0]))` — **un flottant, sans borne** |

`engine/moteur/engine/DspGraph.cpp` est donc la seule porte, et elle est ouverte : un graphe peut
inverser la polarité, un niveau ne peut pas. C'est toute la raison d'être de ce module.

## Ce que le graphe ne fait pas, et pourquoi

**Aucun filtre, aucune enveloppe, aucun `mix`.** Ce qui est soustrait doit être *exactement* ce que
le séparateur a écrit : mettre en forme le stem au passage laisserait un résidu coloré au lieu
d'une annulation.

**Aucun `input(n)`.** Le mix n'entre pas ici — il est sommé en sortie, par la lane. Un second port
ferait de ce module un mélangeur, et la soustraction dépendrait alors de ce qu'on lui a donné.

**`Cut` est une proportion, 0..1, pas des dB.** Ce qu'on demande ici est une part de l'instrument :
la moitié, c'est −6 dB *de cet instrument-là*. Et l'enlever complètement doit être atteignable, ce
que −∞ dB n'est pas une position pour faire.

## Ce que le montage exige autour

- **Les cinq sources doivent être alignées à l'échantillon.** Une dérive d'un échantillon entre le
  mix et le stem transforme la soustraction en filtre en peigne. C'est pourquoi le pupitre applique
  le même warp, le même `start` et le même `slip` aux cinq clips d'une platine.
- **La somme doit se faire AVANT l'EQ.** Soustraire un stem brut d'un mix déjà égalisé laisse un
  résidu en forme d'EQ, et l'annulation cesserait dès qu'on touche un potard.
- **Le test qui décide** : tout à zéro, rendre, soustraire la source du rendu — il doit rester le
  silence numérique. Tout le reste de ce montage est une opinion ; celui-là est une mesure.

`packages/file-service/docs/stemSplit.md` est l'autre moitié : d'où viennent les quatre fichiers.
