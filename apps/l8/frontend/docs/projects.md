# La page d'accueil — l8 ouvre un projet, et c'est ici qu'on le choisit

`/l8/` sans rien après est un écran, et non une adresse à corriger : les dépôts git du compte,
les projets qu'ils contiennent, le dépôt des bibliothèques, les partages publiés et la clé de
déploiement. C'est de là qu'on part, et c'est là qu'on revient en quittant un morceau.

Tout ça a vécu ailleurs. La section **Projets** de la médiathèque le dessinait, `/projects` était
sa page d'accueil, et l8 arrivant sans projet dans son adresse était renvoyé là-bas. Cette page
dit ce que l'écran fait, et — puisque c'est un déménagement — pourquoi il est ici.

## Pourquoi ça a bougé, et ce qui n'a PAS bougé

**Ce qui a bougé est le dessin, et rien d'autre.** Les routes sont toujours celles de st0 :
`/api/projects`, `/api/shares`, `/api/projects/ssh-key`. Le volume est toujours le sien, les
miroirs bare aussi, la clé aussi, et les octets d'un partage aussi. Rien de tout cela n'a de
raison de déménager, et [apps/st0/docs/projects.md](../../st0/docs/projects.md) est la page qui
dit pourquoi ce service en est le bon dépositaire.

Ce qui a changé est **qui pose la question**. Trois arguments, dans l'ordre où ils pèsent :

1. **Le niveau au-dessus d'un projet appartient à ce qui ouvre un projet.** La médiathèque est
   ce dont un morceau *se sert* — des samples, des morceaux. « Quels dépôts
   possède cette personne, et qu'y a-t-il dedans » n'est pas une question de catalogue ; c'est
   la première question de l'éditeur, celle à laquelle il faut répondre avant qu'il y ait quoi
   que ce soit à éditer. Les modules et les chaînes ont fait le même trajet, dans la même
   semaine et pour la même raison : on les ÉCRIT, et on écrit ici.
2. **La machine était déjà de ce côté-ci.** Créer et supprimer un projet passent par le service
   de fichiers du moteur — le miroir de st0 est bare et sans blobs, il ne peut rien écrire (et
   ne doit pas, voir sa page). La médiathèque devait donc tendre le bras vers une machine dont
   elle ne fait rien d'autre. l8 y est branché en permanence : c'est là que le projet s'ouvre,
   se compile et se joue.
3. **Il n'y avait plus qu'un pas entre les deux écrans.** On choisissait un projet là-bas, on
   atterrissait ici. Une des deux pages était toujours de trop dans le trajet.

Le corollaire est que la médiathèque a repris **Morceaux** comme section d'accueil. Sa bande
d'onglets est passée de sept à trois — Projets par ici, Modules et Chaînes par la même porte,
Playlists ensuite (`playlists.md`) — et ce qui reste est exactement ce qu'on n'écrit pas dans un
éditeur de texte : morceaux, samples, et la zone de captures. L'argument qui avait mis Projets en
tête — « la première chose qu'on veut à une porte d'entrée, c'est son propre travail » — n'a pas
perdu : il a déménagé avec l'écran.

Les playlists sont le cas qui ne suit pas tout à fait ce motif, et il vaut d'être distingué :
elles ne sont pas parties parce qu'on les ÉCRIT — bien qu'on les écrive — mais parce qu'elles ne
portent aucun octet. Ce sont des noms de morceaux qui, eux, restent là-bas. Le fichier appartient
donc au dépôt, avec le travail pour lequel il a été écrit ; les morceaux restent au volume qu'on
sauvegarde. Voir `playlists.md`.

## Ce que l'adresse dit, et ce qu'elle ne dit pas

```
/l8/                      la page d'accueil
/l8/?repo=<id>            …avec l'arborescence d'un dépôt ouverte
/l8/band/leclip.l8        un projet — la page d'accueil ne s'affiche plus du tout
```

**Le chemin appartient au lancement.** `parseLaunch` le lit avant que quoi que ce soit ne soit
monté, et le premier segment après `/l8/` est le nom court d'un dépôt : il n'y a donc aucun
segment qu'on puisse ajouter ici sans qu'il se lise comme un dépôt à ouvrir. Le dépôt déplié
voyage dans la **query**, qui est exactement ce qu'un routeur de SPA possède — c'est l'argument
de [packages/project-shell/docs/launch.md](../../../packages/project-shell/docs/launch.md) pris
dans l'autre sens. Et elle se met en signet, se recopie, et répond au bouton « précédent ».

