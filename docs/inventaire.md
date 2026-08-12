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

**Deux pièges de méthode, tous deux rencontrés en écrivant ceci :**

- **Les extensions comptent.** `engine-host` écrit `from "./addresses.ts"`. Une recherche sur
  `"…/addresses"` ne le voit pas et déclare morts cinq de ses six sous-chemins — ils sont tous
  vivants.
- **Un spécificateur ne tient pas sur deux lignes.** Une regex trop permissive attrape le mot
  `from` en pleine prose et invente des dizaines de dépendances fantômes.

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

| quoi | où | note |
|---|---|---|
| `__hints_tmp.ts` | `packages/song/src/` | script de debug ad hoc (`process.argv[2]`, des `console.log`). Le nom `__…_tmp` dit qu'il ne devait pas survivre. |
| `chains.tsx` | `packages/ui-turntables/src/` | la vue « chaîne d'une platine », ~60 lignes de colle. Personne ne la monte. Voir §6, c'est le bloc à trancher en entier. |
| `index.ts` | `packages/ui-eyes/src/` | le baril de commodité. Son propre en-tête dit que « les sous-chemins sont la vraie API », et c'est exactement ce que font les appelants. |
| `export.ts` | `packages/ui-eyes/src/` | **atteignable seulement par le baril mort ci-dessus** : `exportScene` (l'export WebCodecs, image par image) n'est donc joignable par rien. Aucune surface ne monte de bouton pour lui. |
| `probeLocalEngine` | `packages/engine-browser/src/probe.ts` | remplacé par le registre ; il ne reste que de la prose qui en parle au passé. Le supprimer ferait tomber une sonde loopback que rien ne rejoue : à trancher, pas à laisser pourrir. |
| type `Signal` | `packages/dsp/src/index.ts` | `@deprecated`, plus une seule référence dans tout le dépôt. |
| `rollGridPlugin` / `trackerPlugin` | `packages/ui-editor/src/tracker/plugin.ts` | les deux extensions CodeMirror qui remplacent le `notes:` **sur place**, dans le texte. Le seul hôte des grilles (l8, `SeqGrid.tsx`) passe par `mountSeqGrid`, qui rend la même grille dans un conteneur à part. Elles gardent une propriété que `mountSeqGrid` n'a pas — l'enveloppe YAML reste visible autour de la grille. |
| export `AuthUser` | `apps/st0/frontend/src/api.ts` | utilisé dans son propre fichier, importé par personne : c'est l'`export` qui est de trop. |
| script `"serve"` | `apps/l8/frontend/package.json` | doublon exact de `"dev": "vite"` juste en dessous, référencé nulle part. |

**Outillage sans point d'entrée** — des programmes, pas du code mort, mais que rien ne câble :

- `packages/song/scripts/{migrateModules,migrateChains,migrateDocFields,projectFingerprint}.ts` —
  aucun script npm ni tâche turbo. `packages/song/src/moduleMigrate.ts` (350+ lignes) n'existe
  que pour `migrateModules.ts`.
- `packages/ui-turntables/scripts/{tempo-drag,metronome}.ts` — ceux-là sont **documentés** et se
  lancent à la main (`docs/hosting.md`) ; ils mesurent un SON, ce qu'aucun test unitaire ne fait.

## 3. Construit d'avance — à ne pas confondre avec un oubli

`packages/player-web/src/moteurPlayer.ts` et `moteurEffects.ts` n'ont aucun importateur de
production. Ce n'est **pas** un oubli : ils sont documentés délibérément
(`packages/player-web/docs/moteurPlayer.md`) et `AGENTS.md` les présente comme le joint que
`@studio/player-web` porte déjà.

Si on les supprimait, `@studio/engine-browser` et `@studio/engine-protocol` sortiraient des
dépendances de `player-web` avec eux — ils ne servent qu'à ces deux fichiers.

## 4. Duplication

### Le client d'auth : deux moitiés du dépôt, deux comportements

`loginUrl` doit être un **getter** — il capture l'adresse où l'on est *au moment du clic*.

| forme | où |
|---|---|
| getter (correct) | `apps/k7/frontend/src/api.ts`, `apps/l8/frontend/src/api.ts` |
| constante évaluée à l'import | `apps/st0/frontend/src/api.ts`, `apps/z0/editor-v2/src/api.ts` |

Le commentaire qui explique pourquoi la constante est fausse a voyagé ; le correctif non.

**`AuthUser` est déclarée neuf fois** — l8, st0, z0/editor-v2, et les six SPA de z0
(`buzzer`, `editor`, `monitor-web`, `online`, `presenter`, `remote`). Les formes ont divergé :
seule celle de l8 porte `email?: string | null` et `groups?: string[]`.

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
| Des tests qui ne tournent jamais : des fichiers `*.test.ts` et aucun script `test`, donc `turbo run test` les ignore. | `packages/translator` (2 fichiers), `packages/ui-waveform` (1) |
| Importé sans être déclaré — ne se résout que par hoisting. | `engine-host` (`@frediverse/oidc`, `yaml`), `file-service` + `web-protocol` (`@studio/engine-protocol`), `translator` (`yaml`, `vitest`), `ui-editor` (`yaml`), `ui-waveform` (`vitest`), `ui-chains-react` + `k7-frontend` (`@storybook/react-vite`), `l8-frontend` (`yaml`, `zod`, `vitest`), `st0-frontend` (`@studio/ui-editor`) |
| `yaml` chez `l8-frontend` n'est pas que du test : `sliceWaveformWidget.ts` l'importe en production. | `apps/l8/frontend` |
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

## 7. Généré, sans effet

`engine/capot/src-tauri/resources/{file-service,engine-host}.mjs` et les entrées
`.turbo/cache/*-manifest.json` sont des artefacts de build : ils disparaissent au prochain
`build-engine.mjs`. La vérité de source est `packages/engine-protocol/sessions.ts`.
