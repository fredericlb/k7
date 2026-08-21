# Constat global — l'axe audio

**Relevé du 2026-08-21, sur `a4808e35`.** Périmètre : `apps/st0`, `engine/moteur`,
`engine/capot` et les paquets qu'ils pilotent. Hors périmètre : `apps/{z0,k7,pl8,studio}`.

Cette page est **autonome** — elle porte ses preuves plutôt que d'y renvoyer — ce qui veut dire
qu'elle périmera. Le remède n'est pas de la croire mais de la rejouer : la dernière section
donne les commandes exactes. Une entrée fausse doit se découvrir en trente secondes.

Les quatre pages spécialisées gardent ce qu'elles seules détiennent :
[audit-perf-web.md](audit-perf-web.md) (les lots A→E chiffrés),
[audit-moteur.md](audit-moteur.md) (**la plus périmée : elle cite `apps/m9/`, supprimé**),
[inventaire.md](inventaire.md) (le code mort, désormais outillé) et
[engine/moteur/docs/audit-stabilite.md](../engine/moteur/docs/audit-stabilite.md) (le C++).

---

## La thèse

**Ce dépôt durcit toujours la face qu'il regarde, et laisse le jumeau intact.**

Ce n'est pas une négligence : c'est la signature d'un travail sérieux mené une panne à la fois.
On corrige là où ça a fait mal, et le symétrique — qui n'a pas encore fait mal — reste nu.

| durci | le jumeau, resté nu | état |
|---|---|---|
| `engine-browser/src/engine.ts` : file bornée, TTL, chien de garde `whoami`, repli secoué | `engine-client/src/engineControl.ts` : `outbox: string[]` sans borne ni TTL ; `engineLink.ts` re-dialait à **1 Hz sans fin** | **corrigé** (S4) |
| Le web est benché, chiffres publiés | Aucun banc C++, aucun banc navigateur | ouvert |
| `git pull` borné à 60 s, `git fetch` à 30 s | `git push` **sans borne**, contre la règle écrite en tête du même fichier | **corrigé** (S1) |
| `wrap()` attrape ce qu'une route lève | **Aucun** `unhandledRejection` / `uncaughtException` / `set_terminate` dans tout le dépôt | **corrigé** côté TS (S2) ; ouvert en C++ |
| La gate de st0 : bail, relook, prédicat complet | Celle de z0 : ni bail, ni relook, joignabilité qui ignore le jeton | hors périmètre |

Et la conséquence qui tient les trois axes : **aucun n'avait de garde automatique.** Pas de porte
de non-régression perf, pas de test inter-process, pas d'outil de code mort. Tout était une passe
manuelle — donc tout décrochait, et c'est bien ce qu'on observe : deux des quatre pages d'audit
pointent des fichiers disparus.

---

## Performances

### Le banc mesurait deux régimes à la fois — et c'était le seul constat sans explication

`audit-perf-web.md` laissait un fil ouvert : `compileNodeProject` variait de **±36-40 %** à
64 pistes, avec la note « un cache qui tantôt touche et tantôt manque ». Le fil est tiré, et ce
n'était pas le produit.

`yamlCache` refuse de mettre en cache un fichier dont la mtime a moins de 2 s (`SETTLE_MS`), pour
une bonne raison écrite dans le fichier. Or `writeBenchProject` écrivait sa fixture puis mesurait
**immédiatement** : les premières itérations ne *pouvaient* pas toucher le cache, les suivantes
touchaient toutes, et la moyenne mélangeait les deux populations.

Corrigé en vieillissant la fixture d'une heure (`utimesSync`) — le régime dans lequel est un vrai
morceau. Deux bancs joués séquentiellement, même machine :

| banc | avant | après |
|---|---|---|
| `compileNodeProject` — 8 pistes | 14,40 ms, rme ±2,11 % | **3,68 ms**, rme ±1,64 % |
| `compileNodeProject` — 64 pistes | 67,75 ms, **rme ±41,61 %** | **21,36 ms**, rme ±1,74 % |
| `buildGraphDoc` — 8 pistes | 13,5 ms | **4,18 ms** |
| `buildGraphDoc` — 64 pistes | 68,5 ms | **35,65 ms** |

