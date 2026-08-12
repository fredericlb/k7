# Le module builder partagé, et `ui.yaml` à côté du module

Les cinq étapes sont **écrites**, plus les deux décisions qui ont suivi : un module a toujours
un dossier, et ses presets sont un fichier dedans. Ce document garde l'enquête et les
décisions ; ce qu'il reste à faire tient dans la dernière section.

## Ce qu'on veut

Un module = **son dossier**, et ce qu'il y a dedans :

```
modules/<type>/<nom>/module.yaml    ce qu'il fait
modules/<type>/<nom>/ui.yaml        à quoi il ressemble
modules/<type>/<nom>/presets.yaml   ses réglages nommés
```

(Le troisième est arrivé après ; il obéit exactement aux mêmes règles que le deuxième.)

Dans la médiathèque, cliquer sur n'importe lequel ouvre le même builder que l8.

## Décisions prises

1. **Rupture nette** pour les `ui/` existants — pas de migration, comme pour `~/.lanes`.
   Les panneaux déjà dessinés deviennent orphelins ; c'est assumé.
2. Le builder partagé va dans un **nouveau paquet `@studio/ui-module-builder`**, pas dans
   `@studio/ui-editor`.
3. **Un panneau s'écrit dans le dossier de son module, bibliothèque partagée comprise.**
   « Lire partout / écrire chez soi » disparaît : `Workspace.write` laisse passer `ui.yaml`
   sous `_modules/`, seule exception au verrou de lecture seule. Conséquence assumée :
   éditer un panneau depuis un projet change ce que voient tous les autres — c'est le sens
   de « dessiné une fois pour le greffon ».

## Le point de départ, pour situer ce qui a bougé

**`@studio/ui-editor` était déjà partagé.** La pile CodeMirror — mode YAML, complétions
dérivées du schéma, liens d'entités, widget tracker — était consommée par les deux apps. Ce
n'était pas le manque.

Le manque, c'était le **builder** : st0 avait `ModuleEditorPage.tsx` (562 l.),
`WidgetGridEditor.tsx` (787 l.) et `YamlPane.tsx` (65 l.) ; l8 n'en avait plus du tout.
D'où : extraction depuis st0, puis branchement neuf côté l8.

Pourquoi un paquet séparé plutôt que faire grossir `ui-editor` : celui-ci est la pile
*langage*, framework-agnostique. Le builder est une *vue* React. Les fondre ferait entrer
React dans un paquet qui s'en passe. (Ce qui n'empêche pas un bout de remonter dans
`ui-editor` quand il relève vraiment du langage — voir le vocabulaire, plus bas.)

## Étapes 1, 2, 5 — faites

Le dossier est la clé, et le `ref:` a disparu du fichier : deux sources de vérité, c'était
une de trop. Ce qui a bougé :

| endroit | ce qui a changé |
|---|---|
| `packages/song/src/uiLibrary.ts` | `uiPathFor` → `<type>/<sub>/ui.yaml` ; `loadUiLibrary` parcourt les bibliothèques de **modules** et dérive le ref du dossier ; `writeUiFile` résout le ref vers sa bibliothèque |
| `packages/song/src/sharedFolders.ts` | `SHARED_UI_PATH`/`SHARED_UI_DIR` supprimés ; `uiLibraryDirs` → `modulePanelRoots` ; `moduleNamespaceOf` extrait (il était dupliqué dans `moduleFork` et `uiMigrate`) |
| `packages/song/src/yaml/moduleIO.ts` | `nodeFiles` saute `ui.yaml` — **le piège du déplacement** : sans ça le panneau revenait comme un nœud `reverb:ui` |
| `packages/song/src/yaml/moduleSchema.ts` | `UiFileSchema` n'a plus de `ref` |
| `packages/file-service/src/workspace.ts` | `moduleUi()` = `dirname` ; `write()` laisse passer `ui.yaml` sous `_modules/` |
| `packages/mediatek/src/{ingest,layout}.ts` | plus de mapping `_ui → ui`, plus de `uiDir()` |
| `apps/st0/frontend/src/api.ts` | `moduleUi()` = `dirname` ; `refOfUiFile` supprimé |

