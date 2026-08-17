# Audit — vitesse du côté web

Le pendant de [engine/moteur/docs/audit-stabilite.md](../engine/moteur/docs/audit-stabilite.md)
pour tout ce qui n'est pas du C++ : le service de fichiers, le compilateur, les surfaces — plus le
FIL, où les deux se rejoignent et où le lot C a fini par toucher `main.cpp`. Ce qui reste au
C++ seul (le rappel audio, `applyFull`, les drapeaux de compilation) est chez lui, pas ici.

Il reprend sa règle de méthode, qui est la seule qui compte ici :

> **Mesurer à travers deux compilations n'est pas mesurer.**

Un chiffre pris avant un `npm i`, un redémarrage ou un changement de machine ne se compare pas
à un chiffre pris après. Ce qui se compare, ce sont deux bras dans la même invocation.

## Il y a enfin de quoi mesurer

Jusqu'ici le côté web n'avait **aucun** moyen de rejouer une mesure : zéro script `bench`, zéro
fichier `*.bench.ts`. Les seuls chiffres étaient un profil Firefox recopié dans
[apps/l8/frontend/docs/timeline.md](../apps/l8/frontend/docs/timeline.md) et deux nombres en
commentaire (`graphDoc` « ~280 ms », le jeton de révision « 4,8 ms ») que personne ne pouvait
refaire. `timeline.md` dit « measure before paying for it » sans donner de quoi mesurer.

Trois benchs, `npm run bench` dans chacun des trois paquets :

| cible | paquet | ce qu'elle isole |
|---|---|---|
| `compileNodeProject` | `song` | le compilateur, disque compris |
| `buildGraphDoc` | `file-service` | la vue chaînes, **sans** les extents de clips — ceux-là sont le compilateur, et deux coûts pliés en un ne veulent rien dire |
| `buildGraph` | `ui-chains` | l'arithmétique nœuds/arêtes + dagre, **sans disque** : cette fonction prend un `WebGraph`, pas un dossier |

