# Audit — vitesse du côté web

Le pendant de [engine/moteur/docs/audit-stabilite.md](../engine/moteur/docs/audit-stabilite.md)
pour tout ce qui n'est pas du C++ : le service de fichiers, le compilateur, les surfaces — plus le
FIL, où les deux se rejoignent. Ce qui reste au C++ seul (le rappel audio, `applyFull`, les
drapeaux de compilation) est chez lui, pas ici.

Il reprend sa règle de méthode, qui est la seule qui compte ici :

> **Mesurer à travers deux compilations n'est pas mesurer.**

Un chiffre pris avant un `npm i`, un redémarrage ou un changement de machine ne se compare pas
à un chiffre pris après. Ce qui se compare, ce sont deux bras dans la même invocation.

## De quoi mesurer

Trois benchs, `npm run bench` dans chacun des trois paquets :

| cible | paquet | ce qu'elle isole |
|---|---|---|
| `compileNodeProject` | `song` | le compilateur, disque compris |
| `buildGraphDoc` | `file-service` | la vue chaînes, **sans** les extents de clips — ceux-là sont le compilateur, et deux coûts pliés en un ne veulent rien dire |
| `buildGraph` | `ui-chains` | l'arithmétique nœuds/arêtes + dagre, **sans disque** : cette fonction prend un `WebGraph`, pas un dossier |