Trois conséquences, et la deuxième est la plus importante :

1. **La variance a disparu** (±41,6 % → ±1,7 %). Un banc à ±40 % ne pouvait valider aucun
   changement de moins de 40 %, c'est-à-dire aucun.
2. **Les deux bancs ne mesuraient plus la même chose.** Ils rendaient 68,1 et 68,5 ms — identiques
   à 0,6 % près — et on en concluait que `buildGraphDoc` ne coûtait rien de plus. Faux : les deux
   étaient dominés par les mêmes lectures YAML non cachées. À découvert, l'écart est de **14 ms**,
   le travail propre de `buildGraphDoc` (les extents de clips). **Un poste entier était invisible**,
   et c'est lui qu'il faut surveiller quand un morceau grossit.
3. La courbe est plus douce qu'annoncé : 8× les pistes coûtent 5,8× (compile), pas ×5 pour tout.

Page : [`packages/song/docs/benchSettle.md`](../packages/song/docs/benchSettle.md).

### Un constat RETIRÉ, avant qu'on le repropose

Le `safeParse` de zod n'est pas mis en cache alors que le parse YAML l'est, et ça ressemblait au
poste suivant. Mesuré avant d'y toucher : **1,0 % d'un compile à 64 pistes**, 1 à 2,5 % à 8. Et le
mettre en cache casserait un invariant que `loader.ts` écrit noir sur blanc — le parse caché n'est
sûr *que parce que* `r.data` est une structure neuve, si bien que rien de partagé ne sort de la
boucle. Ne pas le faire.

### Le canevas se réallouait vingt fois par seconde

`Waveform.tsx` ouvrait son effet de dessin sur `canvas.width = width * dpr`, sans condition.
Assigner `width` n'est pas neutre quand la valeur ne change pas : cela **réalloue le backing
store et réinitialise tout le contexte 2D**. Comme `currentTime` est dans les dépendances de cet
effet, c'était vingt allocations jetées par seconde et par éditeur de clip ouvert, pour une boîte
dont la taille ne bouge qu'avec la fenêtre. `docs/layers.md` recensait le résidu de dessin et ne
mentionnait pas celle-là. **Corrigé** (P3), avec l'invariant que la réallocation assurait
gratuitement — le contexte est réétabli à chaque frame — désormais écrit.

### Ce qui reste, par ordre de rendement

1. **`ClipWaveform` rend son hôte à la cadence des frames.** Il lit le transport avec
   `useEngineState((s) => s.playhead)` — un hook SÉLECTEUR — alors que le dépôt a déjà la réponse :
   `usePlayheadFrames`, qui s'abonne au store brut, ne rend jamais, et écrit sur un nœud DOM à
   60 Hz. Son en-tête dit exactement pourquoi. On ne peut pas l'y substituer tel quel, parce que
   `Waveform` dessine sa tête de lecture *sur le canevas* : il faut une couche de survol mince.
   C'est le même geste que `layers.md` a écarté pour le REMPLISSAGE de progression, et écarté pour
   une raison qui ne vaut pas ici — un lavis violet sur les numéros de mesure se voit, un trait
   d'un pixel non.
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
raisonnement **mesuré**, y compris un cas où hoisser une portée s'est révélé plus lent.
`engineStore` quantifie dans le sélecteur. Et la table « l'O(n²) qui ne vaut pas la peine » de
`meters.md` est un verdict chiffré : la Map mémoïsée PERD sous ~50 pistes.

---

## Stabilité

### Le filet qui n'existait nulle part

Vérifié : `unhandledRejection`, `uncaughtException` et `std::set_terminate` ne renvoyaient
**aucune correspondance dans tout le dépôt**. Or `void f()` n'attrape rien — il annonce à Biome
qu'on n'attendra pas la promesse — et depuis Node 15 une promesse rejetée non attrapée **termine
le process**.

