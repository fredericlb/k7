# Inventaire du code mort, dupliqué et construit d'avance

Ce que le dépôt contient et que rien n'atteint. Chaque entrée porte de quoi trancher :
*qui appelle* est la question, pas *est-ce que ça marche*.

> **Lisez le §0 avant de supprimer quoi que ce soit.** Plusieurs modules bien vivants sont
> invisibles à un balayage des `import`. Le piège se reproduit à chaque relevé.

## Comment ce relevé est fait

Trois passes, toutes reproductibles :

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

**Deux pièges de RELEVÉ, découverts en rejouant les quatre passes :**

- **Un renommage de fichier périme un chemin sans périmer le constat.** `chainRefFromCreate`
  était listé sous `moduleInsert.ts`, qui n'existe plus — le fichier est `nodeInsert.ts`. Le
  symbole, lui, a été ressuscité entre-temps. Une entrée peut donc être fausse deux fois.
- **Un constat corrigé ne se retire pas tout seul.** Trois entrées décrivaient des problèmes
  réparés depuis (`loginUrl`, les tests jamais joués, `isFileParam`). Un relevé qui n'est pas
  rejoué devient un réquisitoire contre un dépôt qui a bougé.

Corollaire : **`docs/audit-moteur.md` §C5 tient sa propre liste de code mort**, au périmètre
qui chevauche celui-ci sans lui être identique. Les deux se lisent ensemble, ou une entrée
périme des deux côtés sans que personne le voie.

**Trois pièges de méthode, tous rencontrés en écrivant ceci :**

- **Les extensions comptent.** `engine-host` écrit `from "./addresses.ts"`. Une recherche sur
  `"…/addresses"` ne le voit pas et déclare morts cinq de ses six sous-chemins — ils sont tous
  vivants.
- **Un spécificateur ne tient pas sur deux lignes.** Une regex trop permissive attrape le mot
  `from` en pleine prose et invente des dizaines de dépendances fantômes.
- **Un octet NUL rend un fichier INVISIBLE.** ripgrep classe binaire tout fichier qui en
  contient un, et le saute sans un mot : le fichier cesse d'exister pour toute la passe
  d'accessibilité. Trois fichiers en portaient un comme séparateur de clé composite, dont
  `engine-host/src/supervisor.ts` — 781 lignes, et le fichier le plus remanié de tout le
  domaine moteur. Les relevés antérieurs à ce jour ne l'ont donc jamais lu. Corrigé, et
  `npm run lint:bytes` (`scripts/check-source-bytes.mjs`) refuse désormais le cas en CI.

---

## 0. Faux positifs connus — ne pas retuer

### Ce qui est chargé par CHEMIN, jamais importé

| quoi | comment il vit |
|---|---|
| `packages/song/src/dspRunner.mjs` | lancé en **processus fils** par `nodeProject.ts`. Il fait `import { graph } from "@studio/dsp"`, et la dépendance `song → dsp` existe précisément pour que cet import se résolve : un dossier de morceau n'a pas de `node_modules`. |
| `packages/dsp/modules/{normalize,sweep}/jsdsp.ts` | des DSP de MODULE. Le compilateur les trouve par nom de fichier (`JSDSP_FILE = "jsdsp.ts"`), jamais par import. |
| `packages/file-service/src/separateWorker.ts` | lancé par `separateJobs.ts` via `new URL("./separateWorker.ts", import.meta.url)`. |
| `packages/engine-host/src/main.ts`, `packages/file-service/src/server.ts` | **entrées esbuild** de `engine/capot/scripts/build-engine.mjs`, qui les bundle dans le tray. Zéro import n'est pas zéro appelant. |
| `packages/ui-chains-react/src/DomChains.stories.tsx` | ramassé par le glob de `.storybook/main.ts`. |
| `packages/dsp/src/emit.ts` | le script `build` du paquet (`tsx src/emit.ts`). Une passe qui ne regarde que `bin` et les entrées esbuild le déclare mort ; **un `scripts` de `package.json` est un appelant.** |

`@studio/dsp` est aussi l'API d'auteur publiée aux utilisateurs
(`apps/l8/docs/25-syntax-instruments.md`), et le C++ colle son JSON généré
(`engine/moteur/engine/GraphDspPlugin.cpp`).

### `detectTransients` n'est appelé par personne, et doit le rester

`packages/commands/src/waveform.ts` l'exporte, et plus aucun code de production ne l'appelle :
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

`ui-turntables` est le cas à regarder : son seul hôte, l8, n'importe que `/deck-set`, `/engine`
et `/surface`. Les douze autres sont de la plomberie interne exposée.

