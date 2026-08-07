# Audit — les services et le moteur

État des lieux de tout ce qui relie une surface au `engine/moteur` : ce qui est déjà
mutualisé, ce qui est recopié, et où la fiabilité des connexions cède. Écrit pour être
exécuté par lots — le plan est en fin de page.

## Périmètre

Trois services parlent vraiment au moteur : **l8**, **m9** et **st0**, chacun par ses deux
moitiés (navigateur + backend), plus le **superviseur** (`engine-host`) qui l'annonce aux
registres. En marge : **z0** ne s'y relie qu'en un point, un rendu hors-ligne de 74 lignes
(`apps/z0/backend/src/render.ts`) qui passe par le service de fichiers en HTTP et jamais par
la socket ; **k7** n'y touche pas du tout.

Volumétrie : ~7 400 lignes de TypeScript dans les cinq paquets moteur (`engine-protocol` 959,
`engine-client` 684, `engine-browser` 1 944, `engine-host` 3 029, `engine-registry` 793),
52 fichiers C++, et 35 fichiers d'app qui importent `@studio/engine-*`. Sur 90 jours, les
fichiers les plus remaniés sont `engine-host/src/supervisor.ts` (10 commits) et
`engine-browser/src/engine.ts` (9) — c'est là que la fiabilité se joue.

## Ce qui marche déjà, et qu'il ne faut pas défaire

Trois choses sont réussies et servent de modèle au reste.

**`engineAccess(base, json)`** est réellement la voie unique de découverte : les quatre
surfaces l'utilisent, sans exception. Le paquet a supprimé une classe entière de bugs (le
`base` passé deux fois, la liste non gardée qui produisait un spinner éternel).

**`packages/project-shell`** est le seul découplage propre du dépôt : il ne dépend pas de
`engine-browser`, il déclare `GateEngine { fileBase; token }` structurellement, et les trois
apps montent la même `ProjectGate`. C'est le patron à reproduire.

**Le C++ a déjà été durci en profondeur** : `SessionRegistry` sous mutex, accesseurs non
insérants, deux verbes `broadcast`/`broadcastTo`, émetteur audio sur son propre thread, purge
des listeners orphelins. Seize modes de défaillance y sont documentés et corrigés.

La documentation est d'ailleurs le point fort du dépôt : la plupart des pièges de ce domaine
sont écrits noir sur blanc. Le problème n'est pas qu'on ignore les modes de panne, c'est que
**les correctifs sont restés locaux à la surface qui a souffert**.

## A. Ce qui saigne aujourd'hui

### A1 — z0 efface les préférences de la médiathèque

`apps/z0/editor-v2` se lie au préfixe de **st0** (`api.ts:42`) et y écrit par `savePrefs`. La
route est un `PUT` en remplacement intégral (`packages/user-prefs/router.ts:35-45`) et le
document de st0 porte deux champs (`engineId`, `playbackTarget`). Choisir une machine dans
l'éditeur z0 **efface donc la destination de lecture de la médiathèque**. st0 est le seul des
quatre à faire un read-merge-write, et son `api.ts:351` interdit explicitement le `PUT`.

### A2 — le ticket du relais expire, la reconnexion ne le renouvelle pas

Le ticket HMAC vit 60 s (`engine-registry/proxy.ts:22`) et il est **figé dans l'URL** au
moment de la mesure (`engine-browser/src/probe.ts:213`). `EngineClient.onclose`
(`engine.ts:196-200`) rappelle `connect()` toutes les secondes **sur la même URL, ticket
compris**, sans jamais redemander `/engines`. Passé une minute, chaque tentative reçoit un 401
et le client reboucle indéfiniment.

Ce n'est pas un cas limite : `probe.ts:149-154` explique que le relais est **la seule voie
praticable depuis toute machine autre que celle du moteur**. C'est le chemin nominal.

### A3 — personne ne détecte une socket semi-ouverte

