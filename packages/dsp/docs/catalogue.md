# `modules/` — les modules écrits ici, et ce qu'ils ne sont plus

`packages/dsp/modules/` tient des modules **écrits dans ce dépôt** : leur `module.yaml`, leur
panneau, et le `jsdsp.ts` ou le `dsp.dsp` qui fait le son.

```
packages/dsp/modules/
  audio/filter/{eq3,sweep,moogladder}/
  audio/utility/{crossfade,tempo,normalize}/
  audio/separation/{stemsplit,stemcut}/
  audio/dynamics/quick-master/
  instruments/synth/wurlitzer/
```

`quick-master` est le seul de la liste qui **ne fait pas son son ici** : ni `jsdsp.ts` ni
`dsp.dsp`, seulement un `extends: "@engine/quick-master"` et des défauts par-dessus, comme
`eq3` en pose sur l'égaliseur du moteur. Ce qu'il nomme est un built-in compilé, et
`engine/moteur/docs/quickMaster.md` dit pourquoi ce ne pouvait pas être un graphe : les
primitives de `DspGraph` ne savent ni séparer des bandes ni atteindre la différence entre les
deux canaux.

Les deux de `separation/` vont ensemble et se lisent dans cet ordre : `stemsplit` sépare, hors
ligne, en quatre fichiers ; `stemcut` en retire un du mix d'origine, en direct, par un gain
**négatif** (`docs/stemcut.md`). Ils ont leur propre catégorie plutôt qu'une place parmi les
utilitaires parce qu'ils ne servent à rien l'un sans l'autre — et parce que c'est là que le dépôt
de bibliothèques range déjà `stemsplit`, qui est la référence depuis qu'il n'y a plus de graine.

Le premier segment est le **dossier de type**, qui décide de ce qu'un module est (`audio`,
`instruments`, `transformers`, `io`… — voir `@studio/song`'s `docs/loader.md`). Le second est sa
**catégorie**, qui décide seulement de son rangement dans un sélecteur. C'est pourquoi l'EQ est
sous `filter` et non sous `utility`, alors que les deux sont des modules audio.

## Ce n'est plus une graine

Ce dossier a été le **catalogue de départ** : le service de fichiers le recopiait dans toute
bibliothèque de compte encore vide (`seedIfEmpty`), après l'avoir lui-même recopié de la
médiathèque par HTTP dans une vie antérieure. Les deux mécanismes sont partis, et avec eux
`src/catalogue.generated.ts`, son générateur et l'export `@studio/dsp/catalogue`.

**La référence est le dépôt des bibliothèques du compte.** Ce qu'il contient est ce qu'un projet
hérite ; un build qui embarquait sa propre copie des modules de quelqu'un était une seconde
source de vérité, et deux sources ne peuvent que finir par se contredire. `initIfEmpty` ne fait
plus qu'une chose : donner un commit à un dépôt qui n'en a aucun, parce qu'un gitlink doit
pointer quelque part.

Ce que ça coûte, dit ici parce que c'est ici que la graine était argumentée : **une bibliothèque
neuve est vide**, donc toute référence `@st0/…` ne résout rien tant qu'on n'y a rien mis — y
compris les quatre qu'un SET échafaudé écrit pour ses platines. Et une référence non résolue
**n'est pas une erreur de compilation** (`@studio/song`'s `docs/sharedFolders.md`) : le module est
simplement absent du document, ce qui ressemble exactement à un module contourné.

## À quoi le dossier sert encore

- **De source** pour les DSP que ce paquet expose : `crossfade.test.ts` compare le graphe compilé
  du dossier à la fonction de `src/`, dans les deux sens, pour qu'ils ne dérivent pas.
- **De banc au moteur** : `engine/moteur/tests/Faust_test.cpp` compile les `.dsp` d'ici
  (`STUDIO_DSP_MODULES`), le wurlitzer en tête.
- **De modèle à copier** dans une bibliothèque, à la main ou depuis st0 — qui est l'endroit où un
  module s'écrit, contre un projet où le greffon qu'il nomme est réellement chargé.

Il n'y a plus rien à régénérer ni à committer en double : ajouter un module ici ne le donne à
personne, et c'est le point.
