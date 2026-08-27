# Le graphe DSP — la DSP d'un module décrite en données

`engine/moteur/engine/DspGraph.{h,cpp}` est l'interpréteur ; `GraphDspPlugin` l'expose comme
greffon audio et `MidiGraphPlugin` comme greffon MIDI. Ce que le graphe reçoit est le JSON
qu'émet `@studio/dsp`.

**Le côté émetteur a sa propre page et elle ne se répète pas ici** :
[`packages/dsp/docs/builder.md`](../../../packages/dsp/docs/builder.md) tient les raisons du
constructeur — les trois types, `geolerp` qui refuse une paire descendante, `input(port)`, ce que
le vocabulaire refuse de faire pousser. Cette page-ci tient ce que le **moteur** fait de la
description une fois qu'il l'a.

## L'expérience

Est-ce que la DSP d'un module peut être une **description** plutôt qu'un greffon compilé, pour
être écrite en JS (ou en YAML) comme une chaîne l'est déjà ?

Le JS ne doit jamais approcher le fil audio. Le débit n'est pas le problème — un auto-wah écrit en
JS mesure 0,1 % d'un bloc de 5,3 ms — c'est une pause de ramasse-miettes qui l'est. Donc le JS
tourne **une fois**, à la construction, et émet ceci. Même forme que Strudel, une couche plus bas :
le JS produit des données, le moteur les joue.

## Trois phases par bloc, plus une quatrième

C'est ce qu'un effet piloté par une enveloppe est vraiment :

| phase | cadence | ce qu'elle fait |
|---|---|---|
| `analysis` | par échantillon, sur l'entrée | écrit des scalaires (un suiveur d'enveloppe) |
| `control` | une fois par bloc | scalaire → scalaire (arithmétique, mappage, lissage) |
| `audio` | par échantillon, sur le tampon | filtres, gain, mélange |
| `sample` | par échantillon, boucle unique | ce que les trois précédentes ne savent pas dire |

La quatrième existe pour les graphes que les trois autres ne peuvent pas exprimer : un retard dont
la sortie revient dans sa propre entrée, un peigne, un flanger. Ces nœuds tournent dans **une**
boucle par échantillon sur le bloc, dans l'ordre déclaré, sur leur propre banc de registres de
fils audio.

## L'ordre de `nodes` porte le sens

La rétroaction tombe de cette boucle plutôt que de demander une machinerie : un nœud qui lit un
fil écrit **plus loin** dans la liste obtient la valeur de l'échantillon précédent, et c'est le
retard unitaire sur lequel toute topologie à rétroaction est bâtie. C'est la lecture standard d'un
schéma de flux de signal, et c'est pourquoi rien ici n'a besoin de détecter un cycle ni de trier
quoi que ce soit.

Corollaire : réordonner `nodes` change le **son**, pas seulement l'ordonnancement.

## La modulation tourne au taux échantillon

`alfo` est un LFO qui écrit un **fil audio**, pas un nœud de contrôle qui écrit un scalaire. Un
scalaire ne change qu'une fois par bloc, et sur un TEMPS de retard c'est un escalier de ~10 ms —
audible comme une fermeture éclair sur exactement les effets pour lesquels la modulation existe.
D'où `alfo` dans la boucle par échantillon, et `adelay` qui prend son temps d'un fil quand on lui
en donne un : c'est ce qui rend un flanger exprimable du tout.

## Un graphe paie ce qu'il utilise

Sans aucun nœud de phase échantillon, la phase audio reste **au taux bloc** : un biquad y passe
par le `processSamples` vectorisé de JUCE et un gain par `FloatVectorOperations`. Ajouter un seul
nœud `a*` fait basculer ce graphe en répartition par échantillon.

L'auto-wah rend donc toujours **bit à bit** ce que rendait le greffon compilé, et c'est la
régression contre laquelle ce dessin est vérifié.

Les nœuds de phase échantillon sont collectés à `build()` dans `sampleNodes_`, dans l'ordre
déclaré, pour que la boucle n'itère que ceux-là : parcourir tous les nœuds et brancher sur leur
phase à chaque échantillon ferait payer douze nœuds à 48 kHz à un graphe qui en a deux d'audio,
pour la même sortie.

## Les primitives restent PETITES

Un nœud `shape` ou `geomap` serait l'étape propre à un effet portant un nom générique, et par là
on arrive à une primitive par effet — ce qui vide l'idée de son sens. La courbe de sensibilité
d'un auto-wah et son inverseur de sens vivent donc dans la description, en arithmétique, ce qui
est là où l'identité d'un effet appartient.

C'est aussi l'argument invoqué par `docs/quickMaster.md` pour compiler ce module-là plutôt que de
lui ajouter quatre types de nœuds.

## Les registres, résolus en INDICES

Toute entrée est soit un nom de registre, soit un littéral ; un littéral reçoit son propre
registre préchargé à la construction. Les scalaires vivent dans un banc résolu en indices quand le
graphe est bâti, si bien que `process()` ne fait **aucune recherche et aucune allocation**.

