# Tenir un lien, pas seulement l'ouvrir

Ce que `EngineClient` fait entre le moment où la socket s'ouvre et celui où elle se referme
pour de bon. Écrit après l'audit (`docs/audit-moteur.md`), qui a montré que presque tous les
bugs de ce domaine sont des bugs de cycle de vie — jamais de protocole.

## Le ticket périme, l'adresse pas

L'URL n'est plus une chaîne figée au constructeur mais un `EngineUrl` : une fonction, rappelée
**avant chaque tentative**.

C'est le correctif du mode de panne le plus coûteux qu'on ait eu. Depuis toute machine autre
que celle du moteur, la seule voie praticable est le relais — une page HTTPS n'ouvre pas un
`ws://` vers une adresse LAN — et l'URL relayée porte un ticket qui vit **une minute**
(`engine-registry/proxy.ts`). Gelée à la construction, chaque reconnexion survenant plus d'une
minute après la mesure rejouait un ticket mort, recevait un 401, et recommençait. Indéfiniment,
sans que rien ne redemande la liste. Le chemin nominal, donc, pas un cas limite.

`engines.linkUrl(chosen)` est ce qu'on passe : il rend l'adresse **déjà mesurée** au premier
appel — le gate vient de payer ce round-trip, le refaire serait gratuit en latence et cher en
sockets — puis une adresse fraîche à chaque suivant. Une fonction, pour que les trois surfaces
ne puissent pas en réussir chacune une moitié.

Rendre `null` veut dire « aucun moteur à joindre pour l'instant » : le client patiente et
redemande, au lieu de compter ça comme un échec de connexion.

## Une socket ouverte qui ne porte rien

Il n'y a de ping nulle part dans ce protocole, ni en dessous : le serveur du moteur embarque
IXWebSocket avec `kPingIntervalSeconds(-1)` — heartbeat désactivé — et rien côté navigateur
n'en tenait lieu. Un relais figé, un NAT expiré, un portable qui sort de veille laissent donc
une socket qui se déclare `OPEN` et ne transporte plus rien : `close` ne part jamais, la
reconnexion ne se déclenche jamais, et `send()` écrit dans le vide.

Le garde-fou est asymétrique, exprès :

- **Tout ce qui arrive** compte comme preuve de vie. Le moteur pousse son état ~20 fois par
  seconde, donc un client occupé ne sonde jamais — le coût est nul dans le cas courant.
- **Rien pendant `ENGINE_IDLE_PING_MS`** et on envoie `whoami`. C'est le seul verbe que le
  moteur répond quel que soit son état, et il est *engine-global* : il revient même à un client
  qui ne pilote aucune session, ce qu'un chien de garde posé sur la trame d'état seule ne
  couvrirait pas.
- **Pas de réponse dans `ENGINE_PONG_TIMEOUT_MS`** et la socket est morte quoi qu'elle en dise.
  On la ferme nous-mêmes plutôt que d'attendre un `close` qui ne viendra pas.

## Le repli, et pourquoi il double

C'était une seconde, fixe, pour toujours. Un onglet oublié en arrière-plan sur une machine dont
le moteur est éteint frappait donc le relais une fois par seconde tant que l'onglet vivait — et
chaque coup coûte au backend une composition **séquentielle** de toutes les adresses annoncées.
Le même motif avait déjà été corrigé dans le service de fichiers (`pruneIdleLinks`) et laissé
intact ici.

Maintenant : doublement depuis `ENGINE_RECONNECT_MIN_MS`, plafonné à `ENGINE_RECONNECT_MAX_MS`,
et **secoué** — la moitié de l'intervalle est tirée au hasard. Le jitter est pour l'autre
moitié du problème : plusieurs onglets lâchés par un même redémarrage du relais reviendraient
sinon en rang serré. Le compteur repart à zéro sur une socket qui s'est réellement ouverte.

### La génération

Chaque `connect()` incrémente un compteur, et les gestionnaires d'une socket ne font rien une
fois qu'il a bougé. C'est ce qui rend le second avis inoffensif : le chien de garde et
l'événement `close` peuvent parler de la même socket, et sans ce garde-fou le second
programmerait une **deuxième** échelle de repli à côté de la première. Deux échelles qui
doublent chacune, c'est ainsi qu'un réessai discret devient une inondation.

## La file d'attente couvre un clignement, et rien de plus

L'`outbox` retenait tout, sans limite ni de taille ni d'âge. Une coupure de dix minutes
accumulait donc tout ce que la surface avait envoyé, et le tout partait **d'un bloc** à la
reconnexion, verbes de transport périmés compris.

Elle est maintenant bornée par `ENGINE_OUTBOX_MAX` (le plus ancien sort — la commande la plus
récente est celle qui décrit encore ce que la personne veut) et par `ENGINE_OUTBOX_TTL_MS` au
rejeu : une commande que plus personne n'attend ne vaut pas la peine d'être envoyée.

`sendNow()` est pour ce qui ne vaut que sur CETTE socket — le `whoami` du chien de garde, le
document rejoué ci-dessous : les mettre en file n'aurait aucun sens.

## Le document, rejoué

Les souscriptions (`watch-plugin-params`, `subscribe-waveform`, `broadcast`) vivent dans le
moteur et étaient déjà rejouées à chaque ouverture. Le **document** ne l'était nulle part, sur
aucune surface.

Ça se voyait mal et ça coûtait cher : si le moteur redémarre, il revient vide, et la surface
continue de le piloter. Le seul symptôme est « le moteur ignore Play », sans une ligne de
journal pour le relier à une connexion qui a cligné.

`sendProject` retient donc son document, et l'ouverture le renvoie **en premier** — avant les
souscriptions et avant la file, puisque les unes et l'autre parlent d'un document que le moteur
n'a pas encore. C'est bon marché : `EngineHost::apply` diffe contre une baseline qui survit à
la coupure, donc un renvoi rend un diff correct plutôt qu'un rechargement complet.

## Un seul budget pour joindre un moteur

`ENGINE_REACH_BUDGET_MS` et `ENGINE_DIAL_TIMEOUT_MS` vivent dans `@studio/web-protocol` parce
que les deux moitiés doivent s'accorder.

Le navigateur mesure ses candidats **en parallèle** : il dépense le budget une fois. Le relais
les compose **en séquence**, et le dépensait donc *par adresse* — une machine annonçant deux
interfaces mortes (un VPN, un pont Docker) demandait trois fois la patience du navigateur et
était déclarée injoignable pendant que le moteur répondait tranquillement sur loopback. Les
deux s'arrêtent maintenant au même mur, et une première adresse morte ne peut en manger
qu'`ENGINE_DIAL_TIMEOUT_MS`.

L'autre bout du même problème est dans `engine-host/src/addresses.ts` : les interfaces
fantômes — VPN, conteneurs, WSL, Hyper-V — ne sont plus annoncées du tout. Elles ne sont pas
`internal`, donc le filtre existant les laissait passer, et elles portent des adresses privées
parfaitement ordinaires ; seul leur **nom** les distingue.