Aucun ping, aucun pong, aucun timeout d'inactivité, nulle part. Côté C++, IXWebSocket est
lancé avec ses défauts, dont `kPingIntervalSeconds(-1)` — le heartbeat est **désactivé**.
Côté navigateur, rien non plus. Un relais figé, un NAT expiré, une machine réveillée de veille
ne déclenchent donc jamais `onclose`, donc jamais la reconnexion, et `send()` continue
d'écrire dans le vide en croyant le socket `OPEN`.

Or **le signal existe déjà** : le moteur pousse une trame `state` ~20 fois par seconde. Aucune
surface ne s'aperçoit de son absence. Un chien de garde sur ce flux ne coûte pas une ligne de
protocole.

### A4 — m9 ne remarque jamais qu'il a perdu le moteur

`apps/m9/frontend/src/useEngine.ts` ne s'abonne pas à `onConnected`. `phase: {k:"ready"}` est
posé juste après `connect()` et n'est jamais remis en cause : socket morte, le deck continue
d'afficher « en lecture ». l8 est propre sur ce point (`useEngineLink.ts:103-116`, qui force
même `engineBusy` à false — « a socket that drops mid-apply never delivers `busy:false` ») ;
st0 branche `onConnected` mais n'en fait qu'un booléen d'affichage.

### A5 — l'état n'est jamais resynchronisé après une reconnexion

Le `ProjectDoc` n'est **jamais** renvoyé après une reconnexion, sur aucune surface. Seules les
souscriptions le sont (`engine.ts:179-193` : `watched`, `waveformSubs`, `broadcast`).
Conséquence : si le moteur redémarre, l8 pilote un projet vide et le seul symptôme est « le
moteur ignore Play ». m9 se reconnecte sur un moteur vide sans rien lui renvoyer.

Le correctif est bon marché : `EngineHost::apply` diffe contre une baseline qui survit à la
coupure, donc un client qui renvoie son document obtient un diff correct.

### A6 — fuite de sockets dans le relais

