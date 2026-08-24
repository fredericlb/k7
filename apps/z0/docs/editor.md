# editor — l'éditeur qui ouvre un projet

Il édite un **dossier `.z0`** dans un dépôt git — la forme décrite dans
[projects.md](projects.md). C'est le seul éditeur de z0 : il répond à `/z0/editor`, sur le
port 3006.

Il ÉDITE l'ordre des manches, les morceaux de chaque catégorie, et surtout le début et la fin
de chaque extrait, à l'oreille et sur une forme d'onde. La règle qui commande tout ça — on
modifie le document YAML, jamais les valeurs qu'on en a tirées, pour qu'un diff reste lisible —
est dans [editing.md](editing.md).

Le texte brut reste à portée : le bouton **YAML** montre le fichier tel qu'il sera écrit. Le
format est jeune, et pouvoir regarder ce qui est vraiment sur le disque reste la première chose
qui vaut la peine d'exister.

Le chargeur Grist du **backend** (`backend/src/grist/`) alimente les manches du jeu, et n'a
rien à voir avec cet écran : celui-ci ne parle jamais à ce backend.

## Il n'est pas une surface de jeu

C'est ce qu'il faut savoir en premier, parce que tout le reste en découle. Les cinq autres SPA
de z0 parlent au backend z0 — invités sans compte sur `bt_session`, état en Grist et SQLite —
et prennent leur connexion de **compte** à la racine de l'origine comme tout le monde
([auth.md](auth.md)). Celle-ci, elle, ne parle **jamais** au backend du jeu.

| ce qu'il lui faut | d'où ça vient |
|---|---|
| qui vous êtes | `/auth/*` à la racine de l'origine — st0 |
| quelles machines existent, laquelle est la vôtre | `/api/engines*` — le registre de pl8 |
| quels dépôts vous avez | `GET /api/projects/by-name/<dépôt>` — pl8 |
| les fichiers du projet | le file service de la machine choisie, en direct |

La raison est qu'aucune de ces quatre questions n'a de réponse côté z0. Le backend du jeu ne
connaît pas les dépôts git du compte, il n'a pas de registre de moteurs — il en a **un**, nommé
par l'environnement pour un rendu hors-ligne — et il ne sait rien d'une copie de travail. Faire
répondre z0 à tout ça aurait voulu dire un deuxième registre et un deuxième login pour un seul
compte.

Le jeu garde sa porte d'**invité**, celle qui n'a pas de compte derrière. Un joueur ne se
connecte pas ici ; c'est l'auteur du blindtest qui ouvre son dépôt, et c'est le même compte
que pour st0 et la médiathèque.

## Les trois portes, dans l'ordre

Exactement celles de st0, montées depuis `@studio/project-shell`
([launch.md](../../../packages/project-shell/docs/launch.md)) :

1. **connexion** — la session studio ;
2. **la machine** — celle qui tient la copie de travail ; le choix reste sur le compte ;
3. **le projet** — pl8 traduit le nom du dépôt en URI, le file service dit s'il est déjà là,
   le clone avec la progression de git sinon, puis `POST /open` sur le dossier `.z0`.

Aucune n'est réécrite ici : une deuxième façon de répondre à « ce dépôt est-il sur cette
machine » se solde par un clone en double ou par un 404, et c'est précisément ce que le paquet
partagé existe pour empêcher.

## L'adresse

`st0.priv.frediver.se/z0/editor/<dépôt>/<session.z0>` — le vocabulaire d'adresse de
`@studio/web-protocol/projects`, avec un segment de plus que st0. C'est ce que
`PROJECT_MOUNTS` dit : st0 **est** son service, alors que z0 est six SPA derrière un
préfixe et une seule d'entre elles ouvre un projet.

Le `basename` du routeur est cette adresse entière, donc rien dans l'app ne peut réécrire le
projet, et un rechargement relit la même chose.

## Ce que le vocabulaire partagé porte pour lui

Deux tables de `@studio/web-protocol` :

- **`.z0` est un suffixe de projet.** `PROJECT_SUFFIXES` le déclare : pl8 liste les dossiers
  `.z0` d'un dépôt, le file service accepte d'en ouvrir un (`isProjectDir`), et le message qui
  refuse les autres énumère les suffixes au lieu d'en citer deux à la main.
- **`z0` est dans `SERVICE_PATHS`.** Cette table dit **où** un service répond, pas quel cookie
  il porte — le jeu a sa propre porte d'invité, et `/z0` figure là comme les autres.

## À vérifier dans un navigateur

Les suites ici ne montent rien, donc voici ce qu'un test vert ne dit pas :

- ouvrir une session `.z0` depuis la page d'accueil de st0 → l'adresse est
  `/z0/editor/<dépôt>/<session.z0>` et ne bouge plus ;
- recharger → la même session, pas la page d'accueil de l'origine ;
- ouvrir un dépôt que cette machine n'a jamais vu → la barre de progression de git, puis la
  liste des fichiers ; recommencer → aucun clone ;
- cliquer chaque fichier → le YAML brut, commentaires compris ;
- renommer le dossier `.z0` sur la machine et recharger → l'écran « cette session n'est pas
  dans le dépôt », pas celui du CORS.

## Ce qui vient ensuite

L'ordre des manches, les catégories (fichiers compris) et tous les champs du vocabulaire
s'éditent ; ce qui reste est listé à la fin de [editing.md](editing.md).

Et un ramassage à faire côté backend : `backend/src/editor/` (avec `editor.test.ts`) monte des
routes Grist qu'**aucun client n'appelle**. À supprimer une fois vérifié que rien ne les
touche — `backend/src/grist/` **reste**, c'est le chargeur des manches du jeu.
