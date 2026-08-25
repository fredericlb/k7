# Inventaire du code mort, dupliqué et construit d'avance

Ce que le dépôt contient et que rien n'atteint. Chaque entrée porte de quoi trancher :
*qui appelle* est la question, pas *est-ce que ça marche*.

> **Lisez le §0 avant de supprimer quoi que ce soit.** Plusieurs modules bien vivants sont
> invisibles à un balayage des `import`. Le piège se reproduit à chaque relevé.

> **Relevé du 2026-08-21.** `npm run lint:dead` (knip, `knip.json`) fait les passes 1, 2 et 4
> ci-dessous en trente secondes. Il est **non bloquant** — le calibrage se lit, il ne se subit
> pas — et sa liste d'exceptions est le §0, traduit en configuration. Ce qu'il ne voit pas : le
> C++ (`biome.json` l'exclut aussi) et tout ce que le §0 décrit — knip croit ce qu'on lui
> déclare. Son `ignoreWorkspaces` ne contient que `commons/`, parce que le sous-module porte ses
> propres docs et sa propre vérité.
>
> Sortie au jour du relevé : **1 fichier, 4 dépendances, 1 devDépendance, 58 exports et
> 17 types** — 81 constats sur l'axe audio.

## Comment ce relevé est fait

Quatre passes, toutes reproductibles :

1. **Surface publiée** — chaque sous-chemin des cartes `exports` des paquets, confronté aux
   spécificateurs qui apparaissent réellement dans le source.
2. **Accessibilité** — un parcours du graphe d'imports depuis les vraies portes d'entrée :
   tout ce qui est hors de `packages/`, les fichiers atteints depuis un autre paquet par
   spécificateur publié, les `bin`/`main`, les entrées esbuild du tray, et les tests.
3. **Config** — dépendances importées sans être déclarées, scripts manquants, variables
   d'environnement lues sans être documentées.
4. **Symboles** — chaque nom `export`é, confronté à tous les identifiants qui apparaissent
   dans les autres fichiers. Un nom que rien d'autre ne prononce, pas même son propre fichier,
   n'a plus d'appelant possible. Grossier exprès : un homonyme sauve un mort, jamais l'inverse,
   donc la liste est un plancher.

**Deux pièges de RELEVÉ**, qui portent sur la page plutôt que sur le code :

- **Un renommage de fichier périme un chemin sans périmer le constat.** Une entrée peut être
  fausse deux fois : le symbole a bougé de fichier, et il a été ressuscité entre-temps. Vérifier
  les deux, séparément.
- **Un constat corrigé ne se retire pas tout seul.** Un commit qui met à jour la prose *autour*
  d'une entrée sans revenir sur l'entrée elle-même laisse un réquisitoire contre un dépôt qui a
  bougé. Rejouer les passes est la seule défense.

Corollaire : **`docs/audit-moteur.md` §C5 tient sa propre liste de code mort**, au périmètre
qui chevauche celui-ci sans lui être identique. Les deux se lisent ensemble, ou une entrée
périme des deux côtés sans que personne le voie.

**Trois pièges de méthode :**

- **Les extensions comptent.** `engine-host` écrit `from "./addresses.ts"`. Une recherche sur
  `"…/addresses"` ne le voit pas et déclare morts cinq de ses six sous-chemins — ils sont tous
  vivants.
- **Un spécificateur ne tient pas sur deux lignes.** Une regex trop permissive attrape le mot
  `from` en pleine prose et invente des dizaines de dépendances fantômes.
- **Un octet NUL rend un fichier INVISIBLE.** ripgrep classe binaire tout fichier qui en
  contient un, et le saute sans un mot : le fichier cesse d'exister pour toute la passe
  d'accessibilité. Le cas se présente dès qu'on prend un NUL comme séparateur de clé composite —
  l'échappement à six caractères donne la même chaîne à l'exécution et reste visible de tous les
  outils. `npm run lint:bytes` (`scripts/check-source-bytes.mjs`) refuse le cas en CI, et ne sert
  que si on le LANCE. Le piège coûte plus cher qu'il n'y paraît : knip lit le source comme
  ripgrep, donc un fichier porteur d'un NUL est invisible au détecteur de code mort lui-même, qui
  rendra un faux « tout va bien ». **Lancer `lint:bytes` AVANT `lint:dead`**, ou le second ment
  sur le premier. (Cette page n'écrit pas l'octet littéralement : le recopier depuis le source
  pour le décrire piège la page elle-même.)

---

## 0. Faux positifs connus — ne pas retuer

### Ce qui est chargé par CHEMIN, jamais importé

| quoi | comment il vit |
|---|---|
| `packages/song/src/dspRunner.mjs` | lancé en **processus fils** par `nodeProject.ts`. Il fait `import { graph } from "@studio/dsp"`, et la dépendance `song → dsp` existe précisément pour que cet import se résolve : un dossier de morceau n'a pas de `node_modules`. |
| `packages/dsp/modules/{normalize,sweep}/jsdsp.ts` | des DSP de MODULE. Le compilateur les trouve par nom de fichier (`JSDSP_FILE = "jsdsp.ts"`), jamais par import. |
| `songs/**/jsdsp.ts` | même mécanisme : la DSP d'une chanson de démo est une donnée chargée au runtime. |
| `packages/stem-separation/src/separateWorker.ts` | lancé par `separateJobs.ts` via `new URL("./separateWorker.ts", import.meta.url)`. |
| `packages/engine-host/src/main.ts`, `packages/file-service/src/server.ts` | **entrées esbuild** de `engine/capot/scripts/build-engine.mjs`, qui les bundle dans le tray. Zéro import n'est pas zéro appelant. |
| `packages/ui-chains-react/src/DomChains.stories.tsx` | ramassé par le glob de `.storybook/main.ts`. |
| `packages/dsp/src/emit.ts` | le script `build` du paquet (`tsx src/emit.ts`). Une passe qui ne regarde que `bin` et les entrées esbuild le déclare mort ; **un `scripts` de `package.json` est un appelant.** |

`@studio/dsp` est aussi l'API d'auteur publiée aux utilisateurs
(`apps/st0/docs/25-syntax-instruments.md`), et le C++ colle son JSON généré
(`engine/moteur/engine/GraphDspPlugin.cpp`).

### `detectTransients` n'est appelé par personne, et doit le rester

`packages/audio-probe/src/waveform.ts` l'exporte, et aucun code de production ne l'appelle :
la détection tourne dans le moteur, en C++ (`engine/moteur/engine/Waveform.cpp`), pendant qu'il
sous-échantillonne déjà l'audio, et le résultat va dans le sidecar `{source}.cache`.

La version TypeScript est la **spécification exécutable** que le C++ recopie, et
`waveform.test.ts` est le contrat qui tient les deux ensemble — le même arrangement que
`fileFingerprint` et son commentaire « MUST match ».

### Deux imports profonds contournent les cartes `exports`

`engine/moteur/scripts/list-sessions.ts` → `packages/engine-host/src/engineQueries.ts`, et
`engine/moteur/scripts/render-once.ts` → `packages/file-service/src/render.ts`. Ces deux
fichiers paraissent inatteignables si on ne regarde que les `exports`.

### `commons/` est un sous-module

`git ls-files` du dépôt parent ne le liste pas. `OIDC_ISSUER`, `GRIST_API_KEY`, `GRIST_DOC_ID`
et `BACKEND_PORT` y sont lus : ils paraissent inutilisés vus d'ici, et ne le sont pas.

---

## 1. Surface publiée sans consommateur externe

**41 sous-chemins sur 207** n'ont aucun importateur hors de leur propre paquet. C'est un
constat sur la carte `exports`, pas sur le code : sur les 41,

- **37 sont vivants à l'intérieur** de leur paquet, atteints par import relatif ;
- **2 sont morts pour de bon** (§2) ;
- **2 ne servent qu'à leur propre test** : `@studio/mediatek/evict`, `@studio/player-web/moteur`.

Rétrécir la carte ne supprime donc presque rien : elle documente la vraie surface. Les paquets
qui publient le plus large sont `ui-turntables` (12 sous-chemins sans consommateur externe),
`song` (6) et `engine-host` (5) — le réflexe « publier tout `src/` ».

`ui-turntables` est le cas à regarder : son seul hôte, st0, n'importe que `/deck-set`, `/engine`
et `/surface`. Les douze autres sont de la plomberie interne exposée.

## 2. Vraiment orphelin — rien ne l'atteint

| quoi | où | note |
|---|---|---|
| `chains.tsx` | `packages/ui-turntables/src/` | la vue « chaîne d'une platine », ~60 lignes de colle. Personne ne la monte. Voir §6, c'est le bloc à trancher en entier. |
| `index.ts` | `packages/ui-eyes/src/` | le baril de commodité. Son propre en-tête dit que « les sous-chemins sont la vraie API », et c'est exactement ce que font les appelants. **Gardé** parce que le supprimer emporte `export.ts` et `FrameClock` avec lui — c'est le bloc WebCodecs, une décision produit. |
| `export.ts` | `packages/ui-eyes/src/` | **atteignable seulement par le baril mort ci-dessus** : `exportScene` (l'export WebCodecs, image par image) n'est donc joignable par rien. Aucune surface ne monte de bouton pour lui. |
| `probeLocalEngine` | `packages/engine-browser/src/probe.ts` | le registre fait ce travail. Supprimer la sonde loopback que rien ne rejoue est à trancher, pas à laisser pourrir. |
| type `Signal` | `packages/dsp/src/index.ts` | `@deprecated`, plus une seule référence dans tout le dépôt. |
| `rollGridPlugin` / `trackerPlugin` | `packages/ui-editor/src/tracker/plugin.ts` | les deux extensions CodeMirror qui remplacent le `notes:` **sur place**, dans le texte. Le seul hôte des grilles (st0, `SeqGrid.tsx`) passe par `mountSeqGrid`, qui rend la même grille dans un conteneur à part. Elles gardent une propriété que `mountSeqGrid` n'a pas — l'enveloppe YAML reste visible autour de la grille. |
| export `AuthUser` | `apps/pl8/frontend/src/api.ts` | utilisé dans son propre fichier, importé par personne : c'est l'`export` qui est de trop. **Et il y en a un second dans le même cas** : `apps/z0/editor/src/api.ts`. |

### Des SYMBOLES, pas des fichiers

Le fichier vit, la fonction non : personne ne prononce ce nom, nulle part, pas même le fichier
qui le déclare. Relevé par la passe 4 ; les trois déjà décrits ailleurs sur cette page
(`probeLocalEngine`/`isReachable`, `rollGridPlugin`/`trackerPlugin`, `ChainsPanel`) n'y sont pas
répétés.

| symbole | où | note |
|---|---|---|
| `FrameClock` | `packages/ui-eyes/src/clock.ts` | l'horloge que **l'exporteur** avance — et `export.ts` est déjà mort deux lignes plus haut. Le chemin WebCodecs est mort en entier : le baril, `exportScene`, et l'horloge qui le cadence. À trancher d'un bloc, comme §6. |
| `isDocRef` | `packages/song-schema/src/moduleTypes.ts` | une garde de type que plus rien n'interroge. |
| `listAll` | `packages/mediatek/src/catalogue.ts` | |
| `PATH_SEP` | `packages/file-service/src/machinePlayer.ts` | |
| `knownPrefs` | `apps/pl8/frontend/src/prefs.ts` | |
| `requireDb`, `readRawAttachment`, `canRender` | `apps/z0/backend/src/{db,grist/load,render}.ts` | |
| `drawButton`, `drawPlayerBox`, `drawSpinner`, `drawReloadIcon` | `apps/z0/presenter/src/canvas/drawHelpers.ts` | quatre primitives de dessin sur les six du fichier ; le présentateur ne dessine ni bouton ni boîte joueur. |

**232 symboles de plus ne sont prononcés que par leur propre test.** Ce n'est pas du code mort —
c'est le choix, assumé partout ici, de tester une constante ou un pas de calcul plutôt que la
seule fonction publique qui les enveloppe. Compté ici pour que le chiffre ne surprenne pas la
prochaine passe : `ui-turntables/deck.ts` (10), `ui-chains/cableCanvas.ts` (9), `ui-chains/graph.ts` (9).

**Outillage sans point d'entrée** — des programmes, pas du code mort, mais que rien ne câble :

- `packages/song/scripts/` — aucun script npm ni tâche turbo. Huit migrations, et
  `packages/song/src/moduleMigrate.ts` (350+ lignes) n'existe que pour `migrateModules.ts`. Le
  dossier grossit d'une migration à chaque renommage, et rien ne les retire une fois jouées.
- `packages/ui-turntables/scripts/put-on.ts` — celui-là est **documenté** et se lance à la main
  (`packages/ui-turntables/docs/hosting.md`) ; il mesure un SON, ce qu'aucun test unitaire ne fait.
  Ses trois voisins ont été supprimés avec le clip qu'ils mesuraient (`docs/platter-plan.md`).

## 3. Construit d'avance — à ne pas confondre avec un oubli

`packages/player-web/src/moteurPlayer.ts` et `moteurEffects.ts` n'ont aucun importateur de
production. Ce n'est **pas** un oubli : ils sont documentés délibérément
(`packages/player-web/docs/moteurPlayer.md`) et `AGENTS.md` les présente comme le joint que
`@studio/player-web` porte.

Si on les supprimait, `@studio/engine-browser` et `@studio/engine-protocol` sortiraient des
dépendances de `player-web` avec eux — ils ne servent qu'à ces deux fichiers.

### Demander à un greffon ce qu'il a

La chaîne complète est vivante : `App.tsx` (`onScanParams={api.scanPluginParams}`) → `api.ts`
(`GET /plugin-params`) → `file-service/src/server.ts` → `awaitPluginParams` → `listPluginParams`
→ `list-plugin-params` → `pluginParamsOf` (`engine/moteur/engine/ParamDump.cpp`). Ce qui reste
sans appelant est la **moitié navigateur** seulement : `listPluginParams`
(`engine-browser/src/engine.ts`) et `onPluginParamList`.

Deux raisons de garder l'ensemble. C'est la **seule** façon d'apprendre les paramètres d'un
greffon installé — un greffon les enregistre dans son constructeur, et le cache de scan n'en
porte aucun. Et trois pannes réelles s'y lisent : le moteur reconstruisait un `te::Engine` par
question et une quarantaine de questions d'affilée le tuaient (mesuré, deux fois) ; il demandait
sa liste à un greffon avant que le chargement asynchrone ne l'ait construite ; et une liste vide
confond « je n'arrive pas à charger ce greffon » avec « il se charge et n'en publie aucun ».

Ce dernier point vaut pour lui-même : **un greffon sans paramètre est presque toujours un greffon
qui refuse de se charger** (`getLoadError` le dit, encore faut-il le lui demander). Répondre « ce
synthé n'a aucun paramètre » énonce un fait sur le greffon là où c'est un fait sur la machine —
une licence, une installation — et n'envoie personne au seul endroit où c'est réparable.

Un générateur de panneaux déduit d'une liste de paramètres ne sait produire que des boutons et
des listes déroulantes — jamais un fader, un `meter`, un sélecteur de fichier ni une disposition.
Qui rallumerait la moitié navigateur : un module builder qui propose la liste des paramètres d'un
VST à lier.

## 4. Duplication

### Le nom d'une note MIDI, six fois, en quatre orthographes

La même table chromatique et la même arithmétique (`((k%12)+12)%12`, `Math.floor(k/12)-1`) :

| où | constante |
|---|---|
| `packages/ui-editor/src/tracker/RollGrid.ts` | `NOTE_NAMES` |
| `packages/ui-editor/src/tracker/TrackerGrid.ts` | `NAMES2` (deux caractères : `C-`) |
| `apps/st0/frontend/src/components/PianoRoll.tsx` | `NAMES`, exporté en `noteName` |
| `apps/st0/frontend/src/components/IoPanel.tsx` | `NOTE_NAMES` |
| `apps/k7/frontend/src/utils/pitch.ts` | `NOTE_NAMES` |
| `apps/k7/packages/lyrics/src/chords.ts` | `SHARP` |

Deux détails aggravants. Les deux premières sont dans **le même dossier du même paquet**. Et
`PianoRoll.tsx` porte le commentaire « one spelling of a key, wherever it is read » — vrai dans
st0, faux dès qu'on passe dans `@studio/ui-editor`, dont st0 dépend déjà et qui en a deux à lui.
Le prédicat suit : `isBlack = [1,3,6,8,10].includes(...)`, à l'identique dans deux fichiers.

Non traité : c'est une décision de **où poser la table**, pas un nettoyage.

### Des copies STRUCTURELLES — celles qu'un import ne peut pas résoudre

Trois duplications qu'on ne peut pas supprimer sans inverser une dépendance ou empoisonner un
bundle. Écrites ici pour qu'on cesse de les prendre pour de la paresse.

| ce qui est doublé | pourquoi ça reste |
|---|---|
| Le plancher `-100 dBFS` : `PEAK_FLOOR_DB` (`commands/peakPass.ts`), `MIN_DB` (`commands/trimGate.ts`), `kFloorDb` (`FilePeak.cpp`), et trois fois dans `@studio/dsp` | `trimGate` est **sûr pour le navigateur** — le panneau de clip de st0 l'importe — et `peakPass` appelle `node:child_process`. Partager la constante ferait entrer un lanceur de processus dans le navigateur pour économiser un nombre. Essayé, annulé. Le C++ et le JSON généré ne peuvent pas importer du tout |
| `FileEnvelope` (`commands/waveform.ts`) ≡ `Envelope` (`ui-turntables/waveform.ts`) | `ui-turntables` ne dépend pas de `@studio/commands`. Les deux dépendent de `web-protocol`, qui tient déjà `RegionWaveform` — c'est là que ça irait |
| `isMouseWheel` : `ui-timeline/panZoom.ts` ≡ `ui-chains-react/camera.ts` | Reconnaître une molette d'une surface tactile — trois signaux (`deltaMode`, les 120 de `wheelDeltaY`, la forme du delta), identiques des deux côtés. Aucun des deux paquets ne peut dépendre de l'autre : `ui-timeline` n'a **aucune** dépendance `@studio/` et le graphe importerait un paquet nommé pour l'arrangement. Défendable ici parce que **les deux côtés sont testés**, cas par cas. Le foyer naturel serait un paquet de gestes DOM qui n'existe pas ; le créer pour une fonction de dix lignes est une décision, pas un nettoyage |

Le détecteur de k7 (`apps/k7/backend/src/detect.ts`) n'a plus de jumeau, mais il n'est testé
nulle part — c'est ce qui manque aux copies ci-dessus quand elles se défendent.

### Cosmétique, mais réelle

- **Le glyphe `piano-16`**, corps SVG identique octet pour octet :
  `apps/st0/frontend/src/trackIcons.tsx` ≡ `packages/ui-chains-react/src/moduleIcons.tsx`.
  (Le reste de la duplication des tables de glyphes est argumenté et assumé — voir
  `moduleIcons.tsx`.)
- **Le spinner plein écran**, cinq copies du même bloc :
  `apps/st0/frontend/src/components/{AuthGate,EngineGate}.tsx`,
  `packages/project-shell/src/ProjectGate.tsx`, `apps/pl8/frontend/src/Gate.tsx` et
  `apps/z0/editor/src/Gate.tsx`. Laissé tel quel : des blocs de présentation courts, sans risque
  de dérive silencieuse — mais il en pousse une par gate, ce qui fait de ce compte une chose à
  revérifier.
- **Les quatre `turbo.json` d'app** (`apps/{k7,st0,pl8,z0}`) sont **identiques octet pour
  octet**, et leur bloc `tasks.dev` reproduit celui de la racine dont ils héritent par
  `"extends": ["//"]`. Ils ne surchargent rien.

### Laissé exprès

`where()` (`apps/pl8/frontend/src/engine/EnginePicker.tsx`, `apps/z0/editor/src/Gate.tsx`) est
deux lignes identiques dont le seul foyer naturel serait `packages/web-protocol/quality.ts`, à
côté de `formatLatency` — mais ce paquet ne contient **aucune chaîne d'interface en français**,
et « hors de portée » y ferait entrer la langue de l'UI dans un paquet de protocole. Deux lignes
ne valent pas cette propriété-là. Même raisonnement pour `signedInAs` / `currentUser()`.

`AuthUser` est déclarée cinq fois, et seule celle de st0 porte `email?: string | null` et
`groups?: string[]`.

## 5. Config

| constat | où |
|---|---|
| Sans aucun fichier de test : `graph-model` et `ui-eyes`. | — |
| Lues dans le code et absentes de **tout** fichier `.md`, en plus des quatorze ci-dessous : `STUDIO_BACKEND_URL`, `STUDIO_ENGINE_PORT`, `STUDIO_FILE_PORT`. | `apps/st0/frontend/vite.config.ts`, `packages/file-service/src/server.ts` |
| Importé sans être déclaré, hors de l'axe audio : `ui-chains-react` + `k7-frontend` (`@storybook/react-vite`), `pl8-frontend` (`@studio/ui-editor`). | — |
| `yaml` chez `st0-frontend` n'est pas que du test : `rackBuilder.ts` et `sliceSymbols.ts` l'importent en production. | `apps/st0/frontend` |
| `packages/web-protocol` n'a aucun bloc `dependencies`, et c'est JUSTE — `types.ts` n'importe qu'un `type` de son propre `projects.ts`. C'est cette absence de dépendance runtime qui permet à `engine-client` de le prendre pour lire `ENGINE_OUTBOX_MAX` sans alourdir le bundle du superviseur. | `packages/web-protocol` |
| Lues dans le code, absentes de `env.example.yaml` : `STUDIO_REGISTRY_URL` (9 lectures), `STUDIO_WEB_ORIGIN` (5), `STUDIO_DEMOS` (4), `STUDIO_MODELS` (3), `STUDIO_WEB_PORT` (3), `STRUDEL_SAMPLES`, `DIRT_SAMPLES`, `STUDIO_ENGINE_TOKEN`, `STUDIO_SCRATCH`, `K7_URL`, `K7_TOKEN`, `Z0_RENDER_ENGINE`, `MPV_BIN`, `CHROME`. | `env.example.yaml` |

## 6. La chaîne d'effets par platine — un bloc, à trancher en entier

Mix est un pupitre : deux vinyles et un crossfader. La chaîne d'effets d'une platine n'y a pas
de place, et le seul hôte du pupitre (la surface `turntables` de st0) ne dessine pas de graphe
par platine. Trois symboles tiennent debout les uns par les autres et par rien d'autre :

| symbole | où | tenu vivant par |
|---|---|---|
| `chains.tsx` (le composant) | `packages/ui-turntables/src/chains.tsx` | rien |
| `M9_ICONS` | même fichier | `chains.tsx` seul |
| `deckGraph`, `categoryOf` | `packages/ui-turntables/src/graph.ts` | `chains.tsx` et `graph.test.ts` |

`graph.ts` ne survit à la disparition de `chains.tsx` que par un import de **type** :
`deck.ts` prend `DeckModule` chez lui. Le fichier reste donc, la fonction non.

**Non supprimés, et c'est un choix** : ils marchent, `graph.test.ts` les couvre, et la chaîne
par platine fait partie des options annoncées. Inscrit ici plutôt que laissé silencieux : c'est
la différence entre un état connu et de la pourriture. Voir
[packages/ui-turntables/docs/mix.md](../packages/ui-turntables/docs/mix.md).

Ce bloc n'a **aucun hôte** : la décision n'est pas « où vit son hôte » mais « garde-t-on une
option que rien ne peut monter ». `M9_ICONS` porte le nom d'une application qui n'existe pas, et
ce nom traîne encore dans `env.example.yaml`, `docs/tokens.md` (une ligne de la table des
préfixes), `engine/moteur/AGENTS.md`, `apps/pl8/backend/src/server.ts`,
`packages/web-protocol/types.ts`, `apps/z0/AGENTS.md` et les fixtures de
`SessionRegistry_test.cpp` : à nettoyer avec le bloc ou avant lui.

## 7. Généré, sans effet

`engine/capot/src-tauri/resources/{file-service,engine-host}.mjs` et les entrées
`.turbo/cache/*-manifest.json` sont des artefacts de build : ils disparaissent au prochain
`build-engine.mjs`. La vérité de source est `packages/engine-protocol/sessions.ts`.