`attachEngineProxy` fait un `return;` nu sur les upgrades qui ne correspondent pas
(`proxy.ts:153,156`). L'intention est **coopérative** et les commentaires le disent — « leave
it for another handler », « not ours » : un autre écouteur `'upgrade'` est censé prendre le
relais. C'est une convention raisonnable, et c'est là qu'elle casse : Node ne détruit un socket
d'upgrade automatiquement que s'il n'y a **aucun** écouteur — dès qu'il y en a un, le nettoyage
lui incombe. Or dans les trois backends moteur, `attachEngineProxy` est le **seul** écouteur
(k7 et z0 en ont un, mais dans d'autres apps). Toute requête `Upgrade:` vers un autre chemin y
laisse donc un socket ouvert définitivement.

Deux réponses possibles : détruire le socket quand on est le dernier écouteur, ou assumer la
convention et l'écrire — auquel cas c'est le socle du lot 2 qui doit garantir qu'un écouteur
de repli existe.

### A7 — la reconnexion à 1 Hz, sans borne, contre le relais

`engine.ts:196` : `setTimeout(connect, 1000)`, délai fixe, sans jitter, sans plafond, sans
compteur. Un onglet oublié en arrière-plan sur une machine dont le moteur est éteint frappe le
relais une fois par seconde, indéfiniment — et chaque tentative déclenche côté backend un
`dial()` **séquentiel** à 1,5 s par adresse. Exactement le patron déjà corrigé dans le service
de fichiers (`engineLink.ts`, `pruneIdleLinks`), laissé intact ici.

### A8 — l'`outbox` n'est bornée par rien

`engine.ts:137` / `engineControl.ts:81` : file d'attente sans limite de taille ni de TTL. Une
coupure de dix minutes accumule tout ce que la surface a envoyé, et le tout part **d'un coup**
à la reconnexion, verbes de transport périmés compris.

### A9 — dérives entre les trois backends

| point | st0 | m9 | l8 |
|---|---|---|---|
| limite `express.json` | 1 Mo | 1 Mo | **8 Mo** |
| gestionnaire d'erreur Express | 22 lignes | **absent** | **absent** |

Le service de fichiers accepte 8 Mo : un `POST` relayé de 1 à 8 Mo passe par l8 et fait 413
par st0 et m9. Et le commentaire du gestionnaire d'erreur de st0 décrit précisément le
`request aborted` que produit le relais de fichiers — que l8 et m9 relaient sans le filet.

### A10 — `release` n'est pas authentifié

`releaseBody = z.object({ id })` (`router.ts:45`) puis `reg.release(id)` sans aucune
vérification, contrairement à `select`. N'importe quel utilisateur connecté au service peut
libérer le bail d'un autre.

## B. Sécurité — à décider, pas à corriger mécaniquement

**Le jeton moteur fuit par conception.** `main.cpp:1094-1108` : `whoami` renvoie le jeton à
n'importe quelle socket qui le demande, sans authentification préalable. Le navigateur le
récupère là (`probe.ts:124`) et le rejoue vers le service de fichiers. Or
`engine-registry/registry.ts:1-5` affirme l'inverse — « the per-engine token NEVER leaves the
server ». Les deux affirmations sont contradictoires, et c'est la seconde qui est fausse.

Conséquences : quiconque atteint `ws://<moteur>:8765` — loopback, ou le LAN entier quand le
superviseur bind `0.0.0.0` — obtient en un message de quoi réclamer le bail, désenregistrer le
moteur, et appeler **toutes** les routes du service de fichiers de cette machine. Le jeton est
le même pour les deux surfaces, n'a aucune expiration, et le révoquer suppose de supprimer
`engine-id.json`, ce qui change aussi l'`id` et casse la préférence mémorisée.

Deux angles morts aggravent le tableau :

- `file-service/src/context.ts:30` — `if (!expected) return next();`. Jeton vide **ou**
  `engine-id.json` illisible (le `catch` rend `""`) et le service n'a plus aucune
  authentification. Le mode dégradé est indistinguable du mode dev.
- Le relais recopie tous les en-têtes entrants, `origin` compris (`proxy.ts:233`). La requête
  relayée n'étant pas préflightée, le contrôle CORS que `corsAndOrigins.md` décrit comme « the
  load-bearing control » est **entièrement contourné** : il ne reste que le jeton. Effet de
  bord visible en dev : `pending-origins.json` se remplit d'origines qui fonctionnent, et le
  tray notifie « A web UI was blocked » pour chacune.

Ce n'est pas un bug à corriger d'un patch : c'est un modèle de confiance à trancher. Les
options vont de « assumer et l'écrire » (corriger le commentaire de `registry.ts`, fermer le
mode dégradé du service de fichiers) à « le moteur n'émet plus son jeton sur `whoami` », ce
qui demande une autre preuve d'identité pour la sonde.

## C. Duplication — ce qu'un paquet économiserait

### C1 — le socle serveur, recopié trois fois

Le bloc `attachEngineProxy` et son commentaire de quatre lignes sont **byte-identiques** entre
les trois backends. Avec l'import, `requireAuth`, `createRegistry()`, le montage du routeur,
`advertiseRegistry` dans le callback de `listen`, et `bye`/SIGINT/SIGTERM, c'est **30 à 40
lignes recopiées à l'identique**.

Un `mountEngineRegistry(app, server, { service })` absorberait tout. Divergences réellement
voulues à paramétrer : le nom de service, l'extra legacy de l8, le `loadServiceEnv` de st0, et
la liste des chemins gardés. Les autres (A9) sont de la dérive.

À noter : `ENGINE_PROXY_PATH` est exporté par le paquet et **personne ne l'importe** — le
chemin est réécrit en dur côté navigateur (`probe.ts:170`).

### C2 — les sélecteurs de moteur, quatre copies

`apps/m9/frontend/src/Gate.tsx` et `apps/z0/editor-v2/src/Gate.tsx` partagent **102 lignes non
vides strictement identiques** : structure `Phase`, `findEngine`, `pick`, l'effet `auth.me`,
les trois branches de rendu, la boucle `ranked.map`. Le `diff` ne montre qu'un bandeau de
commentaire, l'import `useRelook`, et quatre chaînes de texte.

