# Les partages — pl8 héberge une copie gelée d'un projet

## D'abord : mais [projects.md](projects.md) dit que pl8 ne stocke rien de lourd

C'est vrai, et ça l'est devenu plus encore. La règle qu'il pose est *« pl8 ne fait aucune copie
d'un dépôt »* : la copie qu'on édite, qu'on joue et qu'on committe vit sur la machine du moteur, et
ce service n'en tient plus aucune — il tenait un miroir bare et sans blobs pour répondre « qu'est-ce
qu'il y a dedans », et cette question est celle de la machine désormais.

Un partage n'est pas une copie d'un dépôt, et c'est toute la différence :

|  | ce que pl8 tient d'un dépôt | un partage |
|---|---|---|
| ce que c'est | son NOM et son URI, une entrée de registre | **l'original**, et le seul |
| qui peut le refaire | l'inscrire à nouveau coûte un collage | personne — le rendu a eu lieu une fois |
| ce qu'on y écrit | rien | rien non plus : il est gelé à la seconde où il arrive |
| quand ça part | quand on retire le dépôt de sa liste | quand son auteur le retire, et jamais avant |

Un partage est **du contenu publié**, exactement comme une release k7 ou un morceau de la
médiathèque — deux choses que ce service héberge déjà et dont il est déjà la seule copie. Ce que
`projects.md` refuse, c'est que pl8 devienne **écrivain des dépôts de tout le monde** : *« un
changement de posture de sécurité, pas une fonctionnalité »*. Servir des octets figés que
quelqu'un lui a envoyés ne touche à rien de ça — pl8 ne pousse toujours dans aucun dépôt, ne
détient toujours aucune copie de travail, et un partage effacé ne fait perdre que lui-même : le
projet, lui, est intact sur la machine qui l'a rendu.

Le prix réel n'est donc pas la posture, c'est **la place** — et il est mesuré plus bas.

## Ce qu'un partage est

Une version **gelée** d'un projet, sans moteur derrière. Tout ce qui s'entend a été rendu à
l'avance : le mixdown, plus un fichier par piste audible. Le visiteur ouvre st0 en lecture seule,
écoute, regarde les chaînes et les paramètres des modules, et ne peut rien casser parce qu'il n'y
a rien à casser — aucun processus n'attend derrière pour exécuter quoi que ce soit.

Comment le paquet est fabriqué et pourquoi il contient ce qu'il contient est écrit en face, dans
[`packages/commands/docs/shareBundle.md`](../../../packages/commands/docs/shareBundle.md). Cette
page-ci ne parle que de ce que pl8 en fait.

## Deux identifiants, et un seul touche un chemin

```
token = randomBytes(32).base64url     43 caractères, le secret dans le lien
key   = sha256(token)                 64 caractères hexadécimaux, le nom du dossier
```

Le token n'est **jamais** un segment de chemin. Un segment de chemin finit dans chaque journal
d'accès, chaque `Referer`, chaque message d'erreur d'un proxy — et le lien EST la totalité de la
protection. La clé, elle, ne sert à rien à qui ne l'a pas obtenue en hachant un token qu'il
possédait déjà.

Le bénéfice secondaire est de la performance : un mauvais token nomme un dossier qui n'existe
pas, donc la comparaison est un `ENOENT`, en O(1), sans index à charger. Ça compte parce que
c'est le chemin de **chaque requête Range** qu'un `<audio>` émet en cherchant dans un morceau.

`isKey` (`/^[0-9a-f]{64}$/`) est vérifié **avant** toute jonction. `safePath` reste le second mur
et pas le premier : il confine à la racine de la médiathèque, donc `../../songs/private.wav`
depuis `.shares/` le passerait sans broncher.

## Où ça vit

```
<médiathèque>/.shares/
  index/<sub>.json          la liste d'une personne — un fichier par sujet OIDC
  blobs/<key>/
    pending.json            présent = le brouillon n'est pas fini, donc rien ne répond
    snapshot.json           le manifeste — présent = le lien est vivant
    project-doc.json  graph.json  surfaces.json
    audio/mix.wav  audio/s0.mp3 …
```

Un **dossier en point**, gratuitement invisible : `writablePath` refuse tout segment commençant
par `.` et `revision.ts` ne les parcourt pas, donc `.shares/` n'apparaît dans aucune API fichier
et dans aucun balayage de famille. `.prefs`, `.projects`, `.hunts` et `.cache` vivent là pour la
même raison.