`?repo=` est posé en `replace` : parcourir trois dépôts pour voir ce qu'il y a dedans n'est pas
une navigation dont on veut trois entrées dans l'historique.

### Le branchement se fait au montage, en trois

`main.tsx` lit l'adresse une fois et choisit une pile, plutôt que d'en monter une seule avec des
morceaux éteints :

| l'adresse | ce qui est monté |
|---|---|
| `/l8/@shares/<token>.l8` | `SharedGate` — ni compte, ni moteur, ni copie de travail |
| `/l8/` | `AuthGate` → `Home` — le compte, et rien d'autre |
| `/l8/<dépôt>/<projet>` | `AuthGate` → `EngineGate` → `ProjectGate` → l'éditeur |

La ligne du milieu est neuve, et c'est elle qui remplace un `window.location.replace` vers st0.
Le `Profiler` reste sur la troisième seulement : il facture chaque commit du sous-arbre pour en
retenir les rares longs, et cette page-ci n'a pas de rafales de commits à mesurer.

**Aucun moteur n'est exigé.** Lister les dépôts, ouvrir une arborescence, régler les
bibliothèques, révoquer un partage, lire la clé : tout ça est st0, sur la session. Seuls
« Nouveau projet » et « Supprimer » ont besoin d'une machine, ils sont grisés sans elle **et
disent pourquoi**. Une page qu'un sélecteur de moteur barrerait entièrement serait une page où
l'on ne peut plus poser de clé de déploiement le jour où le moteur est éteint — c'est-à-dire le
jour de l'installation.

L'en-tête dit quand même laquelle : « machine prête » ou « aucune machine », avec l'adresse en
info-bulle et un bouton pour re-sonder. Découvrir au clic pourquoi un bouton ne fait rien est
exactement ce qu'on évite ici.

## La règle qui tient tout

**Le suffixe du dossier nomme l'application.** `mysong.l8` s'ouvre dans l8, `partie.z0` dans
z0 ; c'est tout, et `packages/web-protocol/projects.ts` est la règle entière. Un dossier sans
suffixe n'est pas un projet, même s'il contient un `project.yaml`.

Deux suffixes, parce que deux applications ouvrent un projet — et c'est la raison pour laquelle
cette page reste `launchUrl` sur chaque rangée plutôt que de fabriquer ses propres adresses :
un `.z0` dans le même dépôt s'ouvre ailleurs, et la seule ligne de l'écran qui aurait le droit de
deviner ne l'a pas.

Tout ce qu'un projet l8 peut ÊTRE tient dans les **surfaces** qu'il déclare à l'intérieur de
`.l8`, plutôt que dans une sorte de dossier : un `viewport` et des pistes vidéo pour l'image
(`packages/song/docs/picture.md`), une surface `turntables` et la playlist qu'elle nomme pour un set
(`packages/song/docs/setProject.md`). C'est pour ça que les trois archétypes du menu de création
portent le nom de leur surface — plus bas.

## Le dépôt des BIBLIOTHÈQUES, avant tout le reste

Un compte en déclare **un**, en haut de la page, avant la liste des dépôts et avant
l'arborescence : les modules et les chaînes que tous ses projets héritent. Sans lui, l8 refuse
d'ouvrir quoi que ce soit — pas par principe, mais parce qu'aucune référence `@st0/…` ne
résoudrait, et qu'un morceau ouvert avec tous ses modules partagés manquants se lit comme un
morceau cassé plutôt que comme un compte qu'on n'a pas fini d'installer.

C'est aussi pourquoi la carte est **en tête et teintée quand elle est vide** : c'est la seule
chose à faire sur cet écran tant qu'elle n'est pas faite, et le refus que `ProjectGate` opposera
un clic plus tard est le même fait, dit trop tard.

Un seul, pas une liste : il est monté à un chemin fixe dans chaque espace de travail
(`<espace>/_libraries`, voir
[packages/song/docs/sharedFolders.md](../../../packages/song/docs/sharedFolders.md)), et deux
dépôts qui réclament ce chemin est une question sans réponse. Une deuxième bibliothèque est un
dossier DANS ce dépôt, pas un deuxième dépôt.

**Un dépôt vide reçoit un commit vide, une fois.** À la première ouverture d'un projet, le
service de fichiers fait la racine qui manque et la pousse (`initIfEmpty`). Ce n'est pas un
détail de plomberie : un gitlink doit pointer SUR un commit, et un dépôt qu'on vient de créer
dans une interface web n'en a aucun — `git submodule add` sur un HEAD non né échoue. Le dépôt
est ensuite rempli par ici, à mesure qu'on y écrit des modules et des chaînes.

