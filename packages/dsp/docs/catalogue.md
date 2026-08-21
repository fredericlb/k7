# Le catalogue : ce dont on remplit une bibliothèque `@st0` neuve

`packages/dsp/modules/` est le catalogue de départ. Quand le service de fichiers clone une
bibliothèque de compte encore vide, il y écrit ces modules, committe et pousse
(`seedIfEmpty`, `packages/file-service/src/libraries.ts`).

## Pourquoi ça a cessé de marcher

Le catalogue était sur le volume de la médiathèque, et le semis le recopiait par HTTP. Quand
les modules ont quitté ce volume — un module s'écrit dans st0, contre un projet où le greffon
qu'il nomme est réellement chargé — la copie a été retirée et **rien ne l'a remplacée** :
`seedIfEmpty` est devenu `initIfEmpty`, un commit vide, et un compte neuf se retrouvait avec
une bibliothèque de rien.

Ce qui ne se voyait pas. Une référence `@st0/…` qui ne résout pas **n'est pas une erreur de
compilation** : le module est simplement absent du document, ce qui ressemble exactement à un
module contourné. Un set fraîchement créé nomme quatre de ces refs dans ses nœuds — crossfade,
tempo, eq3, sweep — et arrivait donc muet, sans une ligne pour le dire.

## Le dossier EST une bibliothèque

```
packages/dsp/modules/
  audio/filter/{eq3,sweep,moogladder}/
  audio/utility/{crossfade,tempo,normalize,stemsplit}/
  instruments/synth/wurlitzer/
```

Ce rangement n'est pas cosmétique : c'est ce qui permet au semis d'être **une copie** plutôt
qu'une table qui mappe un ref sur un chemin. Une clé du catalogue est un ref moins son
namespace — `audio/utility/tempo` ↔ `@st0/audio/utility/tempo` — et `catalogue.test.ts` tient
les deux ensemble sur les quatre que `scaffoldSet` écrit.

(Le dossier était plat avant, ce qui allait tant que personne ne semait avec.)

Le premier segment est le **dossier de type**, qui décide de ce qu'un module est
(`audio`, `instruments`, `transformers`, `io`… — voir `@studio/song`'s `docs/loader.md`). Le
second est sa **catégorie**, qui décide seulement de son rangement dans un sélecteur. C'est
pourquoi l'EQ est sous `filter` et non sous `utility`, alors que les deux sont des modules
audio.

## Pourquoi il est GÉNÉRÉ dans du TypeScript

`src/catalogue.generated.ts` tient les fichiers en dur, et c'est obligatoire :
**`@studio/file-service` est esbuildé en un seul `.mjs`** posé dans les ressources du capot
(`engine/capot/scripts/build-engine.mjs`). Il n'y a pas de `packages/dsp/` à côté de lui à
l'exécution. Un `readFileSync` relatif marcherait en dev, sous tsx, et échouerait dans l'app
livrée — la forme de panne que ce dépôt déteste le plus, puisqu'elle passe tous les tests.

C'est le même motif que `builtinParams.generated.ts` et que `AirWindowsList.h` : un générateur,
une sortie commitée, et un test qui refuse la dérive.

```
npm run gen:catalogue --workspace @studio/dsp
```

À lancer après avoir ajouté ou modifié un module ici, et **à commiter**. `catalogue.test.ts`
compare le fichier généré au dossier dans les deux sens : un fichier ajouté sans régénérer est
un module que personne ne reçoit, un fichier supprimé sans régénérer est un module que tout le
monde garde pour toujours.

Le générateur porte une **liste blanche** de noms de fichiers (`module.yaml`, `ui.yaml`,
`presets.yaml`, `jsdsp.ts`, `jsdsp.json`, `dsp.dsp`) et signale bruyamment ce qu'il laisse de
côté. Une liste noire aurait échoué en silence : un `.DS_Store` se retrouverait committé dans
la bibliothèque de tout le monde, et un `.wav` déposé là serait embarqué en mojibake, puisque
tout est lu en UTF-8. Un binaire demandera du base64 et une décision ; aujourd'hui il n'y en a
aucun.

## Ce que le semis ne fait jamais

**Écrire dans un `modules/` qui existe.** Ce sont les modules du compte, et les remplacer par
la version que ce build embarque est une perte de données silencieuse. La question est posée au
DOSSIER — pas à un drapeau que quelqu'un doit tenir — et un seul module dedans suffit à ce que
le semis n'y touche pas du tout.

Un `README.md` ne compte pas : un dépôt créé depuis une interface web en a presque toujours un,
et refuser de semer à cause de lui laisserait un compte neuf sans catalogue et sans explication.
Avoir un commit et avoir des modules sont deux questions distinctes.
