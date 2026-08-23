# `Quick Master` — un bus master en un module

`QuickMasterPlugin` est un built-in du moteur (`studio_quickmaster`, `[audioEffect]`,
catégorie `dynamics`). Il enchaîne trois appareils, dans cet ordre et dans cet ordre
seulement :

```
        ┌ compresseur 3 bandes ┐   ┌ élargisseur ┐   ┌ limiteur ┐
entrée →│  split → 3 détecteurs│ → │  M/S, width │ → │ lookahead│ → sortie
        │  → somme             │   │  bass mono  │   │ + plafond│
        └──────────────────────┘   └─────────────┘   └──────────┘
```

Dix paramètres, aucun routage, **neutre à ses défauts** : les trois quantités à zéro, la
largeur à 100 %, le drive à zéro. Le module `audio/dynamics/quick-master` de
`packages/dsp/modules/` est un NOM et des DÉFAUTS par-dessus, exactement comme `eq3` l'est
sur l'égaliseur 4 bandes — c'est lui qui règle un master « posé », pas le plugin.

## Pourquoi un plugin compilé et pas un `jsdsp`

C'est la première question à se poser dans ce dépôt, et pour une fois la réponse n'est pas
« le moteur héberge déjà l'effet ». Rien de tout cela n'est **descriptible** avec les
primitives de `DspGraph.h` :

| ce qu'il faut | ce que le graphe a | pourquoi ça ne va pas |
|---|---|---|
| séparer en bandes et recombiner | `biquad`, `gain` | ce sont des PUITS : ils traitent le tampon entier sur place, il n'y a pas de chemin parallèle |
| un détecteur par bande | `envelope` | phase d'analyse, sur l'ENTRÉE du graphe et sur elle seule — une bande n'existe pas encore |
| un élargisseur stéréo | `amul`, `aadd`, `adelay`… | un fil audio est une PAIRE traitée à l'identique ; la largeur vit entièrement dans la différence entre les deux canaux, à laquelle rien ici ne donne accès |

La deuxième option était d'ajouter quatre types de nœuds à l'interpréteur (`abiquad`,
`aswap`, un détecteur sur fil, un calculateur de gain). L'en-tête de `DspGraph.h` prévient
justement contre ce chemin — « une primitive par effet, ce qui vide l'idée de son sens » —
et quatre nœuds au service d'un seul module, dont trois toucheraient la boucle par
échantillon de TOUS les graphes existants, est exactement ça. `MixerPlugin` est le modèle
suivi à la place : même lambda `add(id, name, lo, hi, def)`, même `CachedValue`, même
recalcul de coefficients seulement quand un potard a bougé.

## Le découpage en bandes : LR4, et l'allpass qu'on oublie

Chaque coupure est un **Linkwitz-Riley d'ordre 4** — deux sections Butterworth (Q = 0,7071)
en cascade. C'est le seul découpage dont les deux moitiés se resomment à magnitude plate,
et il n'a pas besoin d'inversion de polarité (LR2, lui, en demanderait une).

Le piège est le troisième chemin. Un LR4 ne somme pas à 1 : il somme à un **allpass du
second ordre** à sa fréquence de coupure. Donc, avec `f1` la coupure basse et `f2` la haute :

```
grave  = LP4(f1)                    médium = LP4(f2)·HP4(f1)     aigu = HP4(f2)·HP4(f1)
médium + aigu = AP2(f2)·HP4(f1)
grave + médium + aigu               ≠ AP2(f1)·x      ← un creux de plusieurs dB autour de f1
```

Le grave n'est pas passé par la seconde coupure et se retrouve déphasé par rapport aux deux
autres. La correction est d'une ligne : le grave traverse **le même AP2(f2)**, et la somme
redevient `AP2(f2)·AP2(f1)·x` — plate. C'est `lowAp_` dans `splitBands`, et c'est la seule
chose de ce fichier qui ne se voit pas en lisant le code sans savoir ce qu'on cherche.

Les deux coupures ne peuvent pas se croiser : `updateCoefficients` impose `f2 ≥ 2·f1`. Une
bande « grave » au-dessus de la « aiguë » est un découpage avec un trou dedans et une bande
qui fait l'inverse de ce que dit son potard.

## Ce que « quantité » veut dire

Un potard par bande, 0 à 100, et il pilote trois choses à la fois :

| | à 0 | à 100 |
|---|---|---|
| seuil | −8 dB | −24 dB |
| ratio | **1** | 4 |
| makeup | 0 dB | ≈ +9 dB |

Le ratio à exactement 1 à zéro est ce qui rend l'arrêt EXACT : `compressBands` saute la
bande entièrement et remet son détecteur à zéro, donc remonter le potard repart sous le
seuil et s'installe en douceur au lieu de sauter au niveau qu'il avait la dernière fois.

Le makeup rend **la moitié** de ce que le seuil a fait perdre
(`-thrDb * (1 - 1/ratio) * 0.5`). Un macro qui compenserait en totalité ne ferait jamais
que monter le volume, et on ne pourrait plus entendre ce qu'il fait.

Le calculateur de gain est écrit multiplicativement — `(seuil / niveau) ^ (1 − 1/ratio)` —
plutôt qu'en décibels : un `pow` par échantillon au lieu d'un `log` et d'un `exp`, et
seulement au-dessus du seuil.

