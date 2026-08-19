# Recette du renommage `.lanes` → `.studio` / `lanes` → `pistes`

> **HISTORIQUE — les noms de cette page sont périmés de plusieurs renommages.** Elle décrit
> `lanes → pistes` ; depuis, `pistes → l8`, `mediatek → st0` puis `st0 → pl8`, `platines → m9`,
> et le moteur et le capot sont passés sous `engine/`. Donc **aucune commande ni aucun chemin d'ici ne
> s'exécute tel quel** : `apps/pistes`, `apps/moteur`, `apps/capot`, `SESSIONS.pistes`,
> `pistes.sid`, `~/.studio/prefs/pistes/`, `npm run dev --workspace pistes` — tous morts.
>
> Le seul qui ait touché un identifiant écrit dans les fichiers de l'utilisateur : le NIVEAU de
> module `@mediatek` → `@st0`, qui rattrapait `mediatek → st0` côté refs. Il a sa migration,
> `packages/song/scripts/migrateNamespace.ts`, et sa signature d'échec est lisible pour une fois
> — un `?` sur le nœud du graphe. Voir
> [packages/song/docs/moduleNamespaces.md](../packages/song/docs/moduleNamespaces.md).
> Le dossier `~/.studio/mediatek` n'a **pas** bougé : c'est un cache, pas un nom qu'on écrit.
>
> **Dernier en date : `st0 → pl8`, et l8 prend la racine de l'origine.** Deux choses en une —
> un renommage d'application et un échange d'adresses (`SERVICE_PATHS`) — et cette fois le niveau
> `@st0` est resté tel quel, délibérément : le prix d'une migration sur toutes les machines pour
> un mot que personne ne tape. Le nom d'hôte `st0.priv.frediver.se` n'a pas bougé non plus.
> Ce qui NE suit pas la table des services : `/auth/*`, qui reste sans préfixe chez le backend de
> pl8 parce que l'IdP ne connaît qu'un `redirect_uri`.
>
> Ce qui reste vivant, et pourquoi la page n'est pas supprimée : **la méthode**. L'ordre imposé
> des phases, et surtout l'idée que chaque contrôle porte sa *signature d'échec*, sont ce qui a
> rendu les renommages suivants vérifiables. Pour refaire l'exercice, relire la structure et
> substituer les noms courants (`AGENTS.md` à la racine tient la carte à jour).
>
> Elle n'a **pas** été réécrite aux noms d'aujourd'hui, faute d'avoir pu rejouer les contrôles :
> une recette de vérification qu'on n'a pas exécutée est pire qu'une recette datée.

Ordre imposé : chaque phase suppose la précédente verte. Une phase qui échoue rend les
suivantes ininterprétables — le socle est partagé.

Chaque contrôle porte sa **signature d'échec** : ce qu'on verrait précisément si le
renommage était faux à cet endroit. Sans elle, « ça a l'air de marcher » ne prouve rien,
parce que la plupart des fautes de ce lot se lisent comme un fichier vide, pas comme une
erreur.

---

## Phase 0 — migrer le dossier d'état (bloquant)

La rupture est nette : aucun code ne lit `~/.lanes`. Rien ne démarrera correctement tant
que le contenu n'a pas bougé. `~/.studio` existe déjà et est vide, donc on déplace le
*contenu*, pas le dossier.

```bash
mv ~/.lanes/* ~/.studio/ && rm -f ~/.lanes/.lanes.log ~/.studio/engine.pid && rmdir ~/.lanes && ls -a ~/.studio
```

Attendu : `engine-id.json`, `root/`, `web-endpoint.json`, `web-origins.json`.

**Le log et le pid ne sont pas repris, délibérément.** Le log fusionné est tronqué à
chaque lancement du plateau : le conserver ne fait que garder sous un nom neuf des lignes
écrites par le moteur d'*avant* le renommage — dont une bannière `lanes-engine` qui se lit
exactement comme une panne du renommage. Un `engine.pid` périmé, lui, pousse un
superviseur neuf à adopter un moteur mort plutôt qu'à en lancer un.

