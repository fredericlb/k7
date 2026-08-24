# Audit — les services et le moteur

État des lieux de tout ce qui relie une surface au `engine/moteur` : ce qui est mutualisé, ce
qui est recopié, et où la fiabilité des connexions cède. Écrit pour être exécuté par lots — le
plan est en fin de page.

> **L'autre moitié est ailleurs.** Cette page s'arrête à la socket. Ce qui se passe une fois
> le message arrivé — les fils, le rappel audio, le coût d'un chargement de projet, et le gel
> de la première lecture — est dans
> [engine/moteur/docs/audit-stabilite.md](../engine/moteur/docs/audit-stabilite.md).

## Périmètre

Deux services parlent vraiment au moteur : **st0** et **pl8**, chacun par ses deux moitiés
(navigateur + backend), plus le **superviseur** (`engine-host`) qui l'annonce aux registres. En
marge : **z0** ne s'y relie qu'en un point, un rendu hors-ligne de 74 lignes
(`apps/z0/backend/src/render.ts`) qui passe par le service de fichiers en HTTP et jamais par
la socket ; **k7** n'y touche pas du tout.

Volumétrie : ~7 400 lignes de TypeScript dans les cinq paquets moteur (`engine-protocol` 959,
`engine-client` 684, `engine-browser` 1 944, `engine-host` 3 029, `engine-registry` 793),
52 fichiers C++, et 35 fichiers d'app qui importent `@studio/engine-*`. Les fichiers les plus
remaniés sont `engine-host/src/supervisor.ts` et `engine-browser/src/engine.ts` — c'est là que
la fiabilité se joue.

## Ce qui marche, et qu'il ne faut pas défaire

Trois choses sont réussies et servent de modèle au reste.

**`engineAccess(base, json)`** est la voie unique de découverte : toutes les surfaces
l'utilisent, sans exception. Le paquet supprime une classe entière de bugs (le `base` passé
deux fois, la liste non gardée qui produisait un spinner éternel).

**`packages/project-shell`** est le seul découplage propre du dépôt : il ne dépend pas de
`engine-browser`, il déclare `GateEngine { fileBase; token }` structurellement, et les apps
montent la même `ProjectGate`. C'est le patron à reproduire.

**Le C++ est durci en profondeur** : `SessionRegistry` sous mutex, accesseurs non insérants,
deux verbes `broadcast`/`broadcastTo`, émetteur audio sur son propre thread, purge des listeners
orphelins. Seize modes de défaillance y sont documentés et gardés.

La documentation est d'ailleurs le point fort du dépôt : la plupart des pièges de ce domaine
sont écrits noir sur blanc. Le problème n'est pas qu'on ignore les modes de panne, c'est que
**un correctif reste local à la surface qui a souffert** tant qu'un paquet ne le porte pas.

## B. Sécurité — à décider, pas à corriger mécaniquement

**Le jeton moteur fuit par conception.** `main.cpp:1094-1108` : `whoami` renvoie le jeton à
n'importe quelle socket qui le demande, sans authentification préalable. Le navigateur le
récupère là (`probe.ts:124`) et le rejoue vers le service de fichiers.

Conséquences : quiconque atteint `ws://<moteur>:8765` — loopback, ou le LAN entier quand le
superviseur bind `0.0.0.0` — obtient en un message de quoi réclamer le bail, désenregistrer le
moteur, et appeler **toutes** les routes du service de fichiers de cette machine. Le jeton est
le même pour les deux surfaces, n'a aucune expiration, et le révoquer suppose de supprimer
`engine-id.json`, ce qui change aussi l'`id` et casse la préférence mémorisée.

Un angle mort aggrave le tableau : le relais recopie tous les en-têtes entrants, `origin`
compris (`proxy.ts:233`). La requête relayée n'étant pas préflightée, le contrôle CORS que
`corsAndOrigins.md` décrit comme « the load-bearing control » est **entièrement contourné** : il
ne reste que le jeton. Effet de bord visible en dev : `pending-origins.json` se remplit
d'origines qui fonctionnent, et le tray notifie « A web UI was blocked » pour chacune.

Ce n'est pas un bug à corriger d'un patch : c'est un modèle de confiance à trancher. Les
options vont de « assumer et l'écrire » à « le moteur n'émet plus son jeton sur `whoami` », ce
qui demande une autre preuve d'identité pour la sonde. Ce que le jeton prouve aujourd'hui est
écrit dans `packages/engine-registry/docs/token.md`.

## C. Duplication — ce qu'un paquet économiserait