Ailleurs : l'effet `useRelook` est dupliqué mot pour mot entre l8 et m9, `biome-ignore`
compris (26 lignes pour un `useEngineList(actif)` de ~12) ; le spinner plein écran existe en
4 copies ; la carte « Se connecter » en 3 ; la rangée de moteur en 4 (~102 lignes).

Un `@studio/engine-gate` portant la machine à phases, l'effet relook paramétré, `<EngineRow>`,
le spinner et la carte anon ramènerait **770 lignes à environ 400**. Surtout, il rendrait
structurellement impossibles les six divergences ci-dessous.

### C3 — les divergences accidentelles que ce paquet supprimerait

1. **Cinq prédicats différents pour « joignable »**, dont trois qui ignorent le jeton
   (`m9/Gate.tsx:140`, `z0/Gate.tsx:107`, `st0/EnginePicker.tsx:49`). C'est exactement le bug
   que `access.md:37` raconte au passé — corrigé dans `choose.ts` mais pas dans les sélecteurs,
   qui filtrent eux-mêmes. Un `isReachable()` existe dans le paquet et **n'est appelé nulle
   part**.
2. **z0 n'a pas de `useRelook`** — le seul sélecteur permanent qui peut rester bloqué sur
   « hors de portée » jusqu'au rechargement, précisément ce que `relook.ts` existe pour tuer.
   La ligne d'import a été supprimée, pas remplacée par un choix.
3. **z0 ne prend jamais le bail**, alors que `lease.md:20-27` raconte que deux apps ont livré
   ce bug indépendamment.
4. **`assigned` ignoré par 3 gates sur 4** : seul l8 cache un moteur déjà pris.
5. **`select` avant d'entrer : l8 seul.** Les trois autres entrent sur un jeton non vérifié
   côté serveur.
6. **« Rechercher à nouveau » détruit la liste** dans m9 et z0 (`setPhase({k:"looking"})`),
   pas dans l8 ni st0.

Et un doublon d'appel : `holdEngine` fait déjà un `renew()` immédiat, donc `access.hold()`
contient un `select` — `l8/EngineGate.tsx:64` en émet un second dans le même tick.

### C4 — les formes du fil, déclarées deux fois

`EngineSessionInfo`, `EngineAudioDevice`, `EnginePluginInfo`, `EngineEditPlugin` existent en
double, dans `engine-browser/src/engine.ts:44-75` et `engine-client/src/engineControl.ts:55-78`,
avec les mêmes coercitions champ par champ recopiées. Le commentaire de `engine.ts:41-43` le
reconnaît déjà et dit quoi faire : « if a third copy ever appears, move them there instead »
— dans `engine-protocol`, qui existe et ne porte pour l'instant que les types effacés.

Deux divergences y sont déjà nées : le navigateur lit `pitches`/`clarity` sur `io-levels`, le
Node les ignore.

Même chose pour la liste d'adresses, construite deux fois à partir du même `EngineAddresses` :
`probe.ts:161-165` (navigateur) et `proxy.ts:70-73` `hostsFor` (serveur), dans deux paquets.

Et pour le formatage « latence ou hors de portée » : 5 copies d'une fonction d'une ligne, dont
la place est dans `web-protocol/quality.ts` à côté de `formatLatency`.

### C5 — code mort

`probeLocalEngine()`, `isReachable()`, `EngineLookup.ambiguous`, `RELOOK_MS`,
`StreamPlayer.snapshot()` : zéro appelant hors tests. `packages/player-web/src/moteurPlayer.ts`
(~300 lignes, pilote le moteur via `EngineClient`) n'est instancié par personne.
L'instrumentation de streaming décrite dans `streaming.md` (jitter, drift, `dropped`) n'est
exposée par aucun écran — `useEngine.ts:121` échantillonne toutes les 500 ms un `listenStats`
que rien n'affiche, et re-rend le deck 2×/s pour rien.

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
- **`gatherAddresses` ne filtre ni VPN, ni Docker, ni WSL, ni Hyper-V.** Chaque interface
  fantôme coûte 1,5 s de dial séquentiel au relais et un candidat parallèle à la sonde.