`root/` porte vos espaces de travail — c'est la seule chose ici qui ne se régénère pas.
Les autres fichiers du contrat (`engine-tray.json`, `preferences.yaml`, `exts.json`,
`mediatek/`) n'existent pas encore sur cette machine ; ils se recréeront.

`engine.pid` est peut-être périmé si un moteur tournait avant la migration. Vérifiez
qu'aucun n'est resté :

```bash
tasklist | grep -i "studio-moteur\|studio-capot" || echo "aucun moteur en cours"
```

> **Signature d'échec** — si vous sautez cette phase : le moteur démarre mais ne trouve
> aucun espace de travail, l'arbre de fichiers est vide, et rien ne signale d'erreur.
> C'est exactement à quoi ressemble un premier lancement légitime.

---

## Phase 1 — le moteur seul (`apps/moteur`)

Aucun superviseur, aucun navigateur. On teste le binaire C++ pour lui-même.

### 1.1 Compilation

```bash
cd apps/moteur && cmake --preset windows-msvc && cmake --build build/windows-msvc --target studio-moteur studio_engine_tests studio_midigraph_tests studio_dspgraph_tests
```

Attendu : `studio_engine.lib`, `studio_engine_data.lib`, `studio-moteur.exe`. Les
`lanes_engine*.lib` orphelins qui traînent dans `build/windows-msvc/engine/Debug/` sont
des restes des anciennes cibles ; supprimables.

### 1.2 Tests unitaires

```bash
ctest --test-dir build/windows-msvc -C Debug -R "studio_" --output-on-failure
```

Attendu : 3/3. Le filtre `-R "studio_"` est nécessaire — sans lui, ctest ramasse aussi
les cibles de démo de Tracktion (`Benchmarks`, `TestRunner`), jamais compilées, qui
sortent en « Not Run ».

### 1.3 Énumération des périphériques

```bash
./build/windows-msvc/Debug/studio-moteur.exe --list-audio-devices
```

Attendu : la sentinelle `STUDIO_DEVICES_BEGIN`, puis le JSON des interfaces.

> **Signature d'échec** — sentinelle restée `LANES_DEVICES_BEGIN` : le moteur répond, mais
> `packages/translator` et le superviseur ne trouvent plus les bornes et lisent une
> réponse vide. Rien ne lève d'exception.

### 1.4 Scan de plugins

`scan` est une sous-commande, pas un drapeau ; `scan --force` repart de zéro.

```bash
./build/windows-msvc/Debug/studio-moteur.exe scan && ls -la ~/.studio/exts.json
```

Attendu : `~/.studio/exts.json` créé, non vide. Sentinelles `STUDIO_SCAN_BEGIN` /
`STUDIO_SCAN_END` dans la sortie.

> **Signature d'échec** — si le C++ écrivait encore dans `~/.lanes/exts.json` : le fichier
> se crée là-bas, le scan « réussit », et côté TypeScript le catalogue de modules du
> moteur est vide. Aucun module intégré n'apparaît nulle part ensuite.

### 1.5 Le renommage des `xmlTypeName` — **le contrôle le plus important de cette phase**

C'est le seul renommage de tout le lot qui touche un identifiant qu'un fichier
utilisateur peut nommer.

**Ne regardez pas `params`, regardez `complete`.** Un built-in créé avec succès rend
`{"params":{},"complete":true}` — le `params` vide est normal ici (Tracktion en fait
autant pour `chorus` et `4osc`) et ne dit rien sur le renommage. C'est `complete` et le
code de sortie qui discriminent : `dumpPluginParams` émet `complete:false` et sort en **2**
quand `createNewPlugin` rend `nullptr`, c'est-à-dire quand le type est introuvable.

```bash
for t in studio_mixer studio_nam studio_dspgraph studio_midigraph; do printf "%-18s " "$t"; ./build/windows-msvc/Debug/studio-moteur.exe --dump-params "$t" 2>/dev/null | sed -n 2p; done
```

Attendu : `"complete":true` pour les quatre.