## 2. Vraiment orphelin — rien ne l'atteint

> **Relevé du 2026-08-17 : les suppressions faites.** `__hints_tmp.ts`, le script `serve` en
> double, le baril mort de `z0-shared`, et quinze symboles (`valueAt`, `loadMixView`,
> `setTrackFields`, `mediatekDirFor`, `isGeneratedTrack`, `readDoc`, `remoteListing`,
> `forgetPlayers`, `hasLibraries`, `fileServiceLogPath`, `PORT_LEAD`, `EMPTY_SET`, `isYamlFile`,
> `AVAILABLE_EFFECTS`, `localizedCommandNames`) plus les types `CurveType`, `EntityKind`,
> `ViewBinding`, `ProjectSettings`, `SongEntryValue`. Et `EngineHost::waveformData()`, côté C++.
> Les lignes ci-dessous sont donc ce qui RESTE.

| quoi | où | note |
|---|---|---|
| `chains.tsx` | `packages/ui-turntables/src/` | la vue « chaîne d'une platine », ~60 lignes de colle. Personne ne la monte. Voir §6, c'est le bloc à trancher en entier. |
| `index.ts` | `packages/ui-eyes/src/` | le baril de commodité. Son propre en-tête dit que « les sous-chemins sont la vraie API », et c'est exactement ce que font les appelants. **Gardé** parce que le supprimer emporte `export.ts` et `FrameClock` avec lui — c'est le bloc WebCodecs, une décision produit. Le baril JUMEAU de `z0-shared`, lui, ne tenait rien : supprimé. |
| `export.ts` | `packages/ui-eyes/src/` | **atteignable seulement par le baril mort ci-dessus** : `exportScene` (l'export WebCodecs, image par image) n'est donc joignable par rien. Aucune surface ne monte de bouton pour lui. |
| `probeLocalEngine` | `packages/engine-browser/src/probe.ts` | remplacé par le registre ; il ne reste que de la prose qui en parle au passé. Le supprimer ferait tomber une sonde loopback que rien ne rejoue : à trancher, pas à laisser pourrir. |
| type `Signal` | `packages/dsp/src/index.ts` | `@deprecated`, plus une seule référence dans tout le dépôt. |
| `rollGridPlugin` / `trackerPlugin` | `packages/ui-editor/src/tracker/plugin.ts` | les deux extensions CodeMirror qui remplacent le `notes:` **sur place**, dans le texte. Le seul hôte des grilles (l8, `SeqGrid.tsx`) passe par `mountSeqGrid`, qui rend la même grille dans un conteneur à part. Elles gardent une propriété que `mountSeqGrid` n'a pas — l'enveloppe YAML reste visible autour de la grille. |
| export `AuthUser` | `apps/st0/frontend/src/api.ts` | utilisé dans son propre fichier, importé par personne : c'est l'`export` qui est de trop. |

### Des SYMBOLES, pas des fichiers

Le fichier vit, la fonction non : personne ne prononce ce nom, nulle part, pas même le fichier
qui le déclare. Relevé par la passe 4 ; les trois déjà décrits ailleurs sur cette page
(`probeLocalEngine`/`isReachable`, `rollGridPlugin`/`trackerPlugin`, `ChainsPanel`) n'y sont pas
répétés.

| symbole | où | note |
|---|---|---|
| `FrameClock` | `packages/ui-eyes/src/clock.ts` | l'horloge que **l'exporteur** avance — et `export.ts` est déjà mort deux lignes plus haut. Le chemin WebCodecs est mort en entier : le baril, `exportScene`, et l'horloge qui le cadence. À trancher d'un bloc, comme §6. |
| `isDocRef` | `packages/song/src/moduleTypes.ts` | une garde de type que plus rien n'interroge. (`isFileParam`, avec qui elle était listée, a été **ressuscitée** : cinq sites, dont `commands.ts`.) |
| `listAll` | `packages/mediatek/src/catalogue.ts` | |
| `PATH_SEP` | `packages/file-service/src/machinePlayer.ts` | |
| `knownPrefs` | `apps/st0/frontend/src/prefs.ts` | |
| `requireDb`, `readRawAttachment`, `canRender` | `apps/z0/backend/src/{db,grist/load,render}.ts` | |
| `drawButton`, `drawPlayerBox`, `drawSpinner`, `drawReloadIcon` | `apps/z0/presenter/src/canvas/drawHelpers.ts` | quatre primitives de dessin sur les six du fichier ; le présentateur ne dessine plus ni bouton ni boîte joueur. |

**232 symboles de plus ne sont prononcés que par leur propre test.** Ce n'est pas du code mort —
c'est le choix, assumé partout ici, de tester une constante ou un pas de calcul plutôt que la
seule fonction publique qui les enveloppe. Compté ici pour que le chiffre ne surprenne pas la
prochaine passe : `ui-turntables/deck.ts` (10), `ui-chains/cableCanvas.ts` (9), `ui-chains/graph.ts` (9).

**Outillage sans point d'entrée** — des programmes, pas du code mort, mais que rien ne câble :

- `packages/song/scripts/{migrateModules,migrateChains,migrateDocFields,migrateNamespace,migrateTimecodes,projectFingerprint}.ts`
  — aucun script npm ni tâche turbo. `packages/song/src/moduleMigrate.ts` (350+ lignes) n'existe
  que pour `migrateModules.ts`. Deux se sont ajoutés depuis le relevé précédent : le dossier
  grossit d'une migration à chaque renommage, et rien ne les retire une fois jouées.
- `packages/ui-turntables/scripts/{tempo-drag,metronome}.ts` — ceux-là sont **documentés** et se
  lancent à la main (`docs/hosting.md`) ; ils mesurent un SON, ce qu'aucun test unitaire ne fait.

## 3. Construit d'avance — à ne pas confondre avec un oubli

`packages/player-web/src/moteurPlayer.ts` et `moteurEffects.ts` n'ont aucun importateur de
production. Ce n'est **pas** un oubli : ils sont documentés délibérément
(`packages/player-web/docs/moteurPlayer.md`) et `AGENTS.md` les présente comme le joint que
`@studio/player-web` porte déjà.

Si on les supprimait, `@studio/engine-browser` et `@studio/engine-protocol` sortiraient des
dépendances de `player-web` avec eux — ils ne servent qu'à ces deux fichiers.

### Demander à un greffon ce qu'il a — une chaîne entière sans appelant

`list-plugin-params` / `plugin-param-list` dans le moteur, `pluginParamsOf`
(`engine/moteur/engine/ParamDump.cpp`), `listPluginParams` dans les deux clients,
`awaitPluginParams` et la route `GET /plugin-params` du service de fichiers : **rien ne les
appelle**. Ils ont été écrits pour un générateur de panneaux qui a été retiré, parce qu'un
panneau déduit d'une liste de paramètres ne sait produire que des boutons et des listes
déroulantes — jamais un fader, un `meter`, un sélecteur de fichier ni une disposition.

Gardés sciemment, pour deux raisons qui ne dépendent pas du générateur. C'est la **seule** façon
d'apprendre les paramètres d'un greffon installé — un greffon les enregistre dans son
constructeur, et le cache de scan n'en porte aucun. Et les deux corrections qu'ils ont values
sont réelles : le moteur reconstruisait un `te::Engine` par question et une quarantaine de
questions d'affilée le tuaient (mesuré, deux fois) ; et une liste vide confondait « je n'arrive
pas à charger ce greffon » avec « il se charge et ne déclare rien », ce que vingt-sept synthés
Arturia font sans que rien n'aille mal.

Qui les rallumera : un module builder qui propose la liste des paramètres d'un VST à lier, ou un
générateur qui saurait dessiner autre chose que des boutons.

## 4. Duplication

### Le client d'auth — ~~deux comportements~~ RÉGLÉ

`loginUrl` doit être un **getter**, pour capturer l'adresse où l'on est *au moment du clic*.
Les quatre copies (`k7`, `l8`, `st0`, `z0/editor-v2`) en sont une aujourd'hui. Ce constat
disait « le correctif n'a pas voyagé » ; il a voyagé depuis. Gardé barré plutôt que retiré,
pour que la prochaine passe ne le redécouvre pas comme une nouveauté.

**`AuthUser` était déclarée neuf fois** — l8, st0, z0/editor-v2, et les six SPA de z0. Quatre de
ces déclarations sont parties avec la déduplication ci-dessous ; il en reste cinq, et seule celle
de l8 porte `email?: string | null` et `groups?: string[]`.

### Le magasin d'auth de z0 : quatre fichiers identiques à l'octet — RÉGLÉ

`apps/z0/{editor,monitor-web,presenter,remote}/src/lib/auth.ts` étaient **identiques à l'octet**
(MD5 `20057DE8…`, ~100 lignes chacun) : le type `AuthUser`, le magasin de module, `bootstrap()`
avec sa branche 401, `logout`, `useAuth`. Seul l'import du `fetch` local les distinguait — une
différence d'import, pas de comportement, donc un paramètre.

Et l'ironie était dans le fichier : sa ligne 88 disait « It lives in `z0-shared/account` rather
than in six copies here », imprimée sous ses propres quatre-vingt-dix lignes de copie.

Devenu `z0-shared/auth-store` (`createAuthStore(f)`), et les quatre fichiers font dix lignes.
`buzzer` et `online` gardent les leurs : ceux-là diffèrent vraiment.

### Le nom d'une note MIDI, six fois, en quatre orthographes

La même table chromatique et la même arithmétique (`((k%12)+12)%12`, `Math.floor(k/12)-1`) :

| où | constante |
|---|---|
| `packages/ui-editor/src/tracker/RollGrid.ts` | `NOTE_NAMES` |
| `packages/ui-editor/src/tracker/TrackerGrid.ts` | `NAMES2` (deux caractères : `C-`) |
| `apps/l8/frontend/src/components/PianoRoll.tsx` | `NAMES`, exporté en `noteName` |
| `apps/l8/frontend/src/components/IoPanel.tsx` | `NOTE_NAMES` |
| `apps/k7/frontend/src/utils/pitch.ts` | `NOTE_NAMES` |
| `apps/k7/packages/lyrics/src/chords.ts` | `SHARP` |

Deux détails aggravants. Les deux premières sont dans **le même dossier du même paquet**. Et
`PianoRoll.tsx` porte le commentaire « one spelling of a key, wherever it is read » — vrai dans
l8, faux dès qu'on passe dans `@studio/ui-editor`, dont l8 dépend déjà et qui en a deux à lui.
Le prédicat suit : `isBlack = [1,3,6,8,10].includes(...)`, à l'identique dans deux fichiers.

Non traité : c'est une décision de **où poser la table**, pas un nettoyage.

### Des copies STRUCTURELLES — celles qu'un import ne peut pas résoudre

Trois duplications qu'on ne peut pas supprimer sans inverser une dépendance ou empoisonner un
bundle. Écrites ici pour qu'on cesse de les prendre pour de la paresse.

| ce qui est doublé | pourquoi ça reste |
|---|---|
| Le plancher `-100 dBFS` : `PEAK_FLOOR_DB` (`commands/peakPass.ts`), `MIN_DB` (`commands/trimGate.ts`), `kFloorDb` (`FilePeak.cpp`), et trois fois dans `@studio/dsp` | `trimGate` est **sûr pour le navigateur** — le panneau de clip de l8 l'importe — et `peakPass` appelle `node:child_process`. Partager la constante ferait entrer un lanceur de processus dans le navigateur pour économiser un nombre. Essayé, annulé. Le C++ et le JSON généré ne peuvent pas importer du tout |
| `FileEnvelope` (`commands/waveform.ts`) ≡ `Envelope` (`ui-turntables/waveform.ts`) | `ui-turntables` ne dépend pas de `@studio/commands`. Les deux dépendent de `web-protocol`, qui tient déjà `RegionWaveform` — c'est là que ça irait |
| Le détecteur de k7 : `backend/src/detect.ts` ≡ `packages/recorder/src/detect.ts` | Même forme que `detectTransients` ↔ `Waveform.cpp`, **sans** le test de contrat qui rend cet arrangement défendable : aucun test des deux côtés. L'en-tête de la copie renvoie à `backend/src/detect.js`, un chemin qui n'existe plus — la preuve qu'ils ont déjà divergé une fois |
| `isMouseWheel` : `ui-timeline/panZoom.ts` ≡ `ui-chains-react/camera.ts` | Reconnaître une molette d'une surface tactile — trois signaux (`deltaMode`, les 120 de `wheelDeltaY`, la forme du delta), identiques des deux côtés. Aucun des deux paquets ne peut dépendre de l'autre : `ui-timeline` n'a **aucune** dépendance `@studio/` et le graphe importerait un paquet nommé pour l'arrangement. Défendable ici parce que **les deux côtés sont testés**, cas par cas — c'est exactement ce qui manque au détecteur de k7 ci-dessus. Le foyer naturel serait un paquet de gestes DOM qui n'existe pas ; le créer pour une fonction de dix lignes est une décision, pas un nettoyage |

### Cosmétique, mais réelle

- **Le glyphe `piano-16`**, corps SVG identique octet pour octet :
  `apps/l8/frontend/src/trackIcons.tsx` ≡ `packages/ui-chains-react/src/moduleIcons.tsx`.
  (Le reste de la duplication des tables de glyphes est argumenté et assumé — voir
  `moduleIcons.tsx`.)
- **Le spinner plein écran**, quatre copies du même bloc :
  `l8/{AuthGate,EngineGate,ProjectGate}` et `st0/Gate.tsx`. Laissé tel quel : des blocs de
  présentation courts, sans risque de dérive silencieuse.
- **Les quatre `turbo.json` d'app** (`apps/{k7,l8,st0,z0}`) sont **identiques octet pour
  octet**, et leur bloc `tasks.dev` reproduit celui de la racine dont ils héritent par
  `"extends": ["//"]`. Ils ne surchargent rien.

### Laissé exprès

`where()` (`st0/EnginePicker.tsx`, `st0/EngineStatusBar.tsx`) est deux lignes identiques dont le
seul foyer naturel serait `packages/web-protocol/quality.ts`, à côté de `formatLatency` — mais
ce paquet ne contient **aucune chaîne d'interface en français**, et « hors de portée » y ferait
entrer la langue de l'UI dans un paquet de protocole. Deux lignes ne valent pas cette
propriété-là. Même raisonnement pour `signedInAs` / `currentUser()`.

## 5. Config

| constat | où |
|---|---|
| ~~Des tests qui ne tournent jamais~~ **RÉGLÉ** : `translator` et `ui-waveform` déclarent tous deux `"test": "vitest run"`. Les 25 paquets en ont un, sauf les trois qui n'ont aucun fichier de test (`engine-client`, `graph-model`, `ui-eyes`). | — |
| Lues dans le code et absentes de **tout** fichier `.md`, en plus des quatorze ci-dessous : `STUDIO_BACKEND_URL`, `STUDIO_ENGINE_PORT`, `STUDIO_FILE_PORT`. | `apps/l8/frontend/vite.config.ts`, `packages/file-service/src/server.ts` |
| Importé sans être déclaré — ne se résout que par hoisting. | `engine-host` (`@frediverse/oidc`, `yaml`), `file-service` + `web-protocol` (`@studio/engine-protocol`), `translator` (`yaml`, `vitest`), `ui-editor` (`yaml`), `ui-waveform` (`vitest`), `ui-chains-react` + `k7-frontend` (`@storybook/react-vite`), `l8-frontend` (`yaml`, `zod`, `vitest`), `st0-frontend` (`@studio/ui-editor`) |
| `yaml` chez `l8-frontend` n'est pas que du test : `rackBuilder.ts` et `sliceSymbols.ts` l'importent en production. (Ce constat nommait `sliceWaveformWidget.ts`, supprimé depuis ; les deux fichiers ci-dessus l'ont repris.) | `apps/l8/frontend` |
| Aucun bloc `dependencies` alors que le paquet importe `@studio/engine-protocol` ; et `zod` + `@types/express` sont déclarés en devDeps sans qu'une seule ligne les importe. | `packages/web-protocol` |
| Pas de champ `description`. | `packages/ui-waveform`, `packages/web-protocol` |
| Lues dans le code, absentes de `env.example.yaml` : `STUDIO_REGISTRY_URL` (9 lectures), `STUDIO_WEB_ORIGIN` (5), `STUDIO_DEMOS` (4), `STUDIO_MODELS` (3), `STUDIO_WEB_PORT` (3), `STRUDEL_SAMPLES`, `DIRT_SAMPLES`, `STUDIO_ENGINE_TOKEN`, `STUDIO_SCRATCH`, `K7_URL`, `K7_TOKEN`, `Z0_RENDER_ENGINE`, `MPV_BIN`, `CHROME`. | `env.example.yaml` |

## 6. La chaîne d'effets par platine — un bloc, à trancher en entier

Mix est un pupitre : deux vinyles et un crossfader. La chaîne d'effets d'une platine n'y a pas
de place, et le seul hôte du pupitre (la surface `turntables` de l8) ne dessine pas de graphe
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

**Et voici le chaînon qui manquait à ce paragraphe.** `apps/m9` et `apps/v1` existent sur le
disque, ne sont **ni suivis par git ni ignorés**, et ne figurent dans aucun `workspaces`. Or `m9`
est nommé comme application vivante dans une vingtaine de fichiers suivis — `apps/st0/backend`,
la config vite de l8, cinq pages de `apps/st0/docs/` — et jusque dans `M9_ICONS`, ici même. La
chaîne par platine n'a pas d'hôte *dans ce dépôt* parce que son hôte n'y a jamais atterri. Ce
n'est donc pas du code mort : c'est du code dont l'hôte est ailleurs, ce qui se tranche
autrement.

## 7. Généré, sans effet

`engine/capot/src-tauri/resources/{file-service,engine-host}.mjs` et les entrées
`.turbo/cache/*-manifest.json` sont des artefacts de build : ils disparaissent au prochain
`build-engine.mjs`. La vérité de source est `packages/engine-protocol/sessions.ts`.