La fixture est **synthétique et paramétrée par la taille** (`packages/song/src/benchProject.ts`,
publié par la porte `./testSupport` déjà existante plutôt que par un sous-chemin de plus — voir
`docs/inventaire.md` §1 sur les 41 sous-chemins que personne n'importe). Les projets committés
sous `engine/capot/songs/` tiennent UNE piste, là où le « 280 ms » a été pris sur un morceau
d'environ soixante-dix nœuds : une fixture d'une piste mesurerait le démarrage et rien d'autre.
Deux tailles, 8 et 64 pistes, parce que ce qui se lit est la **courbe** — un coût qui double
quand le morceau double va bien, un coût qui quadruple est le constat.

Le dossier finit en `.l8`, et ce n'est pas cosmétique : le service décide qu'un dossier est un
projet d'après son NOM. Un dossier temporaire nu compile parfaitement à travers `@studio/song` et
reste invisible pour `Workspace` — les deux moitiés du harnais doivent pouvoir l'ouvrir.

## Première lecture — ce que les chiffres disent

| | 8 pistes | 64 pistes | rapport |
|---|---|---|---|
| `buildGraph` (sans disque) | 0,046 ms | 0,365 ms | **×8** |
| `compileNodeProject` | 13,4 ms | 68,1 ms | ×5 |
| `buildGraphDoc` | 13,5 ms | 68,5 ms | ×5 |

Trois choses tombent de là, et aucune ne se voyait à la lecture du code :

- **`buildGraph` est exactement linéaire.** Huit fois les pistes, huit fois le temps. dagre et
  l'arithmétique du graphe ne sont pas un problème et n'ont pas besoin qu'on les regarde.
- **Les deux autres coûtent la même chose à la milliseconde près.** `buildGraphDoc` ne compile
  pas le projet ici — et il coûte pourtant ce que coûte le compilateur. Les deux sont donc
  dominés par un troisième coût qu'ils partagent : la lecture des modules sur le disque.
- **La grande taille a ±36 à 40 % de variance** (min 17 ms, max 92 ms sur la même mesure), là où
  la petite en a ±1,5 %. Un cache qui tantôt touche et tantôt manque. C'est le fil à tirer.

## Ce qui a été corrigé

### Le jeton de révision était marché plusieurs fois par dérivation

`graphDoc()` demandait le jeton, puis appelait `clipExtents()` → `cachedProjectDoc()`, qui le
redemandait. `Workspace.withRevision` le calcule une fois pour la durée d'une dérivation :
ré-entrant plutôt que passé de main en main, parce que l'imbrication est déjà synchrone — la
dérivation la plus externe ouvre la portée, les internes la trouvent ouverte. Exactement la forme
de `withModuleStamp` dans `@studio/song`.

`POST /command` prend la même portée pour le couple « jeton d'après + graphe », qui sont pris au
même instant. Le jeton d'AVANT la commande reste sa propre marche : comparer deux moments est
tout son objet.

**Mesuré**, en comptant les `readdirSync` d'un `graphDoc()` sur la fixture :

| | avant | après |
|---|---|---|
| cache plein | 8 | 8 |
| cache manqué (reconstruction) | 32 | **24** |

**Et une correction au constat de départ**, qui vaut d'être écrite : le relevé initial annonçait
« deux parcours même en cache plein ». C'est **faux** — `graphDoc()` sort sur le `return hit.graph`
avant d'appeler `clipExtents`, donc un cache plein n'a jamais coûté qu'une marche. Le doublon
n'existait que sur le chemin qui reconstruit. La mesure a corrigé la lecture, ce qui est
précisément ce à quoi sert un harnais.

### `projectDoc()` n'était pas mémoïsé

Des trois vues dérivées, c'était la seule à se reconstruire à chaque requête : `graphDoc()` et
`hints()` étaient déjà mémoïsés sur le jeton. Et c'est la plus demandée — trois composants montés
en permanence (`useProjectDoc`, `TimelineTab`, `Minimap`) la redemandent sur le même `reloadKey`,
donc une commande valait trois re-projections complètes de chaque piste, clip et note, par
onglet, plus trois `JSON.stringify` du morceau entier.

Le compte de marches ne bouge pas — la marche était déjà là — mais la projection, elle, disparaît
sur un cache plein.

## Le lot C — le fil et le moteur

Les trois constats qui touchaient le son, mesurés puis corrigés. Ils sont ici et non plus dans la
liste d'attente ci-dessous.

### La trame d'état partait sur toutes les sockets

`main.cpp` l'envoyait par `broadcast`, c'est-à-dire à chaque socket du port, à charge pour le
client de la trier avec `forSession`. Ce tri reste — il est la RÈGLE — mais le moteur adresse
désormais : il retient quelle session chaque connexion a nommée dans son premier vrai message et
n'envoie la trame qu'à celles-là.

C'est le premier message NON-SONDE qui déclare, c'est-à-dire le test exact qui vaut à une
connexion sa ligne `[client] connected` : il pose la même question, « est-ce un client, ou une
sonde partie dans la milliseconde ». Pas `role: "driver"`, qui laisserait le service de fichiers
dehors — il ne déclare rien exprès, et son horloge de motifs vit de ces trames. Et une seule fois
par socket : `drop-session` et `show-native-plugin-ui` portent l'id d'une AUTRE session en
surcharge, donc une socket qui se rebindait dessus devenait sourde.

**Mesuré** avec `engine/moteur/scripts/two-sessions.ts`, qui compte maintenant les trames sur une
socket brute — la seule façon de voir ce qui a été ENVOYÉ plutôt que ce qu'un client a gardé. La
machine tenait trois sessions (deux du banc, plus la vraie session st0 du poste), neuf secondes :

| | avant | après |
|---|---|---|
| une socket qui suit `st0` | 200 trames, dont 34 pour elle | **34, toutes pour elle** |
| une sonde muette (le plateau) | 200 | **0** |

83 % de décodage jeté, par socket et par onglet. Et comme le diviseur d'inactivité est PAR
SESSION, une session qui joue tenait éveillés à 20 Hz les onglets de toutes les autres.

### L'horloge de motifs renvoyait le document entier, même inchangé

Le vrai gaspillage n'était pas le document entier — c'en était un que rien n'avait touché.
`tick()` émettait à chaque fenêtre franchie, y compris celles où le motif ne contenait aucun
événement et où l'élagage n'avait rien retiré : le document reconstruit était alors identique au
précédent, et il coûtait un `stringify` ici, une analyse là-bas et un `ProjectDiff` complet dans
le moteur, six à sept fois par seconde. La fenêtre, elle, doit continuer d'avancer —
`scheduledCycle` dit que le motif a été LU, pas qu'il a produit quelque chose.

**Mesuré** par `packages/song/src/patternClock.test.ts`, sur `s("bd ~ ~ ~")` à 120 bpm : une
mesure entière passait de **14 envois à 2**. Le test échoue avant le correctif (16 au lieu de 4,
en comptant les deux de l'amorçage), ce qui est ce qui prouve que le constat était réel.

Ce qui reste — le document entier quand il a VRAIMENT changé — demande un message partiel dans le
protocole et une `ProjectDiff` qui l'accepte. À décider sur un chiffre, pas sur une impression :
tel quel, le coût ne se paie plus que sur les fenêtres qui jouent quelque chose.

### Le watcher strudel tenait tout le dossier de projet

`chokidar.watch(dir, { ignoreInitial: true })` : `ignoreInitial` ne fait taire que les premiers
événements, l'arbre entier est quand même parcouru et retenu. Un projet avec un `media/` de prises
faisait tenir chacune d'elles pour une poignée de `.strudel`.

Deux règles, et la seconde est ce qui évite une liste noire de dossiers lourds : les RÉPERTOIRES
sont élagués par le `skip()` du service de fichiers — sa propre idée de ce qui n'appartient pas à
un projet, donc pas de seconde liste à tenir en phase — et les FICHIERS ne sont gardés que si ce
sont des motifs, où qu'ils soient. C'est ça qui rend `media/` gratuit sans que personne ait à
prédire où un motif a le droit de vivre, et c'est le piège que ce constat annonçait : un `ignored`
mal choisi rend une piste strudel sourde.

**Mesuré** sur un projet synthétique (200 prises, 40 rendus, 300 objets git, 100 modules) en
comptant ce que `getWatched()` rend :

| | avant | après |
|---|---|---|
| entrées tenues | 649 | **5** |
| répertoires surveillés | 8 | 5 |

`packages/file-service/src/engineLink.test.ts` fige le prédicat, y compris l'appel en deux temps
de chokidar 3 : rien ne peut être ignoré au premier appel, où le type n'est pas encore connu.

**Et une correction au constat**, comme pour le jeton de révision : le relevé reprochait au
watcher d'être un singleton « là où `startEngineForActive` est par espace de travail ». Ce n'en
est pas un défaut. L'en-tête de `engineLink.ts` et le commentaire de `clockWs` disent la même
chose depuis longtemps — l'horloge, son watcher et le `clientDoc` du navigateur sont UNE seule
chose qui tourne, le dernier arrivé gagne, et c'est délibéré. Le watcher n'est pas un singleton de
trop : il est la conséquence d'une décision écrite. Rien à faire, sauf la relire.

## Ce qui reste, et n'a pas été fait

Écrit ici plutôt que laissé à re-trouver. Chacun demande sa propre vérification.

| constat | où | pourquoi c'est en attente |
|---|---|---|
| `GET /workspace` reconstruit tout l'arbre du dépôt, 2×/s et par onglet, pour n'en garder que les chemins de projet. `skip()` n'exclut ni `media/`, ni `renders/`, ni `_libraries` | `workspace.ts` (`workspaceInfo`, `walk`), poller `usePolls.ts` | demande un cache et un `skip()` élargi — deux décisions, pas une |
| `projectErrors()` paie `moduleStamp` deux fois, hors de tout `withModuleStamp` (~20 ms le calcul, chiffre de `moduleCache.ts`) | `workspace.ts` | même remède que ci-dessus, mais dans `@studio/song` |
| `/module-libraries` re-marche toutes les bibliothèques à chaque `reloadKey`, sans aucun cache | `EditorTab.tsx` → `workspace.ts` | c'est la « lecture de 295 ms » de `moduleCache.ts` |
| `loadModules`/`loadModuleRefs` clonent en profondeur à chaque appel, cache touché ou non | `loader.ts` (`cloneModules`) | la raison est bonne (les appelants tamponnent `ui`/`cc` en place) ; « mémoïsé » veut dire O(modules) d'allocation, pas O(1). **C'est le suspect n°1 pour la variance ci-dessus** |
| L'horloge de motifs renvoie le `ProjectDoc` entier quand il a changé, pas un delta | `song/src/patternClock.ts`, et la `ProjectDiff` du moteur | demande un message partiel dans le protocole, donc les deux côtés d'un coup |
| `ViewportTab` s'abonne au playhead dans le corps du panneau, et embarque un relevé de debug à 5 Hz livré sans condition | `ViewportTab.tsx`, `VideoCanvas.tsx` | rien ne monte de composant ici : ça se corrige à la lecture et se vérifie à l'écran |

## Ce qui est déjà bon, et qu'il ne faut pas re-suspecter

- **Le sondage `/revision` est unique et recompté** (`useRevision.ts`), requêtes en vol
  supprimées. Il n'existe **aucun** second timer sur cette route. Les autres timers visent
  d'autres routes et sont tous conditionnés.
- **Les cinq gros composants React respectent la règle des feuilles** de `timeline.md` : chaque
  lecteur à 20 Hz est son propre composant, et `Grid`, `RulerTicks`, `ClipContent`, `Node`,
  `Widget` sont mémoïsés sur des props primitives.
- **`buildGraph` est linéaire** (ci-dessus). Ne pas y toucher pour la vitesse.

## Comment vérifier un changement ici

1. `npm run bench` dans le paquet concerné, avant et après, **sur la même machine et sans
   réinstallation entre les deux**.
2. Pour un coût qui ne se lit pas au chronomètre — un parcours de répertoire, une allocation, une
   trame envoyée — compter l'appel plutôt que le mesurer : une sonde qui remplace `fs.readdirSync`,
   une socket brute qui compte les trames, `getWatched()` qui rend ce que chokidar tient. Un entier
   ne fluctue pas, et les trois chiffres du lot C sont tous de cette forme.
3. `npx turbo run test --continue` reste le filet : une optimisation qui change une réponse est
   une régression, pas une optimisation.
4. Pour le C++, en plus : `cmake --build --preset windows-msvc`, les **quatre** cibles de test
   nommées puis `ctest -R studio_`, et un `--list-audio-devices`. Piège du poste de dev, payé une
   fois ici : la session dev reconstruit toute seule, mais `Copy-Item` PRÉSERVE la date du fichier
   source — un `main.cpp` restauré depuis une copie paraît plus vieux que son `.obj` et MSBuild
   ne le recompile pas. Le binaire testé est alors l'ancien, et tout a l'air de marcher.
