# L'EQ d'une platine

Trois potards par platine — grave, médium, aigu — commandant un module `eq3` posé sur cette
platine dans le graphe. Comme tout le reste du pupitre, le lien est **déclaré** dans
`views/mix.yaml` et non câblé dans le code ; voir [controls.md](controls.md).

## Le module n'écrit aucune DSP

Le moteur héberge déjà l'égaliseur 4 bandes de Tracktion (`4bandEq`, enregistré sous le nom
`Equaliser`), avec ses filtres en plateau et en cloche. `@st0/audio/filter/eq3` est un
**nom et des défauts** par-dessus — exactement ce que `audio/utility/pitch-shift` est au Pitch
Shifter. Écrire un EQ en `jsdsp` produirait une deuxième implémentation, moins bonne, à
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

## Ce qu'un potard montre : trois choses

| dessiné | ce que ça dit |
|---|---|
| le petit trait en haut | où est le **neutre** — la référence, toujours à midi |
| l'**aiguille** | où le potard est *posé* |
| l'**arc** de midi à l'aiguille | **de combien** on s'en écarte, et dans quel sens |

L'aiguille seule dit une position ; c'est l'arc qui dit une **quantité**. Sa longueur EST le
réglage, ancré au neutre, donc un boost pousse l'arc vers la droite et une coupe vers la gauche,
et deux potards se comparent d'un coup d'œil sans lire un chiffre.

Au repos l'arc est **vide** — pas un moignon. Un potard qu'on n'a pas touché montre un cadran
nu, et une colonne de potards portant chacun une petite marque serait exactement le bruit qu'on
cherchait à éviter en retirant les chiffres.

Car c'est bien pour cela qu'il existe : sur une tranche courte (un pupitre en panneau), les
**valeurs chiffrées sont retirées** faute de hauteur — voir [deskLayout.md](deskLayout.md). Le
chiffre est un confort, l'arc est ce qui reste pour dire combien, et il ne coûte pas un pixel
de hauteur.

### Comment il est tracé

Deux chemins, tous deux produits par `arcPath` dans `../src/views/ChannelStrip.tsx` : la
**course entière**, pâle, puis l'arc par-dessus. L'arc se lit ainsi contre ce qu'il aurait pu
être plutôt que contre rien.

Les deux passent **en dehors** de la face du cadran — rayon 18 contre les 15 du cercle — pour ne
jamais disputer les mêmes pixels à l'aiguille. Et les extrémités sont `butt` et non `round` :
avec des bouts arrondis, une petite valeur devient une pastille de deux pixels au lieu d'une
petite marque.

Le chiffre, lui, ne s'affiche **que hors du repos** : une colonne de potards affichant tous
« 0 » est du bruit, alors qu'un coup d'œil cherche lequel a été touché.

## Après le tempo, avant le crossfade

```
deckA → tempoA → eqA → crossfade → OUT
deckB → tempoB → eqB → crossfade#b
```

L'ordre EST le chemin du signal. Une platine égalisée après le fondu verrait sa basse coupée en
même temps que celle de l'autre : l'EQ est une propriété de la **tranche**, pas du mélange.
C'est la place qu'une table lui donne.

Un nœud par platine, jamais partagé — couper la basse de CETTE platine est tout l'intérêt,
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

## Une seule vérité, deux images

Le pupitre et le graphe dessinent les mêmes plugins et lisent **une seule** image d'eux. Sans
`liveParams`, chaque widget du graphe retomberait sur `n.params`, le nombre que le fichier du
projet **déclare** : un EQ tourné dans Mix resterait à 0 dB dans le graphe, et un potard tourné
dans le graphe ne ferait rien du tout, faute de `setPluginParam` à appeler. Les deux moitiés
sont le même fil.

Le lien vit donc dans `Studio` et non dans `MixView`, que Studio démonte dès qu'on passe sur
Graphe : un `useEngine` à l'intérieur ne laisserait qu'une vue connectée à la fois, donc aucune
image partageable. `Deck.params` est le `PluginParamsStore` que les deux lisent.

Le moteur est la seule chose qui sache à quoi un plugin est réglé, et il le rapporte quelle que
soit la surface qui l'a réglé — mesuré : on s'abonne (`watch-plugin-params`), une autre
surface pose `Low-shelf gain: -12`, une trame `plugin-params-live` arrive avec `-12`. Studio
s'abonne à tous les plugins que les chaînes compilent, et **demande** en plus leur valeur à
l'abonnement : sans ça, un plugin qui ne bouge plus jamais serait dessiné depuis le fichier
pour le reste de la session.

L'état local d'une surface est donc une couche **optimiste** par-dessus, jamais un
remplacement : `shownValue` prend la main d'abord, le moteur ensuite, et `engineAgrees` lâche
l'optimisme dès que le moteur a rattrapé. Un override qui ne cède jamais est une commande qui a
cessé d'écouter — le moteur peut borner ce qu'on lui a envoyé, et l'autre image peut bouger le
même paramètre.

C'est aussi ce qui fait qu'un creux de −12 dB est **toujours là** au retour du graphe, là où une
copie privée redessinerait le potard à plat pendant que le son dit le contraire.

### Et le tempo, qui n'a pas de plugin du tout

Le crossfade et l'EQ sont de vrais plugins : le moteur les tient, il les rapporte, tout suit.
Le tempo est `offline` — le compilateur n'en émet **aucun** plugin — donc il n'y a rien à
surveiller et aucune adresse pour le faire. Le store de paramètres ne peut rien pour lui.

Sa valeur existe pourtant : sur la surface qui le RÉALISE, le pupitre, qui la transforme en
warp de clip. Le pupitre la prête donc via `Deck.moduleParams`, et le graphe l'emprunte —
`moduleParams` sur la vue chaînes, indexé par NOM DE MODULE puisqu'il n'y a pas d'id de
plugin. Sur le `Deck` et non dans MixView, parce que MixView est démonté exactement quand le
graphe est à l'écran, le seul moment où celui-ci en a besoin.

Et il est **tournable** depuis le graphe, parce que l'état des platines n'est pas dans MixView :
`useDeckSet` vit dans Studio et survit donc à l'onglet. C'est le même nœud qui répond de trois
choses — un aller-retour par le graphe garde les morceaux chargés, laisse le crossfader où il
est, et le tempo se règle des deux côtés. Voir [deckSet.md](deckSet.md).

Le retour se fait par la liaison DÉCLARÉE, lue à l'envers : le graphe ne connaît qu'un module et
un paramètre, `controlDriving` retrouve le contrôle qui les pilote. Repointer une ligne de
`views/mix.yaml` déplace donc aussi l'effet de ce potard.

## Ce qu'il faut savoir

Un `params:` changé à la main dans `nodes/eqA.yaml` ne bouge pas le potard tant que le
projet n'est pas rouvert : ce que le potard montre est l'état du **moteur**, et le fichier
n'atteint le moteur qu'au prochain envoi de document.

Et `extends: "@engine/equaliser"` se résout contre le **scan de plugins de la machine**
(`<state>/exts.json`, un chemin qu'aucune variable d'environnement ne déplace). Sur une
machine qui n'a jamais scanné, la référence ne résout pas et le module devient un **stub** —
silencieusement pour le compilateur, qui n'émet alors aucun plugin. Le graphe, lui, le dessine
comme un stub. C'est ce qui rend un EQ « absent sans message », et c'est pour ça que le fixture
du test de scaffold déclare le plugin en ligne au lieu de dépendre du scan.