`sr` est prédéfini et tient la fréquence d'échantillonnage : un clamp à Nyquist en a besoin et
aucun littéral ne peut la dire. Les paramètres occupent les registres juste après `sr`, dans
l'ordre déclaré.

Cette correspondance est **positionnelle** : `process()` écrit la valeur du n-ième paramètre dans le
registre n+1, sans jamais consulter un nom. Un nom pour lequel `reg()` rend un indice qui existe
déjà décale donc tous les paramètres suivants sur le registre d'un autre — un littéral compris — et
rien en aval ne peut s'en apercevoir. `build()` refuse les deux cas qui le produisent : un paramètre
déclaré deux fois, et un paramètre appelé `sr`. Refusé pendant que ce n'est encore qu'une
description ; `DspGraph_test.cpp` épingle les deux.

Un nœud porte aussi un `mode`, un seul entier pour trois usages selon son type : le genre de filtre
d'un `biquad` (0 passe-bande, 1 passe-bas, 2 passe-haut, 3 réjecteur), la forme d'onde d'un `alfo`
(0 sinus, 1 triangle, 2 dent de scie, 3 carré), ou le numéro de port d'un `ain`. C'est `build()`
qui traduit le nom écrit dans la description en ce nombre.

Les fils audio ont leur **propre** espace de noms : un nœud de phase échantillon porte une trame
stéréo, un nœud de contrôle un scalaire, et laisser un même nom vouloir dire l'un ou l'autre
serait une erreur de type silencieuse dans un fichier texte. Un nœud de phase échantillon range
donc ses fils dans `in` et ses scalaires dans `k`.

## Ce que le fil audio n'a pas le droit de faire

**Il n'alloue pas et il ne bloque pas.** Trois endroits le portent :

- Les lignes à retard sont dimensionnées à `prepare()`. C'est la seule chose de cet interpréteur
  assez grosse pour s'entendre si elle grossissait pendant le rendu. `maxMs` est un **plafond**,
  pas une suggestion.
- Un bloc plus grand que celui annoncé à `prepare()` arrive pour de vrai — un rendu hors ligne, le
  contexte de rendu d'un rack, un tampon de périphérique qui a devancé une ré-initialisation. Un
  `setSize` sur l'instantané sec allouerait alors sur le fil audio, donc `process()` **découpe le
  bloc** : les phases contrôle et analyse tournent une fois par tranche, ce qui est plus fin, pas
  faux.
- Les coefficients d'un biquad ne sont recalculés que quand la fréquence ou le Q ont bougé. Les
  refaire à chaque bloc coûtait un `sin`, un `cos` et une racine pour un filtre dont le potard
  n'avait pas bougé — et `setCoefficients` prend le verrou tournant de `juce::IIRFilter`, deux
  fois par canal, ce que le fil audio n'a pas à faire pour rien.

Les lignes à retard sont arrondies à la puissance de deux **supérieure**, pour que l'enroulement
soit un masque et non un modulo : la boucle faisait quatre divisions entières par échantillon et
par canal, chacune de 20 à 40 cycles, pour un enroulement qui coûte un ET. Le gaspillage mémoire
est d'au plus une ligne de retard supplémentaire.

`GraphDspPlugin::applyToBuffer` pose un `juce::ScopedNoDenormals`. Un retard à rétroaction qui
décroît — ce que `adelay` et les fils sont — est la façon canonique d'en produire : sous ~1e-38,
chaque opération coûte des dizaines à des centaines de cycles au lieu d'une, et le symptôme est un
moteur qui ralentit d'autant plus qu'il joue longtemps. `juce::IIRFilter` remet son propre état à
zéro, donc les biquads étaient déjà à l'abri ; rien d'autre ne l'était.

## `mix` est appliqué EN DERNIER

`mix` veut dire « mélanger la sortie du GRAPHE avec ce qui est entré », et la sortie du graphe
n'existe pas avant que toutes les phases aient tourné. Appliqué dans la phase audio, il est un
non-événement pour tout graphe ayant une étape par échantillon : le mélange tournerait sur un
tampon que rien n'a encore touché, mélangerait donc le signal sec avec une copie identique de
lui-même, et `aout` écraserait ensuite le résultat — le potard Mix d'un flanger ne faisant
strictement rien, à n'importe quel réglage.

L'instantané sec est pris **avant** tout nœud audio, pour la même raison. Qu'un graphe contienne
ou non un nœud `mix` est figé à `build()` (`hasMix_`) plutôt que redemandé par un `std::any_of` à
chaque bloc.

## Les pièges numériques

- `juce::jlimit` **ne filtre pas les NaN** : ses deux comparaisons sont fausses, donc un 0/0
  ressort tel quel, et un NaN qui atteint `makeBandPass` empoisonne l'état de ce filtre pour de
  bon. `linmap` traite donc une plage vide comme 0 plutôt que comme une division — et l'auto-wah
  publié calcule sa borne basse par un `lerp`, donc c'est atteignable, pas théorique.