- **L'adoption par pidfile ne vérifie rien** : ni que le processus est un moteur, ni qu'il
  porte le même jeton. Un moteur adopté avec une autre identité fait diverger ce que le
  superviseur annonce de ce que le moteur répond à `whoami` — et la sonde, qui compare les
  `id`, le déclare injoignable sans un mot.

Et deux délais qui se contredisent : le relais compose ses essais en séquentiel à
`DIAL_TIMEOUT_MS = 1500` par adresse — 4,5 s au pire sur une machine à deux IP LAN — quand la
sonde du navigateur abandonne à `PROBE_TIMEOUT_MS = 3000`. Les deux constantes vivent dans deux
paquets et rien ne les relie.

## E. Tests — l'asymétrie qui coûte

Une centaine de cas couvrent bien **les fonctions pures et les politiques** : `chooseEngine`,
`forSession`, `desiredSwitch`, `normaliseOrigin`, `resolveRegistryUrls`, `seqGap`,
`decodeStreamFrame`. Ils ne couvrent **presque rien de ce qui concerne une socket dans le
temps** : ouverture, fermeture, réouverture, file d'attente, replay, bail, ticket.

Or les trente et quelques bugs recensés dans les docs sont, à trois exceptions près, **tous**
des bugs de cycle de vie de connexion.

Ne sont couverts par aucun test : la reconnexion (aucun client), le replay des souscriptions —
la seule resynchronisation qui existe —, l'`outbox`, la moitié WebSocket du relais,
`issueEngineTicket`/`verifyEngineTicket` (dont le non-rejeu inter-moteur, propriété de sécurité
centrale), `createRegistry` (dont le bail, précisément le bug livré deux fois), `holdEngine`,
et les ~35 branches de dispatch des deux clients. `packages/engine-client` n'a **aucun** test.

Trois accords C++ ↔ TS ne sont vérifiés par rien : la trame binaire (« nothing checks that they
do but a listener, and a disagreement plays as noise »), le choix `broadcast`/`broadcastTo`
pour chaque réponse par session — dont le correctif est une convention de revue —, et
`ProjectDoc` contre ses ~60 `j.value(...)`, où un champ renommé côté TS prend silencieusement
son défaut côté C++. C'est exactement le mode de panne du stub `ClipMoved` : le changelog dit
succès, l'audio ne bouge pas.

## Plan

Ordonné par rapport valeur/risque. Les lots 0 et 1 sont indépendants du reste et livrables
séparément.

### Lot 0 — les saignements ✅ FAIT

**A1.** `patchPrefs` rejoint le client de registre — lecture, fusion, écriture — et les trois
gates y passent, pas seulement z0. `savePrefs` reste, pour qui veut vraiment remplacer, mais le
verbe qui ne peut pas effacer le voisin est désormais celui qu'on prend par défaut : le jour où
l8 ou m9 gagne un second champ, personne n'aura à se souvenir de ces lignes.

**A6.** L'intention coopérative est conservée — k7 et z0 attachent bien leur propre signalisation
à un même serveur — mais elle est maintenant vérifiée : le socket n'est détruit que si ce
gestionnaire est le SEUL écouteur `'upgrade'`, compté à chaque requête et non une fois pour
toutes, parce qu'un service peut ajouter le sien plus tard.

**A9.** Parti avec le lot 2.

**A10.** `release` porte le jeton du moteur, comme `select`. Le refus est **silencieux** et
répond 200 : l'appel arrive par `sendBeacon` d'une page qui s'en va, il n'y a plus personne pour
lire un statut — et un bail non relâché expire de lui-même, ce pour quoi il a été fait.

**Le mode ouvert du service de fichiers.** Le `catch` autour de la lecture de `engine-id.json`
confondait deux choses très différentes : « aucune identité sur cette machine » et « il y en a
une et je n'ai pas su la lire ». La seconde ouvrait toutes les routes. Trois états maintenant,
et une identité illisible fait 503 au lieu de laisser passer. Le service annonce aussi en clair,
au démarrage, quand rien ne garde ses routes — il écoute sur `0.0.0.0`, donc un run ouvert est
ouvert sur tout le réseau local, ce qui vaut une ligne plutôt qu'un état à deviner.

