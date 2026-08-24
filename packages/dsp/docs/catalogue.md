# `modules/` — les modules écrits ici, et ce à quoi le dossier sert

`packages/dsp/modules/` tient des modules **écrits dans ce dépôt** : leur `module.yaml`, leur
panneau, et le `jsdsp.ts` ou le `dsp.dsp` qui fait le son.

```
packages/dsp/modules/
  audio/filter/{eq3,sweep,moogladder}/
  audio/utility/{crossfade,fade,tempo,normalize}/
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
de bibliothèques range déjà `stemsplit`, et ce dépôt-là est la référence.

Trois d'entre eux ont leur propre page, parce que leurs nombres se justifient plutôt qu'ils ne se
lisent : `sweep` (`docs/sweep.md`), `stemcut` (`docs/stemcut.md`) et le wurlitzer
(`docs/wurlitzer.md`). Ce que la bibliothèque elle-même impose à tous — les trois taux, l'indice de
port, la garde de `geolerp` — est dans `docs/builder.md`.

## `fade` et `crossfade` — le même effet, et une seule des deux formes tient sur un pupitre

Les deux fondent entre deux signaux. `crossfade` le fait dans **un** module à deux ports ; `fade`
le fait avec **deux** modules à un port, pilotés en **miroir** par le même contrôle. Le paramètre
d'un `fade` EST son gain — 0 muet, 1 plein — donc son panneau se lit seul, sans second nombre à
travers lequel le traduire.

L'arithmétique est identique. Ce qui diffère est ce que chaque forme exige du moteur, et c'est là
que la seconde gagne. Le second port d'un module se câble en **sidechain**, et une sidechain ne
lit une piste que si cette piste atteint réellement une sortie audible — mesuré cinq fois, dans
`engine/moteur/docs/sidechain.md`. Une platine qui n'alimente qu'un crossfade est donc entendue
**à côté** de lui, brute, et le fondu ne peut rien lui retirer. Aucun mute, aucun débranchement,
aucun routage vers un puits ne dénoue ça : tout ce qui la retire du master la retire du fondu.

Deux `fade` n'ont pas ce problème parce qu'ils n'ont pas de second port. Chaque côté reste une
piste ordinaire, avec sa sortie ordinaire, et la somme se fait au mixeur — là où les sommes se
font. Le prix est un module de plus dans le graphe et une règle de plus dans le mappage du pupitre :
un contrôle, deux paramètres, dont l'un en miroir (`packages/song/docs/setProject.md`).

`crossfade` reste juste, et reste le bon choix partout où ses deux entrées vivent déjà sur la même
piste. C'est sur un pupitre, où elles n'y vivent pas, qu'il ne peut pas tenir.

## `normalize` — le graphe est trivial, et c'est tout le sujet

`packages/dsp/src/normalize.ts` applique un gain, un nœud, et rien d'autre. Savoir **quel** gain est
la partie difficile, et aucun graphe par bloc ne peut y répondre : un nœud en flux ne voit que les
échantillons qu'il a, et le plus fort peut être le dernier. La mesure n'est donc pas là — `Peak` est
une **entrée** du graphe, remplie par la passe froide qui lit le fichier de bout en bout
(`packages/song/docs/coldModules.md`), et ce qui reste à décrire est l'arithmétique.

C'est exactement ce qui rend le module *froid* plutôt que simplement coûteux : ce n'est pas que
mesurer coûte trop cher en direct, c'est qu'en direct il n'y a encore rien à mesurer.

Deux détails tiennent le reste. `Peak` vaut **0 dBFS** par défaut : sans passe, le gain se réduit à
`Target` et le module ne fait qu'atténuer, ce qui est la direction inoffensive pour se tromper. Et
la différence est **bornée** avant le passage en linéaire, parce que l'arithmétique a un cas
dégénéré très bruyant : un quasi-silence mesure −100 dBFS et demanderait +99 dB, transformant un
souffle en rugissement pleine échelle. +30 est généreux pour tout ce qui vaut d'être normalisé et
fini pour le reste.

Le premier segment est le **dossier de type**, qui décide de ce qu'un module est (`audio`,
`instruments`, `transformers`, `io`… — voir `@studio/song`'s `docs/loader.md`). Le second est sa
**catégorie**, qui décide seulement de son rangement dans un sélecteur. C'est pourquoi l'EQ est
sous `filter` et non sous `utility`, alors que les deux sont des modules audio.

## Ce n'est pas une graine

Ce dossier n'est recopié dans aucune bibliothèque de compte. **La référence est le dépôt des
bibliothèques du compte** : ce qu'il contient est ce qu'un projet hérite, et un build qui
embarquerait sa propre copie des modules de quelqu'un serait une seconde source de vérité — deux
sources ne peuvent que finir par se contredire. `initIfEmpty` ne fait qu'une chose : donner un
commit à un dépôt qui n'en a aucun, parce qu'un gitlink doit pointer quelque part.

Ce que ça coûte, dit ici parce que c'est ici qu'on viendrait chercher une graine : **une
bibliothèque neuve est vide**, donc toute référence `@st0/…` ne résout rien tant qu'on n'y a rien mis — y
compris les quatre qu'un SET échafaudé écrit pour ses platines. Et une référence non résolue
**n'est pas une erreur de compilation** (`@studio/song`'s `docs/sharedFolders.md`) : le module est
simplement absent du document, ce qui ressemble exactement à un module contourné.

## À quoi le dossier sert

- **De source** pour les DSP que ce paquet expose : `crossfade.test.ts` compare le graphe compilé
  du dossier à la fonction de `src/`, dans les deux sens, pour qu'ils ne dérivent pas.
- **De banc au moteur** : `engine/moteur/tests/Faust_test.cpp` compile les `.dsp` d'ici
  (`STUDIO_DSP_MODULES`), le wurlitzer en tête.
- **De modèle à copier** dans une bibliothèque, à la main ou depuis st0 — qui est l'endroit où un
  module s'écrit, contre un projet où le greffon qu'il nomme est réellement chargé.

Il n'y a rien à régénérer ni à committer en double : ajouter un module ici ne le donne à
personne, et c'est le point.