> Il y a eu une SEMENCE à cet endroit : la machine y recopiait `modules/` et `chains/` depuis la
> médiathèque, pour qu'un dépôt neuf ne casse pas d'un coup toutes les références `@st0/…` déjà
> écrites. Ce volume n'en tient plus aucun — un module s'écrit dans l8 — donc il n'y a plus rien
> à copier ni à migrer. Seul le commit reste, et c'est `initIfEmpty` et non `seedIfEmpty`.

**En changer ne touche aucune machine.** Les espaces de travail déjà clonés gardent l'ancien :
leur sous-module y pointe toujours, et le service de fichiers REFUSE de le réécrire plutôt que
de le faire en silence. La carte le dit au moment où on change.

## Un projet s'ouvre dans un nouvel onglet

Les deux départs — la rangée en retrait sous le dépôt et le bouton de l'arborescence — sont des
**ancres** portant `target="_blank"`, et non des boutons qui affectent `window.location`.

L'argument a survécu au déménagement en changeant de sujet. Il disait : la médiathèque doit
rester ouverte derrière, à sa section, avec ses dossiers dépliés. Il dit maintenant : **la liste
des projets doit rester ouverte derrière**. On ouvre un morceau, cinq minutes plus tard on en
veut un deuxième — pour comparer deux mixes, ou parce que le premier n'était pas le bon — et un
aller-retour par le bouton « précédent » redemanderait `/api/projects`, replierait l'arbre du
dépôt, et re-sonderait les moteurs.

Et ouvrir un deuxième projet ne coûte alors plus rien : deux morceaux côte à côte sont deux
onglets, ce qui est exactement la façon dont on les compare.

Le corollaire est le type des props : `RepoList` et `RepoTree` reçoivent un `projectHref`, pas un
`onOpenProject`. **Une adresse et non une action** — la page calcule où mène la rangée, la vue en
fait un lien. Le navigateur fait le reste, et le fait mieux : ctrl-clic, clic du milieu et
« copier l'adresse du lien » marchent parce que c'en est une. Un `window.open` dans un `onClick`
aurait répondu la même chose aux trois.

`rel="noopener"` coupe `window.opener` : l'onglet ouvert n'a rien à dire à celui-ci, et
`@studio/project-shell` ne lit que son adresse à lui.

## L'arborescence n'est pas le chemin normal

Ce qu'on vient chercher ici, c'est un projet — pas un dépôt. `GET /api/projects` renvoie donc
`projects: RepoProject[] | null` sur chaque dépôt, et la liste les dessine **en retrait sous le
leur**, chacun menant droit à son application. Il n'y a pas de champ `projectCount` à côté : c'est
`projects.length`, et deux sources pour un même chiffre finissent toujours par diverger.

`null` reste distinct de `[]` — « miroir jamais lu » n'est pas « aucun projet », et afficher un
dépôt sans projet alors qu'il n'a pas encore été récupéré serait un mensonge qui se corrige tout
seul dix secondes plus tard, donc que personne ne signalerait.

L'arborescence garde son bouton : elle sert à regarder ce qu'il y a dedans, y compris les
dossiers qui ne sont pas des projets.

### Comment elle s'ouvre

Le **premier niveau est déplié** dès que le miroir répond, et rien en dessous : un dépôt qui
s'ouvre tout replié cache derrière un clic la seule chose qu'on vient y chercher, et tout
déplier noierait un projet dans le `node_modules` du voisin.

Ce dépliage est fait **une fois par dépôt**, pas à chaque arbre reçu : ensuite les plis
appartiennent à la personne, y compris ceux qu'elle a refermés, et un rafraîchissement (bouton,
ou `fetch` qui se termine) ne les rouvre pas.

Les lignes sont triées **alphabétiquement, à tous les niveaux**, dossiers et fichiers mêlés :
git répond dans l'ordre de son arbre, qui n'est pas un ordre où l'on cherche quelque chose. Le
comparateur est `@studio/web-protocol/tree` — `Intl.Collator` : la casse et les accents ne
comptent pas, et `prise 2` précède `prise 10`. Il est dans un paquet et non dans une app parce
que la médiathèque trie ses familles avec le même, et deux ordres pour deux arbres du même
studio se lisent comme un bug dans l'un des deux.

