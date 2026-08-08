# L'EQ d'une platine

Trois potards par platine — grave, médium, aigu — commandant un module `eq3` posé sur cette
platine dans le graphe. Comme tout le reste du pupitre, le lien est **déclaré** dans
`views/mix.yaml` et non câblé dans le code ; voir [controls.md](controls.md).

## Le module n'écrit aucune DSP

Le moteur héberge déjà l'égaliseur 4 bandes de Tracktion (`4bandEq`, enregistré sous le nom
`Equaliser`), avec ses filtres en plateau et en cloche. `@mediatek/audio/filter/eq3` est un
**nom et des défauts** par-dessus — exactement ce que `audio/utility/pitch-shift` est au Pitch
Shifter. Écrire un EQ en `jsdsp` aurait produit une deuxième implémentation, moins bonne, à
maintenir.

Ce que le module apporte, ce sont les **points de coupure**. Ceux de Tracktion sont ceux d'un
EQ de mastering : 80 Hz, 3 kHz, 17 kHz. Un plateau haut à 17 kHz ne touche que l'air, donc un
potard « aigu » posé dessus ne ferait presque rien. Le module pose ceux d'une tranche de
table :

| bande | filtre | coupure | ce qu'elle prend |
|---|---|---|---|
| Grave | plateau bas | 200 Hz | le kick et la basse |
| Médium | cloche | 1 kHz | la voix, la caisse claire |
| Aigu | plateau haut | 6 kHz | les cymbales, l'attaque |

Trois bandes sur les quatre. Le second médium reste à plat : une tranche DJ a trois potards, et
en offrir un quatrième que le pupitre ne dessine pas ferait une commande accessible seulement
par le fichier.

Les fréquences n'ont **pas** de widget. Ce sont elles qui définissent ce qu'EST une bande, donc
les déplacer ferait un autre module plutôt qu'un autre réglage — et une table n'offre pas ce
bouton.

## ±20 dB, et le neutre au milieu

La plage est celle du plugin, reprise telle quelle. Le neutre tombe ainsi exactement au centre
de la course, ce qu'un potard d'EQ doit faire : un potard dont le 0 dB n'est pas au milieu se
lit de travers à chaque coup d'œil. Une table coupe plus qu'elle ne remonte — par l'usage, pas
parce que la commande le lui interdit.

En **décibels**, jamais en 0..1. Même règle que le `Volume` d'une tranche : une surface qui
enverrait 0,5 pour « moitié » aurait l'air de marcher et se tromperait de six décibels.

## Après le tempo, avant le crossfade

```
deckA → tempoA → eqA → crossfade → OUT
deckB → tempoB → eqB → crossfade#b
```

L'ordre EST le chemin du signal. Une platine égalisée après le fondu verrait sa basse coupée en
même temps que celle de l'autre : l'EQ est une propriété de la **tranche**, pas du mélange.
C'est la place qu'une table lui donne.

Une instance par platine, jamais partagée — couper la basse de CETTE platine est tout l'intérêt,
et un paramètre appartient à un usage et non à un module.

## Le chemin « paramètre », pas celui du warp

Le pupitre a deux chemins, et l'EQ prend celui du crossfader :

|  | EQ, crossfade | tempo |
|---|---|---|
| dans le document | un vrai plugin | **rien** (`offline`) |
| ce qu'on envoie | `set-plugin-param` | le document entier |
| cadence | à chaque pixel | cadencé à 120 ms |

Un module `offline` ne compile en aucun plugin, si sûr de lui que soit le graphe en lui
distribuant une adresse. `hasPlugin()` est la question à poser, et c'est le **document
compilé** qui répond — jamais le graphe. Un potard dont la cible n'est pas chargée est
**refusé** au lieu d'être envoyé dans le vide : la bande se grise, et l'infobulle dit pourquoi.

## Le potard est rotatif, et se glisse verticalement

Poursuivre le pointeur le long d'un arc est la lecture évidente d'une commande ronde, et la
mauvaise : le gain saute quand le pointeur traverse le centre, et c'est inutilisable sur un
potard de cette taille. Haut c'est plus, bas c'est moins, sur une course fixe de 160 px —
ce que fait tout séquenceur.

`setPointerCapture` est ce qui laisse la main sortir des 40 px du potard en cours de geste, les
flèches le rendent atteignable sans pointeur du tout, et le double-clic revient à plat : la
seule position qui mérite un raccourci, et celle qu'un glissement n'atteint jamais exactement.

Le chiffre ne s'affiche **que** hors du plat. Six potards affichant tous « 0.0 » sont du bruit ;
ce qu'un coup d'œil cherche, c'est quelle bande quelqu'un a touchée.

## Ce qu'il faut savoir

Rien ne renvoie la valeur. `set-plugin-param` est à sens unique, donc la position du potard est
l'état du pupitre et non un écho du moteur : elle est perdue au rechargement, et un `params:`
changé dans `instances/eqA.yaml` ne fait pas bouger le potard tant que la page n'est pas
relue.

Et `extends: "@engine/equaliser"` se résout contre le **scan de plugins de la machine**
(`~/.studio/exts.json`, un chemin qu'aucune variable d'environnement ne déplace). Sur une
machine qui n'a jamais scanné, la référence ne résout pas et le module devient un **stub** —
silencieusement pour le compilateur, qui n'émet alors aucun plugin. Le graphe, lui, le dessine
comme un stub. C'est ce qui rend un EQ « absent sans message », et c'est pour ça que le fixture
du test de scaffold déclare le plugin en ligne au lieu de dépendre du scan.
