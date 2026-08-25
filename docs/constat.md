# Constat global — l'axe audio

**Relevé du 2026-08-21, sur `a4808e35`.** Périmètre : `apps/st0`, `engine/moteur`,
`engine/capot` et les paquets qu'ils pilotent. Hors périmètre : `apps/{z0,k7,pl8,studio}`.

Cette page est **autonome** — elle porte ses preuves plutôt que d'y renvoyer — ce qui veut dire
qu'elle périme. Le remède n'est pas de la croire mais de la rejouer : la dernière section
donne les commandes exactes. Une entrée fausse doit se découvrir en trente secondes. Les
chiffres gardent leur date de mesure, faute de quoi ils ne se vérifient pas.

Les quatre pages spécialisées gardent ce qu'elles seules détiennent :
[audit-perf-web.md](audit-perf-web.md) (les lots chiffrés),
[audit-moteur.md](audit-moteur.md) (le lien d'une surface au moteur),
[inventaire.md](inventaire.md) (le code mort) et
[engine/moteur/docs/audit-stabilite.md](../engine/moteur/docs/audit-stabilite.md) (le C++).

---

## La thèse

**Ce dépôt durcit la face qu'il regarde, et laisse le jumeau intact.**

Ce n'est pas une négligence : c'est la signature d'un travail sérieux mené une panne à la fois.
On corrige là où ça fait mal, et le symétrique — qui n'a pas encore fait mal — reste nu.

| durci | le jumeau, resté nu |
|---|---|
| Le web est benché, chiffres publiés | Aucun banc C++, aucun banc navigateur |
| Un filet `unhandledRejection` / `uncaughtException` aux deux points d'entrée TypeScript | Ni `try` au niveau de `main()`, ni `set_terminate` en C++ |
| La gate de st0 : bail, relook, prédicat complet | Celle de z0 : ni bail, ni relook, joignabilité qui ignore le jeton (hors périmètre) |

Et la conséquence qui tient les trois axes : **la garde automatique manque sur deux d'entre
eux.** Pas de porte de non-régression perf, pas de test inter-process ; seul le code mort a son
outil. Ce qui n'est pas outillé se vérifie à la main, donc décroche.

---

## Performances

### Un banc mesure deux régimes à la fois s'il ne vieillit pas sa fixture

`yamlCache` refuse de mettre en cache un fichier dont la mtime a moins de 2 s (`SETTLE_MS`), pour
une raison écrite dans le fichier. Un banc qui écrit sa fixture puis mesure **immédiatement** ne
*peut* pas toucher le cache aux premières itérations et le touche à toutes les suivantes : la
moyenne mélange deux populations, et la variance rend le banc inutilisable. La fixture se
vieillit d'une heure (`utimesSync`) — c'est le régime dans lequel est un vrai morceau.

Repères sur cette machine, au 2026-08-21, fixture vieillie :

| banc | 8 pistes | 64 pistes |
|---|---|---|
| `compileNodeProject` | 3,68 ms, rme ±1,64 % | 21,36 ms, rme ±1,74 % |
| `buildGraphDoc` | 4,18 ms | 35,65 ms |

Deux lectures, et la seconde est la plus importante :

1. **La variance tient sous ±2 %.** Un banc à ±40 % ne valide aucun changement de moins de 40 %,
   c'est-à-dire aucun.
2. **Les deux bancs mesurent des choses différentes.** À cache froid ils sont tous deux dominés
   par les mêmes lectures YAML et rendent le même chiffre, ce qui fait croire que `buildGraphDoc`
   ne coûte rien de plus. À découvert l'écart est de **14 ms** : le travail propre de
   `buildGraphDoc`, les extents de clips. C'est ce poste qu'il faut surveiller quand un morceau
   grossit.
3. La courbe est douce : 8× les pistes coûtent 5,8× sur le compile.

Page : [`packages/song/docs/benchSettle.md`](../packages/song/docs/benchSettle.md).

### Ne pas mettre le `safeParse` de zod en cache

Le parse YAML est caché, pas le `safeParse` de zod, et ça ressemble au poste suivant. Mesuré :
**1,0 % d'un compile à 64 pistes**, 1 à 2,5 % à 8. Et le cacher casserait un invariant que
`loader.ts` écrit noir sur blanc — le parse caché n'est sûr *que parce que* `r.data` est une
structure neuve, si bien que rien de partagé ne sort de la boucle. Ne pas le faire.

### Le rechargement après commande est ciblé, et ce que ça coûte de vrai

Le jeton de révision est `${mutations}:${count}:${newest}`, et `mutations` est incrémenté par
TOUTE écriture : il bouge pour tout, par construction. Il ne peut pas être plus fin sans
redevenir faux — c'est lui qui défend contre deux écritures dans la même milliseconde, le même
piège que `SETTLE_MS` pare dans `yamlCache`. La précision vient donc du client : `POST /command`
rend la liste des fichiers écrits (`changed`, project-relative), `reloadKey` vaut `{ key, files }`,
et `EditorTab` ne redemande `/tree` et `/hints` que si ce qui a bougé peut les avoir bougés.

| ce qui a changé | `/tree` | `/hints` |
|---|---|---|
| un fichier apparaît ou disparaît | oui | oui |
| réécriture d'un `clips/`, `sequences/`, `curves/` | non | non — ils sont recensés PAR NOM |
| réécriture de n'importe quoi d'autre | non | oui |
| liste absente (`null`) | oui | oui — personne n'a rien dit |

`null` ≠ `[]` est le point porteur : un service qui n'a pas pu differ dit « je ne sais pas », et
tout redevient l'ancien compteur. L'ouverture d'un projet, un undo, un `project pull` et le tic
`/revision` n'ont donc rien à savoir de ce mécanisme. `/project-doc`, `/graph` et
`/project-errors` restent inconditionnels : une écriture peut réellement les changer.

Deux limites, dites plutôt que cachées :

- `/module-libraries` et `/library-chains` lisent les **dossiers partagés**, qu'une commande de
  projet ne peut pas toucher : ils sont lus au montage du volet, et rechargés par les trois seuls
  actes qui les changent — créer un module, forker un module partagé, publier depuis le builder.
  Une bibliothèque changée **hors de cet onglet** (un `project pull`, un autre navigateur)
  n'apparaît donc qu'au prochain montage. C'est le marché que « Many browsers at once » prend
  déjà partout ailleurs.
- Le `source` d'un clip décide aussi s'il est listé comme clip audio ou vidéo. Une commande qui
  repointerait un clip EXISTANT d'un wav vers un mp4 laisserait cette seule répartition périmée
  jusqu'au prochain rechargement complet. Les prédicats et leurs tests sont dans
  `apps/st0/frontend/src/reloadScope.ts`.

Le même raisonnement vaut pour les gestes : `quietCommand` (`want: []`, pas de bump) porte sa
propre mesure — « 62 ms per mute, per solo, per knob turn, built and dropped ». Les gestes de
warp l'empruntent, ce qui les tient à ~130 ms au lieu de ~465.

### Ce qui reste, par ordre de rendement

1. **`ClipWaveform` rend son hôte à la cadence des frames.** Il lit le transport avec
   `useEngineState((s) => s.playhead)` — un hook SÉLECTEUR — alors que le dépôt a déjà la réponse :
   `usePlayheadFrames`, qui s'abonne au store brut, ne rend jamais, et écrit sur un nœud DOM à
   60 Hz. Son en-tête dit exactement pourquoi. On ne peut pas l'y substituer tel quel, parce que
   `Waveform` dessine sa tête de lecture *sur le canevas* : il faut une couche de survol mince.
   C'est le même geste que `layers.md` écarte pour le REMPLISSAGE de progression, et pour une
   raison qui ne vaut pas ici — un lavis violet sur les numéros de mesure se voit, un trait d'un
   pixel non.
2. **`App.tsx` : 4 200 lignes, 51 `useState`, 11 `useMemo`, aucun panneau mémoïsé.** Or un panneau
   du layout est monté une fois et jamais démonté (`hidden` le sort de l'écran) : tout changement
   d'état re-rend les 3 513 lignes de `TimelineTab` **y compris cachée**. Le seul profil existant
   (`timeline.md`) est **antérieur** aux lots C et D — le re-mesurer est le préalable, pas le
   correctif.
3. **`EditorTab` peut émettre une requête HTTP par frappe.** Son effet dépend de `file`, recréé à
   chaque caractère, et appelle `api.projectDoc()` en trois endroits. `fget` ne dédoublonne que
   les requêtes en vol, ce n'est pas un cache — et le service est mono-processus.
4. **Côté moteur** : la trame d'état à 20 Hz envoyée synchronement depuis le thread message (un
   client coincé fige le moteur) ; `Change`, type valeur gras, qui copie le `PluginDoc` entier
   *par paramètre* pendant un drag de potard ; `diff()` qui reconstruit quatre `std::map` à clés
   concaténées par apply ; et le chemin d'horloge de motifs qui paie **deux copies profondes du
   `ProjectDoc`** par tick, à 6,7 Hz.

### Ce qui est déjà excellent — ne pas re-suspecter

Le rappel audio est sans allocation et ses seuls verrous sont des `try_lock` qui jettent un bloc.
`BroadcastTap` est un anneau SPSC exemplaire. `moduleCache` et `yamlCache` portent leur
raisonnement **mesuré**, y compris un cas où hoisser une portée se révèle plus lent.
`engineStore` quantifie dans le sélecteur. Et la table « l'O(n²) qui ne vaut pas la peine » de
`meters.md` est un verdict chiffré : la Map mémoïsée PERD sous ~50 pistes.

---

### Le chemin de contrôle n'est pas un goulot, et il en avait l'air

Deux écrans bleus `KMODE_EXCEPTION_NOT_HANDLED` dans `FocusriteUsb.sys` ont fait soupçonner le
débit de `set-plugin-param` : le scratch en envoyait un par `pointermove`, soit 500 à 1000 par
seconde. Mesuré le 2026-08-25 contre un moteur chargé, sur `eqA:eqA` (12 paramètres), en
réémettant à chaque fois la valeur COURANTE pour que tout le chemin s'exécute sans que le son
bouge :

| envoi + drainage complet | témoin (`id` inexistant) | réglages réels |
|---|---|---|
| 5 000 messages | 45 ms | 45 ms |
| 20 000 messages | 168 ms | 173 ms |

Soit **entre 0,2 et 0,9 µs de travail moteur par réglage** selon la passe — l'écart est du bruit
de mesure, ce qui est déjà la réponse — et un débit d'environ **110 000 par seconde**. Le scratch, à
son pire, en utilisait moins d'un millième. Et une sonde postée derrière 20 000 messages en attente
revient en 1,1 ms : la file `callAsync` ne se laisse pas engorger.

Trois choses à en retenir, dont deux corrigent ce qu'on croyait :

- **La lecture du code disait le contraire.** `pluginParams()` reconstruit le vecteur entier des
  paramètres, chaque entrée portant quatre `std::function`, puis compare par `toStdString()` — on
  en attendait une centaine d'allocations par réglage, donc des microsecondes. La mesure dit moins
  d'une microseconde. **Ne pas optimiser ce chemin sans le remesurer d'abord.**
- **Le coût réel est côté NAVIGATEUR.** 168 ms pour émettre 20 000 messages, c'est 8,4 µs par
  message en `JSON.stringify` + `ws.send`, sur le thread principal qui dessine le pupitre. C'est ça
  que l'étranglement du scratch économise — pas le moteur.
- **Donc ça n'explique pas le bugcheck.** En ASIO le pilote nous APPELLE ; il n'existe pas de file
  d'instructions vers la carte. Ce qui peut fauter un pilote, c'est un callback tardif ou bloquant,
  et le chemin de contrôle ne touche jamais le thread audio. Les vrais candidats sont dans
  `engine/moteur/docs/audit-stabilite.md`, section « Real-time safety ».

À rejouer avec `engine/moteur/scripts/param-cost.mjs` contre un moteur qui a un projet chargé — sans projet, le
`set` s'arrête au défaut de la map et mesure le témoin des deux côtés.

### Le callback audio est à 5 % de son échéance, geste compris

Suite du précédent : le chemin de contrôle ne coûtant rien, restait à savoir si le thread AUDIO
approchait sa date limite — c'est la seule chose qu'un pilote remarque. Tracktion mesure déjà chaque
bloc (`DeviceManager::getCPUStatistics`, moyenne/min/**max**) ; le verbe `audio-cost` l'expose.

Mesuré le 2026-08-25, tampon 512 à 48 kHz — la valeur d'un après-midi, rendue à 256 depuis, et
c'est ce relevé qui l'a rendue — soit une **échéance de 10,67 ms par bloc** :

| état | blocs | moyen | pire bloc |
|---|---|---|---|
| moteur au repos, rien de chargé | 563 en 6 s | 0,010 ms | 0,046 ms (0,4 %) |
| pupitre chargé, disque qui tourne | 90 s, 30 fenêtres | 0,13 ms | 0,476 ms (4,5 %) |
| … sans geste, fenêtre de 5 s | 469 | 0,178 ms | 0,565 ms (5,3 %) |
| … **scratch piloté à 2918 réglages/s** | 469 | 0,201 ms | 0,456 ms (4,3 %) |

Le scratch — trois fois la cadence d'une souris — ajoute **0,023 ms** à la moyenne et fait *baisser*
le maximum : l'écart est du bruit. Le compte de blocs ne bouge pas non plus (93,8/s, la valeur
exacte de 512 à 48 kHz), donc aucun bloc n'est perdu.

Puis à **256**, où le tampon est resté, même pupitre et même scratch piloté — échéance 5,33 ms :

| état | blocs | moyen | pire bloc |
|---|---|---|---|
| à vide | 938 en 5 s | 0,007 ms | 0,137 ms (2,6 %) |
| chargé, sans geste | 1126 en 6 s | 0,127 ms | 0,493 ms (9,3 %) |
| chargé, **scratch à 2863/s** | 1125 | 0,144 ms | 0,508 ms (9,5 %) |

**Le coût ne se divise pas avec le bloc, et j'avais prédit qu'il le ferait.** En passant de 512 à
256, la moyenne en charge ne tombe pas de moitié (0,201 → 0,144, soit −28 %) et le maximum ne bouge
pas du tout (0,456 → 0,508). Une part du callback est un coût FIXE par bloc — traversée du graphe,
appels de greffons, comptabilité — qui ne connaît pas la taille du bloc. Donc **diviser le tampon
par deux double à peu près la part d'échéance consommée** : 4,3 % à 512, 9,5 % à 256. La marge
reste d'un ordre de grandeur, mais la tendance dit ce que coûterait 128, et surtout 64.

**Ce qui reste, et qui n'était pas dans le champ.** Une seule chose que le moteur fasse atteint
vraiment le pilote : `list-audio-devices`, qui appelle `scanForDevices()` sur chaque type, ASIO
compris. Mesuré : **50 ms par scan**, six fois sur six — et le superviseur en demandait un **toutes
les deux secondes**, à vie, soit 1800 contacts par heure avec un pilote mono-client pendant qu'il
diffuse. Le callback n'en souffre pas (max 0,278 ms pendant une rafale contre 0,356 sans), donc ce
n'est pas un problème de temps réel ; c'est la seule sollicitation répétée qu'on impose au pilote.
`DEVICES_POLL_MS` est passé à 10 s pour voir — 360 scans par heure au lieu de 1800 ; expérience à
coût quasi nul, pas correctif prouvé :
`packages/engine-host/docs/supervisorPolicy.md`.

**Ce que ça clot.****Ce que ça clot.** L'engin n'approche jamais sa date limite : facteur vingt de marge sur le pire
bloc observé, dans toutes les conditions essayées. La théorie « on envoie trop d'instructions à la
carte » est morte deux fois — le chemin de contrôle est gratuit, et le thread audio ne s'en aperçoit
pas. Le point d'arrêt dans `FocusriteUsb.sys` reste un défaut de pilote, sans levier de ce côté-ci.

**Savoir si le pupitre est VRAIMENT chargé, et les deux façons de se tromper.** J'ai d'abord écarté
un relevé en voyant `tracks=3` dans `list-sessions`, puis je me suis corrigé en disant que trois
pistes était le compte juste d'un pupitre à platines. Les deux fois à côté. Ce qui est vrai :

- `tracks=3` EST le document de secours (`deckDoc`) — deux platines et la somme. Un pupitre
  compilé en annonce 17.
- Demander `stemDrumsA:platter` ne tranche PAS, parce que `deckDoc` construit les plateaux lui
  aussi. Le greffon répond dans les deux cas.
- `loaded=true` ne tranche pas non plus : le document de secours est un document chargé.

Le seul témoin fiable est donc le **nombre de pistes**, comparé à ce que le projet compile. À
vérifier avant de compter quoi que ce soit : un relevé sur l'imitation mesure un graphe qui n'a ni
EQ, ni filtre, ni fondus.

## Stabilité

### Le filet d'exceptions

`void f()` n'attrape rien — il annonce à Biome qu'on n'attendra pas la promesse — et depuis
Node 15 une promesse rejetée non attrapée **termine le process**. Côté TypeScript, un `guard()`
par process et le filet aux deux points d'entrée couvrent ça, avec les deux moitiés
volontairement asymétriques : un rejet est journalisé et on vit, une exception non attrapée est
journalisée avec sa pile et on sort. Page :
[`packages/engine-host/docs/background.md`](../packages/engine-host/docs/background.md).

Le mode de panne que ce filet pare est instructif parce qu'il ne se remarque pas : quand le
superviseur meurt, **le moteur reste vivant derrière lui**, le capot le relance sur son repli et
le nouveau superviseur ré-adopte le moteur par son pidfile. Ça se rattrape, donc ça passe
inaperçu. Même famille côté service de fichiers, où `wrap()` ne peut rien voir : elle n'attrape
que ce que le handler *retourne*.

**Ouvert : le C++.** Un seul `try`/`catch` dans toute la bibliothèque (`NamPlugin.cpp`) sur
52 fichiers, ni `try` au niveau de `main()`, ni `set_terminate`.

### git bloque le process qui tient le moteur

`packages/commands/src/git.ts` fait tout en `execFileSync`, et les routes aussi. Ce process tient
la socket vers le moteur, l'horloge de motifs et le watcher. Les commandes sont bornées, mais le
fond reste : `gitStatus` fait un `fetch` bloquant jusqu'à 30 s, et **il n'y a aucun verrou nulle
part**. `commitAndPush` fait `add -A`, puis `status`, puis `commit` en trois sous-process : une
écriture d'autosave qui atterrit entre le premier et le troisième est hors du commit. Et
`cancelAlternative` fait `reset --hard` puis `clean -fd` sans exclusion.

### Le jeton de moteur part sur n'importe quelle socket

Le moteur rend son jeton à **toute socket** qui envoie `whoami`, sans authentification, et le
navigateur le stocke. Ce que le jeton prouve vraiment (l'anti-confusion) et ce qu'il ne protège
pas sont écrits dans
[`packages/engine-registry/docs/token.md`](../packages/engine-registry/docs/token.md). Le
resserrer est un lot, pas une phrase.

### Les tests : ce que personne ne couvre

`engine-browser/src/engine.ts` — 852 lignes où vit toute la fiabilité du client navigateur —
**n'a pas de fichier de test**. Et plus large : **aucun test ne franchit une frontière de
process**, **aucun contrat C++ ↔ TS** ne tient la trame binaire.

### Déjà solide

Le client navigateur du moteur dans son entier. `moduleWatch` avec ses trois moitiés — le watcher,
le plafond de 10 s qui guérit un événement perdu, et la moitié écrivain, parce que `fs.watch`
délivre un tick trop tard. Le bail sur un projet, testé 21 fois. Et `reconcileEngine`, qui est la
réponse écrite à ce que le code appelle lui-même « l'échec le plus silencieux de ce dépôt » :
envoyer à une session vide.

---

## Code mort

### L'outil, et ce qu'il ne voit pas

Biome ne voit que l'intra-fichier — un `export` que personne n'importe lui est invisible **par
construction** — et `biome.json` exclut `engine/moteur`. `npm run lint:dead` (knip, `knip.json`)
fait trois des quatre passes de `inventaire.md` en trente secondes. **Non bloquant** : un faux
positif se lit, il ne doit pas bloquer un merge.

Sa liste d'exceptions est le §0 de l'inventaire traduit en configuration, faute de quoi il tue du
code vivant : `dspRunner.mjs`, `separateWorker.ts`, les entrées esbuild du tray, `emit.ts`, les
`jsdsp.ts`, les harnais de `engine/moteur/scripts/`.

Sortie sur l'axe audio au 2026-08-21 : **1 fichier, 4 dépendances, 1 devDépendance, 58 exports,
17 types** — 81 constats en 92 lignes, chacun à examiner.

### Lancer `lint:bytes` AVANT `lint:dead`

Un octet NUL dans un fichier source suffit à le faire classer binaire par ripgrep, qui le saute
**sans un mot** : le fichier cesse d'exister pour toute passe d'accessibilité. `npm run
lint:bytes` est le garde-fou, et il ne sert que si on le lance.

Ce piège coûte plus cher qu'il n'y paraît : knip lit le source comme ripgrep, donc un fichier
porteur d'un NUL est invisible au détecteur de code mort lui-même, qui rendra un « rien à
signaler » parfaitement faux. Et attention en décrivant le problème — recopier l'octet depuis le
source pour l'illustrer dans une page réintroduit le NUL dans cette page.

---

## Les lots ouverts

Chacun est une décision de conception, et c'est pourquoi aucun n'est pris au fil de l'eau.

1. La trame d'état à 20 Hz, envoyée synchronement depuis le thread message.
2. `Change`, type valeur gras.
3. La couche de survol de `Waveform`, pour sortir la tête de lecture du dessin complet.
4. `App.tsx` — **à re-mesurer avant de toucher** : le seul profil est antérieur aux lots C/D.
5. `git` hors du process du service, ou sérialisé derrière un verrou.
6. Le jeton distribué à toute socket, et `STUDIO_ENGINE_HOST` à `0.0.0.0` par défaut.
7. Le filet d'exceptions côté C++.
8. Les tests absents : `engine.ts`, le premier test inter-process, le premier contrat C++ ↔ TS.
9. Le bloc WebCodecs de `ui-eyes`, et la chaîne d'effets par platine, qui n'a pas d'hôte.

---

## Comment rejouer ce relevé

```
npm run lint:bytes                         # AVANT lint:dead, ou le second ment
npm run lint:dead                          # knip — lire la SORTIE, pas le code de sortie
npm run bench --workspace @studio/song     # séquentiellement : deux bancs en parallèle
npm run bench --workspace @studio/file-service   #   se concurrencent et le chiffre ment
npx turbo run test --force                 # --force : un vert en cache est identique à un vrai vert
npx turbo run typecheck --force
```

Pour vérifier les affirmations de cette page une par une :

```bash
# le filet — doit trouver les deux background.ts, et RIEN en C++
grep -rn "unhandledRejection\|uncaughtException\|set_terminate" --exclude-dir=.claude .

# le jeton part sur n'importe quelle socket
grep -n "engineToken" engine/moteur/server/main.cpp
```

Deux pièges de mesure déjà payés ici : lire le **nombre de tests** et non le code de sortie (le
glob vide de `docs.test.ts` passe à vide), et se méfier de `libraries.test.ts`, qui pilote du vrai
git et sort en timeout sous charge — le remettre en cause une seconde fois avant d'accuser un
changement. Et sur cette machine, `.claude/` contient une trentaine de worktrees : un glob à la
racine qui ne les exclut pas rapporte les résultats d'autres branches.