L'arbre rendu est du `FileNode` — **le même type** que celui que sert le file service, avec le
même drapeau `project?: boolean` sur les dossiers, plus `app` qui dit laquelle des applications
l'ouvre. Les deux arbres du dépôt dessinent donc les mêmes lignes.

## Le trajet complet

1. Sur la page d'accueil, on colle une URI SSH. st0 génère la clé de déploiement si elle
   n'existe pas encore, enregistre le dépôt et lance le miroir en tâche de fond.
2. La liste affiche chaque dépôt avec **ses projets en retrait dessous** ; un clic sur l'un
   d'eux part directement dans son application, **dans un nouvel onglet**. Le nom du dépôt, lui,
   ouvre l'arborescence — ici même —, où les dossiers-projets sont marqués de la même façon.
3. Dans les deux cas on arrive à `/<app>/<nom-du-dépôt>/<dossier>` — `/l8/band/leclip.l8` pour
   une chanson — une ADRESSE, et le dépôt par son **nom court**, pas par son URI : une barre
   d'adresse se copie et se colle, et une URI SSH y traîne une machine, un port et un
   utilisateur.
4. L'application redemande à st0 l'URI derrière ce nom (`GET /api/projects/by-name/:name`).
   Deux dépôts qui répondent au même nom court font un 409 plutôt qu'un choix silencieux.
5. Puis elle demande au file service `GET /workspaces/by-repo?uri=` : cette machine
   connaît-elle ce dépôt ?
6. Sinon, elle le clone, **avec la progression de git à l'écran**
   ([cloneJobs.md](../../../packages/file-service/docs/cloneJobs.md)), puis ouvre le projet.

Les étapes 4 à 6 sont `@studio/project-shell`, montée à l'identique par l8 et par l'éditeur de
z0 : une divergence là serait un clone en double ou un 404. Voir
[launch.md](../../../packages/project-shell/docs/launch.md).

**Une seule pile pour les deux applications, toujours.** z0 revient ici aussi en quittant un
projet — cette liste tient les dossiers `.z0` autant que les `.l8`, et un deuxième sélecteur de
son côté serait exactement la deuxième chose à tenir en phase que ce paquet existe pour éviter.

## Créer et supprimer un projet — sur la machine, pas ici