Le superviseur y était exposé sept fois, un minuteur par sondage, chacun touchant le réseau ou le
disque. Le mode de panne n'est pas « le superviseur s'arrête » : il meurt, **le moteur reste vivant
derrière lui**, le capot le relance sur son repli et le nouveau superviseur ré-adopte le moteur par
son pidfile. Ça se rattrape, donc ça ne se remarque pas — la raison même pour laquelle personne ne
l'avait vu. Le service de fichiers avait quatre sites de la même famille, dont deux dans une route,
où sa protection `wrap()` ne peut rien voir : elle n'attrape que ce que le handler *retourne*.

**Corrigé** (S2, S3) : un `guard()` par process et le filet aux deux points d'entrée, avec les deux
moitiés volontairement asymétriques — un rejet est journalisé et on vit, une exception non attrapée
est journalisée avec sa pile et on sort. Page :
[`packages/engine-host/docs/background.md`](../packages/engine-host/docs/background.md).

**Reste ouvert : le C++.** Un seul `try`/`catch` dans toute la bibliothèque (`NamPlugin.cpp`) sur
52 fichiers, ni `try` au niveau de `main()`, ni `set_terminate`.

### git bloque le process qui tient le moteur

`packages/commands/src/git.ts` fait tout en `execFileSync`, et les routes aussi. Ce process tient
la socket vers le moteur, l'horloge de motifs et le watcher. `push` n'avait **aucune borne** —
**corrigé** (S1) — mais le fond reste : `gitStatus` fait un `fetch` bloquant jusqu'à 30 s, et
**il n'y a aucun verrou nulle part**. `commitAndPush` fait `add -A`, puis `status`, puis `commit`
en trois sous-process : une écriture d'autosave qui atterrit entre le premier et le troisième est
hors du commit. Et `cancelAlternative` fait `reset --hard` puis `clean -fd` sans exclusion.

### Une doc qui affirmait le contraire du code

