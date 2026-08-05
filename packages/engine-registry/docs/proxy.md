# Le relais — joindre un moteur que le navigateur n'a pas le droit d'appeler

Le moteur écoute en clair, sur `ws://<machine>:8765`. Les pages du studio sont servies en
HTTPS. Ces deux phrases ne tiennent pas ensemble, et c'est tout le sujet de cette page.

## Le mur

Une page HTTPS ne peut pas ouvrir un `ws://` ni un `fetch("http://…")` : le navigateur le
refuse comme **contenu mixte**, avant toute requête réseau. La seule exception est la
loopback, réputée sûre. Conséquence exacte :

| depuis | `ws://127.0.0.1:8765` | `ws://192.168.x.y:8765` |
|---|---|---|
| la machine du moteur | autorisé, et c'est le moteur | autorisé mais inutile |
| une autre machine du LAN | autorisé, et ce n'est **pas** le moteur | **bloqué** |

D'où un symptôme qui envoie chercher au mauvais endroit : sur la machine distante, la seule
adresse qui produise une vraie tentative réseau est la loopback — qui tape la machine
distante elle-même. Le blocage de l'adresse LAN, lui, n'apparaît pas dans l'onglet Réseau,
seulement en console. On croit donc lire « le client insiste sur localhost » là où il faut
lire « l'adresse LAN a été refusée avant de partir ».

Ce mur est **indépendant du réseau**. Sur l'installation qui a motivé cette page, tout le
reste était vert : moteur en écoute sur `0.0.0.0:8765`, règles de pare-feu Windows en
`Allow` pour le binaire exact, `nc -vz <ip> 8765` réussi depuis le Mac distant. Vérifier le
réseau ne prouve rien ici — il faut lire la console.

macOS ajoute un second mur au même endroit : depuis macOS 15, un navigateur doit avoir
l'autorisation « Réseau local » pour joindre une adresse privée. Le succès d'un `nc` depuis
le Terminal ne dit rien du navigateur, chaque application ayant la sienne.

## La sortie

Le navigateur ne compose plus d'adresse LAN du tout. Il ouvre un `wss://` vers **l'origine
qu'il a déjà chargée**, et c'est le backend qui compose vers le moteur :

```
navigateur ──wss://studio.test/l8/api/engine/<id>/ws──▶ backend l8 ──ws://127.0.0.1:8765──▶ moteur
```

Le backend n'est pas un contexte sécurisé : il appelle qui il veut. Il essaie la loopback
puis chaque adresse LAN, dans l'ordre (`hostsFor`), séquentiellement — la liste fait deux ou
trois entrées, la loopback gagne dès que le backend partage la machine du moteur, et une
course laisserait des sockets à demi ouverts contre un processus audio.

Ni contenu mixte, ni permission réseau local, ni port à ouvrir dans un pare-feu.

## Les deux moitiés

Elles ont des contraintes différentes, donc deux formes :

- **`engineFilesProxy`** — une route Express ordinaire, montée sur
  `/engine/:id/files` (`router.ts`). Une requête simple traverse la chaîne de
  middlewares, donc le cookie de session la garde déjà.
- **`attachEngineProxy`** — attachée au **serveur HTTP**, pas montée comme route : un
  `upgrade` WebSocket ne traverse jamais la chaîne de middlewares d'Express. C'est aussi
  pourquoi le cookie ne peut pas la garder, et pourquoi il existe un **ticket**.

Chaque service appelle `attachEngineProxy(server, registry)` après son `app.listen` — les
trois, car chacun tient sa propre instance de registre (voir [shared.md](shared.md)).

## Le ticket

`/engines` frappe un ticket par moteur, en même temps qu'il renvoie la liste : cette route
est déjà l'authentifiée, et elle renvoie déjà tous les moteurs. Un ticket demandé par moteur
aurait coûté un aller-retour par moteur, avant même d'en avoir mesuré un seul.

Il vit une minute, signé HMAC par un secret tiré au démarrage du **processus qui le
vérifie** : rien à partager entre machines, aucun secret à câbler dans trois backends. Un
redémarrage invalide ceux qui circulent, ce qui coûte au navigateur un rechargement d'une
liste qu'il interroge de toute façon en boucle.

L'`id` du moteur est **dans le chemin**, et le ticket est vérifié contre lui : un ticket ne
peut pas être rejoué contre un autre moteur. Et la cible vient toujours du **registre**,
jamais de la requête — un `?host=&port=` aurait fait de chaque backend un relais ouvert vers
tout ce qu'il peut joindre.

## Ce que la sonde en fait

`candidatesFor` (`packages/engine-browser/src/probe.ts`) construit la loopback, chaque
adresse LAN, puis le relais. L'ordre n'est que documentaire : `rank` les lance **toutes en
parallèle** et garde la plus rapide. Le relais paie un saut de plus, donc il perd tout seul
partout où le lien direct est permis — sur la machine du moteur, la loopback gagne, comme
avant.

Le `fileBase` voyage avec l'adresse qui a répondu, et c'est important : un socket relayé à
côté d'un `http://` direct vers le service de fichiers, ce serait le mur une seconde fois,
sur l'autre moitié.

## Le corps qu'un parseur a déjà pris

`engineFilesProxy` est une route Express, donc elle hérite de tout ce que le service a monté
devant elle — et les trois montent `express.json()` pour l'application entière, avant le
routeur. Quand le relais est atteint, le flux de la requête est **déjà à sa fin** : un
`req.pipe(up)` appelle `end()` immédiatement et l'amont reçoit le `content-length` d'origine
avec zéro octet derrière.

Le service de fichiers attend alors des octets qui ne viendront jamais, le `timeout` du dial
tombe au bout de 1500 ms, l'adresse suivante fait pareil, et le relais répond
`502 engine file service unreachable` — un message qui accuse le réseau alors que le relais
s'est saboté lui-même. Les `GET` passaient, donc le moteur se choisissait, se mesurait et se
connectait ; c'est le premier `POST /open` qui échouait, et `diagnoseFileService` traduisait ça
en « origine bloquée, autorisez-la dans le capot ». Trois écrans de diagnostic, aucun ne
nommant la cause.

Le relais **rejoue** donc ce que le parseur a pris (`replayBody`) plutôt que de supposer un flux
intact, et recalcule le `content-length` : les octets re-sérialisés ne sont pas les octets
reçus. Il pouvait aussi bien s'écrire « ne montez pas de parseur devant » — mais une règle
d'ordre de montage que trois backends doivent respecter est exactement ce qui vient de casser,
et rien ne l'aurait rattrapée. `proxy.test.ts` monte `express.json()` devant le relais, comme
eux.

Deux conséquences de bord, dans le même geste :

- Un corps **flué** (`application/octet-stream`, le seul que `express.json` ne touche pas) ne
  peut pas être rejoué sur l'adresse suivante : le flux est dépensé. Ce cas répond 502 au lieu
  de réessayer en silence avec un corps vide.
- Le `timeout` de 1500 ms est celui du **dial**, pas du téléchargement. C'est une inactivité de
  socket, donc le laisser courir détruisait un export de mixdown ou un `/media` lent en plein
  vol ; il est désarmé dès que la réponse commence.

## Le premier message est mis en attente

Le navigateur envoie `whoami` à l'instant où le socket s'ouvre — or à cet instant le socket
*amont* est encore en train d'être composé. Le relais retient donc ce qui arrive avant, et le
rejoue une fois l'amont ouvert. Le perdre ferait expirer chaque sonde : le relais serait
« joignable » et ne répondrait rien, ce qui est pire qu'injoignable.
