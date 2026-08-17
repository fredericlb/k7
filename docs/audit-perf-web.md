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

## Les lots A et B — le service de fichiers, et ce que le navigateur lui demande

Mesuré sur le vrai poste, sur `lemo_mante/01.danse.l8` — un morceau de 15 pistes dans un dépôt
de 721 répertoires — huit passes par point, en millisecondes :

| | avant | après | |
|---|---|---|---|
| `GET /workspace` | 30,7 | **0,01** | 25,8 sur le rebalayage, une fois toutes les 5 s |
| `GET /project-errors` | 48,5 | **29,2** | une marche d'empreinte au lieu de deux |
| `GET /project-doc` | 4,9 | 4,9 | déjà mémoïsé ; c'est la marche du jeton |
| `GET /graph` | 4,8 | 4,8 | idem |
| `GET /module-libraries` | 14,4 | 14,4 | mesuré, laissé — voir plus bas |

### `/workspace` construisait tout l'arbre du dépôt pour en garder cinq chemins

La route est sondée toutes les deux secondes par chaque onglet, et ce que le sondage VEUT est
`activeProject` (un autre onglet a changé de projet) et `lastTake` (une prise vient de tomber).
Les deux sont gratuits. `projects` est le champ cher : `collect(this.walk(root))` allouait un
`FileNode` par FICHIER du dépôt — un `toRel`, un `isBinary`, un objet — puis jetait l'arbre.

Deux corrections. Le balayage ne construit plus rien : répertoires seulement, même `skip()`, même
ordre (30,7 → 25,8 ms — l'allocation n'était donc PAS le gros du coût, les 721 `readdir` le sont).
Puis la liste est tenue : rebalayée quand ce service a bougé un projet — les trois méthodes qui en
créent, en importent ou en recyclent un le disent — et sinon au plus toutes les cinq secondes.

Le compromis est écrit et testé : un dossier apparu derrière le dos du service (un `git pull`, un
`mkdir` à la main) se voit au balayage suivant et pas au sondage suivant. `cachedProjectDoc` a
refusé ce marché et devait le refuser — une COMPILATION périmée se trompe avec assurance sur une
chanson. Une liste de projets en retard de cinq secondes est un sélecteur qui n'a pas encore vu un
dossier : une attente, pas un mensonge.

Le balayage descend toujours DANS un projet : `parseLaunch` décrit un `.m9` niché dans un `.l8`,
donc s'arrêter au premier projet reconnu serait une règle que ce dépôt n'a jamais eue. Un test le
fige, avec le projet en profondeur (`albums/winter.l8`).

### `/project-errors` payait l'empreinte des modules deux fois

`notSupportedModules` et `libraryModuleIssues` atteignent chacun `loadModuleRefs`, et chacun
repayait la marche d'empreinte — 19 ms, alors que les DEUX lectures étaient déjà des succès de
cache. Un `withModuleStamp` autour de la route couvre les deux, et un `withRevision` avec, pour la
même raison qu'ailleurs. La route ne lit et n'écrit rien, ce qui est exactement la permission que
`withModuleStamp` demande.

`withModuleStamp` est ré-exporté par `@studio/song/loader` plutôt que par un sous-chemin de plus :
un appelant qui en veut est, par définition, un appelant qui enchaîne des lectures de modules, et
c'est la porte par laquelle il est déjà entré.

### Le navigateur demandait la même chose à quatre ou cinq voix

Sur un `reloadKey`, quatre composants montés redemandent `/graph` et cinq `/project-doc` — chacun
sa requête, pour les mêmes octets, tirés d'un mémo qu'ils touchaient tous. Le mémo ne coûte rien ;
la marche du jeton devant lui coûte 5 ms à chaque fois.

`fget` regroupe donc les requêtes EN VOL : une route déjà en l'air est attendue plutôt que
redemandée. Ce n'est pas un cache — rien ne survit à la requête dont il vient, donc deux appels à
une seconde d'écart restent deux requêtes. Ce qu'il supprime est la rafale.

Deux garde-fous, tous deux testés. Une ÉPOQUE, avancée par chaque écriture (`fsend`, aux deux
bords) : une lecture émise après une commande ne peut pas être servie par une lecture émise avant.
Et ce qui est partagé est le TEXTE de la réponse, chaque appelant l'analysant lui-même — donner un
seul objet analysé à plusieurs composants les mettrait en alias, et une surface qui remplit les
clips de ses platines dans le document qu'on lui a donné écrirait dans l'état d'un autre. Chacun
paie l'analyse qu'il payait déjà ; ce qu'il cesse de payer est l'aller-retour.

### Deux constats mesurés, et délibérément pas corrigés