Docs refaites : `packages/song/docs/uiLibrary.md`, `docs/sharedFolders.md`,
`docs/moduleCatalogue.md`, `packages/mediatek/docs/ingest.md`,
`apps/l8/docs/25-syntax-instruments.md`.

Le cas `io/` **ne disparaît pas** : un ref io nu (`desk`) n'a pas de segment de type, donc
`uiPathFor` remet le `io/` ou le fichier atterrit à la racine de la bibliothèque. Vérifié
contre le test, qui le pose maintenant explicitement.

## Un module a toujours un dossier

Un greffon scanné n'a de fichier nulle part : `engineCatalogue` synthétise `@engine/<slug>` à
partir du cache de scan, et une chaîne peut le nommer sans que rien ne soit sur le disque.
C'est une bonne disposition — copier 273 dossiers d'emballages dans chaque espace de travail,
c'est ce que faisait `module populate` et pourquoi il s'en va.

Elle cesse de tenir dès qu'on veut **posséder** quelque chose du module : une face et une
tagère de presets sont des *fichiers dans le dossier d'un module*. D'où la règle, et le
mécanisme qui la rend vraie : `materialiseEngineModule` (moduleFork.ts) fabrique le dossier,
écrit un `module.yaml` qui enregistre **quel** greffon charger — le scan est une aide à la
découverte, pas la mémoire du projet — et repointe les chaînes, exactement comme un fork.

Atteint par la commande **`module own <ref>`**, donc partagée par la CLI et le web ; dans le
graphe des chaînes, un clic droit sur un bloc `@engine/…` l'offre à la place de `ui file`, qui
n'a aucun fichier à ouvrir. `writeUiFile` refuse toujours un `@engine/` — mais le message dit
maintenant quoi faire.

## Les presets sont un fichier du dossier

Troisième frère de `module.yaml` et `ui.yaml` : `presets.yaml`, un nom et les valeurs qu'il
pose. Il remplace l'ancien dossier `<nom>.presets/` (un fichier par preset).

Ce qui disparaît, assumé : le blob `.vstpreset`. Un preset est un nom et une liste de valeurs
de paramètres, point — une seule forme, un seul chemin de code pour l'appliquer, et une tagère
lisible et éditable à la main comme tout le reste. Un greffon dont l'état n'est pas des
paramètres adressables ne peut plus mémoriser plusieurs états ; il garde le `.vstpreset` par
défaut de son dossier. Les anciens dossiers ne sont **pas** migrés, même rupture nette.

Le même piège qu'aux deux étages précédents, une troisième fois : `nodeFiles` et
`scanModules` comptaient `presets.yaml` comme un nœud. Les trois fichiers du dossier sont
maintenant nommés au même endroit (`UI_BASE` / `PRESETS_BASE`, moduleIO.ts).

Côté builder : un troisième onglet, et le menu Preset gagne un groupe « This module ». Appliquer
un preset **estampille les valeurs dans le tampon** du module — une édition, rien de plus, donc
visible avant d'être validée et annulée en ne sauvegardant pas. C'est ce qui rend supportable
d'en essayer quatre de suite. `POST /presets/apply` prend désormais un **nom** et non un chemin,
ce qui fait tomber le garde anti-traversée de la route.

## Étapes 3 et 4 — faites

`@studio/ui-module-builder` : `ModuleBuilder.tsx` (l'ancien `ModuleEditorPage`),
`WidgetGridEditor.tsx`, `YamlPane.tsx`, `moduleUi.ts` et `paramDrag.ts`, plus `store.ts` —
la couture. Les deux apps le dessinent.

**La couture, c'est `ModuleStore` : cinq appels** (`read`, `moduleUi`, `presets`, `hints`,
`write`), et
le builder ne fabrique jamais un chemin — il ne repasse que ceux qu'on lui a donnés. Les deux
espaces de chemins se ressemblent trop pour qu'il puisse en construire un. Le rationale complet
est dans `packages/ui-module-builder/docs/store.md`, y compris la seule asymétrie : `write` peut
répondre « ç'a atterri ailleurs », parce que l8 redirige une sauvegarde visant `_modules`
vers une copie locale. Le builder le remonte par `onRelocated` et ne suit pas le chemin lui-même.

