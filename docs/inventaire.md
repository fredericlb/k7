# Inventaire du code mort, dupliqué et construit d'avance

Relevé du 4 août 2026, après le renommage `platines → m9`, **révisé le même jour après l'audit de
cohérence**. Le constat reste un constat : ce qui a été traité depuis est marqué RÉSOLU sur place
plutôt que retiré, pour que la ligne garde son historique. Chaque entrée porte de quoi trancher.

> **Lisez le §0 avant de supprimer quoi que ce soit.** Un balayage automatique a déjà classé
> mort un paquet chargé à l'exécution. Le piège se reproduira.

## Traité par l'audit de cohérence — ne pas rechercher

- **Les deux coquilles HTTP de la médiathèque** (`apps/st0/backend/src/routes/library.ts` ↔
  `packages/file-service/src/routes/mediatek.ts`) : ~35 lignes identiques, et surtout deux
  tables MIME divergées **dans des formes incompatibles**. Le vocabulaire (familles, extensions,
  bornes de recherche) vit désormais dans `@studio/mediatek` ; le routage reste délibérément
  dupliqué, les deux sémantiques de 404 n'étant pas les mêmes. Voir `packages/mediatek/docs/mime.md`.
- **Le client `engines`** recopié entre st0 et m9 (36 lignes, commentaires compris) →
  `@studio/engine-browser/registry`.
- **`chooseEngine` refait à la main dans l8** (`EngineGate.tsx`), qui oubliait le filtre
  `&& r.token` et le raccourci « un seul moteur joignable » → il appelle le partagé.
- **`TIER_LABEL` en triple** : déjà résolu avant l'audit, tout le monde passe par `formatLatency`.
- **Le commentaire orphelin** de `apps/st0/frontend/src/api.ts` (il documentait un objet déplacé
  30 lignes plus bas) : supprimé.

Reste **non traité, et c'est un choix** : `where()` (`m9/Gate.tsx`, `st0/EnginePicker.tsx`,
`st0/EngineStatusBar.tsx`) est deux lignes identiques dont le seul foyer naturel serait
`packages/web-protocol/quality.ts`, à côté de `formatLatency` — mais ce paquet ne contient
aujourd'hui **aucune chaîne d'interface en français**, et `« hors de portée »` y ferait entrer
la langue de l'UI dans un paquet de protocole. Deux lignes ne valent pas cette propriété-là.
Même raisonnement pour `signedInAs` / `currentUser()`.

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

### `detectTransients` n'est appelé par personne, et doit le rester

`packages/commands/src/waveform.ts` exporte `detectTransients`, que plus aucun code de
production n'appelle : la détection tourne désormais dans le moteur, en C++
(`engine/moteur/engine/Waveform.cpp`), pendant qu'il sous-échantillonne déjà l'audio, et le
résultat est écrit dans le sidecar `{source}.cache`.

La version TypeScript reste la **spécification exécutable** que le C++ recopie, et
`waveform.test.ts` est le contrat qui tient les deux ensemble. Exactement l'arrangement de
`fileFingerprint`, qui porte le même commentaire « MUST match » depuis toujours — à la
différence près que celui-là a encore un appelant, et que celui-ci n'en a plus. Un balayage
qui ne regarde que les importateurs le classera mort ; il ne l'est pas.

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
| export `AuthUser` | `apps/st0/frontend/src/api.ts:22`, `apps/m9/frontend/src/api.ts:12` | exporté, jamais importé. Seul celui de l8 est consommé. |
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
  `apps/m9/frontend/src/Gate.tsx:22` ≡ `apps/st0/frontend/src/engine/EnginePicker.tsx:12`.
  l8 a la même table en `TIER_LABEL` (`EngineSelect.tsx:11`), via paraglide — donc c'est
  déjà la troisième. Foyer naturel : à côté de `chooseEngine`.
- **Le spinner plein écran**, cinq copies du même bloc : `l8/{AuthGate,EngineGate,ProjectGate}`,
  `st0/Gate.tsx:33`, `m9/Gate.tsx:76`. Laissé tel quel : cinq blocs de présentation courts, sans
  risque de dérive silencieuse. (`WorkspaceGate` est devenu `ProjectGate` quand st0 a pris les
  dépôts — voir `apps/st0/docs/projects.md`.)
- **Le stub « pas de barre de commandes »**, trois copies : `m9/chains.tsx:74`,
  `st0/ChainView.tsx:45`, `st0/ModulePreview.tsx:63`.
- **Le type `Phase`**, identique : `st0/engine/useModuleEngine.ts:18` ≡ `m9/useEngine.ts:14`.
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
| Cinq `turbo.json` d'app **strictement identiques** au bloc `tasks.dev` de la racine : ils ne surchargent rien. | `apps/{k7,l8,m9,st0,z0}/turbo.json` |
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
`packages/engine-protocol/sessions.ts`, qui dit bien `l8 / st0 / m9`.