**Le clone profond de `loadModules` n'était pas le suspect.** L'audit le donnait comme cause n°1 de
la variance. Mesuré : **0,21 ms** sur 575 refs, contre 19 ms pour l'appel entier. Le coût est la
MARCHE D'EMPREINTE, pas le clone — et elle vaut ce qu'elle protège (une lecture de 295 ms), donc
le remède n'est pas de la supprimer mais de la porter en portée, ce que fait `/project-errors`
ci-dessus. C'est aujourd'hui le premier poste de dépense de tout ce voisinage.

**`/module-libraries` ne gagne rien à être mis en cache.** Le seul jeton honnête pour lui est
l'empreinte des modules, qui balaie les mêmes arbres et coûte 19 ms là où la marche en coûte 14 :
le cache coûterait plus cher que ce qu'il évite. Et la profondeur ne peut pas être réduite —
l'onglet Bibliothèques passe les sous-arbres tels quels à `foldModules`, qui a besoin du contenu
d'un dossier de module pour en faire une ligne. Laissé tel quel, sciemment.

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

### …et le delta, une fois le reste fait

Ce qui restait après ça : l'horloge renvoyait le document ENTIER quand il avait vraiment changé.
Mesuré sur un vrai projet — 15 pistes, 54 clips — et le rapport ne laisse pas de doute :

| une trame d'horloge | |
|---|---|
| document entier | 137,6 Ko |
| les seules pistes qui bougent | **3,7 Ko** |
| à 6,7 Hz | 922 Ko/s → **25 Ko/s** |

Plus, côté C++, un `docFromJson` et une `diff()` qui reconstruit quatre `std::map` sur chaque
piste, clip et plugin du document — pour huit notes.

Le moteur FUSIONNE dans le document qu'il tient, puis lance le même `apply`. C'est ce qui rend
la chose à la fois bon marché et ennuyeuse : la diff, les chemins incrémentaux et le repli sur
reconstruction sont intacts, et il n'y a pas une deuxième façon d'atteindre le moteur — seulement
une façon plus courte de dire ce qui a bougé.

Il REMPLACE par id, sans jamais ajouter ni retirer. Un id que la session ne tient pas est un
DÉSACCORD — le cerveau croyant qu'on tient un projet qu'on ne tient pas, ce à quoi ressemble un
redémarrage — donc il est signalé et jeté ; ajouter cacherait exactement le cas pour lequel le
renvoi à la reconnexion existe. Et la garde côté horloge est le JEU DE PISTES, pas le contenu :
au moindre écart, c'est le document entier qui part.

`engine/moteur/scripts/track-delta.ts` éprouve les trois réponses contre un vrai moteur : refus
sans projet chargé, silence sur une piste connue, avertissement sur une inconnue.

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

## Le lot D — deux feuilles qui redessinaient pour rien

### Le viewport rendait sa vue vingt fois par seconde pour nourrir une horloge

`ViewportTab` lisait `playing` et `playhead` par `useEngineState`, en deux tranches séparées,
sous un commentaire disant que c'était ce qui le tenait hors du chemin à 20 Hz. Ce n'était pas
vrai et ne pouvait pas l'être : le playhead est justement le champ qui BOUGE. Le panneau et tout
son sous-arbre se validaient donc à chaque trame — pour passer un nombre à une horloge impérative
dont aucune sortie React ne dépend.

La règle de `timeline.md` est que l'état vivant est dessiné par les FEUILLES. Ici rien n'est
dessiné par React du tout, donc la bonne feuille est l'absence de composant : `VideoCanvas`
s'abonne au magasin directement (`store.subscribe`) et appelle `clock.feed`. Zéro rendu par
trame. C'est l'arrangement qu'a déjà la toile de câbles des chaînes — la raison pour laquelle
`activeTrackIds` n'est délibérément pas un hook.

L'horloge est en plus nourrie une fois à la construction du pilote, depuis l'instantané courant :
une horloge neuve ne sait rien, et transport à l'arrêt la trame suivante peut être à 250 ms —
de quoi dessiner l'image 0 d'un morceau garé à 3:20.

### Et le relevé de dérive était livré à tout le monde

Un sondage à 5 Hz qui re-rendait le panneau à 5 Hz, embarqué sans condition, alors que le
`Profiler` de React est correctement conditionné dans `main.tsx`. Les deux coûtent de la même
façon et passent désormais par le MÊME drapeau (`src/profiling.ts`, `?profile=1`) : un instrument
qu'on laisse tourner est une mesure de lui-même. Le format et l'avertissement WebCodecs restent
affichés — ils ne coûtent rien et disent quelque chose.