Deux fichiers sont sortis plus loin que prévu :

- `yamlVocabulary.ts` → **`@studio/ui-editor/yaml/vocabulary`**, pas dans le builder : trois
  éditeurs veulent les mêmes réponses (l'`EditorPane` de l8, celui de la médiathèque, celui
  du builder), et « ce qui se complète où » est une affaire de *langage*, pas de vue. Les deux
  copies portaient chacune un commentaire disant que sa vraie place était un paquet. Son test
  a suivi. `@studio/song/yaml/fields` est du Zod pur, donc `ui-editor` reste navigable.
- `paramDrag.ts` est exporté par le builder (`/param-drag`) : `fileDrop.ts` de l8 lit le
  MIME pour ignorer le glisser, et deux copies d'un protocole ne sont pas un protocole.

**Côté l8**, un bouton *Builder* dans la barre de l'éditeur quand le fichier ouvert est un
module, et une surcouche plein écran au-dessus du shell. Un **bouton** et pas un clic détourné :
ouvrir `module.yaml` doit continuer d'ouvrir son texte, parce que c'est le chemin par lequel un
module partagé se forke. La surcouche n'offre ni presets ni paramètres de greffon vivants — ils
sont l'affaire du moteur et cette surcouche n'a pas de lien moteur.

**Côté médiathèque**, l'arbre descend enfin au niveau des fichiers : une entrée `modules` a
maintenant ses deux enfants, et cliquer l'un ou l'autre ouvre le builder sur le bon onglet
(`initialPane`). L'arbre montre **exactement les fichiers qui existent** : une ligne pour un
fichier absent ment sur le disque. Le panneau et la tagère se créent dans le builder, qui les
offre de toute façon — c'est lui l'entrée, pas l'arbre.

Au passage, le même piège qu'à l'étape 1, une couche plus haut : `scanModules` comptait comme
**nœud** tout `.yaml` qui n'était pas `module.yaml`, donc `ui.yaml`. Corrigé, et l'entrée
porte maintenant `files` — ce que le dossier contient vraiment.

## Ce qui reste

- **Rien n'a été exercé dans un navigateur.** Les deux apps compilent, se construisent et le
  serveur de dev sert les nouveaux modules à travers l'alias de l'espace de travail ; le shell
  frontend n'a pas de tests (voir `apps/l8/AGENTS.md`). La surcouche l8 et l'arbre de la
  médiathèque demandent un vrai clic.
- **Sauvegarder les params courants comme preset depuis le builder.** `saveModuleAsPreset` et
  `POST /presets/save` existent et n'ont pas de bouton : il faut un champ « nom », et une tagère
  s'écrit aussi bien à la main dans le troisième onglet. Volontairement laissé de côté.
- **`api.listUserPresets` côté l8** ne sert toujours à personne : le builder lit la tagère
  par son *store*, pas par cette route, ce qui marche identiquement dans les deux apps.

## Contexte utile

La médiathèque vient de recevoir le chrome de l8 : familles en onglets, `FileTree`
partagé en sidebar avec menus contextuels et glisser-déposer, cog pour le moteur et la
déconnexion. Le backend a gagné `POST /move`, `POST /folder` et `DELETE /folder`
(`apps/st0/backend/src/routes/library.ts`, adossées à `@studio/mediatek/write`).

Piège du `FileTree` partagé, appris à la dure : le menu contextuel **ne s'ouvre pas du
tout** si aucune action ne passe son `when` (`file-tree.tsx:385`), et `rootLabel` ne dessine
aucune ligne — il ne nomme que la cible du menu du fond. Un nœud racine visible se
synthétise.