- La fréquence d'un biquad est bornée à une bande réelle et stable : une coupure à Nyquist ou
  au-delà fait diverger les coefficients, et elle est alimentée par des nœuds de contrôle dont les
  entrées sont automatisables.
- `atanh` sature, et c'est ce qui empêche une boucle de rétroaction de s'emballer — et ce qui la
  fait sonner comme une machine plutôt que comme une divergence.
- La lecture d'un retard est **fractionnaire et interpolée** : une prise en échantillons entiers
  fait une fermeture éclair dès que le temps bouge, ce qui est précisément le métier d'un flanger.

## Les ports d'entrée

`ain` nomme un **port du module** (`packages/song/docs/ports.md`). Le port n est la paire stéréo
des canaux 2n / 2n+1 : le flux de la chaîne est 0/1, la première entrée latérale 2/3. Absent, le
port est le premier — ce qu'est tout graphe écrit avant que les ports existent.

`DspGraph::inputs()` rend un de plus que le plus grand `port` nommé, et c'est ce qui dit au
greffon combien de canaux demander (`GraphDspPlugin::getChannelNames`), donc si le module est
« sidechainable » du tout. Voir `docs/sidechain.md`.

Un port que personne n'alimente lit le **silence** plutôt que de sortir des bornes : Tracktion
plafonne à deux canaux un greffon sans source latérale, donc c'est le nombre de canaux disponibles
qui décide, par échantillon.

## Les nœuds MIDI

Ils tournent une fois par bloc et **réécrivent la liste de messages sur place**. Leurs entrées
sont des SCALAIRES : un nœud MIDI n'a aucun fil à lire, il agit sur le tampon que le greffon lui a
passé — d'où l'absence de `out`, il n'y a rien à nommer.

`processMidi()` fait tourner la phase **contrôle** puis la phase MIDI, et ne touche ni un fil, ni
une ligne à retard, ni un filtre. C'est la phase contrôle qui transforme les paramètres en les
nombres dont une transformation a besoin, et c'est pourquoi elle est partagée : `runControlNodes()`
est extrait exactement pour que `processMidi()` ne duplique pas le chargement des registres, qui
est l'endroit où les deux entrées dériveraient l'une de l'autre.

`DspGraph::hasMidi()` est ce qui décide si un module est un transformateur du tout ; un graphe sans
nœud MIDI laisse le tampon tranquille.

Deux règles que les transformations tiennent, et qui ne sont pas cosmétiques :

- Une note poussée hors du clavier par `transpose` est **écrêtée, pas jetée** : la jeter
  laisserait son note-off orphelin et la voix suspendue. Les deux bouts bougent ensemble, donc
  le on et le off s'apparient encore.
- `velocity` n'atteint jamais zéro : une vélocité 0 **est** un note-off en MIDI, donc réduire une
  note douce jusqu'à rien tairait la voix et abandonnerait son vrai note-off.

Le transposeur travaille en demi-tons **entiers** : un numéro de note fractionnaire n'est pas
quelque chose que MIDI transporte, et arrondir ici plutôt qu'au paramètre garde le potard continu
pour l'automation.

## Les deux greffons

`GraphDspPlugin` et `MidiGraphPlugin` partagent le même contrat : la description est lue **dans le
constructeur**, parce que les paramètres qu'elle déclare doivent exister avant qu'il rende la
main — Tracktion crée ses `AutomatableParameter` là et jamais après. C'est pour ça que
`EditBuilder::addPlugin` fabrique ces greffons depuis un `ValueTree` plutôt que depuis un nom de
type, exactement comme pour `FaustPlugin` (`docs/faust.md`).

Une description cassée laisse un greffon qui **passe l'audio** et le dit sur le canal
d'avertissement qui atteint le frontend : sans ça, c'est un module qui a l'air bien et ne fait
rien. De même, un graphe sans nœud MIDI dans un greffon MIDI est un module pointé sur le mauvais
porteur, et le dire est tout ce qui le distingue d'un transposeur cassé.

Le repli de `GraphDspPlugin` est l'auto-wah, **GÉNÉRÉ** : c'est `packages/dsp/graphs/autowah.json`
mot pour mot, collé plutôt que lu parce que le moteur ne lit aucun fichier, et `autowah.test.ts`
compare les deux pour que la copie ne dérive pas. Celui de `MidiGraphPlugin` est une transposition
de zéro, écrite à la main et minuscule : il n'y a rien là qui vaille d'être généré.

`canSidechain()` répondrait déjà oui depuis le seul compte de canaux ; le dire explicitement est ce
qui rend la règle lisible — un module est « sidechainable » exactement quand son graphe déclare un
second port d'entrée.

## Vérifier

```
cmake --build --preset windows-msvc
cmake --build build/windows-msvc --config RelWithDebInfo --target \
      studio_dspgraph_tests studio_midigraph_tests
ctest --test-dir build/windows-msvc -C RelWithDebInfo -R 'studio_' --output-on-failure
```

`tests/DspGraph_test.cpp` couvre l'interpréteur sans `te::Edit` : la construction, les phases, la
rétroaction, les bornes. `tests/MidiGraph_test.cpp` fait la même chose du côté notes.
