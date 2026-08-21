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
greffon est inscrit au catalogue avec le rôle `audioEffect`. `packages/dsp/modules/instruments/synth/wurlitzer`
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

## La route retenue : libfaust, backend INTERPRÉTEUR — mesurée, pas estimée

**Il n'y a pas besoin de LLVM.** Le backend interpréteur est déjà dans la bibliothèque statique
par défaut (`build/backends/interp.cmake` pose `INTERP_COMP_BACKEND STATIC DYNAMIC`), et
`createInterpreterDSPFactoryFromString` compile une source à l'exécution comme la variante LLVM.
Tout ce qui suit a été construit et exécuté ici, sur Faust 2.85.9 et MSVC :

```
cmake -S faust/build -B out -C faust/build/backends/interp.cmake \
      -DINCLUDE_STATIC=ON -DINCLUDE_DYNAMIC=OFF -DINCLUDE_EXECUTABLE=OFF \
      -DINCLUDE_OSC=OFF -DINCLUDE_HTTP=OFF -DINCLUDE_EMCC=OFF -DINCLUDE_WASM_GLUE=OFF
```

Ce que ça donne, et ce sont des nombres relevés :

| | |
|---|---|
| `libfaust.lib` (statique, non liée) | 108 Mo |
| un exécutable qui la LIE et compile un module | **4,0 Mo** |
| les bibliothèques standard (`libraries/`) | 47 fichiers, 2,0 Mo |

**Les dizaines de Mo que cette page annonçait étaient celles de LLVM.** Par cette route le coût
réel est de l'ordre de 4 Mo, ce qui change la décision.

Trois pièges, tous rencontrés :

- **`ws2_32` est obligatoire sur Windows.** libfaust embarque un récupérateur HTTP de sources
  (`sourcefetcher.obj`) et l'édition de liens échoue sur huit symboles Winsock sans lui.
- **`libraries/` est un SOUS-MODULE** de faust (`grame-cncm/faustlibraries`). Un clone qui ne
  l'initialise pas donne un dossier vide, et `import("stdfaust.lib")` échoue à l'exécution —
  pas à la construction.
- **La signature réelle a cinq paramètres**, pas sept :
  `createInterpreterDSPFactoryFromString(name, source, argc, argv, error)`. La documentation en
  ligne décrit la variante LLVM ; c'est l'en-tête qui fait foi.

Reste le prix vrai de cette route : un interpréteur, donc plus lent que du code machine. Pas
mesuré ici — c'est la prochaine chose à faire, et le seuil qui compte est ce qu'on met en série
dans une tranche, pas un module isolé.

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