### Lot 1 — la fiabilité des connexions ✅ FAIT

Voir `packages/engine-browser/docs/reliability.md` pour le détail et les raisons. Livré :
l'URL redemandée avant chaque tentative (`EngineUrl`, `engines.linkUrl`), le repli doublé,
plafonné et secoué, la file bornée en taille et en âge, le chien de garde `whoami` sur socket
silencieuse, le document rejoué à l'ouverture, `onConnected` branché dans m9, un budget unique
pour joindre un moteur (`ENGINE_REACH_BUDGET_MS`) partagé entre la sonde et le relais, et les
interfaces fantômes retirées de l'annonce.

Restent de A3–A8 : rien côté navigateur. A5 est couvert pour le document ; l'état de session
(armements, boucle) revient de lui-même dans la trame à 20 Hz.

Deux écarts au plan, tous deux assumés :

- **Le chien de garde sonde par `whoami`, pas par la trame d'état.** Le plan disait de compter
  les trames manquées à 20 Hz. C'est faux pour une surface qui ne pilote aucune session : elle
  n'en reçoit aucune, et le chien de garde fermerait une socket parfaitement saine. `whoami` est
  *engine-global*, donc il répond dans tous les cas. Il ne part d'ailleurs que sur une socket
  silencieuse — un client occupé ne sonde jamais.
- **Pas d'arrêt du repli sur onglet caché.** Le plafond à 30 s et le jitter suffisent à rendre
  un onglet oublié inoffensif, et suspendre la reconnexion en arrière-plan ferait rater à un
  onglet qui revient l'instant où le moteur est redevenu joignable — ce que `useRelook` a déjà
  eu à corriger une fois.

### Lot 2 — `mountEngineRegistry` ✅ FAIT

C1, plus les dérives de A9 qu'il supprime par construction : `ENGINE_BODY_LIMIT`,
`engineErrorHandler` monté par les trois, et un départ propre avec `alsoOnStop` pour ce que l8
a en propre. Voir `packages/engine-registry/docs/shared.md`, « Un registre par service, mais un
seul montage ».

A6 et A10 sont partis avec le lot 0.

### Lot 3 — `@studio/engine-gate`

C2 et C3. Le plus gros lot (~770 lignes vers ~400), et celui qui supprime six divergences
d'un coup. À faire après le lot 1, pour que le paquet naisse avec la bonne sémantique de
reconnexion plutôt que de figer l'actuelle.

### Lot 4 — descendre les formes du fil dans `engine-protocol`

C4, plus le ménage de C5. Le commentaire du code dit déjà quoi faire.

### Lot 5 — les tests de cycle de vie

Un faux moteur et un faux registre en mémoire, puis couvrir : reconnexion, replay,
`outbox`, bail, ticket, relais WebSocket. Plus un test de contrat C++ ↔ TS sur la trame
binaire et sur `PER_SESSION_REPLIES`. C'est le lot qui empêche les trente bugs déjà corrigés
de revenir.

### Lot 6 — le modèle de confiance

Section B. À trancher avant d'écrire quoi que ce soit.

## Corrections de documentation à faire au passage

- `engine-registry/registry.ts:1-5` affirme que le jeton ne quitte jamais le serveur. Faux.
- `engine-browser/docs/access.md` : parle de trois gates (il y en a quatre), présente le
  filtrage sans jeton au passé (trois surfaces le font encore), et son tableau « où brancher
  `useRelook` » omet z0, seul cas où la doc dit qu'il faut *toujours* le brancher.
- `engine-browser/docs/lease.md` présente le bail comme un sujet clos ; z0 n'en prend aucun.
- `engine-browser/docs/streaming.md` dit « quatre apps » pour `./stream` (une seule), et son
  tableau de lecture des mesures décrit une instrumentation qu'aucun écran n'expose.
- `engine-registry/docs/proxy.md:116-118` promet un 502 franc sur corps flué ; le code
  (`proxy.ts:291`) réessaie sur un flux déjà partiellement consommé.