### C2 — les sélecteurs de moteur, trois copies

Le spinner plein écran, la carte « Se connecter », la rangée de moteur, et l'effet `useRelook`
dupliqué mot pour mot avec son `biome-ignore` (26 lignes pour un `useEngineList(actif)` de ~12).
Les gates partagent la structure `Phase`, `findEngine`, `pick`, l'effet `auth.me`, les trois
branches de rendu et la boucle `ranked.map` ; ce qui les distingue est un bandeau de
commentaire, un import et quelques chaînes de texte.

Un `@studio/engine-gate` portant la machine à phases, l'effet relook paramétré, `<EngineRow>`,
le spinner et la carte anon ramènerait **~770 lignes à environ 400**. Surtout, il rendrait
structurellement impossibles les divergences ci-dessous. Les nombres sont à revérifier au moment
de faire le lot.

### C3 — les divergences accidentelles que ce paquet supprimerait

1. **Quatre prédicats différents pour « joignable »**, dont deux qui ignorent le jeton
   (`z0/Gate.tsx:107`, `pl8/EnginePicker.tsx:49`). C'est le bug que `access.md:37` décrit —
   gardé dans `choose.ts` mais pas dans les sélecteurs, qui filtrent eux-mêmes. Un
   `isReachable()` existe dans le paquet et **n'est appelé nulle part**.
2. **z0 n'a pas de `useRelook`** — le seul sélecteur permanent qui peut rester bloqué sur
   « hors de portée » jusqu'au rechargement, précisément ce que `relook.ts` existe pour tuer.
3. **z0 ne prend jamais le bail**, alors que `lease.md:20-27` raconte que deux apps ont livré
   ce bug indépendamment. z0 ne pilote pas de projet, mais il pilote un moteur, donc la ligne
   tient.
4. **`assigned` ignoré par 2 gates sur 3** : seul st0 cache un moteur déjà pris.
5. **`select` avant d'entrer : st0 seul.** Les deux autres entrent sur un jeton non vérifié
   côté serveur.
6. **« Rechercher à nouveau » détruit la liste** dans z0 (`setPhase({k:"looking"})`), pas dans
   st0 ni pl8.

### C4 — les formes du fil, déclarées deux fois

`EngineSessionInfo`, `EngineAudioDevice`, `EnginePluginInfo`, `EngineEditPlugin` existent en
double, dans `engine-browser/src/engine.ts:44-75` et `engine-client/src/engineControl.ts:55-78`,
avec les mêmes coercitions champ par champ recopiées. Le commentaire de `engine.ts:41-43` le
reconnaît et dit quoi faire : « if a third copy ever appears, move them there instead » — dans
`engine-protocol`, qui existe et ne porte que les types effacés.

Deux divergences y sont déjà nées : le navigateur lit `pitches`/`clarity` sur `io-levels`, le
Node les ignore.

Même chose pour la liste d'adresses, construite deux fois à partir du même `EngineAddresses` :
`probe.ts:161-165` (navigateur) et `proxy.ts:70-73` `hostsFor` (serveur), dans deux paquets.

Et pour le formatage « latence ou hors de portée » : 5 copies d'une fonction d'une ligne, dont
la place est dans `web-protocol/quality.ts` à côté de `formatLatency`.

À noter, de la même famille : `ENGINE_PROXY_PATH` est exporté par `engine-registry` et
**personne ne l'importe** — le chemin est réécrit en dur côté navigateur (`probe.ts:170`).

### C5 — code mort

`probeLocalEngine()`, `isReachable()`, `EngineLookup.ambiguous`, `RELOOK_MS`,
`StreamPlayer.snapshot()` : zéro appelant hors tests. `packages/player-web/src/moteurPlayer.ts`
(~300 lignes, pilote le moteur via `EngineClient`) n'est instancié par personne — c'est un
joint assumé, voir `docs/inventaire.md` §3. L'instrumentation de streaming décrite dans
`streaming.md` (jitter, drift, `dropped`) n'est exposée par aucun écran.

Hors périmètre moteur mais même famille : `apps/z0/buzzer/src/lib/ws.ts` et
`apps/z0/remote/src/lib/ws.ts` sont identiques à l'octet (74 lignes), `presenter` en est une
troisième copie de 69 lignes. Aucun des trois ne reconnecte.

## D. Le superviseur

- **Aucun backoff sur registre injoignable** : `beat` relance N `fetch` toutes les 5 s, pour
  toujours, sans journalisation ni espacement. Le contraste est net avec la surveillance de
  crash du moteur, qui a bien un backoff 1 s → 30 s.
