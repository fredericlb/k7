# Le stem cut — doser un instrument dans un mix

`stemcut` prend un stem et le rend **mis à l'échelle par un gain signé**, pour que la lane qui le
porte, sommée au morceau d'origine à côté, ajoute ou retire cet instrument :

```
sortie = mix + (Level · stem)    Level = −1 → le mix sans cet instrument
                                 Level =  0 → le mix, échantillon pour échantillon
                                 Level = +1 → le mix avec cet instrument deux fois
```

**Un** nœud : `gain(Level)`. Tout le reste de cette page explique pourquoi c'est cette forme-là et
pas une autre.

La course a d'abord été `Cut`, de 0 à 1, et ne savait que soustraire — le graphe portait alors un
`sub(0, Cut)` pour forcer le signe. Ça coûtait un nœud et, plus cher, ça coûtait le neutre : le
repos se trouvait à une extrémité du potard au lieu d'être sous la main, et la moitié « ajouter de
l'instrument », que tout remix demande, n'existait pas. Le signe est passé dans le paramètre, et il
ne reste rien entre le potard et le gain.

Le module existe deux fois, ici et dans `packages/dsp/src/stemcut.ts`, parce qu'un module est un
dossier qu'on copie ; `packages/dsp/src/stemcut.test.ts` tient les deux copies et le
`graphs/stemcut.json` committé à la même forme.

## Pourquoi soustraire, plutôt que jouer les stems

La réponse tient dans un fait sur le modèle : **la somme des quatre stems ne redonne pas le
morceau.** HT-Demucs sort quatre formes d'onde apprises à ressembler chacune à sa source, sans
aucune contrainte de conservation. Le résidu est petit et jamais nul.

Notre passe, elle, n'ajoute rien : les stems sont écrits en float32 sans le moindre gain, et
l'overlap-add divise les quatre par **le même** registre de poids
(`packages/stem-separation/src/separateAudio.ts`, `OverlapAdd.weight`). L'écart est celui du modèle.

Donc une platine qui jouerait les quatre stems sonnerait déjà autrement que le disque, **avant
qu'on ait touché quoi que ce soit**. En soustrayant, le cas au repos est exact par construction :
à `Level: 0` cette lane est silencieuse, et ce qu'on entend est le fichier d'origine. Ce zéro est
au MILIEU de la course, ce qui met le repos sous la main plutôt qu'à une extrémité.

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

**`Level` est une proportion signée, −1..1, pas des dB.** Ce qu'on demande ici est une part de
l'instrument : la moitié, c'est −6 dB *de cet instrument-là*. Et l'enlever complètement doit être
atteignable, ce que −∞ dB n'est pas une position pour faire.

Le côté positif n'est pas une symétrie gratuite. Ajouter du stem au mix dont il sort **renforce**
cet instrument sans toucher aux autres, ce qui est la moitié de ce qu'on demande à une séparation —
et ça coûte exactement le même nœud. Les artefacts y croissent de la même façon qu'à gauche,
proportionnellement à ce qu'on demande.

## Ce que le montage exige autour

- **Les cinq sources doivent être alignées à l'échantillon.** Une dérive d'un échantillon entre le
  mix et le stem transforme la soustraction en filtre en peigne. C'est pourquoi le pupitre applique
  le même warp, le même `start` et le même `slip` aux cinq clips d'une platine.
- **Et à la même fréquence d'échantillonnage.** Corollaire du point précédent, mais il se rate
  autrement : le modèle travaille à 44,1 kHz, et un stem écrit à cette fréquence-là face à un master
  à 48 kHz dérive de plusieurs échantillons en une seconde. La soustraction n'annule plus rien, elle
  additionne deux signaux décorrélés — mesuré à +0,9 dB au lieu d'une coupure.
  `stem-separation` réécrit maintenant les stems à la fréquence du DISQUE.
- **Et du même décodeur.** Le piège suivant, et le plus coûteux : un mp3 porte un délai
  d'encodage que ffmpeg coupe et que JUCE ne coupe pas. Les cinq clips avaient beau être posés au
  même endroit, le disque et ses stems ne venaient pas du même décodage. La séparation écrit donc
  `stems/master.wav` à côté des quatre, et c'est ce fichier que la platine joue
  (`packages/stem-separation/docs/stemSplit.md`).
- **La somme doit se faire AVANT l'EQ.** Soustraire un stem brut d'un mix déjà égalisé laisse un
  résidu en forme d'EQ, et l'annulation cesserait dès qu'on touche un potard.
- **Le test qui décide** : tout à zéro, rendre, soustraire la source du rendu — il doit rester le
  silence numérique. Tout le reste de ce montage est une opinion ; celui-là est une mesure.

`packages/stem-separation/docs/stemSplit.md` est l'autre moitié : d'où viennent les quatre fichiers.
