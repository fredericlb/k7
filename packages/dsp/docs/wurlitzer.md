# Le Wurlitzer : d'où viennent ses nombres, et ce qui manque pour l'entendre

`modules/wurlitzer/` est un module Faust — `plugin: {type: faust}` et un `dsp.dsp`. Cette
page est sa provenance : il n'y a **pas** de Wurlitzer en Faust dans la distribution
officielle, donc il est porté d'ailleurs, et tout ce qui suit est vérifiable ligne à ligne
contre la source d'origine.

## Ce que j'ai cherché avant d'écrire

Le dossier `examples/physicalModeling/faust-stk/` de la distribution Faust — le Faust-STK de
Romain Michon, qui est l'endroit où un tel modèle vivrait s'il existait — contient vingt
instruments et **aucun piano électrique** : `piano.dsp`, `piano1.dsp` et `harpsi.dsp` sont
les seuls claviers. Rien non plus dans `synths.lib`, qui a bien une émulation DX7 mais pas
de Wurlitzer.

En revanche le **Synthesis ToolKit** de CCRMA a une classe `stk::Wurley`, en C++ : « deux
paires FM simples sommées, aussi appelé algorithme 5 du TX81Z ». C'est de là que vient ce
module. Ce n'est donc pas une transcription d'un modèle Faust existant, c'est un port — et
ce qui suit dit exactement ce qui a été repris et ce qui ne l'a pas été.

## La table de correspondance

Tout vient de `Wurley.cpp` (constructeur, `noteOn`, `tick`) et de `FM.cpp` pour la table de
gains et le deux-zéros.

| STK | ici | valeur |
|---|---|---|
| `setRatio(0, 1.0)` | porteuse de la paire A | `freq` |
| `setRatio(1, 4.0)` | modulateur de la paire A | `freq * 4` |
| `setRatio(2, -510.0)` | porteuse de la paire B | **510 Hz fixes** |
| `setRatio(3, -510.0)` | modulateur de la paire B | **510 Hz fixes** |
| `fmGains_[i]` | `fmGain(i)` | `0.933033 ^ (99 - i)` |
| `adsr_[0..1]->setAllTimes` | `e0`, `e1` | `0.001, 1.50, 0.0, 0.04` |
| `adsr_[2]->setAllTimes` | `e2` | `0.001, 0.25, 0.0, 0.04` |
| `adsr_[3]->setAllTimes` | `e3` | `0.001, 0.15, 0.0, 0.04` |
| `twozero_.setGain(2.0)`, `setB2(-1)` | `tz` | `2·(x − x[n−2])` |
| `vibrato_.setFrequency(8.0)` | `vib` | 8 Hz |
| `control1_`, `control2_` | `Index`, `Tine` | 1 au repos, plage 0–2 |
| `lastFrame_[0] = temp * 2.0` | `out` | ×2 |

Un rapport **négatif** chez STK ne veut pas dire « à l'envers » : il veut dire une fréquence
absolue en Hz au lieu d'un multiple de la note. C'est ce qui fait que la paire B ne transpose
pas, et c'est le cœur du son — le bruit du marteau sur la lame appartient au mécanisme, pas à
la note qu'on joue. Un port qui lirait `-510` comme un rapport ferait un instrument qui sonne
juste dans le grave et faux ailleurs, sans rien qui le signale.

## Les trois écarts, assumés

1. **`waves_[3]` utilise `fwavblnk.raw` chez STK, une sinusoïde ici.** C'est une table
   d'ondes livrée avec STK ; on ne peut pas l'embarquer dans un fichier source, et un module
   est un dossier qu'on copie. L'attaque est donc un peu plus propre que l'originale.
2. **`gains_[2]` vaut `fmGains_[92]` dans le constructeur et `fmGains_[82]` dans `noteOn`.**
   `noteOn` tourne toujours, donc [82] est la valeur effective et c'est celle qui est ici. Le
   [92] du constructeur n'est jamais entendu — ce n'est pas un choix, c'est une lecture.
3. **Le vibrato est à zéro au repos.** `modDepth_` de STK vaut zéro tant qu'un contrôleur ne
   l'ouvre pas, donc `Wurley` ne vibre pas non plus tant qu'on ne lui demande rien. Le potard
   est là pour qu'on puisse, pas pour qu'il vibre par défaut.

## Ce qui manque pour l'entendre — deux choses, pas une

**Le compilateur.** `FaustPlugin` reçoit la source et passe l'audio inchangé ;
`engine/moteur/docs/faust.md` tient les trois façons de le remplir et ce que chacune coûte.

**La couture INSTRUMENT**, qui n'existe pas du tout et que ce module est le premier à
demander. La couture Faust posée jusqu'ici est celle d'un effet : audio en entrée, audio en
sortie, et le greffon est inscrit au catalogue avec le rôle `audioEffect`. Un instrument
demande trois choses de plus :

- `takesMidiInput()` vrai, et la lecture du flux de notes dans `applyToBuffer` — le contexte
  de rendu de Tracktion le porte déjà, aucun de nos greffons intégrés ne le lit ;
- `producesAudioWhenNoAudioInput()` vrai, sans quoi rien ne tourne sur une piste sans entrée ;
- un **répartiteur de voix**. C'est lui qui remplit `freq`, `gain` et `gate` — les trois noms
  que `dsp.dsp` déclare et que le `params:` du module laisse volontairement de côté. Faust le
  fournit (`mydsp_poly`), mais il vient avec le compilateur : sans compilateur, il n'y a pas
  de voix à répartir.

Le troisième est la raison pour laquelle ça n'a pas été fait dans la même passe : il ne se
teste pas. On peut écrire du code MIDI spéculatif contre une classe qui ne compile rien, et
il aura l'air juste jusqu'au jour où on l'exercera. Le module est donc écrit dans la
convention que `mydsp_poly` attend — c'est la partie qui est décidable aujourd'hui — et le
reste attend le compilateur.

## Sources

- [stk::Wurley](https://ccrma.stanford.edu/software/stk/classstk_1_1Wurley.html) — la classe et son algorithme
- [Wurley.cpp](https://github.com/thestk/stk/blob/master/src/Wurley.cpp) — les nombres de la table ci-dessus
- [faust-stk](https://github.com/grame-cncm/faust/tree/master-dev/examples/physicalModeling/faust-stk) — le dossier où il n'est pas
- [Faust-STK, Michon & Smith, DAFx-11](https://ccrma.stanford.edu/~rmichon/publications/doc/DAFx11-Faust-STK.pdf) — ce que cette collection couvre
- [envelopes.lib](https://faustlibraries.grame.fr/libs/envelopes/) et [oscillators.lib](https://faustlibraries.grame.fr/libs/oscillators/) — les signatures utilisées