- **`heartbeat()` est tout-ou-rien** : trois registres sains sur quatre affichent rouge, sans
  dire lequel manque — alors que le snapshot joint pourtant les URL.
- **`lastHeartbeatOk` confond trois choses** : moteur arrêté, registre injoignable, et un
  écrasement hors cycle par `addRegistryUrl`.
- **Le niveau 3 de `resolveRegistryUrls` est collant** : un backend tué par `SIGKILL` laisse
  son fichier d'annonce, le superviseur bat éternellement vers un port mort, et combiné au
  tout-ou-rien ci-dessus, éteint le voyant pour tous les autres.
- **L'adoption par pidfile ne vérifie rien** : ni que le processus est un moteur, ni qu'il
  porte le même jeton. Un moteur adopté avec une autre identité fait diverger ce que le
  superviseur annonce de ce que le moteur répond à `whoami` — et la sonde, qui compare les
  `id`, le déclare injoignable sans un mot.

## E. Tests — l'asymétrie qui coûte

Une centaine de cas couvrent bien **les fonctions pures et les politiques** : `chooseEngine`,
`forSession`, `desiredSwitch`, `normaliseOrigin`, `resolveRegistryUrls`, `seqGap`,
`decodeStreamFrame`. Ils ne couvrent **presque rien de ce qui concerne une socket dans le
temps** : ouverture, fermeture, réouverture, file d'attente, replay, ticket.

Or les trente et quelques bugs recensés dans les docs sont, à trois exceptions près, **tous**
des bugs de cycle de vie de connexion.

Le bail fait exception : `engine-registry/registry.test.ts` couvre l'octroi, le renouvellement,
la reprise, le refus du perdant, l'expiration sans adieu et la libération par secret. Ne sont
couverts par aucun test : la reconnexion (aucun client), le replay des souscriptions — la seule
resynchronisation qui existe —, l'`outbox`, la moitié WebSocket du relais,
`issueEngineTicket`/`verifyEngineTicket` (dont le non-rejeu inter-moteur, propriété de sécurité
centrale), `holdEngine`, et les ~35 branches de dispatch des deux clients.

Trois accords C++ ↔ TS ne sont vérifiés par rien : la trame binaire (« nothing checks that they
do but a listener, and a disagreement plays as noise »), le choix `broadcast`/`broadcastTo`
pour chaque réponse par session — dont le correctif est une convention de revue —, et
`ProjectDoc` contre ses ~60 `j.value(...)`, où un champ renommé côté TS prend silencieusement
son défaut côté C++. C'est exactement le mode de panne du stub `ClipMoved` : le changelog dit
succès, l'audio ne bouge pas.

## Plan

Ordonné par rapport valeur/risque.

### Lot 3 — `@studio/engine-gate`

C2 et C3. Le plus gros lot (~770 lignes vers ~400), et celui qui supprime six divergences
d'un coup. Le paquet doit naître avec la sémantique de reconnexion de
`packages/engine-browser/docs/reliability.md` plutôt que de figer celle d'un sélecteur.

### Lot 4 — descendre les formes du fil dans `engine-protocol`

C4, plus le ménage de C5. Le commentaire du code dit déjà quoi faire.

### Lot 5 — les tests de cycle de vie

Un faux moteur et un faux registre en mémoire, puis couvrir : reconnexion, replay, `outbox`,
ticket, relais WebSocket. Plus un test de contrat C++ ↔ TS sur la trame binaire et sur
`PER_SESSION_REPLIES`. C'est le lot qui empêche les trente bugs déjà corrigés de revenir.

### Lot 6 — le modèle de confiance

Section B. À trancher avant d'écrire quoi que ce soit.

## Corrections de documentation à faire au passage

- `engine-browser/docs/access.md` : son tableau « où brancher `useRelook` » omet z0, seul cas
  où la doc dit qu'il faut *toujours* le brancher, et le filtrage sans jeton y est présenté
  comme réglé alors que deux surfaces le font encore.
- `engine-browser/docs/lease.md` présente le bail comme un sujet clos ; z0 n'en prend aucun.
- `engine-browser/docs/streaming.md` dit « quatre apps » pour `./stream` (une seule), et son
  tableau de lecture des mesures décrit une instrumentation qu'aucun écran n'expose.
- `engine-registry/docs/proxy.md:116-118` promet un 502 franc sur corps flué ; le code
  (`proxy.ts:291`) réessaie sur un flux déjà partiellement consommé.