Le bloc de chaque dépôt porte un **« Nouveau projet »** (l'archétype, et un nom), et chaque
projet un petit **« Supprimer »** avec confirmation. Ni l'un ni l'autre n'est fait par st0.

C'est le seul endroit de cette page où le déménagement change quelque chose de réel : l'écran et
la machine sont maintenant du même côté. La médiathèque appelait ces routes **depuis le
navigateur**, par une couture qu'elle ne se servait à rien d'autre ; ici, c'est le service de
fichiers que l'app entière utilise dès qu'un projet est ouvert.

Ce qui n'a pas changé, c'est que ce sont **des appels explicites**, avec `fileBase` et le jeton
sur chaque appel (`projects/api.ts`), et non le `configureFileApi` global de l'éditeur. Celui-là
est posé UNE fois, sur l'espace de travail du seul projet qu'un onglet a ouvert ; cette page
touche un dépôt différent à chaque rangée, et plusieurs avant que rien ne soit ouvert.

### Ce que la machine sait déjà faire

| pièce | où |
|---|---|
| échafaudage aux réglages par défaut | `POST <fileBase>/project/create` → `createProjectIn` |
| suppression (le dossier est recyclé) | `POST <fileBase>/project/delete` |
| indexer, committer, pousser | la commande `commit` → `packages/commands/src/git.ts` |
| cloner le dépôt s'il n'y est pas | `POST /workspaces/clone` + les jobs à interroger |

### Le clonage est ce qui rend un dépôt vide utilisable

`ensureWorkspace` clone si la machine ne connaît pas encore le dépôt. Sans ça il faudrait déjà
avoir un projet pour pouvoir en ouvrir un, donc pour pouvoir en créer un — un œuf sans poule,
qui rendrait la fonction inutile précisément sur les dépôts neufs. La progression affichée est
celle de git, dans ses mots (« Receiving objects »), parce qu'une attente de trente secondes qui
ne dit rien ressemble à un écran figé.

### Le suffixe décide, et le nom est montré avant

`projectName.ts` est pur et testé : c'est lui qui pose le suffixe, retire un suffixe déjà tapé —
« hiver.z0 » dans un menu qui écrit du l8 donnerait « hiver.z0.l8 », qui ne serait ni l'un ni
l'autre — et refuse les séparateurs plutôt que de les remplacer en silence.

Un suffixe ne se lit **qu'à la fin** : « prise v1 » est un nom de dossier parfaitement ordinaire,
et rien n'y touche. C'est déjà la règle de `projectApp`, et `projectName.test.ts` la fixe des
deux côtés. Le dossier obtenu est affiché sous le champ **avant** de valider : ici c'est le nom
qui décide de tout.

### Les trois archétypes, nommés d'après leur surface

| archétype | surfaces | ce qu'il écrit |
|---|---|---|
| `arrangement` | `timeline` | une piste, un synthé, un motif |
| `mix` | `turntables` | deux platines, un crossfade, et un `playlist:` à remplir |
| `video` | `timeline` + `viewport` | l'arrangement, plus une piste d'image |

Tout est un dossier `.l8` ouvert par le même l8, donc « quelle sorte de projet » n'a plus de
réponses à départager — ce qui diffère est la surface que le projet DÉCLARE
(`packages/song/docs/surfaces.md`). Un quatrième existait, `live` : le graphe seul, aucune
surface. Il est parti avec ce nommage — une entrée dont la description entière est « aucune des
trois » n'est pas un choix qu'on fait exprès. Le MODE `live`, lui, reste : c'est ce que `mix`
déclare, et un rig écrit à la main s'ouvre toujours.

`createProjectIn` les distingue dans un `Record<ProjectShape, …>` et non dans une suite de `if` :
un quatrième archétype ajouté à `PROJECT_SHAPES` ne compilera plus tant que personne n'aura dit
ce qu'il écrit. La même raison que `HAS_SCAFFOLD`, plus bas.

> **Le service de fichiers connaît ces noms, et une machine en retard le dit.** `shape` voyage
> jusqu'à `POST /project/create`, dont le `z.enum` est `PROJECT_SHAPES`. Une machine dont le
> service est plus ancien que ces trois-là répond 400 — l'échec est visible et nommé, ce qui vaut
> mieux qu'un gabarit deviné à côté.

### Posséder un suffixe et pouvoir être créé sont deux questions

`ProjectApp` vaut `"l8" | "z0"` — k7 n'a pas de projets. Mais le menu ne reflète PAS ce type :
il reflète `SCAFFOLDED_APPS`, et confondre les deux fabrique un dossier dont le suffixe dit une
chose et le contenu une autre. Une seule application y figure, donc le menu offre les archétypes
d'un projet l8 plutôt qu'une liste d'applications.

Créer demande un **gabarit** — une carte de fichiers que le file-service sait écrire
(`createProjectIn`, et les modules `scaffold*` de `@studio/song`). z0 possède bien les dossiers
`.z0` et n'en a aucun. Le proposer fabriquait donc un dossier `.z0` contenant une chanson l8 :
le suffixe disait une chose, le contenu une autre, et rien ne s'en plaignait avant que z0 essaie
de l'ouvrir. `HAS_SCAFFOLD` répond la question app par app, dans un `Record` et non une liste.

### Le verbe est `project commit`, et un succès doit se prouver

Deux pièges se sont refermés ensemble, et ils méritent d'être écrits parce qu'ils se cachaient
l'un l'autre.

**Le verbe.** `commands.yaml` déclare `project commit`, pas `commit`. Une ligne qui ne
correspond à aucune commande **ne lève pas** : `runCommand` répond « unknown command ». Rien
n'était donc committé, et rien ne le disait.

**La lecture de la réponse.** La première version cherchait des mots d'échec connus et concluait
au succès pour tout le reste. C'est le mauvais défaut : elle a donc annoncé que tout allait bien
pour une commande qui n'existait pas. `commitOutcome` exige maintenant une **preuve positive** —
une ligne `committed …` — et rend la sortie brute pour tout le reste, y compris ce qu'elle ne
reconnaît pas. C'est cette sortie qui nommera la prochaine dérive entre ce code et
`commands.yaml`.

Il est pur et dans son propre module, sans le moindre import : c'est ce qui le rend chargeable
par un test, `machine.ts` touchant `./api` — donc `window` — dès son chargement.

### Un envoi raté n'annule pas la création

Le commit vient après, et sa plainte est rapportée séparément : le dossier est là, sur la
machine, et seul l'envoi a manqué — hors ligne, pas d'amont. Le dialogue se ferme, la page
affiche « créé, mais : … ». Supprimer le projet pour faire propre serait jeter le travail de
quelqu'un pour une panne de réseau, et lever inviterait à recommencer une création qui a eu lieu.

Après coup, on demande explicitement à st0 un `git fetch` de son miroir : le poll n'en fait un
qu'au plus toutes les dix minutes, et la liste serait sinon restée telle quelle — un clic qui a
l'air de n'avoir rien fait.

## Les partages

La carte du bas liste les instantanés gelés que ce compte a publiés, et c'est le seul endroit
où l'on en retire un. **Les deux bouts sont l8 maintenant** : `project share link` fabrique le
paquet ici, sur la machine qui a un moteur et peut donc rendre du son, et l'envoie à st0 — qui
en détient l'unique copie et le sert à des gens sans compte.

Que la révocation ait vécu dans la médiathèque était le dernier morceau d'une chose coupée en
deux. Ce que le paquet contient et pourquoi est dans
[packages/commands/docs/shareBundle.md](../../../packages/commands/docs/shareBundle.md) ; ce que
st0 en fait, y compris pourquoi héberger ça ne contredit pas « st0 ne fait jamais de copie de
travail », est dans [apps/st0/docs/shares.md](../../st0/docs/shares.md).

Ce que cette carte doit dire, elle le dit :

- **le total en octets**, en tête — un partage n'expire jamais, donc voir ce qu'ils coûtent
  ensemble est la seule chose qui peut faire décider d'en retirer un ;
- **la ligne survit à la révocation, datée**, et le token est effacé du registre : un partage
  qui disparaîtrait laisserait son auteur se demander s'il a jamais existé, et une ligne révoquée
  ne doit pas pouvoir être recopiée depuis l'écran où elle est encore dessinée ;
- **l'adresse est un lien** et pas un bouton : c'est ce qu'on a envoyé aux autres, et la seule
  façon de vérifier ce qu'ils voient est de l'ouvrir ;
- la confirmation nomme les deux choses qui surprennent — les octets s'en vont tout de suite et
  pour de bon, et **un lien déjà envoyé ne se dé-envoie pas**.

## Un seul poll, là où il y en avait deux

La médiathèque en tenait deux : le sien pour le volume, et un pour `/api/projects`, séparés parce
qu'un `git fetch` qui traîne ne devait pas empêcher le catalogue de se rafraîchir. Ici les dépôts
et les partages sont le **même écran** et viennent du **même service**, donc un seul minuteur, et
les partages sur le même tick.

Un `git fetch` coûte du réseau, donc le miroir n'est pas rafraîchi à chaque affichage : à
l'ajout, sur le bouton, et au plus une fois par dix minutes côté st0. C'est la raison pour
laquelle `useGitStatus` dans l'éditeur est déjà sur un timer de dix minutes.

### Le jeton dit « à jour », pas « en main »

`seen` retient la révision de ce qui a été chargé la dernière fois. Elle répond à « le service
a-t-il bougé depuis ? » — et **pas** à « est-ce que l'écran tient encore cette liste ? ». C'est ce
qui produisait, dans la médiathèque, un spinner qui ne s'arrêtait plus : vider l'affichage en
laissant le jeton intact fait que le poll ne recharge rien, donc que rien ne remplace le vide.
Ici les deux vont ensemble — `onChanged` remet les deux jetons à `""`, ce qui force la relecture
au tick suivant plutôt que d'attendre qu'une révision bouge après une écriture qu'on vient de
faire.

## Ce qu'il faut vérifier dans un navigateur

Les suites d'ici tournent dans node et ne montent rien : `commitOutcome` et `projectName` sont
couverts, l'écran ne l'est pas. Ce qu'un run vert ne dit pas :

- ouvrir `/l8/` sans être connecté → l'écran de connexion, puis la page d'accueil (et pas la
  médiathèque) ;
- **sans machine moteur** : la liste s'affiche, « Nouveau projet » et « Supprimer » sont gris et
  leur info-bulle dit pourquoi, la clé et les bibliothèques se règlent quand même ;
- déplier un dépôt, recharger la page → le même dépôt déplié, `?repo=` dans l'adresse ;
- ouvrir un projet → un nouvel onglet, la page d'accueil intacte derrière ; ctrl-clic et clic du
  milieu font la même chose ;
- quitter un projet depuis l'éditeur, et perdre son moteur au profit de quelqu'un d'autre → les
  deux ramènent ici, pas sur `/projects` ;
- créer un projet dans un dépôt **vide** que cette machine n'a jamais vu → le clone avec la
  progression de git, puis le dossier, puis le commit ;
- révoquer un partage, puis ouvrir son lien → « introuvable ».