**Ce que je ne peux pas vérifier ici, et il faut le dire** : rien ne monte de composant dans ce
dépôt (`apps/l8/AGENTS.md` le pose noir sur blanc). Ces deux corrections se prouvent à la lecture
et par le contrat du magasin, plus `tsc` et `vite build` — pas par un rendu. À exercer à l'écran :
le transport roule, l'image suit, et un `?profile=1` fait réapparaître la bande de dérive.

Le second point du lot D — `rackLit` rebalayant depuis l'index 0 à chaque trame — a été corrigé
plus tôt, avec le bug de tri qu'il cachait (`d2a0df6`).

## L'empreinte des modules — pas moins chère, moins souvent

C'était le premier poste de dépense du voisinage après les lots A à D. Deux questions, dans
l'ordre : peut-on la rendre moins chère, et sinon, la paie-t-on trop souvent ?

### Non, elle ne peut pas être moins chère

Mesuré, sur le même projet : **329 `readdir` = 11,7 ms, 419 `stat` = 11,9 ms**, moitié-moitié.

- `readdirSync(recursive: true)` ne gagne rien (23,6 ms contre 23,5) : il stat en interne pour
  décider de descendre. Impasse.
- Les 419 `stat` sont sur des fichiers dont le contenu est VRAIMENT lu : 291 `module.yaml`,
  42 `ui.yaml`, 68 fichiers de `nodes/`. Restent une quinzaine de `jsdsp.ts` et `.vstpreset`
  dont seul le CHEMIN est retenu — 4 % du total. Rétrécir `DEFINITION` ne vaut pas son risque.
- La mtime d'un DOSSIER ne bouge pas quand le contenu d'un fichier change (NTFS), donc elle ne
  peut pas remplacer les `stat` de fichiers. C'est ce qui ferme la porte.
- Un cache à l'horloge est refusé par `moduleCache.ts` lui-même, et à raison : le dépôt écrit
  des fichiers de module dans ses tests puis les relit aussitôt.

### Oui, elle était payée deux fois par route

Trois routes lisaient le vocabulaire deux fois hors de toute portée — `ioPorts` (refs +
modules), `projectHints` (idem) et `graphDoc` sur reconstruction (compile + graphe). Chacune
payait deux marches pour prouver, la seconde fois, ce que la première venait d'établir. Elles
s'enveloppent maintenant elles-mêmes, comme `compileNodeProject` et `loadGraph` le font depuis
toujours — dans `@studio/song` pour les deux premières, donc la CLI en profite aussi.

**Et hoisser une portée rendait les choses PLUS lentes, ce que seule la mesure a montré.**
`withModuleStamp` n'était pas ré-entrant : une portée imbriquée sur le même projet ouvrait une
portée NEUVE et jetait l'empreinte déjà payée. Envelopper `graphDoc`, dont le contenu ouvre déjà
deux portées, ajoutait donc une marche au lieu d'en retirer une. Corrigé de la même façon que
`withRevision` l'était — `if (scope?.dir === dir) return fn()` — avec un test qui fige le
contrat : à l'intérieur d'une portée, les dossiers de modules sont tenus pour immobiles, et
l'appel imbriqué doit honorer la MÊME promesse plutôt que re-vérifier en douce.

### Et payée par des routes qui n'avaient aucun cache

`projectErrors`, `moduleCatalogue`, `ioPorts` et `baseModules` relisaient tout le vocabulaire à
CHAQUE requête — 21 à 43 ms — là où `graphDoc`, `projectDoc` et `hints` sont mémoïsés sur le
jeton de révision depuis longtemps. Les quatre passent par un helper unique (`onRevision`)
plutôt que par quatre champs écrits à la main.