L'index est un petit JSON par personne, nommé par `fileFor(sub)` — exactement l'arrangement des
préférences et des dépôts, et pour les mêmes raisons : il n'y a pas de base de données ici, et
il n'en faut pas une pour une liste que son propriétaire est seul à lire.

**Les écritures de l'index lèvent**, là où les lectures ne lèvent jamais. Une lecture qui échoue
veut dire « aucun partage », qui est un état réel. Une écriture qui échoue en silence veut dire
un lien que son auteur s'apprête à distribuer et que ce service ne saura **pas révoquer** : les
octets sont publics et le seul registre qui les connaissait vient de ne pas s'écrire.

## Les routes, et la barrière

`apps/pl8/backend/src/server.ts` monte, à la ligne 115 :

```ts
app.use("/api", requireAuth, preferencesRouter(…));
```

Tout ce qui est monté sous `/api` **après** cette ligne hérite de la garde, silencieusement.
`packages/engine-registry/mount.ts` documente déjà exactement ce piège. Les deux routeurs des
partages sont donc montés **avant**, et gardés chacun explicitement :

| route | garde |
|---|---|
| `POST /api/shares` (brouillon), `PUT /:key/file`, `POST /:key/finish` | `bearerOrSession(requireAuth)` |
| `GET /api/shares`, `GET /revision`, `DELETE /:key` | la même — session en pratique |
| `GET /api/public/share/:key/*` | **aucune** |

Le sens de la panne est heureusement le bon : un partage mal monté devient *inaccessible*, pas
*public*. C'est écrit et testé — `routes/shares.test.ts` monte les routeurs **comme `server.ts`
les monte**, barrière comprise et à sa vraie place. C'est le seul test qui attrapera le jour où
quelqu'un réordonnera les `app.use`.

Le mot `public` **dans le chemin** est un commentaire qui survit à un refactor, et qu'on ne
confond pas avec `/api/shares` à un caractère près.

Et tout est sous `/api/` parce que nginx ne proxifie que `^/(api|auth)/` : le reste est
`try_files $uri /index.html`. Il n'y a pas de « hors de `/api` » sans toucher au proxy. Cette
`location` porte déjà `proxy_buffering off` et `client_max_body_size 512m` — **aucun changement
nginx des deux côtés**.

### Les `..` nus se testent en unitaire, pas en HTTP

`routes/shares.test.ts` exerce le garde `isKey` **directement** sur `..`, `../..`, `%2E%2E`… et
c'est à savoir plutôt qu'à redécouvrir : un client conforme ne peut pas envoyer ces cas. `fetch`
résout `/api/public/share/../manifest` en `/api/public/manifest` avant qu'un octet ne parte, et
fait la même chose de `%2E%2E` — undici décode l'échappement d'abord. Le mur est donc réel, une
socket brute peut encore le viser, et l'appel direct est le seul endroit où on peut l'éprouver.

### Le routeur public finit par un 404 terminal

Express retombe sur la suite quand rien ne matche. Sans ce 404, une clé inconnue traverserait
jusqu'à `requireAuth` et répondrait **401** — « ça existe mais pas pour vous » à propos de
quelque chose qui n'existe pas, ce qui est à la fois faux et une fuite.