Puis le contrôle inverse, qui documente la perte assumée :

```bash
./build/windows-msvc/Debug/studio-moteur.exe --dump-params lanes_mixer; echo "[code $?]"
```

Attendu : `"complete":false`, code **2**, et sur stderr
`[dump-params] could not create plugin 'lanes_mixer'`. C'est correct et voulu.
`resolveBuiltInType`
(`engine/EditBuilder.cpp`) accepte soit le nom affiché (« Mixer ») soit l'identifiant
interne — donc un `module.yaml` écrit avec la forme humaine continue de marcher, et seul
un fichier écrit avec l'id brut `lanes_*` casse. Aucun morceau du dépôt n'en utilise,
mais **vos** modules dans la médiathèque peuvent. Si vous en avez, c'est le moment :

```bash
grep -rn "lanes_nam\|lanes_mixer\|lanes_dspgraph\|lanes_midigraph" ~/.studio/mediatek 2>/dev/null || echo "aucun module concerne"
```

---

## Phase 2 — superviseur et service de fichiers

Le socle partagé : `@studio/engine-host` lance le moteur, `@studio/file-service` sert les
fichiers. Ports : moteur **8765** (WebSocket), service de fichiers **8770**.

### 2.0 Repartir propre

Le log fusionné et le pid survivent à la phase 0 et **datent d'avant le renommage**. Les
laisser fait lire des archives comme un résultat — la bannière y dit encore `lanes-engine`,
ce qui ressemble à s'y méprendre à une panne du renommage.

```bash
rm -f ~/.studio/.studio.log ~/.studio/engine.pid
```

Un `engine.pid` périmé n'est pas cosmétique : il pousse un superviseur neuf à tenter
d'adopter un moteur mort au lieu d'en lancer un.

### 2.1 Démarrage

```bash
npm run dev --workspace pistes
```

**Ceci ne lance PAS le superviseur.** Le script filtre bien `@studio/engine-host`, mais le
`dev` de ce paquet est `tsc --noEmit --watch` — un typechecker, rien d'autre. On obtient
le frontend, le backend et le service de fichiers ; la sortie du moteur va dans le
terminal. C'est suffisant pour les phases 4 et 5.

Pour le superviseur — donc pour le log fusionné et l'adoption du moteur — il faut le
plateau : `npm run engine:buildstart --workspace capot`, ou la phase 3.

Le binaire retenu est le **plus récent** sous `apps/moteur/build/*/*/` (`findEngineBinary`
trie par date, pas par configuration) — donc le `Debug` de la phase 1, pas le
`RelWithDebInfo` du preset. Pour forcer : `STUDIO_ENGINE=/chemin/vers/studio-moteur.exe`.

### 2.2 Le contrat de fichiers

```bash
ls -la --time-style=+%H:%M ~/.studio
```

Attendu, **avec l'heure du jour** : `exts.json` (écrit par le moteur au scan),
`web-endpoint.json` (par le backend pistes au démarrage), `mediatek/` (par le service de
fichiers). C'est l'horodatage qui prouve le renommage, pas la présence du fichier — la
phase 0 en a déposé d'anciens ici.

`.studio.log` ne grossit **que** si le superviseur tourne (voir 2.1). Sous `npm run dev`
seul, un log figé est normal et ne prouve rien.

> **Signature d'échec** — un `exts.json` daté d'avant, alors qu'un scan vient de tourner :
> le moteur écrit encore dans `~/.lanes`. Côté TypeScript le catalogue de modules sera
> vide, sans message d'erreur.

### 2.3 Le service de fichiers répond

```bash
curl -s http://127.0.0.1:8770/health
```

Attendu : `{"ok":true}`. Cette route est délibérément non gardée et vide.

### 2.4 Les en-têtes de protocole renommés — **le contrôle le plus important de cette phase**

Toutes les routes utiles sont gardées par `x-studio-{user,workspace,engine-token}`. Le
jeton est dans `~/.studio/engine-id.json`.

