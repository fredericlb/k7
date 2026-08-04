# Inventaire du code mort, dupliqué et construit d'avance

Relevé du 4 août 2026, après le renommage `platines → m9`. **Rien n'a été supprimé** : c'est un
constat, pas un nettoyage. Chaque entrée porte de quoi trancher.

> **Lisez le §0 avant de supprimer quoi que ce soit.** Un balayage automatique a déjà classé
> mort un paquet chargé à l'exécution. Le piège se reproduira.

---

## 0. Faux positifs connus — ne pas retuer

### `@studio/dsp` est vivant

Un scan l'a classé « paquet entièrement mort, plus une dépendance fantôme dans `@studio/song` ».
Les deux affirmations sont fausses :

- `packages/song/src/nodeProject.ts:244` lance `dspRunner.mjs` **en processus fils** ;
- `packages/song/src/dspRunner.mjs:9` fait `import { graph } from "@studio/dsp"` ;
- la dépendance `song → dsp` du `package.json` existe **précisément** pour que cet import se
  résolve — un dossier de morceau n'a pas de `node_modules` et n'en aura jamais. Le
  commentaire en tête de `dspRunner.mjs` le dit.

C'est aussi l'API d'auteur publiée aux utilisateurs
(`apps/l8/docs/25-syntax-instruments.md:60`), et le C++ colle son JSON généré
(`engine/moteur/engine/GraphDspPlugin.cpp:13`).

**Pourquoi le scan s'est trompé :** il ne lisait que `.ts`/`.tsx`. Le seul consommateur est un
`.mjs`. Tout inventaire de ce dépôt doit inclure `.mjs` et les processus fils.

### Deux paquets sont des programmes, pas des bibliothèques

`@studio/file-service` (`bin: studio-file-service`) et `@studio/engine-host` (`src/main.ts`)
n'ont aucun importateur, et c'est normal : ils sont *exécutés*, et `engine/capot/scripts/build-engine.mjs`
les bundle par esbuild. Ne pas conclure de « zéro import » à « mort ».

### Deux imports profonds contournent les cartes `exports`

`engine/moteur/scripts/list-sessions.ts:12` → `packages/engine-host/src/engineQueries.ts`, et
`engine/moteur/scripts/render-once.ts:7` → `packages/file-service/src/render.ts`. Ces deux
fichiers paraissent inatteignables si on ne regarde que les `exports`.

---

## 1. Surface exportée sans consommateur

21 sous-chemins n'ont aucun importateur hors de leur propre paquet. Dans presque tous les cas
**le module reste vivant à l'intérieur** — c'est le réflexe « publier tout `src/` ». Rétrécir la
carte `exports` ne supprime pas de code et documente la vraie surface.

| paquet | sous-chemins sans importateur |
|---|---|
| `engine-host` | `./identity`, `./addresses`, `./settings`, `./hostProtocol`, `./audioPolicy` — **5 sur 6** |
| `ui-eyes` | `.`, `./timeline`, `./compositor`, `./export` |
| `ui-editor` | `./yaml/previewTriggers`, `./yaml/entityValues`, `./yaml/keyPath` |
| `player-web` | `./moteur`, `./moteur-effects` — voir §3 |
| `mediatek` | `./scan`, `./evict` |
| `song` | `./yaml/uiFile`, `./moduleTypes` |
| `commands` | `./timeline` |
| `dsp` | `./autowah` |

`engine-host` est le cas net : sa carte `exports` devrait se réduire à `./webOrigins`, le seul
sous-chemin réellement importé (`file-service/src/{cors,pendingOrigins}.ts`).

## 2. Vraiment orphelin

| quoi | où | note |
|---|---|---|
| `__hints_tmp.ts` | `packages/song/src/` | script de debug ad hoc (`process.argv[2]`, des `console.log`). Aucun importateur, aucune référence. Le nom `__…_tmp` dit qu'il ne devait pas survivre. |
| `probeLocalEngine` | `packages/engine-browser/src/probe.ts:128` | remplacé par le registre. Les deux seules mentions restantes sont de la prose, dont `engine-registry/docs/shared.md:11` qui en parle **au passé**. |
| type `Signal` | `packages/dsp/src/index.ts:48` | marqué `@deprecated`, plus aucun usage. |
| script `"serve"` | `apps/l8/frontend/package.json:7` | doublon exact de `"dev": "vite"` juste en dessous, référencé nulle part. |
| export `AuthUser` | `apps/mediatek/frontend/src/api.ts:22`, `apps/m9/frontend/src/api.ts:12` | exporté, jamais importé. Seul celui de l8 est consommé. |
| `evict.ts` | `packages/mediatek/src/` | atteignable seulement par l'export mort `./evict` et son propre test. |

**Outillage à une seule utilisation**, pas mort mais sans point d'entrée :
`packages/song/scripts/{migrateModules,migrateChains,projectFingerprint}.ts` ne sont câblés à
aucun script npm ni tâche turbo. `packages/song/src/moduleMigrate.ts` (350+ lignes) n'existe que
pour `migrateModules.ts:24`. Ça pourrira en silence.

## 3. Construit d'avance — à ne pas confondre avec un oubli

`packages/player-web/src/moteurPlayer.ts` et `moteurEffects.ts` n'ont aucun importateur. Ce
n'est **pas** un oubli : ils sont documentés délibérément
(`packages/player-web/docs/moteurPlayer.md`) et `AGENTS.md` les présente comme « le joint que
`@studio/player-web` avait déjà ». Les supprimer contredirait la carte du dépôt.

Si on les supprimait un jour, `@studio/engine-browser` et `@studio/engine-protocol` sortiraient
des dépendances de `player-web` avec eux — ils ne servent qu'à ces deux fichiers.

