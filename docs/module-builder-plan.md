# Le module builder partagé, et `ui.yaml` à côté du module

Un module est **son dossier**, ce qui le décrit tient dans trois fichiers dedans, et les deux
apps dessinent le même builder par-dessus. Ce document tient les règles qui rendent ça vrai ;
ce qu'il reste à faire tient dans la dernière section.

## Un module, son dossier

```
modules/<type>/<nom>/module.yaml    ce qu'il fait
modules/<type>/<nom>/ui.yaml        à quoi il ressemble
modules/<type>/<nom>/presets.yaml   ses réglages nommés
```

Dans la médiathèque, cliquer sur n'importe lequel ouvre le même builder que st0.

## Les règles

1. Le builder partagé est un paquet à lui, **`@studio/ui-module-builder`**, et non un morceau de
   `@studio/ui-editor`. Ce dernier est la pile *langage* — mode YAML CodeMirror, complétions
   dérivées du schéma, liens d'entités, widget tracker — et il est framework-agnostique ; le
   builder est une *vue* React. Les fondre ferait entrer React dans un paquet qui s'en passe. (Ce
   qui n'empêche pas un bout de remonter dans `ui-editor` quand il relève vraiment du langage —
   voir le vocabulaire, plus bas.)
2. **Un panneau s'écrit dans le dossier de son module, bibliothèque partagée comprise.**
   `Workspace.write` laisse passer `ui.yaml` sous `_modules/`, seule exception au verrou de
   lecture seule. Conséquence assumée : éditer un panneau depuis un projet change ce que voient
   tous les autres — c'est le sens de « dessiné une fois pour le greffon ».
3. Le dossier est la clé, et le fichier ne porte pas de `ref:` : ce serait une seconde source de
   vérité. `uiPathFor` écrit `<type>/<sub>/ui.yaml`, `loadUiLibrary` parcourt les bibliothèques de
   **modules** et dérive le ref du dossier, `writeUiFile` résout le ref vers sa bibliothèque
   (`packages/song/src/uiLibrary.ts`, rationale dans `packages/song/docs/uiLibrary.md`).

Le cas `io/` est l'exception qui reste : un ref io nu (`desk`) n'a pas de segment de type, donc
`uiPathFor` remet le `io/` ou le fichier atterrit à la racine de la bibliothèque. Le test le pose
explicitement.

## Le piège : les trois fichiers ne sont pas des nœuds

Il se présente à chaque étage, et toujours de la même façon : compter comme **nœud** tout `.yaml`
du dossier qui n'est pas `module.yaml`. Sans garde, un panneau revient comme un nœud `reverb:ui`,
et une tagère de presets comme un autre. `nodeFiles` (`packages/song/src/yaml/moduleIO.ts`) et
`scanModules` sautent donc les deux, nommés au même endroit — `UI_BASE` et `PRESETS_BASE`. Côté
médiathèque, l'entrée d'un module porte `files` : ce que le dossier contient vraiment.

## Un module a toujours un dossier

Un greffon scanné n'a de fichier nulle part : `engineCatalogue` synthétise `@engine/<slug>` à
partir du cache de scan, et une chaîne peut le nommer sans que rien ne soit sur le disque. C'est
une bonne disposition — copier 273 dossiers d'emballages dans chaque espace de travail ne sert
personne.

Elle cesse de tenir dès qu'on veut **posséder** quelque chose du module : une face et une tagère
de presets sont des *fichiers dans le dossier d'un module*. D'où la règle, et le mécanisme qui la
rend vraie : `materialiseEngineModule` (moduleFork.ts) fabrique le dossier, écrit un `module.yaml`
qui enregistre **quel** greffon charger — le scan est une aide à la découverte, pas la mémoire du
projet — et repointe les chaînes, exactement comme un fork.

Atteint par la commande **`module own <ref>`** ; dans le graphe des chaînes, un clic droit sur un
bloc `@engine/…` l'offre à la place de `ui file`, qui n'a aucun fichier à ouvrir. `writeUiFile`
refuse un `@engine/`, et le message dit quoi faire.

## Les presets sont un fichier du dossier

Troisième frère de `module.yaml` et `ui.yaml` : `presets.yaml`, un nom et les valeurs qu'il pose.

Pas de blob `.vstpreset` : un preset est un nom et une liste de valeurs de paramètres, point — une
seule forme, un seul chemin de code pour l'appliquer, et une tagère lisible et éditable à la main
comme tout le reste. Un greffon dont l'état n'est pas des paramètres adressables ne peut pas
mémoriser plusieurs états ; il garde le `.vstpreset` par défaut de son dossier.