```bash
TOKEN=$(node -p "require(process.env.HOME+'/.studio/engine-id.json').token") && curl -s -H "x-studio-engine-token: $TOKEN" -H "x-studio-user: fred@parapluie.org" http://127.0.0.1:8770/workspaces
```

Attendu : la liste de vos espaces de travail, celle que la phase 0 a préservée.

Puis l'ancien en-tête, qui doit être refusé :

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "x-lanes-engine-token: $TOKEN" -H "x-lanes-user: fred@parapluie.org" http://127.0.0.1:8770/workspaces
```

Attendu : **401** (ou 400 si `engine-id.json` manque — le portillon du jeton laisse alors
passer et c'est `resolveUser` qui refuse). Dans les deux cas, un refus. Si la liste des
espaces revient, un ancien en-tête est resté quelque part.

---

## Phase 3 — le plateau (`apps/capot`), optionnel

À faire seulement si vous utilisez la version empaquetée. Le superviseur ci-dessus est
interchangeable avec lui sur le même contrat.

```bash
npm run tray:restart --workspace capot
```

Attendu : l'icône apparaît, le menu liste les périphériques audio, « Show logs » ouvre
`~/.studio/.studio.log`. L'identifiant de bundle est passé à
`org.parapluie.studio.engine-tray` : **Windows et macOS le voient comme une application
neuve**. Un éventuel élément de démarrage automatique pointe encore l'ancien identifiant
et doit être refait.

`cargo check` est déjà vert, mais le plateau lit `env!("STUDIO_BUILD")` à la compilation —
si le menu affiche `build dev` au lieu d'un horodatage, c'est normal hors CI.

---

## Phase 4 — la médiathèque (`apps/mediatek`)

Premier consommateur du socle. Port **5224**, backend **8795**, via `https://st0.priv.frediver.se/mediatek`.

```bash
npm run dev --workspace mediatek
```

Un seul terminal : `dev` orchestre le frontend **et** le backend par turbo, et
`STUDIO_MEDIATEK` vient de la section `mediatek-backend` de l'`env.yaml` racine.

Cette variable est **obligatoire** — le backend refuse de démarrer sans elle plutôt que de
retomber sur `~/.studio/mediatek` et de servir un répertoire vide que personne n'a monté.
S'il sort en 1, la section manque : son message part sur stderr et se noie sous turbo, et
le seul symptôme visible est une porte d'authentification qui échoue sans raison apparente.

L'authentification, justement : le chargement de l'`env.yaml` apporte aussi la section
`common`, donc les `OIDC_*` réels. La médiathèque n'utilise plus le stub « Dev User » ici —
attendez-vous à un vrai login, comme pour k7 et obscura.

À vérifier dans le navigateur :

1. **La porte unique** — la médiathèque n'a qu'un `AuthGate`, pas les trois de pistes.
   La connexion doit passer.
2. **Le sélecteur de moteur** — elle tient son **propre** registre, distinct de celui de
   pistes. Le moteur de la phase 2 doit y apparaître.
3. **Le catalogue de modules** — les modules intégrés du moteur doivent être listés.
   C'est la vérification en bout de chaîne de `~/.studio/exts.json` (phase 1.4).
4. **Le constructeur de modules** — ouvrez un module, faites glisser un paramètre. Le
   glisser-déposer passe par le MIME `application/x-studio-param`.
5. **La racine média** — `~/.studio/mediatek` (ou `$STUDIO_MEDIATEK`).

> **Signature d'échec** — un catalogue de modules vide avec une interface par ailleurs
> fonctionnelle pointe vers `exts.json` au mauvais endroit, pas vers la médiathèque.

---

## Phase 5 — pistes (`apps/pistes`)

Frontend **5223**, backend **8789**, via `https://st0.priv.frediver.se/pistes`.

```bash
npm run dev --workspace pistes
```

### 5.1 Les trois portes

`AuthGate` → `EngineGate` → `WorkspaceGate`. Le cookie de session s'appelle désormais
`pistes.sid` : **vous serez déconnecté une fois**, c'est attendu.

### 5.2 L'espace de travail

