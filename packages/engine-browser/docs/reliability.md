# Tenir un lien, pas seulement l'ouvrir

Ce que `EngineClient` fait entre le moment où la socket s'ouvre et celui où elle se referme
pour de bon. Presque tous les bugs de ce domaine sont des bugs de cycle de vie — jamais de
protocole (`docs/audit-moteur.md`).

## Le ticket périme, l'adresse pas

L'URL n'est pas une chaîne figée au constructeur mais un `EngineUrl` : une fonction, rappelée
**avant chaque tentative**.

C'est le mode de panne le plus coûteux du domaine. Depuis toute machine autre que celle du
moteur, la seule voie praticable est le relais — une page HTTPS n'ouvre pas un `ws://` vers une
adresse LAN — et l'URL relayée porte un ticket qui vit **une minute**
(`engine-registry/proxy.ts`). Gelée à la construction, toute reconnexion survenant plus d'une
minute après la mesure rejoue un ticket mort, reçoit un 401, et recommence. Indéfiniment, sans
que rien ne redemande la liste. Le chemin nominal, donc, pas un cas limite.

`engines.linkUrl(chosen)` est ce qu'on passe : il rend l'adresse **déjà mesurée** au premier
appel — le gate vient de payer ce round-trip, le refaire serait gratuit en latence et cher en
sockets — puis une adresse fraîche à chaque suivant. Une fonction, pour qu'aucune surface ne
puisse en réussir seulement la moitié.

Rendre `null` veut dire « aucun moteur à joindre pour l'instant » : le client patiente et
redemande, au lieu de compter ça comme un échec de connexion.

## Une socket ouverte qui ne porte rien

Il n'y a de ping nulle part dans ce protocole, ni en dessous : le serveur du moteur embarque
IXWebSocket avec `kPingIntervalSeconds(-1)` — heartbeat désactivé. Un relais figé, un NAT
expiré, un portable qui sort de veille laissent donc une socket qui se déclare `OPEN` et ne
transporte plus rien : `close` ne part jamais, la reconnexion ne se déclenche jamais, et
`send()` écrit dans le vide. D'où un chien de garde côté navigateur.

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

Un repli fixe d'une seconde fait qu'un onglet oublié en arrière-plan sur une machine dont le
moteur est éteint frappe le relais une fois par seconde tant que l'onglet vit — et chaque coup
coûte au backend une composition **séquentielle** de toutes les adresses annoncées. C'est le
même motif que `pruneIdleLinks` dans le service de fichiers.

D'où : doublement depuis `ENGINE_RECONNECT_MIN_MS`, plafonné à `ENGINE_RECONNECT_MAX_MS`,
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

Sans limite de taille ni d'âge, l'`outbox` accumulerait tout ce que la surface a envoyé pendant
une coupure de dix minutes, et le tout partirait **d'un bloc** à la reconnexion, verbes de
transport périmés compris.

Elle est donc bornée par `ENGINE_OUTBOX_MAX` (le plus ancien sort — la commande la plus
récente est celle qui décrit encore ce que la personne veut) et par `ENGINE_OUTBOX_TTL_MS` au
rejeu : une commande que plus personne n'attend ne vaut pas la peine d'être envoyée.

`sendNow()` est pour ce qui ne vaut que sur CETTE socket — le `whoami` du chien de garde, le
document rejoué ci-dessous : les mettre en file n'aurait aucun sens.

## Le document, rejoué

Les souscriptions (`watch-plugin-params`, `subscribe-waveform`, `broadcast`) vivent dans le
moteur et sont rejouées à chaque ouverture. Le **document** aussi, et c'est la moitié facile à
oublier.

Ça se voit mal et ça coûte cher : si le moteur redémarre, il revient vide, et la surface
continue de le piloter. Le seul symptôme est « le moteur ignore Play », sans une ligne de
journal pour le relier à une connexion qui a cligné.

`sendProject` retient donc son document, et l'ouverture le renvoie **en premier** — avant les
souscriptions et avant la file, puisque les unes et l'autre parlent d'un document que le moteur
n'a pas encore. C'est bon marché : `EngineHost::apply` diffe contre une baseline qui survit à
la coupure, donc un renvoi rend un diff correct plutôt qu'un rechargement complet.

Le `hello` qui précède tout ça porte `role: "driver"`, et c'est un champ plutôt qu'un verbe à
part exprès : le moteur compte ses pilotes par session et libère un projet dont le dernier est
parti, donc une reconnexion qui ne se redéclarerait pas ferait lâcher au moteur le document
même que la ligne suivante s'apprête à rejouer. En faire un champ de `hello`, c'est le rendre
impossible à oublier — toute connexion en envoie un.

### Qui appelle `sendProject`, et ce qui n'est pas plié

st0 ne l'appelle jamais : ses documents sont **compilés** depuis un dossier de YAML, ce que fait
le service de fichiers, donc son navigateur ne pilote que le transport. Une app qui construit
elle-même son document (un aperçu de module, une platine) n'a rien à compiler et aucune raison
de passer par un second processus pour atteindre une socket qu'elle tient déjà.

Le document part **tel quel**. Le client Node, lui, replie les groupes sur leurs membres et
retire la vidéo avant d'envoyer ; un document issu de `@studio/engine-protocol/build` n'a ni
l'un ni l'autre, donc les deux replis y sont l'identité. Repliez avant d'appeler si le vôtre
peut en avoir.

## Le fil d'activité

`BeginActivity` marque une tranche de travail et rend son callback de fin. Le moteur pousse son
état à la cadence de l'image et les paramètres à 20 Hz : un gestionnaire devenu lent est donc
invisible dans un profil pris après coup, et évident dans un rapport de blocage. Savoir si
quelqu'un regarde est l'affaire de l'hôte, pas de ce client — d'où le défaut qui ne fait rien.

## Un seul budget pour joindre un moteur

`ENGINE_REACH_BUDGET_MS` et `ENGINE_DIAL_TIMEOUT_MS` vivent dans `@studio/web-protocol` parce
que les deux moitiés doivent s'accorder.

Le navigateur mesure ses candidats **en parallèle** : il dépense le budget une fois. Le relais
les compose **en séquence** ; le dépenser *par adresse* ferait qu'une machine annonçant deux
interfaces mortes (un VPN, un pont Docker) demande trois fois la patience du navigateur et est
déclarée injoignable pendant que le moteur répond tranquillement sur loopback. Les deux
s'arrêtent donc au même mur, et une première adresse morte ne peut en manger
qu'`ENGINE_DIAL_TIMEOUT_MS`.

L'autre bout du même problème est dans `engine-host/src/addresses.ts` : les interfaces
fantômes — VPN, conteneurs, WSL, Hyper-V — ne sont pas annoncées du tout. Elles ne sont pas
`internal`, donc un filtre sur ce seul critère les laisse passer, et elles portent des adresses
privées parfaitement ordinaires ; seul leur **nom** les distingue.
