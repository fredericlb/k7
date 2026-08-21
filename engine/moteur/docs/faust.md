# FaustPlugin — le moteur compile le Faust d'un module

`FaustPlugin` est le greffon intégré qu'un module `plugin: {type: faust}` charge. Il reçoit la
source sur la propriété `faust` de son `ValueTree`, **la compile** avec libfaust (backend
interpréteur), déclare un paramètre par contrôle que le programme annonce, et la fait tourner.

Le côté TypeScript est décrit dans `packages/song/docs/faustModules.md`.

## Le contrat structurel

**Les paramètres sont créés dans le constructeur.** Tracktion crée ses `AutomatableParameter`
là et jamais après, et un programme Faust déclare les siens (`hslider`, `nentry`, `checkbox`).
La compilation se fait donc dans le constructeur, pas paresseusement dans `prepare()`. C'est le
même contrat que `GraphDspPlugin`, et c'est pour ça que `EditBuilder::addPlugin` fabrique ces
deux greffons-là depuis un `ValueTree` plutôt que depuis un nom de type.

Trois décisions qui vont avec :

- **Les groupes Faust sont ignorés.** Un `hgroup`/`vgroup` imbrique le chemin complet d'un
  contrôle. Le replier dans le nom du paramètre ferait dépendre ce nom de la façon dont
  quelqu'un a groupé sa source, alors que `ui.yaml` est écrit à la main contre ces noms.
- **Un `bargraph` n'est pas un paramètre** : c'est une sortie que le programme écrit pour un
  vumètre. L'exposer laisserait un fader écrire là où seule la DSP doit.
- **Le rendu n'est jamais en place.** Entrée et sortie sont deux tampons, alloués dans
  `initialise` et jamais dans le rappel : un `.dsp` ne promet pas de ne pas relire une entrée
  après avoir écrit une sortie.

`takesAudioInput` et `producesAudioWhenNoAudioInput` sont répondus **d'après le programme
compilé** (`getNumInputs`), ce qui distingue un effet d'un instrument sans que personne ait à
le déclarer nulle part.

## Les notes tombent sur LEUR échantillon

`renderWithNotes` découpe le bloc à chaque message : appliquer ce qui est dû, calculer jusqu'au
prochain événement, recommencer. Faust accepte n'importe quelle longueur, donc un segment n'est
qu'un `compute` plus court.

La première version posait tout au début du bloc. À 5 ms c'est inaudible sur un jeu de clavier
et faux sur un roulement programmé : deux frappes à 2 ms d'écart tombent ensemble, et un motif
en triples croches perd son placement au profit de la grille des blocs.

L'horodatage d'un message est absolu ; `midiBufferOffset` dit où ce bloc commence sur la même
horloge. L'inverse exact de ce que fait `ExternalPlugin` en SORTIE. Rien n'alloue dans le
rappel : les tableaux de pointeurs par segment sont dimensionnés dans `initialise`, et la
marche consomme la liste dans l'ordre plutôt que d'en trier une copie.

Et `applyToBuffer` pose un `juce::ScopedNoDenormals` : un filtre résonant en fin de queue est
le générateur canonique de dénormaux, et le symptôme est un moteur qui ralentit d'autant plus
qu'il joue longtemps.

## Ce que ça coûte, mesuré

| | |
|---|---|
| `studio-moteur.exe` avant | 36,0 Mo |
| après | **42,1 Mo** |

Six mégaoctets. C'est le prix du backend interpréteur ; celui de LLVM aurait été d'un autre
ordre.

## Où `import("stdfaust.lib")` est résolu

À l'**exécution**, quand le moteur compile un module — pas à la construction. Le dossier doit
donc voyager avec l'app : `build-engine.mjs` copie les 43 `.lib` du sous-module dans
`resources/faust-libs/`, et `faustLibrariesDir()` sonde les quatre dispositions qu'un paquet
Tauri peut prendre, dans le même ordre et pour la même raison que `hostcmd.rs` le fait pour le
script du superviseur.

Le repli est le dossier que le CMake du moteur a récupéré. Il est dans un répertoire de
construction et ne voyage pas : y arriver dans une app installée veut dire que la mise en
ressource n'a pas eu lieu. C'est pour ça que le script échoue franchement s'il ne trouve rien à
copier, plutôt que de produire un paquet qui a l'air construit.

## Deux pièges qui n'apparaissent pas chez celui qui écrit

- **Lier la CIBLE `staticlib`, jamais le chemin du `.lib`.** Les presets épinglent
  `targets: ["studio-moteur"]`, donc rien ne construit une bibliothèque dont personne ne
  dépend. Nommer le fichier lie parfaitement sur un arbre où il existe déjà — et échoue avec
  `LNK1104` sur un arbre neuf, au tout dernier pas d'une construction de vingt minutes.
- **`ws2_32` est obligatoire** sur Windows : libfaust embarque un récupérateur HTTP de sources,
  et sans Winsock le lien échoue sur huit symboles qui n'ont rien à voir avec ce qu'on appelle.

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

### Et sa vitesse, mesurée en SÉRIE

Un module isolé ne dit rien : ce qui compte est ce qu'une tranche empile. `studio_faust_tests`
enchaîne huit `moogladder` l'un derrière l'autre, sur des blocs de 256 à 48 kHz — le budget du
moteur, 5,33 ms de calcul pour 5,33 ms d'audio :

```
8 moogladder in series: 19.9% of the block budget (1.06 ms per 256-frame block)
-> one instance costs about 2.49%
```

Environ **2,5 % du budget par instance**. Un interpréteur reste plus lent que du code machine,
et ça se voit ; ce que ça dit, c'est qu'on peut en mettre une dizaine dans une chaîne sans y
penser, ce qui est l'usage. Le plafond du test est volontairement large (50 %) : il est là pour
attraper un ORDRE de grandeur — un interpréteur à 30 % l'instance rendrait la route fausse — et
pas pour servir d'objectif de performance sur une machine qui construit en même temps.

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