Le reste de sa posture tient en trois en-têtes : `X-Robots-Tag: noindex, nofollow` partout
(un lien secret n'a rien à faire dans un index), `Referrer-Policy: no-referrer` (le token est
dans l'adresse, donc il ne doit pas voyager en `Referer` vers ce que la page charge),
`no-store` sur le manifeste — la révocation doit se sentir au chargement suivant — et
`immutable` sur les octets, puisqu'un instantané ne change pas, par définition.

Le manifeste est aussi la **liste blanche** : `/doc/:name` et `/audio/:file` ne cherchent pas un
fichier, ils cherchent un nom **dans le manifeste** et servent ce qu'il désigne. Aucune requête
n'atteint jamais un chemin qu'elle a composé.

L'extension y est **facultative**, et c'est ce qui permet au lecteur d'être st0 tel quel : `fget`
demande `/project-doc` parce que c'est la route du service de fichiers, et l'instantané appelle les
mêmes octets `project-doc.json` parce qu'un fichier a besoin d'un nom. Accepter les deux
orthographes ici tient en un `||` ; apprendre à l'un des deux côtés l'existence de l'autre aurait
été un cas particulier dans le seul endroit — le transport — qui doit rester ignorant de qui
répond.

## L'envoi est en trois temps

pl8 ne fait pas de multipart : `PUT /api/mediatek/file`, `POST /song`, `POST /recording` sont
tous `express.raw({type:"*/*", limit:"512mb"})` — *un master de 400 Mo n'a rien à faire dans un
parse de formulaire* — et l'`express.json` global est à 8 Mo. D'où :

1. **brouillon** — `POST /api/shares`, le manifeste en JSON. Frappe le jeton, mint le secret,
   crée le dossier, écrit `pending.json` avec la liste de ce qui est attendu ;
2. **un `PUT` brut par fichier**, dont le `?path=` est **apparié** à cette liste, jamais
   assaini : le brouillon a dit ce qu'il enverrait, et tout le reste ne fait pas partie de cet
   instantané ;
3. **`finish`** — écrit `snapshot.json`, efface `pending.json`, et **remesure les tailles sur le
   disque** au lieu de croire le brouillon. Ce que le lien sert est ce qui est arrivé.

C'est `finish`, et lui seul, qui rend le lien vivant : un envoi interrompu n'est donc jamais
atteignable, et un `pending.json` qui traîne est du ménage, pas une fuite.

Le jeton est celui de la **machine** (`service:st0`, celui que `npm run tokens` écrit déjà pour la
récupération des bibliothèques). Un jeton de service n'a pas de personne à lui, donc **chacun**
des trois appels nomme la sienne avec `?user=` — c'est le même marché que
[`sshKeyForService.md`](sshKeyForService.md) documente : qui détient le jeton d'une machine peut
agir pour quiconque est dessus.

## Révoquer

Dans st0, sur sa page d'accueil, **à la rangée du projet dont il sort** : un bouton « Partages »
qui ouvre la popin de ce projet-là (`apps/st0/frontend/src/projects/ProjectShares.tsx`, le
découpage étant `sharesForProject.ts`). Les deux bouts d'un partage sont donc st0
maintenant : c'est lui qui rend le paquet et l'envoie ici, et lui qui le retire. Ça a vécu dans
la section Projets de ce service tant que cette section existait ; ce qui reste ici est ce que
cette page décrit — les octets, l'index, les routes.

**Les octets partent d'abord, l'index est marqué ensuite.** Cet ordre est tout : effacer le
dossier est ce qui tue un lien qui a fuité, et ça ne doit dépendre d'aucune écriture qui suit.
Idempotent, parce qu'un second clic n'est pas une erreur.

**La ligne survit, datée.** Un partage qui disparaîtrait de la liste laisserait son auteur se
demander s'il a jamais existé — et les tailles restent lisibles. Le token, lui, est **effacé du
registre** : une ligne révoquée ne peut pas être recopiée depuis l'écran où elle est encore
dessinée.

Ce que la confirmation dit nomme les deux choses qui surprennent : les octets s'en vont tout de
suite et pour de bon, et **un lien déjà envoyé ne se dé-envoie pas** — il répondra « introuvable »
à tous ceux qui l'ont, ce qui est le but, mais republier donnera un lien *nouveau*.

L'adresse est dessinée comme un **lien** et pas comme un bouton : c'est ce qu'on a envoyé aux
autres, et la seule façon de vérifier ce qu'ils voient est de l'ouvrir. `rel="noopener
noreferrer"`, la page d'en face étant publique.

## Le risque qui n'a pas de plafond

Un paquet construit sur un vrai morceau — douze pistes, `01.danse.st0` — pesait **484 Mo** en wav.
Sans expiration, sur le volume qui porte aussi la médiathèque de tout le monde. La panne, à ce
compte-là, n'est pas « le partage ne marche plus » : c'est « le studio passe en lecture seule ».

Tranché par la mesure : **les stems sont en mp3**, le mixdown reste en wav parce que c'est le
seul fichier qu'on télécharge. Environ trente fois plus petit, et un téléphone cesse de
rapatrier 37 Mo pour démuter une piste.

Deux parades ne sont **pas** prises, et c'est délibéré :

- **le total est affiché** en tête de la carte — le coût se voit sans que rien ne soit interdit,
  et c'est la seule chose qui peut faire décider d'en retirer un, puisqu'aucun ne s'en ira seul ;
- **il n'y a pas de quota par auteur.** Ça reste la parade à prendre si ça déborde, et elle
  appartient au **brouillon** : apprendre un 507 au 400ᵉ mégaoctet est le pire endroit possible
  pour l'apprendre.

## Ce qui n'a pas pu être vérifié ici

Le streaming public de vrais fichiers audio derrière le proxy. `proxy_buffering off` est déjà
posé pour la médiathèque, mais un lien partagé est le premier usage **non authentifié** de ce
chemin, et ça se mesure en déployant.