Ouvrez un projet. Le projet actif est mémorisé dans un marqueur `.studio-active` à la
racine de l'espace :

```bash
ls -a ~/.studio/root/*/*/.studio-active
```

La clé localStorage de l'espace est passée à `pistes.workspace.<engineId>` — **le choix
d'espace repart de zéro une fois**, attendu.

### 5.3 La session moteur

Transport : jouez. La tête de lecture doit avancer.

C'est le contrôle de `SESSIONS.pistes`, qui est épelé par **deux** processus — le
navigateur pilote le transport, le service de fichiers compile et envoie le projet. Un
désaccord ne lève rien.

> **Signature d'échec** — le projet se charge, `play` « marche », la tête de lecture reste
> à 0 et rien ne sonne : les deux moitiés pilotent deux sessions différentes sur le même
> moteur.

### 5.4 La documentation

Ouvrez `/docs`. Les pages viennent d'un `import.meta.glob` sur `pistes/docs/`.

> **Signature d'échec** — un `/docs` blanc signifie un glob vide. Le test associé
> (`docs.test.ts`) **passe à vide** dans ce cas, en itérant une liste vide : il compte
> 40 cas aujourd'hui, c'est le nombre qu'il faut regarder, pas le code de sortie.

### 5.5 Les préférences

Le mode vim de l'éditeur vient de `~/.studio/preferences.yaml`, les préférences par
service de `~/.studio/prefs/pistes/`. **Ce dernier repart de zéro**, attendu.

### 5.6 Le reste de l'interface

Timeline (`hjkl`, `v`, `z`), graphe de chaînes, compositeur vidéo, barre de commandes
(`;`). Rien ici ne touche au renommage, mais c'est la vérification que le déplacement du
répertoire n'a pas cassé un chemin d'import.

Un piège documenté du répertoire : `src/index.css` déclarait `@source` vers
`packages/ui/src`, qui **n'existe pas** (c'est `commons/packages/ui/src`). Tailwind ignore
un chemin absent sans prévenir. Ce bug était antérieur au renommage ; il est corrigé
depuis, ici comme dans k7 et les six SPA d'obscura.

---

## Phase 6 — non-régression du socle partagé

Ces deux applications consomment `packages/*` sans avoir été la cible du renommage.

```bash
npm run dev --workspace m9
```

m9 (**5225**) : lit le cache de la médiathèque par le service de fichiers et joue
par le moteur. Sa session est `SESSIONS.m9`, ses préférences
`~/.studio/prefs/m9/`.

Obscura : le rendu hors ligne envoie `x-studio-engine-token` en dur
(`apps/obscura/backend/src/render.ts`) — c'est le seul consommateur des en-têtes hors du
socle, donc le seul endroit où un renommage partiel se verrait tard.

---

## Ce qui repart de zéro, légitimement

À ne pas confondre avec une panne :

| | pourquoi |
|---|---|
| une reconnexion à pistes | cookie `lanes.sid` → `pistes.sid` |
| le choix d'espace de travail | clé localStorage renommée |
| `~/.studio/prefs/pistes/` | répertoire de préférences par service renommé |
| `%APPDATA%/Studio/Settings.xml` vierge | nom d'application JUCE renommé — le superviseur rebascule sur le bon périphérique au premier cycle de poll |
| les alias de canaux et défauts MIDI de Tracktion | même cause ; les libellés d'entrée viennent de `preferences.yaml` et sont intacts |
| `branch.<b>.studioParent` | clé git locale — les branches en cours perdent leur parent mémorisé |
| l'application du plateau vue comme neuve | identifiant de bundle renommé |
| `%APPDATA%/Lanes/` et les `lanes_engine*.lib` du build | orphelins inertes, supprimables |

## Ce qui n'a pas été renommé, et n'est pas un oubli

`lane` reste le mot pour une rangée de clips sur la timeline : un morceau a des `tracks`
**et** des `lanes`. Les éléments `<Lanes>` que l'import DAWproject parse appartiennent au
format de quelqu'un d'autre, et `biPlanes` est un champ du `BITMAPINFOHEADER` de Win32.
