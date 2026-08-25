# Le stem cut — doser une des quatre parties d'un morceau

`stemcut` prend **une partie séparée** et la rend mise à l'échelle par un niveau. La platine pose
les quatre parties sur quatre lanes, les somme, et chaque potard dose la sienne :

```
sortie de la lane = Level · partie     Level = 0 → l'instrument a disparu
                                       Level = 1 → tel que la séparation l'a écrit
                                       Level = 2 → deux fois plus présent
```

**Un** nœud : `gain(Level)`. Tout le reste de cette page explique pourquoi c'est cette forme-là et
pas une autre — et la forme a changé deux fois, ce qui vaut d'être raconté, parce que les deux
premières étaient défendables et que ce sont des mesures qui les ont écartées.

Le module existe deux fois, ici et dans `packages/dsp/src/stemcut.ts`, parce qu'un module est un
dossier qu'on copie ; `packages/dsp/src/stemcut.test.ts` tient les deux copies et le
`graphs/stemcut.json` committé à la même forme.

## Trois formes, et ce qui a tué les deux premières

**`Cut`, de 0 à 1, qui ne savait que soustraire.** Le graphe portait un `sub(0, Cut)` pour forcer le
signe. Ça coûtait un nœud et, plus cher, ça coûtait le neutre : le repos se trouvait à une extrémité
du potard, et « ajouter de l'instrument », que tout remix demande, n'existait pas.

**`Level`, de −1 à 1, signé.** La platine jouait le disque, et cette lane lui **soustrayait** la
partie : `mix + (Level · stem)`. À 0 la lane était silencieuse et la sortie était le fichier
d'origine, **échantillon pour échantillon**. C'était la forme la plus séduisante des trois, et elle
a tenu jusqu'à ce qu'on mesure ce qui se passe quand le tempo bouge.

**`Level`, de 0 à 2, un simple niveau** — la forme actuelle. La lane porte la partie *elle-même* et
les quatre se somment. Ce qui suit est pourquoi.

## Pourquoi la soustraction a été abandonnée

Une soustraction n'annule que si les deux signaux restent alignés à l'échantillon. Trois choses
cassent cet alignement, et les deux premières se réparent :

1. **La fréquence.** Le modèle travaille à 44,1 kHz ; un stem écrit à cette fréquence-là face à un
   master à 48 kHz dérive en une seconde. Réparé : `stem-separation` écrit à la fréquence du disque.
2. **Le décodeur.** Un mp3 porte un délai d'encodage — 1105 échantillons sur le disque mesuré — que
   ffmpeg coupe et que JUCE ne coupe pas. Réparé aussi, en décodant une seule fois.
3. **L'étirement du tempo, qui ne se répare pas.** Un étireur à hauteur constante est **non
   linéaire** : il choisit ses trames et ses phases en fonction du spectre qu'il voit, donc
   `étirer(a) − étirer(b) ≠ étirer(a − b)`. Les cinq clips reçoivent pourtant le même warp, les
   mêmes marqueurs et le même `start` — ça ne suffit pas, parce que ce que les marqueurs ne
   partagent pas, c'est ce que l'algorithme décide entre eux.

Mesuré sur un morceau, les cinq pistes étirées **exactement de la même façon**, résidu de
`master − Σstems` :

| étirement | résidu |
|---|---|
| aucun | **−49,5 dB** — ça s'annule |
| rubberband +5 % | −15,9 dB |
| atempo +5 % | −13,1 dB |
| varispeed +5 % | **−49,5 dB** — intact |

Le morceau lui-même est à −16 dB : à hauteur tenue, la « soustraction » ne retirait plus rien du
tout. Seul le rééchantillonnage survit, parce que son barème ne regarde pas le contenu — c'est la
même combinaison linéaire d'échantillons pour les cinq fichiers. La règle générale est là : *tout*
étirement indépendant du contenu conserve l'annulation, *aucun* étirement qui écoute le signal ne
la conserve.

Une soustraction ne marchait donc qu'au tempo du disque. Une somme, elle, ne demande rien : chaque
partie s'étire dans son coin et le résultat est ce qu'il est. C'est aussi ce que font toutes les
platines à stems du commerce — Traktor depuis les Stem Decks, Serato, rekordbox, VirtualDJ : elles
jouent les parties, aucune ne soustrait.