Les temps sont **fixes** et décroissants en montant (30/250 ms sur le grave, 15/150 sur le
médium, 5/80 sur l'aigu). Les exposer aurait fait treize potards pour un appareil dont tout
l'argument est qu'on le pose et qu'il marche ; un master se règle bande par bande en
QUANTITÉ, pas en attaque.

Chaque détecteur est **stéréo-lié** : un seul nombre pour la paire. Deux détecteurs
écarteraient les canaux l'un de l'autre, et écarter les canaux d'un master c'est déplacer
l'image — la seule chose qu'un compresseur de mastering ne doit pas faire.

## L'élargisseur, et sa moitié qui rétrécit

Mid/side ordinaire : `M = (L+R)/2`, `S = (L−R)/2`, puis `L' = M + w·S`, `R' = M − w·S`.
`Width` est en pourcent, 100 % est l'identité — et à 100 % sans bass-mono la fonction sort
immédiatement, donc le signal est bit à bit celui d'avant.

`Bass Mono` est l'autre moitié et travaille en sens inverse : un passe-haut LR4 sur le
**side seul**, donc sous cette fréquence les deux canaux se rejoignent au centre. Le mid
garde tous ses hertz. Sous 20 Hz le potard est **ARRÊT** et pas « très bas » : un passe-haut
à 0 Hz n'a pas de coefficients, et c'est ce que veut dire le bas de cette course.

## Le limiteur, et ce que le plafond garantit vraiment

Deux millisecondes de **lookahead** (`lookaheadMs`), une vraie ligne à retard : le détecteur
voit l'échantillon, le gain descend pendant que le signal attend. La constante de temps de
la descente est le quart de la fenêtre, donc le gain est à 2 % de sa cible quand la crête
qui l'a provoqué arrive enfin.

Ces deux millisecondes sont **déclarées** — `getLatencySeconds()` — et pas absorbées en
silence. Un bus master est précisément l'endroit où une latence non compensée cesse d'être
gratuite : un départ parallèle arriverait en avance.

Puis un **écrêteur**, `jlimit(-ceil, +ceil)`, et c'est lui qui fait du plafond un plafond.
Le limiteur au-dessus fait le travail musical et ne lui laisse normalement rien à faire ;
ce qu'il rattrape est la fraction de dB qu'une attaque à un pôle ne peut pas retirer d'un
transitoire à temps. Sans lui le plafond serait une intention, ce qui est la façon la plus
courante de rendre un master faux de 0,2 dB.

`Drive` est le gain d'entrée, appliqué avant le détecteur ET avant la ligne à retard : c'est
lui qui pousse dans le plafond, et c'est une décision de niveau qu'un module posé ne prend
pas tout seul — d'où son défaut à 0.

## Vérifier

Il n'y a pas de test unitaire : `QuickMasterPlugin` a besoin d'un `te::Edit` vivant pour
exister, ce que les quatre suites C++ de ce dépôt ne construisent pas (voir AGENTS.md,
« Anything needing a live `te::Edit` is covered by CLI smoke-runs instead »).

Ce qui le couvre :

```
cmake --build --preset windows-msvc
npm run gen:builtin-params --workspace moteur   # INSTANCIE chaque built-in et lit ses params
npx tsx engine/moteur/scripts/quick-master.ts   # RENVOIE du son et le mesure
```

La deuxième ligne crée le plugin, lit ses dix paramètres et écrit
`packages/song-schema/src/builtinParams.generated.ts`. Un plugin qui ne s'instancie pas, ou dont
les plages ne sont pas celles qu'on croit, s'y voit tout de suite — et ce fichier est
committé, donc `git diff` est la comparaison.

La troisième est le vrai banc : deux pistes panoramiquées à fond, rendues hors ligne à
travers le plugin, et six mesures. Relevé le 2026-08-23 :

```
no plugin              peak 0.4983  mid 0.1149  side 0.1148
neutral                peak 0.5003  mid 0.1149  side 0.1148
ceiling −12 dB         peak 0.2512  mid 0.0731  side 0.0732
width 0                peak 0.4833  mid 0.1148  side 0.0000
width 180              peak 0.8466  mid 0.1149  side 0.2066
```

- **neutre à 0,03 dB du rendu nu.** C'est la correction allpass de `splitBands` qui se lit
  là : sans elle le découpage à trois bandes creuse plusieurs dB autour de `f1`, et cette
  ligne serait négative.
- **plafond tenu au centième de dB** (−12,00 pour −12 demandés), avec 12 dB de drive
  au-dessus d'un signal déjà à −6 dBFS — donc 18 dB de limitation.
- **largeur 0 : side/mid à 0,0000** et le mid inchangé au centième de dB. La largeur 180
  ouvre à 1,80 fois, mesuré en RAPPORT side/mid et pas en side absolu, parce que le
  limiteur est derrière l'élargisseur et qu'une image plus large qui tape dans le plafond
  redescend en niveau.

Deux pièges du banc lui-même, tous les deux payés une fois :

- **le rendu est du PCM 24 bits**, pas du float. Un signal chaud écrête au format, et
  toutes les mesures comparent alors deux formes d'onde écrêtées. D'où les −12 dB sur les
  tranches et la première vérification, qui refuse un rendu nu au-dessus de −0,4 dBFS.
- **une valeur hors plage est ÉCRÊTÉE par l'AutomatableParameter**, en silence.
  `Ceiling: -18` sur un paramètre qui descend à −12 mesure −12 dBFS et se lit comme un
  limiteur faux de 6 dB.

Le reste — est-ce que ça SONNE — ne se mesure pas ici. Un rendu se mesure, il ne se juge
pas.