Côté builder : un troisième onglet, et un groupe « This module » dans le menu Preset. Appliquer un
preset **estampille les valeurs dans le tampon** du module — une édition, rien de plus, donc
visible avant d'être validée et annulée en ne sauvegardant pas. C'est ce qui rend supportable d'en
essayer quatre de suite. `POST /presets/apply` prend un **nom** et non un chemin, ce qui fait
tomber le garde anti-traversée de la route.

## Le paquet partagé, et la couture

`@studio/ui-module-builder` : `ModuleBuilder.tsx`, `WidgetGridEditor.tsx`, `YamlPane.tsx`,
`moduleUi.ts` et `paramDrag.ts`, plus `store.ts` — la couture. Les deux apps le dessinent.

**La couture, c'est `ModuleStore` : cinq appels** (`read`, `moduleUi`, `presets`, `hints`,
`write`), et le builder ne fabrique jamais un chemin — il ne repasse que ceux qu'on lui a donnés.
Les deux espaces de chemins se ressemblent trop pour qu'il puisse en construire un. Le rationale
complet est dans `packages/ui-module-builder/docs/store.md`, y compris la seule asymétrie :
`write` peut répondre « ç'a atterri ailleurs », parce que st0 redirige une sauvegarde visant
`_modules` vers une copie locale. Le builder le remonte par `onRelocated` et ne suit pas le chemin
lui-même.

Deux fichiers vivent plus loin que le builder :

- `yamlVocabulary.ts` est dans **`@studio/ui-editor/yaml/vocabulary`** : trois éditeurs veulent
  les mêmes réponses (l'`EditorPane` de st0, celui de la médiathèque, celui du builder), et « ce
  qui se complète où » est une affaire de *langage*, pas de vue. `@studio/song/yaml/fields` est du
  Zod pur, donc `ui-editor` reste navigable.
- `paramDrag.ts` est exporté par le builder (`/param-drag`) : `fileDrop.ts` de st0 lit le MIME
  pour ignorer le glisser, et deux copies d'un protocole ne sont pas un protocole.

**Côté st0**, un bouton *Builder* dans la barre de l'éditeur quand le fichier ouvert est un
module, et une surcouche plein écran au-dessus du shell. Un **bouton** et pas un clic détourné :
ouvrir `module.yaml` doit continuer d'ouvrir son texte, parce que c'est le chemin par lequel un
module partagé se forke. La surcouche n'offre ni presets ni paramètres de greffon vivants — ils
sont l'affaire du moteur et cette surcouche n'a pas de lien moteur.

**Côté médiathèque**, l'arbre descend au niveau des fichiers : une entrée `modules` a ses deux
enfants, et cliquer l'un ou l'autre ouvre le builder sur le bon onglet (`initialPane`). L'arbre
montre **exactement les fichiers qui existent** : une ligne pour un fichier absent ment sur le
disque. Le panneau et la tagère se créent dans le builder, qui les offre de toute façon — c'est
lui l'entrée, pas l'arbre.

## Ce qui reste

- **Rien n'est exercé dans un navigateur.** Les deux apps compilent, se construisent et le
  serveur de dev sert les modules à travers l'alias de l'espace de travail ; le shell frontend n'a
  pas de tests (voir `apps/st0/AGENTS.md`). La surcouche st0 et l'arbre de la médiathèque
  demandent un vrai clic.
- **Sauvegarder les params courants comme preset depuis le builder.** `saveModuleAsPreset` et
  `POST /presets/save` existent et n'ont pas de bouton : il faut un champ « nom », et une tagère
  s'écrit aussi bien à la main dans le troisième onglet. Volontairement laissé de côté.
- **`api.listUserPresets` côté st0** ne sert à personne : le builder lit la tagère par son *store*,
  pas par cette route, ce qui marche identiquement dans les deux apps.

## Le chrome de la médiathèque

La médiathèque porte le chrome de st0 : familles en onglets, `FileTree` partagé en sidebar avec
menus contextuels et glisser-déposer, cog pour le moteur et la déconnexion. Le backend a
`POST /move`, `POST /folder` et `DELETE /folder` (`apps/pl8/backend/src/routes/library.ts`,
adossées à `@studio/mediatek/write`).

Piège du `FileTree` partagé : le menu contextuel **ne s'ouvre pas du tout** si aucune action ne
passe son `when` (`file-tree.tsx:385`), et `rootLabel` ne dessine aucune ligne — il ne nomme que
la cible du menu du fond. Un nœud racine visible se synthétise.