Ce qui a demandé d'élargir le jeton, et c'est la partie qui vaut d'être lue : deux fichiers
HORS du projet décident de ces réponses — le cache de scan du moteur (`~/.studio/exts.json`,
d'où sortent les modules `@engine/…`) et les préférences de la machine
(`~/.studio/preferences.yaml`, d'où sort l'étiquette d'un canal). Le jeton ne les regardait pas.
`hints()` avait donc ce trou depuis le jour où il a été mémoïsé : après un rescan de plugins, sa
liste de plugins restait périmée jusqu'à une édition sans rapport. Deux `stat` de plus sur une
marche qui en fait des centaines le referment pour toutes les vues d'un coup — dans le JETON, et
non dans chaque cache, parce que c'est une propriété de « qu'est-ce qui a changé », pas de l'un
des lecteurs.

**Mesuré en MARCHES, les deux bras dans la même invocation** — le poste était trop chargé pour
que la montre serve à quoi que ce soit ce jour-là, et un entier ne fluctue pas :

| | avant | après |
|---|---|---|
| un rechargement (les six routes) | 10 marches | **6** |
| les mêmes, rien n'ayant bougé | 4 marches | **0** |

Une note d'outillage, parce qu'elle m'a coûté une mesure fausse : on ne peut PAS compter les
appels en remplaçant `fs.readdirSync` depuis un script — les imports nommés d'un module `node:`
sont figés à la liaison, et le compteur reste à zéro sans rien dire. Ajouter un compteur
temporaire dans le module mesuré est la façon qui marche.

### …puis un watcher, pour descendre sous une marche par route

Six marches par rechargement était le plancher que la portée explicite permet : une portée ne
va pas plus loin qu'une dérivation, et six routes sont six requêtes. Descendre plus bas demande
de tenir l'empreinte ENTRE deux requêtes, donc quelque chose qui SAIT que les dossiers n'ont pas
bougé.

`@studio/song` reçoit pour cela une couture d'une ligne — `useFoldersStill(fn)`, un booléen — et
rien d'autre : ni watcher, ni horloge, ni dépendance. `false` veut dire « marche », et c'est ce
que reçoit tout ce qui n'installe rien : la CLI, les tests, un script. Un BIT et non un jeton,
délibérément : la bibliothèque doit rendre l'empreinte que la marche aurait produite, sinon le
mémo manque et relit toute la médiathèque à chaque changement de main. Et la première lecture
d'un projet marche toujours, quoi qu'on lui réponde — c'est ce qui rend un watcher vide sûr.

Le watcher est dans le service de fichiers, seul processus qui vive assez longtemps pour tenir
des poignées. `fs.watch(root, {recursive:true})` plutôt que chokidar, pour deux raisons :
UNE poignée par racine au lieu d'une par dossier (quatre contre cent cinquante), et sur Windows
une poignée tenue sur `modules/` n'empêche pas de renommer un dossier de module À L'INTÉRIEUR —
ce qu'un renommage de module est. Chokidar dit QUEL fichier a changé ; ici on veut un compteur.

Et un plafond de dix secondes, qui est le cœur de l'argument de sûreté : `fs.watch` perd des
événements. Sans plafond, un seul événement perdu laisserait le vocabulaire périmé POUR DE BON —
la panne « sûre d'elle et fausse » que `cachedProjectDoc` documente et refuse. Avec, c'est un
retard de dix secondes au pire. La marche reste la source de vérité ; le watcher dit seulement
quand on peut la sauter.

**Mesuré**, les deux bras alternés dans une seule invocation pour que la dérive de la machine
sorte de la comparaison, médiane de cinq :

| les six routes d'un rechargement | ms |
|---|---|
| sans le watcher | 230 |
| avec | **108** |

Rationale complet : `packages/file-service/docs/moduleWatch.md`.

## Ce qui reste, et n'a pas été fait

Écrit ici plutôt que laissé à re-trouver. Chacun demande sa propre vérification.

| constat | où | pourquoi c'est en attente |
|---|---|---|
| Le watcher de modules ne couvre qu'un projet à la fois, celui qui est servi | `file-service/src/moduleWatch.ts` | deux personnes sur deux projets du même poste : le second marche comme avant. Élargir veut dire décider quand on cesse de surveiller, ce qui est une question de cycle de vie et pas de vitesse |
| Un rechargement paie encore six marches d'empreinte quand rien ne veille — hors du service de fichiers, c'est-à-dire pour la CLI | `song/src/moduleCache.ts` | c'est le plancher de la portée explicite, et le remède est celui qui existe déjà : un processus qui tient des poignées. La CLI n'en est pas un |

## Ce qui est déjà bon, et qu'il ne faut pas re-suspecter

- **Le sondage `/revision` est unique et recompté** (`useRevision.ts`), requêtes en vol
  supprimées. Il n'existe **aucun** second timer sur cette route. Les autres timers visent
  d'autres routes et sont tous conditionnés.
- **Le clone de `loadModules` coûte 0,21 ms**, pas 19 (ci-dessus). Ne pas le re-suspecter.
- **Les cinq gros composants React respectent la règle des feuilles** de `timeline.md` : chaque
  lecteur à 20 Hz est son propre composant, et `Grid`, `RulerTicks`, `ClipContent`, `Node`,
  `Widget` sont mémoïsés sur des props primitives. Le viewport était l'exception ; il ne l'est
  plus (lot D). Et sa correction dit la limite de la règle : « une feuille » est le bon remède
  quand quelque chose est DESSINÉ, pas quand une valeur est simplement transmise à du code
  impératif — là, le bon nombre de composants est zéro.
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
