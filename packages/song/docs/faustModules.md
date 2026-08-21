# Un module écrit en Faust

`plugin: {type: faust}` et un `dsp.dsp` dans le dossier du module. C'est le frère de
`jsdsp`, et cette page tient à la différence entre les deux — plus l'état exact de ce qui
est branché aujourd'hui, qui n'est pas « ça marche ».

## L'état, d'abord

**Le moteur ne compile rien.** `FaustPlugin` existe, se charge, reçoit la source et
*passe l'audio sans le toucher*, en le disant une fois sur le canal des avertissements. Tout
ce qui est au-dessus est fini : le module se charge, se dessine dans le graphe avec la bonne
couleur, s'édite dans le builder, arrive dans le document compilé et atteint le moteur.

C'est délibérément l'ordre dans lequel ça a été fait. La couture se voit et s'exerce avant
qu'on décide ce que coûte un compilateur — voir `engine/moteur/docs/faust.md` pour ce qui
manque et les trois façons de le combler.

## Le dossier

```
modules/audio/moogladder/
  module.yaml       plugin: {type: faust}, params:
  dsp.dsp           la source           (nom FIXE — FAUST_FILE)
  ui.yaml           la face
  presets.yaml      les réglages nommés
  assets/           ce que ses params nomment
```

Le nom du fichier est une constante et non un champ, exactement comme `jsdsp.ts` : le type
dit que le fichier est là, et un module reste un dossier qu'on copie sans rien réécrire
dedans.

Pas de `.vstpreset` : l'état d'un module Faust *est* ses paramètres, donc `presets.yaml`
suffit. Même raison que pour un module jsdsp.

## Ce qui le distingue de jsdsp : QUI compile

C'est la seule différence, et elle explique tout le reste.

| | `jsdsp` | `faust` |
|---|---|---|
| la source | `jsdsp.ts` | `dsp.dsp` |
| qui la compile | **ici**, `readJsDspGraph` lance un process Node | **le moteur**, dans le constructeur du greffon |
| ce qui part sur le fil | `dspGraph` — le JSON produit | `faustDsp` — le texte de la source |
| artefact frère commité | `jsdsp.json`, reconstruit sur la mtime | **aucun** |
| ce qui tourne sur le thread audio | l'interpréteur `DspGraph` | du code compilé |

L'absence d'artefact frère n'est pas un oubli. Le `.json` de jsdsp existe parce qu'il faut
Node pour lire un `.ts` et qu'on ne veut pas payer 200 ms par compilation ni exiger Node
d'un poste qui joue. Ici le compilateur est déjà de l'autre côté du fil : un cache de sa
sortie serait une deuxième source de vérité au profit de personne. `readFaustSource` lit le
fichier, point.

**Le jour où l'app aura besoin de la liste des paramètres SANS moteur**, ça change : il
faudra `faust -json` à la compilation et un `dsp.json` frère après tout. Ce jour n'est pas
venu — le panneau et le graphe lisent les noms dans le `params:` du `module.yaml`, que
l'auteur écrit de toute façon.

## Les paramètres, et ce que personne ne vérifie

Un `hslider("Cutoff", 1200, 20, 20000, 1)` donne nom, minimum, maximum, défaut et pas :
la forme exacte de `DspGraphParam`, donc `params:`, `ui.yaml`, `presets.yaml`, les
automations et les `viewBindings` continuent sans rien savoir de Faust.

Ce qu'aucun des deux côtés ne vérifie, c'est que le `params:` du `module.yaml` et les
`hslider` de la source parlent des mêmes noms. Rien ici ne peut le faire : les paramètres
sont déclarés par le compilateur, qui est dans le moteur. Une faute de frappe donne donc un
réglage que personne ne lit — et le moteur le dit, une ligne par nom inconnu
(`applyPluginParams`, PluginParams.cpp). C'est le seul filet, et il est à l'exécution.

## Les imports

`import("stdfaust.lib")` doit se résoudre quelque part, et un dossier de module doit rester
copiable. La règle prévue, non implémentée puisque rien ne compile encore :

- les **bibliothèques standard** voyagent avec le moteur, jamais dans le dossier du module ;
- ce que le module a écrit lui-même va dans un `lib/` à lui ;
- le chemin d'inclusion est `[<dossier du module>, <libs du moteur>]`, dans cet ordre, et un
  import qui sort du dossier est refusé comme `resolveAssets` refuse un `../`.

Ce qui suppose que le dossier du module soit connu du moteur — il ne l'est pas : ce qui part
sur le fil est le TEXTE de la source, pas son chemin. Un module qui importe un fichier à lui
demandera donc soit un champ de plus dans `PluginDoc`, soit que le compilateur d'ici aplatisse
les imports avant l'envoi. À trancher avec le compilateur, pas avant.

## Les quatre portes

Un mot de `plugin.type` doit être connu de quatre endroits, et celui qu'on oublie ne dit
rien. Pour mémoire, parce que la deuxième a déjà été oubliée pour `jsdsp` et que les modules
migrés disparaissaient *silencieusement* du document compilé :

| fichier | ce qu'il fait |
|---|---|
| `loader.ts` `dspSourceFor` | résout la source contre le dossier du module |
| `nodeProject.ts` | la porte du compilateur — un type inconnu est jeté sans un mot |
| `graphDoc.ts` `known` | la couleur du nœud : rouge veut dire « le moteur ne sait pas charger ça » |
| `enginePlugin` (engine-protocol/build.ts) | la correspondance vers le greffon intégré |

## Éditer la source pendant que ça joue

`keyOf` (ProjectDiff.cpp) plie `faustDsp` dans l'identité du greffon, donc sauvegarder
`dsp.dsp` le fait re-créer — obligatoire, puisque la compilation est dans le constructeur.

**`dspGraph` n'y est pas**, et c'est un écart connu du côté jsdsp : éditer un `jsdsp.ts`
pendant que le moteur tourne atteint le document et ne change rien qu'on entende, jusqu'au
prochain rebuild complet. Noté ici parce que c'est en le décalquant qu'on le voit ; pas
corrigé dans la même passe pour ne pas changer ce qui joue en même temps qu'on ajoute une
langue.
