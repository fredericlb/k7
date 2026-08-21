# FaustPlugin — le moignon, et les trois façons de le remplir

`FaustPlugin` est le greffon intégré qu'un module `plugin: {type: faust}` charge. Il reçoit
la source Faust du module sur la propriété `faust` de son `ValueTree`, **ne la compile pas**,
déclare zéro paramètre et passe l'audio inchangé — en le disant une fois par instance sur le
canal des avertissements.

Le côté TypeScript est fini : voir `packages/song/docs/faustModules.md`. Cette page est ce
qui reste, ici.

## Pourquoi un moignon plutôt que rien

Parce que la couture est ce qui se vérifie en premier. Avec ce fichier, un module Faust se
charge, se dessine dans le graphe avec la bonne couleur, s'édite dans le builder, atteint le
document compilé et arrive dans une chaîne. Sans lui, tout ça était invisible et il aurait
fallu choisir un compilateur avant de savoir si le reste tenait.

Il avertit au lieu de se taire pour une raison précise : un module qui se dessine, répond sur
ses paramètres et joue son entrée telle quelle est **indiscernable d'un module contourné**.
C'est exactement la forme de bug que la porte du compilateur, côté TS, a déjà coûtée une fois.

## Le contrat que la vraie version devra tenir

Un seul, et il est structurel : **les paramètres sont créés dans le constructeur**. Tracktion
crée ses `AutomatableParameter` là et jamais après, et un programme Faust déclare les siens
(`hslider`, `nentry`, `checkbox`). Donc la compilation se fait dans le constructeur, pas
paresseusement dans `prepare()`. C'est le même contrat que `GraphDspPlugin`, et c'est pour ça
que `EditBuilder::addPlugin` fabrique ces deux greffons-là depuis un `ValueTree` plutôt que
depuis un nom de type.

Ce qui suit dans le constructeur est déjà écrit à côté et se recopie presque mot pour mot :
la boucle de `GraphDspPlugin` qui transforme chaque `DspGraphParam` en `CachedValue` +
`AutomatableParameter`, avec `DiscreteLabelledParameter` quand il y a des libellés.

Et `applyToBuffer` doit poser un `juce::ScopedNoDenormals` : un filtre résonant en fin de
queue est le générateur canonique de dénormaux, et le symptôme est un moteur qui ralentit
d'autant plus qu'il joue longtemps.

## La couture INSTRUMENT, qui est un second manque

Ce qui est posé est la couture d'un **effet** : audio en entrée, audio en sortie, et le
greffon est inscrit au catalogue avec le rôle `audioEffect`. `packages/dsp/modules/wurlitzer`
est le premier module à demander autre chose, et il demande trois ajouts :

- `takesMidiInput()` vrai, et la lecture du flux de notes dans `applyToBuffer` — le
  `PluginRenderContext` de Tracktion porte déjà le tampon MIDI, et aucun de nos greffons
  intégrés ne le lit aujourd'hui ;
- `producesAudioWhenNoAudioInput()` vrai, sans quoi rien ne tourne sur une piste sans entrée ;
- un **répartiteur de voix**, qui remplit les `freq`/`gain`/`gate` qu'un instrument Faust
  déclare. Faust le fournit (`mydsp_poly`) et il arrive AVEC le compilateur : sans
  compilateur il n'y a pas de voix à répartir.

Le troisième est pourquoi ça n'a pas été fait d'avance : ça ne se teste pas. Du code MIDI
écrit contre une classe qui ne compile rien aura l'air juste jusqu'au jour où on l'exercera,
ce qui est la définition d'un piège. Le catalogue devra probablement porter **deux** entrées —
un `Faust` effet et un `Faust Instrument` — puisque le rôle décide du dossier de type sous
lequel un module est classé et de sa place dans une chaîne, et qu'une seule classe ne peut
pas répondre les deux.

## Les trois routes, et ce qu'elles coûtent

### libfaust (backend LLVM), compilation à l'exécution

La seule qui garde la propriété entière : on écrit un module dans l'app, on l'entend. La
compilation tient dans le constructeur.

Prix : libfaust + LLVM, des dizaines de Mo dans un binaire que le capot embarque, sur trois
plateformes. Et une licence à lire avant de s'engager — le code *généré* par Faust est
explicitement libre d'usage, la bibliothèque du compilateur elle-même est une autre question.

### Le backend WASM et un interpréteur embarqué

`faust -lang wasm`, puis wasm3 ou WAMR dans le moteur. Beaucoup plus petit que LLVM. Mais un
interpréteur wasm tourne autour d'un ordre de grandeur sous le natif, ce qui est acceptable
pour un filtre et ne l'est pas pour ce qu'on met en série dans une tranche. À ne considérer
que si la taille du binaire devient le critère qui tranche.

### `faust -lang cpp` à la compilation du moteur

Un script dans `engine/capot/scripts/` qui passe les `.dsp` du dépôt par le compilateur et
génère une liste, à la manière de `AirWindowsList.h`. Zéro dépendance à l'exécution, vitesse
native, rien à lire côté licence.

Prix : on n'écrit plus un module depuis l'app. Il faut recompiler le moteur, donc les modules
Faust cessent d'être des fichiers d'un projet et redeviennent du code de l'engin — ce qui
défait la raison d'avoir fait tout ce chemin.

## La quatrième, qui ne demande rien

`faust2vst3` hors ligne, `studio-moteur scan`, `module own <ref>`. Ça fonctionne aujourd'hui,
sans une ligne de code, et c'est par là qu'il faut passer pour savoir si Faust s'installe dans
les habitudes avant de payer l'une des trois ci-dessus. Ce qu'on y perd : un binaire par
plateforme, et la source qui ne voyage pas avec le module.

## Vérifier ce qui est là

```
cmake --build --preset windows-msvc
cmake --build build/windows-msvc --config RelWithDebInfo --target \
      studio_engine_tests studio_session_tests studio_midigraph_tests studio_dspgraph_tests
ctest --test-dir build/windows-msvc -C RelWithDebInfo -R 'studio_' --output-on-failure
```

Le greffon apparaît dans `--dump-builtin-params` sous le nom `Faust`, sans paramètre — ce qui
est l'observation exacte que ce moignon ne compile rien.