## 4. Duplication

### Classée par gravité

**Le client d'auth, en trois copies, dont une seule a le correctif.** l8 utilise un
**getter** pour `loginUrl` (`apps/l8/frontend/src/api.ts:193`) — *« un GETTER, pas une
constante : il doit capturer où vous êtes au moment du clic »*. mediatek (`api.ts:75`) et m9
(`api.ts:37`) utilisent une **constante** évaluée à l'import. Le commentaire expliquant
pourquoi la constante est fausse a été copié ; le correctif non.
`AuthUser` a dérivé aussi : l8 a `email?: string | null` et `groups?: string[]`, les deux
autres non.

**`chooseEngine` adopté par tous sauf l8.** `packages/engine-browser/src/choose.ts` dit
avoir été extrait *« parce que c'est la même question dans chaque service »*. mediatek et m9
l'importent ; `apps/l8/frontend/src/components/EngineGate.tsx:85` refait le calcul à la
main — `chooseEngine` moins le filtre `&& r.token` et moins le raccourci « un seul moteur
joignable n'est pas une question ».

**`categoryOf` de m9 est une copie affaiblie.** `apps/m9/frontend/src/graph.ts:66` mappe un
chemin de module vers sa catégorie par `split("/")[1]` à index fixe — ce qui casse sur
`_modules/` et sur les chemins imbriqués — et lui manque l'alias historique `midi`. La version
solide est `moduleCategoryOf` dans `packages/ui-chains/src/modulePreview.ts:41`, dont m9 dépend
déjà. La justification historique de la duplication (*« le seul foyer commun serait
`@studio/mediatek`, la bibliothèque côté Node »*) est morte avec `moduleGraph.ts`.

### Cosmétique, mais réelle

- **Le libellé de tier**, identique au caractère près, commentaire compris :
  `apps/m9/frontend/src/Gate.tsx:22` ≡ `apps/mediatek/frontend/src/engine/EnginePicker.tsx:12`.
  l8 a la même table en `TIER_LABEL` (`EngineSelect.tsx:11`), via paraglide — donc c'est
  déjà la troisième. Foyer naturel : à côté de `chooseEngine`.
- **Le spinner plein écran**, cinq copies du même bloc : `l8/{AuthGate,EngineGate,WorkspaceGate}`,
  `mediatek/Gate.tsx:33`, `m9/Gate.tsx:76`.
- **Le stub « pas de barre de commandes »**, trois copies : `m9/chains.tsx:74`,
  `mediatek/ChainView.tsx:45`, `mediatek/ModulePreview.tsx:63`.
- **Le type `Phase`**, identique : `mediatek/engine/useModuleEngine.ts:18` ≡ `m9/useEngine.ts:14`.
- **Le glyphe `piano-16`**, corps SVG identique octet pour octet entre
  `apps/l8/frontend/src/trackIcons.tsx:38` et
  `packages/ui-chains-react/src/moduleIcons.tsx:20`, et son enveloppe `<svg …>` réécrite à la
  main une troisième et une quatrième fois dans `mediatek/ModulePreview.tsx:23` et
  `m9/chains.tsx:25`. (Le reste de la duplication des tables de glyphes est argumenté et
  assumé — voir `moduleIcons.tsx:8`.)

## 5. Config

| constat | où |
|---|---|
| **Un test qui ne tourne jamais.** `emitInstances.test.ts` existe, le paquet n'a aucun script `test`, donc `turbo run test` l'ignore. Seul paquet dans ce cas. | `packages/translator/` |
| `vitest` lancé sans être déclaré — ne se résout que par hoisting. mediatek et m9 le déclarent. | `apps/l8/frontend/package.json` |
| Cinq `turbo.json` d'app **strictement identiques** au bloc `tasks.dev` de la racine : ils ne surchargent rien. | `apps/{k7,m9,mediatek,z0,l8}/turbo.json` |
| Pas de section `m9-backend` ; le port 8796 est en dur dans le serveur alors que k7 et mediatek déclarent le leur. `STUDIO_PREFS_DIR` n'est documenté nulle part. | `env.example.yaml` |
| Lus dans le code, absents de l'exemple : `STUDIO_REGISTRY_URL` (18 lectures), `K7_URL`, `K7_TOKEN`. | — |
| Importé sans être déclaré : `@studio/engine-protocol` par `file-service` et `web-protocol` (qui n'a **aucun** bloc `dependencies`), `yaml` par `translator` et `ui-editor`. | — |
| Déclaré sans être importé : `zod`, `@types/express` en devDeps. | `packages/web-protocol` |
| Pas de champ `description`. | `packages/ui-waveform`, `packages/web-protocol` |

## 6. Petits nettoyages sûrs

- **Ternaire mort** : `apps/m9/frontend/src/graph.ts:60` — `warnings: song ? [] : []`, les deux
  branches identiques. C'est le **seul** usage du paramètre `song` de `deckGraph`, que
  `chains.tsx:56` passe pourtant dans un `useMemo` : chaque changement de morceau force un
  re-layout complet du graphe pour rien.
- **Commentaire tronqué en pleine phrase** : `packages/ui-chains-react/src/moduleIcons.tsx:5`
  s'arrête sur « keyed by CATEGORY rather than a ».

## 7. Ce que le renommage a laissé dans le généré

Sans effet, disparaît au prochain build : `engine/capot/src-tauri/resources/file-service.mjs`,
`src-tauri/target/{debug,release}/resources/file-service.mjs`, et une quarantaine d'entrées
`.turbo/cache/*-manifest.json`. La vérité de source est
`packages/engine-protocol/sessions.ts`, qui dit bien `l8 / mediatek / m9`.