`engine-registry/registry.ts` disait « The per-engine token NEVER leaves the server ». Le moteur
rend son jeton à **toute socket** qui envoie `whoami`, sans authentification, et le navigateur le
stocke. **Corrigé** (S6) — la phrase, pas le modèle : le modèle est un lot, et il a maintenant sa
page, [`packages/engine-registry/docs/token.md`](../packages/engine-registry/docs/token.md), qui
dit ce que le jeton prouve vraiment (l'anti-confusion) et ce qu'il ne protège pas.

### Les tests : ce que personne ne couvre

`engine-browser/src/engine.ts` — 852 lignes où vit toute la fiabilité du client navigateur —
**n'a pas de fichier de test**. `packages/engine-client` n'en avait aucun ; il en a trois
maintenant (S4), sur l'outbox, et c'était le paquet du chemin critique. Restent : **aucun test ne
franchit une frontière de process**, et **aucun contrat C++ ↔ TS** ne tient la trame binaire.

### Déjà solide

Le client navigateur du moteur dans son entier. `moduleWatch` avec ses trois moitiés — le watcher,
le plafond de 10 s qui guérit un événement perdu, et la moitié écrivain, parce que `fs.watch`
délivre un tick trop tard. Le bail sur un projet, testé 21 fois. Et `reconcileEngine`, qui est la
réponse écrite à ce que le code appelle lui-même « l'échec le plus silencieux de ce dépôt » :
envoyer à une session vide.

---

## Code mort

### Il n'y avait aucun outil ; il y en a un

Ni knip, ni ts-prune, ni depcheck. Biome ne voit que l'intra-fichier — un `export` que personne
n'importe lui est invisible **par construction** — et `biome.json` exclut `engine/moteur`. Les
quatre passes manuelles de `inventaire.md` étaient tout, ce qui explique la forme de leur
péremption : pas des constats faux, mais des chemins qu'un renommage déplace.

`npm run lint:dead` (knip, `knip.json`) fait désormais trois de ces quatre passes en trente
secondes. **Non bloquant** — un faux positif se lit, il ne doit pas bloquer un merge — et sa liste
d'exceptions est le §0 de l'inventaire traduit en configuration, faute de quoi il tue du code
vivant : `dspRunner.mjs`, `separateWorker.ts`, les entrées esbuild du tray, `emit.ts`, les
`jsdsp.ts`, les harnais de `engine/moteur/scripts/`.

Calibrage : **66 fichiers « morts » au premier passage, 1 au troisième.** Sortie finale sur l'axe
audio : **1 fichier, 4 dépendances, 1 devDépendance, 58 exports, 17 types** — 81 constats en
92 lignes, chacun à examiner.

### Ce qui a été supprimé

- **`packages/ui-module-builder/src/libraryStore.ts`**, en entier. Ni `libraryModuleStore` ni
  `LibraryFileIO` n'étaient prononcés nulle part, pas même dans leur propre fichier — alors que
  son en-tête affirmait servir « pl8's own screen and st0's Libraries tab » et que `docs/store.md`
  le documentait comme branché. La preuve était dans `apps/pl8/frontend/src/api.ts` : il y
  renvoyait en son milieu, et portait au bas du **même fichier** la pierre tombale disant que la
  section avait disparu.
- Le sous-chemin `exports` **`@studio/commands/timeline`**. Le fichier vit — c'est un script
  documenté lancé par `npx tsx` — mais un script se lance par CHEMIN : la carte `exports` ne
  pouvait servir à personne.
- `zod` et `@types/express` de `web-protocol`, déclarés sans qu'une ligne les importe.

### Ce qui a été déclaré plutôt que supprimé

54 fichiers importaient `vitest` sans que personne le déclare ; idem `yaml` dans trois paquets et
`zod` dans st0. Ça ne se résolvait que par hoisting. Déclaré — mécanique, sans risque, et c'est ce
qui a rendu la sortie de knip lisible.

### Signalé, non supprimé

**`packages/engine-client/frame.mjs`** — trouvé par knip à son tout premier passage. Neuf lignes,
un chemin ABSOLU en dur vers `C:/Users/flb/.studio/engine-id.json`, aucun appelant. **Suivi par
git, et committé dans `a4808e35`** — le dernier commit au moment du relevé. Un brouillon de sonde
qui a suivi un commit. Non supprimé : il vient d'atterrir, donc c'est à son auteur de trancher.

### Un garde-fou qui était rouge, et que personne ne lançait

`npm run lint:bytes` échouait sur `packages/ui-turntables/src/setList.ts` : un octet NUL, utilisé
comme séparateur de clé composite. C'est le piège que `inventaire.md` §0 décrit et **déclare
réglé** — ripgrep classe binaire tout fichier qui en porte un et le saute **sans un mot**, donc le
fichier cesse d'exister pour toute passe d'accessibilité. Trois avaient été corrigés ; en voici un
quatrième, apparu depuis.

Deux choses valent d'être retenues, et la seconde est neuve :

- Le garde-fou fonctionne, mais **seulement si on le lance**. Il était rouge et invisible.
- **Ce piège coûte maintenant plus cher qu'avant.** knip lit le source comme ripgrep : un fichier
  porteur d'un NUL est invisible au détecteur de code mort lui-même, qui rendra un « rien à
  signaler » parfaitement faux. **Lancer `lint:bytes` AVANT `lint:dead`**, ou le second ment.

Corrigé (un caractère, même chaîne à l'exécution ; 217 tests de `ui-turntables` verts).
Anecdote instructive : en recopiant l'octet depuis le source pour le *décrire* dans l'inventaire,
ce relevé s'est piégé lui-même et a réintroduit le NUL dans sa propre page.

### Ce que l'inventaire disait et qui a changé

- **§3 : la chaîne `list-plugin-params` est RALLUMÉE** depuis `60c8e002`, alors que la page dit
  encore « rien ne les appelle ». Seule la moitié navigateur reste sans appelant. C'est
  littéralement le second piège de relevé que la page s'annonce à elle-même : un commit a mis à
  jour la prose autour sans revenir sur le constat.
- **§6 : `apps/m9` et `apps/v1` n'existent plus.** La page les disait présents sur le disque et
  concluait que la chaîne d'effets par platine « n'est pas du code mort, c'est du code dont l'hôte
  est ailleurs ». L'hôte n'est plus ailleurs : il n'est nulle part, et l'argument qui protégeait ce
  bloc est tombé avec lui.
- Deux chemins de `where()` faux sur deux ; le spinner est en cinq copies et non quatre ; les
  scripts de migration de `song` sont passés de six à huit **entre deux passes de la page**, ce
  qui vérifie littéralement sa propre phrase « rien ne les retire une fois jouées ».

---

## Ce qui a été fait dans cette passe

| | quoi | où |
|---|---|---|
| S1 | `git push` borné à 60 s | `commands/src/git.ts` |
| S2 | Filet `unhandledRejection` / `uncaughtException` aux deux points d'entrée | `engine-host/src/main.ts`, `file-service/src/server.ts` |
| S3 | `guard()` sur 11 promesses flottantes (7 minuteurs + 4 sites) | `supervisor.ts`, `files.ts`, `workspace.ts`, `engineLink.ts` |
| S4 | Outbox bornée + TTL ; repli doublé, plafonné, secoué ; **3 premiers tests du paquet** | `engine-client/`, `file-service/src/engineLink.ts` |
| S5 | Trois gestionnaires d'erreur muets journalisent | `engine.ts`, `engineLink.ts` ×2 |
| S6 | La phrase fausse sur le jeton, plus la page qui dit le vrai modèle | `engine-registry/` |
| P1 | **Réfuté par la mesure** (zod = 1 %) ; le BANC corrigé à la place | `song/src/benchProject.ts` |
| P3 | Le canevas ne se réalloue plus par frame | `ui-waveform/src/Waveform.tsx` |
| D1 | knip, non bloquant, calibré | `knip.json`, `npm run lint:dead` |
| D2/D3 | `libraryStore.ts` supprimé ; sous-chemin `timeline` retiré | `ui-module-builder/`, `commands/` |
| D4 | `inventaire.md` rafraîchi sur dix points périmés | `docs/inventaire.md` |

Vérifié : 5 suites forcées (`song` 1025 tests, `commands` 304, `file-service` 291,
`engine-client` 3, `web-protocol`), 9 typechecks, biome propre.

## Les lots laissés ouverts

Chacun est une décision de conception, et c'est pourquoi aucun n'a été pris ici.

1. La trame d'état à 20 Hz, envoyée synchronement depuis le thread message.
2. `Change`, type valeur gras.
3. La couche de survol de `Waveform`, pour sortir la tête de lecture du dessin complet.
4. `App.tsx` — **à re-mesurer avant de toucher** : le seul profil est antérieur aux lots C/D.
5. `git` hors du process du service, ou sérialisé derrière un verrou.
6. Le jeton distribué à toute socket, et `STUDIO_ENGINE_HOST` à `0.0.0.0` par défaut.
7. Le filet d'exceptions côté C++.
8. Les tests absents : `engine.ts`, le premier test inter-process, le premier contrat C++ ↔ TS.
9. Le bloc WebCodecs de `ui-eyes`, et la chaîne par platine — cette dernière a perdu son argument
   avec `apps/m9`.

---

## Comment rejouer ce relevé

```
npm run lint:dead                          # knip — lire la SORTIE, pas le code de sortie
npm run bench --workspace @studio/song     # séquentiellement : deux bancs en parallèle
npm run bench --workspace @studio/file-service   #   se concurrencent et le chiffre ment
npx turbo run test --force                 # --force : un vert en cache est identique à un vrai vert
npx turbo run typecheck --force
npm run lint:bytes
```

Pour vérifier les affirmations de cette page une par une :

```bash
# « aucun filet nulle part » — doit maintenant trouver les deux background.ts, et RIEN en C++
grep -rn "unhandledRejection\|uncaughtException\|set_terminate" --exclude-dir=.claude .

# « le jeton part sur n'importe quelle socket »
grep -n "engineToken" engine/moteur/server/main.cpp

# « m9 n'existe plus » — et ce que l'audit-moteur cite encore
ls apps/ ; grep -rn "apps/m9" docs/
```

Deux pièges de mesure déjà payés ici : lire le **nombre de tests** et non le code de sortie (le
glob vide de `docs.test.ts` passe à vide), et se méfier de `libraries.test.ts`, qui pilote du vrai
git et sort en timeout sous charge — le remettre en cause une seconde fois avant d'accuser un
changement. Et sur cette machine, `.claude/` contient une trentaine de worktrees : un glob à la
racine qui ne les exclut pas rapporte les résultats d'autres branches.