## Ce qu'on a perdu, chiffré

L'argument de la forme signée était que **la somme des quatre stems ne redonne pas le morceau** :
HT-Demucs sort quatre formes d'onde apprises à ressembler chacune à sa source, sans contrainte de
conservation. C'est vrai, et l'écart a été mesuré plutôt que supposé — trois fenêtres de 20 s à
travers un morceau :

| position | morceau | résidu de `master − Σstems` | écart |
|---|---|---|---|
| 30 s | −15,6 dB | −50,0 dB | 34,4 dB |
| 90 s | −16,2 dB | −49,4 dB | 33,2 dB |
| 150 s | −16,8 dB | −51,1 dB | 34,3 dB |

Donc au repos la sortie n'est plus le disque **échantillon pour échantillon**, mais le disque à
34 dB près, de façon stable d'un bout à l'autre. L'erreur est corrélée au signal — ça s'entendrait
comme un très léger flou, pas comme un souffle. C'est le prix, et il est dit ici pour que personne
ne le redécouvre en le cherchant.

Ce qui reste par ailleurs — et qui ne peut pas être supprimé — ce sont les artefacts
**proportionnels à ce qu'on retire** : ce qui a fui d'un instrument dans un autre reste quand on
coupe le premier. La basse et la batterie sont les deux parties que ce modèle sépare le mieux ;
`other` est le fourre-tout et le plus fragile.

## Pourquoi un module, et pas un fader

Un fader de piste ferait presque l'affaire, maintenant que le gain n'a plus besoin d'être négatif.
Presque : `MixerPlugin` parle en **dB avec un plancher à −60**, et un send passe par
`gainToDecibels`. Faire disparaître une partie doit être une position sur la course, pas une
asymptote — et une partie à −60 dB s'entend encore dans un creux.

| | ce qu'il accepte |
|---|---|
| `MixerPlugin` (`Volume`) | des dB, plancher −60 — le silence n'est pas atteignable |
| un send (`SendDoc.level`) | idem, par `gainToDecibels` |
| `Kind::gain` du graphe DSP | `buffer.applyGain(start, n, r(n.in[0]))` — **un flottant, sans borne** |

La porte reste donc `engine/moteur/engine/DspGraph.cpp`. Elle était ouverte pour le signe ; elle
sert maintenant pour le zéro.

## Ce que le graphe ne fait pas, et pourquoi

**Aucun filtre, aucune enveloppe, aucun `mix`.** Mettre en forme une partie ici la colorerait par
rapport aux trois autres, et rien ne le signalerait : le disque ne sonnerait plus comme lui-même
sans qu'aucun potard n'ait bougé.

**Aucun `input(n)`.** Les quatre parties se somment en sortie, par les lanes. Un second port ferait
de ce module un mélangeur.

**`Level` est une proportion, 0..2, pas des dB**, pour la raison du tableau ci-dessus. L'unité est
au MILIEU de la course, ce qui met le repos sous la main plutôt qu'à une extrémité — c'est la seule
chose que les trois formes ont toujours eu en commun, et la seule sur laquelle il n'y a jamais eu
de doute.

## Ce que le montage exige autour

- **Les quatre parties doivent être posées ensemble.** Même `start`, même warp, même `slip` :
  quatre parties à quelques millisecondes d'écart, c'est un flam sur chaque frappe. `withDecks` les
  remplit en un seul endroit pour ça, et un test l'exige.
- **La lane du disque est VIDE quand le morceau est séparé.** Les quatre parties *sont* le disque ;
  le jouer en plus le doublerait.
- **La somme se fait AVANT l'EQ**, comme avant, parce que la tranche d'une platine égalise ce
  qu'elle envoie au fader et pas le mélange.
- **Le test qui décide** : les quatre à l'unité, rendre, comparer au disque — il doit rester environ
  34 dB sous la musique, et pas 10. Tout le reste de ce montage est une opinion ; celui-là est une
  mesure.

`packages/stem-separation/docs/stemSplit.md` est l'autre moitié : d'où viennent les quatre fichiers.