La fixture est **synthétique et paramétrée par la taille** (`packages/song/src/benchProject.ts`,
publiée par la porte `./testSupport` déjà existante plutôt que par un sous-chemin de plus — voir
`docs/inventaire.md` sur les sous-chemins que personne n'importe). Les projets committés sous
`demos/` tiennent UNE piste : une fixture d'une piste mesurerait le démarrage et rien
d'autre. Deux tailles, 8 et 64 pistes, parce que ce qui se lit est la **courbe** — un coût qui
double quand le morceau double va bien, un coût qui quadruple est le constat.

Le dossier finit en `.st0`, et ce n'est pas cosmétique : le service décide qu'un dossier est un
projet d'après son NOM. Un dossier temporaire nu compile parfaitement à travers `@studio/song` et
reste invisible pour `Workspace` — les deux moitiés du harnais doivent pouvoir l'ouvrir.

## Ce que les chiffres disent

| | 8 pistes | 64 pistes | rapport |
|---|---|---|---|
| `buildGraph` (sans disque) | 0,046 ms | 0,365 ms | **×8** |
| `compileNodeProject` | 13,4 ms | 68,1 ms | ×5 |
| `buildGraphDoc` | 13,5 ms | 68,5 ms | ×5 |

Trois choses tombent de là, et aucune ne se voit à la lecture du code :

- **`buildGraph` est exactement linéaire.** Huit fois les pistes, huit fois le temps. dagre et
  l'arithmétique du graphe ne sont pas un problème et n'ont pas besoin qu'on les regarde.
- **Les deux autres coûtent la même chose à la milliseconde près.** `buildGraphDoc` ne compile
  pas le projet ici — et il coûte pourtant ce que coûte le compilateur. Les deux sont donc
  dominés par un troisième coût qu'ils partagent : la lecture des modules sur le disque.
- **La grande taille a ±36 à 40 % de variance** (min 17 ms, max 92 ms sur la même mesure), là où
  la petite en a ±1,5 %. C'est un cache qui tantôt touche et tantôt manque, et c'est la marche
  d'empreinte des modules — voir plus bas.

## Ce que coûte chaque route

Mesuré sur le vrai poste, sur `lemo_mante/01.danse.st0` — un morceau de 15 pistes dans un dépôt
de 721 répertoires — huit passes par point, en millisecondes :

| | ms | |
|---|---|---|
| `GET /workspace` | 0,01 | la liste est tenue ; 25,8 sur le rebalayage, une fois toutes les 5 s |
| `GET /project-errors` | 29,2 | une seule marche d'empreinte, prise en portée |
| `GET /project-doc` | 4,9 | mémoïsé ; c'est la marche du jeton |
| `GET /graph` | 4,8 | idem, 62 ms à froid |
| `GET /module-libraries` | 14,4 | pas de cache — voir plus bas |
| les marches d'une commande qui ÉCRIT | 16 | une seule traversée par phase (`walkProject` / `withWalk`) |
| les six routes d'un rechargement | 108 | 230 sans le watcher de dossiers de modules |

Le service est **un seul processus** : tout ça fait la queue.

Le compromis de `/workspace` est écrit et testé : un dossier apparu derrière le dos du service
(un `git pull`, un `mkdir` à la main) se voit au balayage suivant et pas au sondage suivant.
`cachedProjectDoc` refuse ce marché, et doit le refuser — une COMPILATION périmée se trompe avec
assurance sur une chanson. Une liste de projets en retard de cinq secondes est un sélecteur qui
n'a pas encore vu un dossier : une attente, pas un mensonge.

Le balayage descend DANS un projet — un projet peut en nicher un autre — donc s'arrêter au
premier reconnu serait une règle que ce dépôt n'a jamais eue. Un test le fige, avec le projet en
profondeur (`albums/winter.st0`).

## L'empreinte des modules — le premier poste

C'est le premier poste de dépense de tout ce voisinage : **19 ms** par marche, et ce sont ces
19 ms, pas le clone profond de `loadModules` (0,21 ms sur 575 refs), qui font la variance des
gros projets. Elle vaut ce qu'elle protège — une lecture de 295 ms — donc le remède n'est pas de
la supprimer mais de la payer moins souvent.

### Elle ne peut pas être moins chère

Mesuré sur la chanson de référence : **329 `readdir` = 11,7 ms, 419 `stat` = 11,9 ms**,
moitié-moitié.

- `readdirSync(recursive: true)` ne gagne rien (23,6 ms contre 23,5) : il stat en interne pour
  décider de descendre. Impasse.
- Les 419 `stat` sont sur des fichiers dont le contenu est VRAIMENT lu : 291 `module.yaml`,
  42 `ui.yaml`, 68 fichiers de `nodes/`. Restent une quinzaine de `jsdsp.ts` et `.vstpreset`
  dont seul le CHEMIN est retenu — 4 % du total. Rétrécir `DEFINITION` ne vaut pas son risque.
- La mtime d'un DOSSIER ne bouge pas quand le contenu d'un fichier change (NTFS), donc elle ne
  peut pas remplacer les `stat` de fichiers. C'est ce qui ferme la porte.
- Un cache à l'horloge est refusé par `moduleCache.ts` lui-même, et à raison : le dépôt écrit
  des fichiers de module dans ses tests puis les relit aussitôt.

### Elle se paie une fois par dérivation, pas une fois par lecture

`withModuleStamp` et `withRevision` sont des portées **ré-entrantes** : une portée imbriquée sur
le même projet trouve celle qui est ouverte (`if (scope?.dir === dir) return fn()`) au lieu d'en
ouvrir une neuve et de rejeter l'empreinte déjà payée. Le contrat est figé par un test, et il est
exigeant dans les deux sens : à l'intérieur d'une portée, les dossiers de modules sont tenus pour
immobiles, et l'appel imbriqué doit honorer la MÊME promesse plutôt que re-vérifier en douce.

Le jeton de révision regarde deux fichiers HORS du projet, parce que deux fichiers hors du projet
décident de ces réponses : le cache de scan du moteur (`~/.studio/exts.json`, d'où sortent les
modules `@engine/…`) et les préférences de la machine (`~/.studio/preferences.yaml`, d'où sort
l'étiquette d'un canal). Deux `stat` de plus sur une marche qui en fait des centaines, et c'est
dans le JETON plutôt que dans chaque cache, parce que c'est une propriété de « qu'est-ce qui a
changé », pas de l'un des lecteurs.

### Et sous une marche par route, grâce au watcher

Une portée ne va pas plus loin qu'une dérivation, et six routes sont six requêtes : descendre
sous six marches par rechargement demande de tenir l'empreinte ENTRE deux requêtes.
`@studio/song` a pour cela une couture d'une ligne — `useFoldersStill(fn)`, un booléen — et rien
d'autre : ni watcher, ni horloge, ni dépendance. `false` veut dire « marche », et c'est ce que
reçoit tout ce qui n'installe rien : les tests, un script. Le watcher est dans le service de
fichiers, seul processus qui vive assez longtemps pour tenir des poignées, avec un plafond de dix
secondes parce que `fs.watch` perd des événements — sans plafond, un seul événement perdu
laisserait le vocabulaire périmé POUR DE BON. Rationale complet :
`packages/file-service/docs/moduleWatch.md`.

**Un watcher ne suffit pas : le processus qui écrit doit le DIRE aussi.** `fs.watch` livre ses
événements au tick suivant, donc une commande qui écrit un fichier de module puis reconstruit le
graphe — une seule requête, synchrone — demande avant que son propre événement n'arrive, et le
plafond de dix secondes n'aide pas : ces dix secondes-là sont justement celles qui comptent. D'où
`moduleFoldersMoved()`, câblé sur `Workspace.invalidateProjectDoc`, le point de passage unique de
« quelque chose a changé ». Délibérément brutal, toutes les écritures et pas seulement celles d'un
module : savoir lesquelles c'est déjà savoir la réponse, et une marche de plus après une écriture
est exactement ce qu'une écriture coûtait de toute façon. La leçon vaut pour tout cache adossé à
un watcher : les deux sources doivent être branchées, pas l'une ou l'autre.

## Ce qui est laissé tel quel, sciemment

- **`/module-libraries` ne gagne rien à être mis en cache.** Le seul jeton honnête pour lui est
  l'empreinte des modules, qui balaie les mêmes arbres et coûte 19 ms là où la marche en coûte 14 :
  le cache coûterait plus cher que ce qu'il évite. Et la profondeur ne peut pas être réduite —
  l'onglet Bibliothèques passe les sous-arbres tels quels à `foldModules`, qui a besoin du contenu
  d'un dossier de module pour en faire une ligne.
- **`setCachedProjectDoc` appelle `revision()` au MILIEU de la mutation**, donc hors de toute
  portée, donc une marche de plus pour toute commande qui passe par `applyProject` (mute, solo, un
  fader). Elle ne peut pas être partagée : elle décrit un instant qui n'est ni l'avant ni l'après.
  La supprimer voudrait dire que le doc compilé se donne un jeton qu'il n'a pas mesuré, ce qui est
  exactement le mensonge que `cachedProjectDoc` refuse.

## Ce qui est déjà bon, et qu'il ne faut pas re-suspecter

- **Le sondage `/revision` est unique et recompté** (`useRevision.ts`), requêtes en vol
  supprimées. Il n'existe **aucun** second timer sur cette route. Les autres timers visent
  d'autres routes et sont tous conditionnés.
- **Le clone de `loadModules` coûte 0,21 ms**, pas 19 (ci-dessus). Ne pas le re-suspecter.
- **Les cinq gros composants React respectent la règle des feuilles** de
  [timeline.md](../apps/st0/frontend/docs/timeline.md) : chaque lecteur à 20 Hz est son propre
  composant, et `Grid`, `RulerTicks`, `ClipContent`, `Node`, `Widget` sont mémoïsés sur des props
  primitives. Et la règle a une limite : « une feuille » est le bon remède quand quelque chose est
  DESSINÉ, pas quand une valeur est simplement transmise à du code impératif — là, le bon nombre de
  composants est zéro, et le lecteur s'abonne au magasin directement.
- **`buildGraph` est linéaire** (ci-dessus). Ne pas y toucher pour la vitesse.

## Comment vérifier un changement ici

1. `npm run bench` dans le paquet concerné, avant et après, **sur la même machine et sans
   réinstallation entre les deux**.
2. Pour un coût qui ne se lit pas au chronomètre — un parcours de répertoire, une allocation, une
   trame envoyée — compter l'appel plutôt que le mesurer : un compteur temporaire DANS le module
   mesuré, une socket brute qui compte les trames, `getWatched()` qui rend ce que chokidar tient.
   Un entier ne fluctue pas. Ce qui ne marche PAS : remplacer `fs.readdirSync` depuis un script,
   parce que les imports nommés d'un module `node:` sont figés à la liaison — le compteur reste à
   zéro sans rien dire.
3. `npx turbo run test --continue` reste le filet : une optimisation qui change une réponse est
   une régression, pas une optimisation.
4. Pour le C++, en plus : `cmake --build --preset windows-msvc`, les **quatre** cibles de test
   nommées puis `ctest -R studio_`, et un `--list-audio-devices`. Piège du poste de dev : la
   session dev reconstruit toute seule, mais `Copy-Item` PRÉSERVE la date du fichier source — un
   `main.cpp` restauré depuis une copie paraît plus vieux que son `.obj` et MSBuild ne le
   recompile pas. Le binaire testé est alors l'ancien, et tout a l'air de marcher.
