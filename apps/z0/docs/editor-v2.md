# editor-v2 — l'éditeur qui ouvre un projet

L'éditeur actuel édite **Grist** : il charge l'arbre d'une session par l'API du backend z0 et
réécrit des lignes. Le v2 édite un **dossier `.z0`** dans un dépôt git — la forme décrite dans
[projects.md](projects.md). Ce sont deux sources différentes, donc deux applications, et pas
une bascule dans la même.

Aujourd'hui il **affiche**, et rien d'autre : la liste des fichiers du projet et le texte de
celui qu'on choisit. C'est délibéré. Le format de session est jeune, et la première chose qui
vaut la peine d'exister est de pouvoir regarder ce qu'il y a vraiment sur le disque, avant
qu'un formulaire ne se pose par-dessus et ne commence à le cacher.

## Il n'est pas une surface de jeu

C'est ce qu'il faut savoir en premier, parce que tout le reste en découle. Les six autres SPA
de z0 parlent au backend z0 — invités sans compte sur `bt_session`, état en Grist et SQLite —
même si, depuis [auth.md](auth.md), elles prennent leur connexion de **compte** chez pl8 comme
tout le monde. Le v2, lui, ne parle **jamais** au backend du jeu.

| ce qu'il lui faut | d'où ça vient |
|---|---|
| qui vous êtes | `/auth/*` à la racine de l'origine — pl8 |
| quelles machines existent, laquelle est la vôtre | `/api/engines*` — le registre de pl8 |
| quels dépôts vous avez | `GET /api/projects/by-name/<dépôt>` — pl8 |
| les fichiers du projet | le file service de la machine choisie, en direct |

La raison est qu'aucune de ces quatre questions n'a de réponse côté z0. Le backend du jeu ne
connaît pas les dépôts git du compte, il n'a pas de registre de moteurs — il en a **un**, nommé
par l'environnement pour un rendu hors-ligne — et il ne sait rien d'une copie de travail. Faire
répondre z0 à tout ça aurait voulu dire un deuxième registre et un deuxième login pour un seul
compte.

Ce qui reste vrai : le jeu garde sa porte d'**invité**, celle qui n'a pas de compte derrière.
Un joueur ne se connecte pas ici ; c'est l'auteur du blindtest qui ouvre son dépôt, et c'est
le même compte que pour l8, m9 et la médiathèque.

## Les trois portes, dans l'ordre

Exactement celles de m9, montées depuis `@studio/project-shell`
([launch.md](../../../packages/project-shell/docs/launch.md)) :

1. **connexion** — la session studio ;
2. **la machine** — celle qui tient la copie de travail ; le choix reste sur le compte ;
3. **le projet** — pl8 traduit le nom du dépôt en URI, le file service dit s'il est déjà là,
   le clone avec la progression de git sinon, puis `POST /open` sur le dossier `.z0`.

Aucune n'est réécrite ici : une deuxième façon de répondre à « ce dépôt est-il sur cette
machine » se solde par un clone en double ou par un 404, et c'est précisément ce que le paquet
partagé existe pour empêcher.

## L'adresse

`st0.priv.frediver.se/z0/editor-v2/<dépôt>/<session.z0>` — le vocabulaire d'adresse de
`@studio/web-protocol/projects`, avec un segment de plus que l8 et m9. C'est ce que
`PROJECT_MOUNTS` dit : l8 et m9 **sont** leur service, alors que z0 est sept SPA derrière un
préfixe et une seule d'entre elles ouvre un projet.

Le `basename` du routeur est cette adresse entière, donc rien dans l'app ne peut réécrire le
projet, et un rechargement relit la même chose.

## Ce qu'il a fallu ajouter ailleurs

Deux tables et une phrase, toutes dans `@studio/web-protocol` :

- **`.z0` est un suffixe de projet.** `PROJECT_SUFFIXES` ne connaissait que `.l8` et `.m9`, et
  disait en toutes lettres que z0 ne possédait pas de projets. Désormais pl8 liste les dossiers
  `.z0` d'un dépôt, le file service accepte d'en ouvrir un (`isProjectDir`), et le message qui
  refuse les autres énumère les suffixes au lieu d'en citer deux à la main.
- **`z0` est dans `SERVICE_PATHS`.** Il en était absent *à cause de la session* — le jeu a son
  propre login. Mais cette table dit **où** un service répond, pas quel cookie il porte ; la
  distinction est maintenant écrite là-bas, et `/z0` en fait partie comme les autres.

## À vérifier dans un navigateur

Les suites ici ne montent rien, donc voici ce qu'un test vert ne dit pas :

- ouvrir une session `.z0` depuis la page d'accueil de l8 → l'adresse est
  `/z0/editor-v2/<dépôt>/<session.z0>` et ne bouge plus ;
- recharger → la même session, pas pl8 ;
- ouvrir un dépôt que cette machine n'a jamais vu → la barre de progression de git, puis la
  liste des fichiers ; recommencer → aucun clone ;
- cliquer chaque fichier → le YAML brut, commentaires compris ;
- renommer le dossier `.z0` sur la machine et recharger → l'écran « cette session n'est pas
  dans le dépôt », pas celui du CORS.

## Ce qui vient ensuite

Éditer. Puis remplacer l'éditeur Grist, qui gardera son `/z0/editor` jusque-là : basculer, ce
sera changer `PROJECT_MOUNTS.z0` et les deux `handle` du proxy config.
