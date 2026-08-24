# La page d'accueil — st0 ouvre un projet, et c'est ici qu'on le choisit

`/` sans rien après est un écran, et non une adresse à corriger : les dépôts git du compte,
les projets qu'ils contiennent, le dépôt des bibliothèques, les partages publiés et la clé de
déploiement. C'est de là qu'on part, et c'est là qu'on revient en quittant un morceau.

## Qui dessine, qui détient

**st0 dessine, pl8 détient.** Les routes sont celles de pl8 : `/api/projects`, `/api/shares`,
`/api/projects/ssh-key`. Le volume est le sien, la clé aussi, et les octets d'un partage aussi —
[apps/pl8/docs/projects.md](../../pl8/docs/projects.md) dit pourquoi ce service en est le bon
dépositaire.

**La SOURCE de la liste, elle, est la machine.** Ce qui liste les projets est le service de
fichiers, sur les espaces de travail clonés — pas un miroir tenu ailleurs. Un index séparé serait
une deuxième copie de ce que la machine du moteur tient déjà, et une moins bonne : en retard d'un
`git fetch`, et aveugle à un projet créé, committé, dont l'envoi n'est pas passé — le cas exact
que `commitOutcome` traite comme rattrapable.

Deux raisons de fond, dans l'ordre où elles pèsent :

1. **Le niveau au-dessus d'un projet appartient à ce qui ouvre un projet.** La médiathèque est
   ce dont un morceau *se sert* — des samples, des morceaux. « Quels dépôts
   possède cette personne, et qu'y a-t-il dedans » n'est pas une question de catalogue ; c'est
   la première question de l'éditeur, celle à laquelle il faut répondre avant qu'il y ait quoi
   que ce soit à éditer. Les modules et les chaînes suivent la même règle : on les ÉCRIT, et on
   écrit ici.
2. **La machine est de ce côté-ci.** Créer, supprimer et LISTER un projet passent par le service
   de fichiers du moteur, parce qu'un projet est un dossier chez lui. La médiathèque devrait
   tendre le bras vers une machine dont elle ne fait rien d'autre ; st0 y est branché en
   permanence — c'est là que le projet s'ouvre, se compile et se joue.

Le corollaire est que la médiathèque a **Morceaux** comme section d'accueil, et une bande de trois
onglets : exactement ce qu'on n'écrit pas dans un éditeur de texte — morceaux, samples, et la zone
de captures. Les projets sont ici, les modules et les chaînes aussi, les playlists ensuite
(`playlists.md`).

## L'adresse suit

Cet écran est **la porte d'entrée elle-même**. st0 répond à la racine de l'origine
(`st0.priv.frediver.se`, `studio.frediver.se`), et la médiathèque — **pl8** — est sous `/pl8`.
C'est la conclusion de l'argument ci-dessus : si la première chose qu'on veut à une porte d'entrée
est son propre travail, alors la page qui liste ce travail EST la porte d'entrée, et la laisser
derrière un préfixe qu'il faut savoir taper serait la mettre au second rang.

**Le lien vers pl8 est dans l'en-tête de CETTE page, et seulement ici.** Ouvert sur un projet, st0
dessine l'en-tête de l'éditeur, où un lien qui fait quitter la session n'a rien à faire ; sur
l'accueil, rien ne tourne et le catalogue est précisément ce dont le prochain projet va se
servir. Le bouton part dans le MÊME onglet, à l'inverse du lien qui vient d'en face
(`apps/pl8/docs/otherApps.md`) : là-bas la médiathèque joue peut-être quelque chose et partir
l'arrêterait, ici la page est une liste et le bouton « précédent » la rend telle quelle.

`/auth/*` suit la racine : l'IdP ne connaît qu'un seul `redirect_uri`, sans préfixe, donc ces
routes ne peuvent être servies que par le service qui n'a pas de préfixe — st0. Voir
`packages/web-protocol/services.ts`, où le chemin de st0 est `""` exprès.

Les playlists tiennent par un autre argument, et il vaut d'être distingué : elles ne sont pas ici
parce qu'on les ÉCRIT — bien qu'on les écrive — mais parce qu'elles ne portent aucun octet. Ce
sont des noms de morceaux qui, eux, restent au catalogue. Le fichier appartient donc au dépôt,
avec le travail pour lequel il a été écrit ; les morceaux restent au volume qu'on sauvegarde. Voir
`playlists.md`.

## Ce que l'adresse dit, et ce qu'elle ne dit pas

```
/                     la page d'accueil — st0 répond à la racine de l'origine
/?ws=<espace>         …avec l'arborescence d'un espace de travail dépliée
/band/leclip.st0      un projet, par son dépôt — la même adresse sur toute machine
/@local/demos/x.st0   un projet dans un espace qui n'a pas de dépôt — voir plus bas
```

**Le chemin appartient au lancement.** `parseLaunch` le lit avant que quoi que ce soit ne soit
monté, et le PREMIER segment de l'adresse est le nom court d'un dépôt : il n'y a donc aucun
segment qu'on puisse ajouter ici sans qu'il se lise comme un dépôt à ouvrir. C'est aussi ce qui
rend inouvrable un dépôt qui s'appellerait `pl8`, `k7`, `z0`, `api` ou `auth` — l'origine
revendique ces préfixes avant st0, et la requête n'arrive jamais jusqu'ici
(`apps/studio/docker/nginx.conf`). Le dépôt déplié
voyage dans la **query**, qui est exactement ce qu'un routeur de SPA possède — c'est l'argument
de [packages/project-shell/docs/launch.md](../../../../packages/project-shell/docs/launch.md) pris
dans l'autre sens. Et elle se met en signet, se recopie, et répond au bouton « précédent ».

`?ws=` est posé en `replace` : parcourir trois espaces pour voir ce qu'il y a dedans n'est pas
une navigation dont on veut trois entrées dans l'historique. Ce qu'on déplie est un dossier sur la
machine, et c'est son NOM qui le désigne, pas un identifiant de dépôt : lisible dans la barre
d'adresse, et vrai sur la machine qui répond.

### Le branchement se fait au montage, en trois

`main.tsx` lit l'adresse une fois et choisit une pile, plutôt que d'en monter une seule avec des
morceaux éteints :

| l'adresse | ce qui est monté |
|---|---|
| `/@shares/<token>.st0` | `SharedGate` — ni compte, ni moteur, ni copie de travail |
| `/` | `AuthGate` → `Home` — le compte, et rien d'autre |
| `/<dépôt>/<projet>` | `AuthGate` → `EngineGate` → `ProjectGate` → l'éditeur |

Le `Profiler` reste sur la troisième seulement : il facture chaque commit du sous-arbre pour en
retenir les rares longs, et cette page-ci n'a pas de rafales de commits à mesurer.

### Le moteur est nécessaire pour la liste, et c'est le prix de tout le reste

Cette page réclame une machine pour **la liste des projets**, et pour l'ajout d'un dépôt (qui le
clone) : les projets sont des dossiers sur cette machine, donc elle seule sait lesquels existent.
Sans elle, la liste est remplacée par la phrase qui le dit, plutôt que par un écran vide qui
ressemblerait à un compte neuf.

Ce qui se lit et se règle **sans machine** est ce qui sauve le jour de l'installation : la clé de
déploiement et le dépôt des bibliothèques. On peut donc faire, moteur éteint, exactement ce qu'il
faut faire avant d'en allumer un — une page qu'un sélecteur de moteur barrerait entièrement serait
une page où l'on ne peut pas poser de clé tant qu'il n'y a pas de moteur.

Les partages, eux, sont derrière un bouton sur la rangée d'un projet, donc derrière une liste qui
exige une machine (§ Les partages). Ça ne touche pas l'argument d'installation — un compte neuf
n'a rien publié — mais il faut le dire, et c'est le prix noté là-bas.

L'en-tête dit quand même laquelle : « machine prête » ou « aucune machine », avec l'adresse en
info-bulle et un bouton pour re-sonder. Découvrir au clic pourquoi un bouton ne fait rien est
exactement ce qu'on évite ici.

## La règle qui tient tout

**Le suffixe du dossier nomme l'application.** `mysong.st0` s'ouvre dans st0, `partie.z0` dans
z0 ; c'est tout, et `packages/web-protocol/projects.ts` est la règle entière. Un dossier sans
suffixe n'est pas un projet, même s'il contient un `project.yaml`.

Deux suffixes, parce que deux applications ouvrent un projet — et c'est la raison pour laquelle
cette page reste `launchUrl` sur chaque rangée plutôt que de fabriquer ses propres adresses :
un `.z0` dans le même dépôt s'ouvre ailleurs, et la seule ligne de l'écran qui aurait le droit de
deviner ne l'a pas.

Tout ce qu'un projet st0 peut ÊTRE tient dans les **surfaces** qu'il déclare à l'intérieur de
`.st0`, plutôt que dans une sorte de dossier : un `viewport` et des pistes vidéo pour l'image
(`packages/song-video/docs/picture.md`), une surface `turntables` et la playlist qu'elle nomme pour un set
(`packages/song/docs/setProject.md`). C'est pour ça que les trois archétypes du menu de création
portent le nom de leur surface — plus bas.

## La barre de commande de cet écran

Elle est en bas, sur toute la largeur, exactement comme dans l'éditeur — et pour la même raison :
c'est là qu'on tape, donc elle est toujours là, jamais convoquée. Double-Shift lui donne le
clavier, Échap le rend. `frontend/docs/commandBar.md` décrit le composant ; ce qui suit est ce
qui le distingue ici.

**Son vocabulaire est le sien** (`src/projects/homeCommands.ts`), et pas `LOCAL_COMMANDS`. Cet
écran n'a ni projet ouvert, ni session moteur, ni fichier : le catalogue de l'éditeur y serait une
liste de choses qu'on ne peut pas faire, et la moitié qui vient du service de fichiers ne
répondrait même pas — `/complete` et `/command` veulent un projet actif. Six verbes, et ce sont
ceux des boutons de la page :

| la ligne | ce qu'elle fait, et par où |
|---|---|
| `project new <type> <name>` | les trois archétypes, puis `projectFolderName` pose le `.st0` — échafaudage sur la machine, puis commit et push |
| `project delete init <name>` | **désigne** le projet et dit ce que confirmer fera. N'écrit rien |
| `project delete confirm <name>` | supprime celui-là, si c'est bien celui qui a été désigné |
| `system repo add <repo_url>` | inscrit chez pl8 **puis** clone ici — les deux, dans cet ordre |
| `system repo remove <repo_name>` | retire du registre. Les fichiers restent |
| `system repo sync <repo_name>` | `project pull`, puis `project commit sync` dans cet espace |

### Deux verbes pour supprimer, et c'est la confirmation

Une palette peut lancer une ligne destructrice sur un Enter posé sur une correspondance floue.
Le dialogue de la page pose une seconde question ; la barre n'a pas de dialogue, donc elle pose
un **second verbe**. Nommer le projet deux fois est ce qui fait de la deuxième frappe une
décision, et `init` est le seul endroit où l'on LIT ce que la suppression fera — le dossier
recyclé sur la machine, le commit poussé, le contenu qui reste dans l'historique git.

Le confirm **exige le même nom** : autrement la seconde ligne serait une formalité, ce qu'elle ne
doit surtout pas être. Et l'armement est **consommé par n'importe quelle commande**, pas seulement
par son confirm — c'est la règle que suit déjà l'insertion en attente du graphe (`docs/shell.md`),
et elle interdit ici qu'un verbe destructeur reste armé derrière trois lignes sans rapport.

### Dans quel dépôt une ligne atterrit

Les verbes `project …` ne nomment pas d'espace de travail : c'est **celui que l'adresse a
déplié** (`?ws=`), et à défaut le seul qu'il y ait. Entre plusieurs, la ligne est **refusée en les
nommant** plutôt que d'en choisir un — créer un projet dans le mauvais dépôt, c'est un commit
poussé là où personne ne regardait. L'autre option aurait été un troisième argument sur chaque
verbe, qui est le dépôt où l'on se tient déjà.

### Les boutons et la barre passent par les mêmes fonctions

`createProjectOnMachine`, `deleteProjectOnMachine`, `ensureWorkspace`, le registre de pl8 : une
seule implémentation, deux portes. C'est la relation qu'ont déjà le menu de l'arbre de fichiers et
les verbes `fs …` (`docs/shell.md`) — les dialogues gardent leur progression pas à pas et leur
confirmation, la barre a la sienne. Ce que la barre ajoute, c'est de pouvoir faire tout ça sans la
souris, et de le dire dans une ligne d'état au-dessus d'elle : refus en ambre, parce que ces
verbes-là parlent à deux services et qu'un « ça n'a rien fait » silencieux est ce qu'on évite
partout ailleurs.

Une ligne que cet écran ne connaît pas est refusée **ici** : il n'y a pas de service derrière à
qui la passer, contrairement à la barre de l'éditeur, dont les lignes finissent chez `/command`.

## Le dépôt des BIBLIOTHÈQUES, avant tout le reste

Un compte en déclare **un**, en haut de la page, avant la liste des dépôts et avant
l'arborescence : les modules et les chaînes que tous ses projets héritent. Sans lui, st0 refuse
d'ouvrir quoi que ce soit — pas par principe, mais parce qu'aucune référence `@st0/…` ne
résoudrait, et qu'un morceau ouvert avec tous ses modules partagés manquants se lit comme un
morceau cassé plutôt que comme un compte qu'on n'a pas fini d'installer.

C'est aussi pourquoi la carte est **en tête et teintée quand elle est vide** : c'est la seule
chose à faire sur cet écran tant qu'elle n'est pas faite, et le refus que `ProjectGate` opposera
un clic plus tard est le même fait, dit trop tard.

Un seul, pas une liste : il est monté à un chemin fixe dans chaque espace de travail
(`<espace>/_libraries`, voir
[packages/song/docs/sharedFolders.md](../../../../packages/song/docs/sharedFolders.md)), et deux
dépôts qui réclament ce chemin est une question sans réponse. Une deuxième bibliothèque est un
dossier DANS ce dépôt, pas un deuxième dépôt.

**Un dépôt vide reçoit un commit vide, une fois.** À la première ouverture d'un projet, le
service de fichiers fait la racine qui manque et la pousse (`initIfEmpty`). Ce n'est pas un
détail de plomberie : un gitlink doit pointer SUR un commit, et un dépôt qu'on vient de créer
dans une interface web n'en a aucun — `git submodule add` sur un HEAD non né échoue. Le dépôt
est ensuite rempli par ici, à mesure qu'on y écrit des modules et des chaînes.

> **Rien n'y SÈME de modules, et c'est délibéré.** `initIfEmpty` pose le commit et rien d'autre :
> le dépôt des bibliothèques est la référence, donc une bibliothèque neuve est **vide** et les
> `@st0/…` d'un set échafaudé n'y résolvent rien tant qu'on n'y a rien mis
> (`packages/song/docs/sharedFolders.md`). Recopier un catalogue depuis ailleurs — le volume de
> pl8, ou le build — ferait de cet ailleurs une seconde source de vérité sur les modules de
> quelqu'un d'autre.

### …mais la dette est dite à la création, pas découverte à l'ouverture

Cette règle-là ne bouge pas ; ce qui bougeait, c'est le moment où on l'apprenait. Un `mix`
échafaudé sur un compte neuf s'ouvrait avec **tous** ses modules partagés manquants — exactement
la lecture « morceau cassé plutôt que compte pas fini » que la carte plus haut existe pour éviter,
sauf que la carte ne vérifie que la DÉCLARATION du dépôt, jamais son contenu.

`createProjectIn` répond donc maintenant un `missing[]` à côté du `project` : les refs `@st0/…`
que l'échafaudage vient d'écrire et que l'espace de travail ne résout pas
(`packages/song/src/scaffoldNeeds.ts`). Trois choses valent d'être notées :

- **La liste est lue dans le texte que l'échafaudage écrit**, pas tenue à côté de lui. Un
  archétype dont les nœuds changent de module ne peut pas faire mentir la liste, puisqu'il n'y en
  a pas d'autre que ses propres fichiers.
- **Seul `@st0/` compte.** `@project/` est le dossier du morceau, `@workspace/` les `_modules` de
  l'espace, `@engine/` le scan des greffons et `@studio/` les modules intégrés : aucun de ces
  quatre n'attend qu'on installe un dépôt. C'est pourquoi `arrangement` et `video` ne doivent
  rien — ils n'étendent que du `@project/` et du `@studio/` — et pourquoi `mix` est le seul des
  trois qui s'ouvre cassé sur un compte neuf. L'asymétrie est fixée par un test.
- **La phrase ne promet aucun catalogue.** Elle nomme les modules dus et dit qu'on les écrit
  soi-même, précisément pour ne pas laisser croire que quelque chose va les chercher.

**En changer ne touche aucune machine.** Les espaces de travail déjà clonés gardent l'ancien :
leur sous-module y pointe toujours, et le service de fichiers REFUSE de le réécrire plutôt que
de le faire en silence. La carte le dit au moment où on change.

## Un projet s'ouvre dans un nouvel onglet

Les deux départs — la rangée en retrait sous le dépôt et le bouton de l'arborescence — sont des
**ancres** portant `target="_blank"`, et non des boutons qui affectent `window.location`.

L'argument est que **la liste des projets doit rester ouverte derrière**, avec ses dossiers
dépliés. On ouvre un morceau, cinq minutes plus tard on en veut un deuxième — pour comparer deux
mixes, ou parce que le premier n'était pas le bon — et un
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

Ce qu'on vient chercher ici, c'est un projet — pas un dépôt. `GET /workspaces/projects` sur la
machine renvoie donc, par espace de travail, la liste de ses projets, et l'écran les dessine **en
retrait sous le leur**, chacun menant droit à son application. Il n'y a pas de champ
`projectCount` à côté : c'est `projects.length`, et deux sources pour un même chiffre finissent
toujours par diverger.

Il n'y a pas de `null` dans cette réponse, et c'est le gain le plus net : « pas encore su » serait
un troisième état à distinguer de « aucun projet », et un dépôt affiché sans projet alors qu'il
n'a pas encore été lu est un mensonge qui se corrige tout seul dix secondes plus tard, donc que
personne ne signale. Un `readdir` sur un disque qui est là ne connaît pas cet état : la réponse
est la réponse.

Les projets sont trouvés **à n'importe quelle profondeur**, `songs/hiver.st0` compris, et un projet
dans un projet est descendu et rapporté — un `.z0` rangé dans un dossier `.st0` est une vraie
disposition. C'est `projectDirsUnder` dans le service de fichiers, le même marcheur que la liste
que l'éditeur poll déjà.

L'arborescence garde son bouton : elle sert à regarder ce qu'il y a dedans, y compris les
dossiers qui ne sont pas des projets.

### Une rangée par ESPACE DE TRAVAIL, pas par dépôt

La liste montre ce que la machine tient, donc ses dossiers sous `~/.studio/root/<vous>/`. Deux
conséquences, et il faut les deux :

**Un dépôt inscrit chez pl8 que cette machine n'a pas cloné n'a aucune rangée.** Une deuxième
machine, ou un compte déjà rempli, ne montre ici que ce qui est sur celle-ci. Son adresse
`/<dépôt>/<projet>` continue de marcher — `ProjectGate` le clonera à l'ouverture — et c'est la
façon de le rapatrier.

**Un espace de travail SANS dépôt en a une aussi.** `Examples`, semé avec les démos au premier
contact, n'est le clone de rien — et c'est pourtant ce qu'un compte neuf a le jour où il n'a rien
d'autre. Une liste qui viendrait des dépôts inscrits le laisserait invisible. Il lui faut donc une
adresse, et c'est `@local`.

## `@local` — un projet qui n'appartient à aucun dépôt

```
/@local/Examples/synth-demo.st0     un projet dans l'espace « Examples »
/@local/hiver.st0                   un espace de travail qui EST le projet
```

La troisième sentinelle, après `@banc` et `@shares`, et exactement le même tour : `@` ne peut pas
commencer un nom court git — c'est le dernier segment d'une URI SSH sans `.git` — donc ça ne peut
jamais entrer en collision avec un vrai dépôt, et la porte le voit et saute toute la route qui
transforme un nom en URI puis en clone. Il n'y a rien à cloner : le dossier est déjà là.

**`parseLaunch` n'a rien de spécial à faire.** `/@local/Examples/synth-demo.st0` se lit comme dépôt
`@local`, projet `Examples/synth-demo.st0` — la part projet s'arrête au dernier segment qui
revendique le suffixe de l'app, la règle ordinaire. `localTarget` détache l'espace de travail du
début, et c'est la seule règle propre à `@local`. Un espace qui EST un projet n'a rien après son
nom, et le projet est `"."` : la même réponse que pour un dépôt qui est le projet, donc rien en
aval ne change.

**Le prix, écrit là où il se paie : cette adresse n'est pas portable.** L'adresse d'un dépôt ouvre
la même chanson sur n'importe quelle machine — c'est par `<dépôt>/<projet>` que `projectClaimKey`
identifie un projet, et c'est ce qu'un lien collé à quelqu'un doit être. `@local` nomme un dossier
sur celle-ci et rien ailleurs. L'adresse portable gagne donc dès qu'elle existe, et `@local` est
le repli.

Trois cas y tombent, et c'est la page qui tranche parce qu'elle est la seule à parler aux deux
services :

| cas | qui le sait |
|---|---|
| l'espace n'est pas un clone du tout | la machine : pas d'`origin` |
| deux clones répondent au même nom court | la machine : `uniqueName: false` — pl8 répond 409 pour un tel nom plutôt que d'en choisir un |
| le registre de pl8 ne connaît pas ce dépôt | pl8 : le nom court n'est pas dans sa liste |

Le troisième est celui qu'on oublie : un clone parfaitement nommé que le registre ignore a un nom
court impeccable et se résout en 404 à la porte. C'est pour ça que cette page demande encore
`GET /api/projects` — pas pour dessiner une liste, mais pour savoir laquelle des deux adresses
écrire.

**`@local` n'exige PAS de dépôt de bibliothèques**, et c'est le seul endroit où cette route est en
désaccord avec les deux autres. Le refus `no-libraries` est posé avant tout le reste parce qu'une
référence `@st0/…` non résolue fait lire une chanson comme cassée plutôt que comme un compte qu'on
n'a pas fini d'installer. Mais un espace sans dépôt ne monte aucun sous-module, et c'est ce qu'un
compte NEUF a : exiger une bibliothèque mettrait les démos derrière la seule chose qu'elles
existent pour précéder. Une référence qui ne résout pas se signale déjà, sur son nœud.

### Comment elle s'ouvre

Le **premier niveau est déplié** dès que la machine répond, et rien en dessous : un espace qui
s'ouvre tout replié cache derrière un clic la seule chose qu'on vient y chercher, et tout
déplier noierait un projet dans le `node_modules` du voisin.

Ce dépliage est fait **une fois par espace**, pas à chaque arbre reçu : ensuite les plis
appartiennent à la personne, y compris ceux qu'elle a refermés.

Les lignes sont triées **alphabétiquement, à tous les niveaux**, dossiers et fichiers mêlés. Le
comparateur est `@studio/web-protocol/tree` — `Intl.Collator` : la casse et les accents ne
comptent pas, et `prise 2` précède `prise 10`. Il est dans un paquet et non dans une app parce
que la médiathèque trie ses familles avec le même, et deux ordres pour deux arbres du même
studio se lisent comme un bug dans l'un des deux.

L'arbre vient de `GET /workspace-tree` sur la machine, et **pas** de `/tree` : celui-là est
enraciné sur le projet ACTIF, délibérément, parce que c'est la question de l'éditeur et pas
celle-ci. Deux méthodes plutôt qu'un drapeau, pour cette raison exacte.

C'est du `FileNode`, le même type que partout ailleurs, avec le même drapeau `project?: boolean`
sur les dossiers et `app` qui dit laquelle des applications l'ouvre. Le dessin ne connaît donc que
ce type, jamais le service qui a répondu : changer de source ne lui coûte pas une ligne.

## Le trajet complet

1. Sur la page d'accueil, on colle une URI SSH. pl8 génère la clé de déploiement si elle
   n'existe pas encore et inscrit le dépôt à son registre ; la page enchaîne aussitôt sur
   `POST /workspaces/clone` et suit le job, **avec la progression de git à l'écran**. Le clone
   n'est pas un extra : cette liste ne montre que ce que la machine tient, donc sans lui l'ajout
   serait un formulaire qui ne change rien à l'écran.
2. La liste affiche chaque espace de travail avec **ses projets en retrait dessous** ; un clic sur
   l'un d'eux part directement dans son application, **dans un nouvel onglet**. Le nom de l'espace,
   lui, déplie l'arborescence — ici même —, où les dossiers-projets sont marqués de la même façon.
3. Dans les deux cas on arrive à `/<app>/<nom-du-dépôt>/<dossier>` — `/band/leclip.st0` pour
   une chanson — une ADRESSE, et le dépôt par son **nom court**, pas par son URI : une barre
   d'adresse se copie et se colle, et une URI SSH y traîne une machine, un port et un
   utilisateur.
4. L'application redemande à pl8 l'URI derrière ce nom (`GET /api/projects/by-name/:name`).
   Deux dépôts qui répondent au même nom court font un 409 plutôt qu'un choix silencieux.
5. Puis elle demande au file service `GET /workspaces/by-repo?uri=` : cette machine
   connaît-elle ce dépôt ?
6. Sinon, elle le clone, **avec la progression de git à l'écran**
   ([cloneJobs.md](../../../../packages/file-service/docs/cloneJobs.md)), puis ouvre le projet.

Les étapes 4 à 6 sont `@studio/project-shell`, montée à l'identique par st0 et par l'éditeur de
z0 : une divergence là serait un clone en double ou un 404. Voir
[launch.md](../../../../packages/project-shell/docs/launch.md).

**Une seule pile pour les deux applications, toujours.** z0 revient ici aussi en quittant un
projet — cette liste tient les dossiers `.z0` autant que les `.st0`, et un deuxième sélecteur de
son côté serait exactement la deuxième chose à tenir en phase que ce paquet existe pour éviter.

## Créer et supprimer un projet — sur la machine, pas ici

Le bloc de chaque dépôt porte un **« Nouveau projet »** (l'archétype, et un nom), et chaque
projet un petit **« Supprimer »** avec confirmation. Ni l'un ni l'autre n'est fait par pl8.

L'écran et la machine sont du même côté : ce que cette page appelle est le service de fichiers que
l'app entière utilise dès qu'un projet est ouvert, et pas une couture qui ne servirait qu'ici.

Ce sont **des appels explicites**, avec `fileBase` et le jeton
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
« hiver.z0 » dans un menu qui écrit du st0 donnerait « hiver.z0.st0 », qui ne serait ni l'un ni
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

Tout est un dossier `.st0` ouvert par le même st0, donc « quelle sorte de projet » n'a pas de
réponses à départager — ce qui diffère est la surface que le projet DÉCLARE
(`packages/song/docs/surfaces.md`). Il n'y a pas d'archétype « le graphe seul, aucune surface » :
une entrée dont la description entière serait « aucune des trois » n'est pas un choix qu'on fait
exprès, et un rig écrit à la main s'ouvre de toute façon. Le MODE `live` est autre chose : c'est
ce que `mix` déclare.

`createProjectIn` les distingue dans un `Record<ProjectShape, …>` et non dans une suite de `if` :
un quatrième archétype ajouté à `PROJECT_SHAPES` ne compilera plus tant que personne n'aura dit
ce qu'il écrit. La même raison que `HAS_SCAFFOLD`, plus bas.

> **Le service de fichiers connaît ces noms, et une machine en retard le dit.** `shape` voyage
> jusqu'à `POST /project/create`, dont le `z.enum` est `PROJECT_SHAPES`. Une machine dont le
> service est plus ancien que ces trois-là répond 400 — l'échec est visible et nommé, ce qui vaut
> mieux qu'un gabarit deviné à côté.

### Posséder un suffixe et pouvoir être créé sont deux questions

`ProjectApp` vaut `"st0" | "z0"` — k7 n'a pas de projets. Mais le menu ne reflète PAS ce type :
il reflète `SCAFFOLDED_APPS`, et confondre les deux fabrique un dossier dont le suffixe dit une
chose et le contenu une autre. Une seule application y figure, donc le menu offre les archétypes
d'un projet st0 plutôt qu'une liste d'applications.

Créer demande un **gabarit** — une carte de fichiers que le file-service sait écrire
(`createProjectIn`, et les modules `scaffold*` de `@studio/song`). z0 possède bien les dossiers
`.z0` et n'en a aucun. Le proposer fabriquerait donc un dossier `.z0` contenant une chanson st0 :
le suffixe dirait une chose, le contenu une autre, et rien ne s'en plaindrait avant que z0 essaie
de l'ouvrir. `HAS_SCAFFOLD` répond la question app par app, dans un `Record` et non une liste.

### Le verbe est `project commit`, et un succès doit se prouver

Deux pièges se cachent l'un l'autre ici, et ils méritent d'être écrits ensemble.

**Le verbe.** `commands.yaml` déclare `project commit`, pas `commit`. Une ligne qui ne
correspond à aucune commande **ne lève pas** : `runCommand` répond « unknown command ». Rien
n'est donc committé, et rien ne le dit.

**La lecture de la réponse.** Chercher des mots d'échec connus et conclure au succès pour tout le
reste est le mauvais défaut : ça annonce que tout va bien pour une commande qui n'existe pas.
`commitOutcome` exige une **preuve positive** — une ligne `committed …` — et rend la sortie brute
pour tout le reste, y compris ce qu'il ne reconnaît pas. C'est cette sortie qui nommera la
prochaine dérive entre ce code et `commands.yaml`.

Il est pur et dans son propre module, sans le moindre import : c'est ce qui le rend chargeable
par un test, `machine.ts` touchant `./api` — donc `window` — dès son chargement.

### Un envoi raté n'annule pas la création

Le commit vient après, et sa plainte est rapportée séparément : le dossier est là, sur la
machine, et seul l'envoi a manqué — hors ligne, pas d'amont. Le dialogue se ferme, la page
affiche « créé, mais : … ». Supprimer le projet pour faire propre serait jeter le travail de
quelqu'un pour une panne de réseau, et lever inviterait à recommencer une création qui a eu lieu.

Il n'y a rien à redemander après coup. Le projet est un dossier que la machine vient de faire, et
c'est elle qui répond la liste : il y apparaît au tick suivant, sans rafraîchissement à réclamer.

## Les partages, à la rangée du projet dont ils sortent

Un bouton **« Partages »** sur chaque rangée de projet, à côté de « Supprimer », ouvre une popin
qui liste les instantanés gelés que **ce projet-là** a publiés, et c'est le seul endroit où l'on
en retire un. **Les deux bouts sont st0** : `project share link` fabrique le paquet ici, sur la
machine qui a un moteur et peut donc rendre du son, et l'envoie à pl8 — qui en détient l'unique
copie et le sert à des gens sans compte.

Ce que le paquet contient et pourquoi est dans
[packages/commands/docs/shareBundle.md](../../../../packages/commands/docs/shareBundle.md) ; ce que
pl8 en fait, y compris pourquoi héberger ça ne contredit pas « pl8 ne fait jamais de copie de
travail », est dans [apps/pl8/docs/shares.md](../../pl8/docs/shares.md).

**À la rangée, et non dans une carte du compte entier.** Un partage SORT d'un projet, et la
question qu'on se pose est « qu'est-ce que j'ai publié de ce morceau-là », jamais « donne-moi les
vingt liens du compte triés par rien ». Une liste unique porterait le nom du projet sur chaque
ligne, c'est-à-dire qu'elle redessinerait à la main le groupement que la liste des projets fait
déjà. À la rangée, le regroupement est la disposition.

Ce que la popin doit dire, elle le dit :

- **le total en octets**, en tête — un partage n'expire jamais, donc voir ce qu'ils coûtent
  ensemble est la seule chose qui peut faire décider d'en retirer un ;
- **la ligne survit à la révocation, datée**, et le token est effacé du registre : un partage
  qui disparaîtrait laisserait son auteur se demander s'il a jamais existé, et une ligne révoquée
  ne doit pas pouvoir être recopiée depuis l'écran où elle est encore dessinée ;
- **l'adresse est un lien** et pas un bouton : c'est ce qu'on a envoyé aux autres, et la seule
  façon de vérifier ce qu'ils voient est de l'ouvrir ;
- la confirmation nomme les deux choses qui surprennent — les octets s'en vont tout de suite et
  pour de bon, et **un lien déjà envoyé ne se dé-envoie pas**.

Le **compte est sur le bouton** (« Partages (2) ») plutôt que dans la popin seule : sinon il
faudrait ouvrir dix popins pour savoir laquelle n'est pas vide, alors que c'est la chose qui doit
se lire d'un coup d'œil. Le bouton est là même à zéro, parce qu'un bouton qui apparaît et
disparaît selon l'état ne se cherche pas au bon endroit.

### Rattacher un partage à un projet est une jointure, et elle est faillible

`origin` est écrit par la machine, en deux basenames :

```ts
origin: { repo: basename(this.root), project: basename(dir) }   // file-service/src/workspace.ts
```

Donc `origin.repo` est le nom de l'**espace de travail** — `MachineWorkspace.name`, et pas le nom
court du dépôt chez pl8 — et `origin.project` est le **dernier segment avec son suffixe**, pas le
chemin. `sharesForProject.ts` franchit cet écart, seul et testé, parce que c'est le genre de règle
qu'on ne relit pas dans un JSX — nommé au long plutôt que « projectShares », qui se heurterait à
`ProjectShares.tsx` sur un disque insensible à la casse. Deux conséquences à connaître :

- un projet qui EST son espace de travail (`path: "."`) porte le nom de l'espace des deux côtés,
  `dir` valant `root` là-bas ;
- **deux projets du même nom dans deux dossiers d'un même espace sont indiscernables** et voient
  donc les mêmes lignes. Élargir la comparaison demande que la machine écrive le chemin ; ça se
  règle là-bas, et rien ici ne peut le deviner.

### Le prix : un partage orphelin n'a pas d'écran

Le partage d'un projet supprimé depuis, ou publié depuis une autre machine que celle-ci, n'a
aucune rangée à quoi s'accrocher : ses octets restent sur le volume de pl8, sans bouton pour les
reprendre. Le partage n'expire jamais, donc c'est définitif tant que personne n'appelle
`DELETE /api/shares/:key` à la main.

C'est un compromis assumé et non un oubli : le cas courant est « qu'ai-je publié de ce morceau »,
et ce qu'il faudrait pour couvrir l'autre — une deuxième liste, quelque part, montrant ce que la
première ne montre pas — ramène la carte du compte entier que le regroupement par rangée remplace.
Si ça se met à mordre, la réponse est un « Partages sans projet » dans l'en-tête de la page, vide
et donc invisible la plupart du temps.

Et il y a un second prix, plus discret : **cette popin est derrière la liste des projets, qui
exige une machine.** Les partages ne sont donc pas dans la colonne « se règle moteur éteint », où
sont la clé et les bibliothèques.

## Deux polls, parce qu'il y a deux services

La liste des projets est demandée à la **machine**, les partages et le registre à **pl8** : deux
services, deux minuteurs, et ils ne peuvent pas partager de jeton.

Celui de la machine n'en a d'ailleurs aucun devant lui — pas de `/revision` à interroger d'abord.
Le service répond la liste elle-même, derrière une fenêtre de cinq secondes de son côté
(`LISTING_RESCAN_MS`, la même que celle sous le scan de projets de `workspaceInfo`, et pour la
même raison : sans plancher, chaque onglet ferait un `readdir` par dossier toutes les trois
secondes). Demander d'abord si ça a bougé serait un aller-retour de plus pour économiser un scan
déjà mémoïsé.

Une liste en retard de cinq secondes est une rangée qui n'est pas encore apparue, c'est-à-dire une
attente. Le cache du document compilé refuse ce marché et doit le refuser — une compilation
périmée se trompe avec assurance sur une chanson — et c'est la différence qui vaut d'être notée.
Un clone ou un espace fait ici vide la fenêtre tout de suite (`forgetListing`), donc le seul retard
possible vient d'une main extérieure au processus.

### Le jeton dit « à jour », pas « en main »

`seen` retient la révision de ce qui a été chargé la dernière fois. Elle répond à « le service
a-t-il bougé depuis ? » — et **pas** à « est-ce que l'écran tient encore cette liste ? ». Vider
l'affichage en laissant le jeton intact fait donc que le poll ne recharge rien, donc que rien ne
remplace le vide : un spinner qui ne s'arrête plus.
Ici les deux vont ensemble — `onChanged` remet les deux jetons à `""`, ce qui force la relecture
au tick suivant plutôt que d'attendre qu'une révision bouge après une écriture qu'on vient de
faire.

## Ce qu'il faut vérifier dans un navigateur

Les suites d'ici tournent dans node et ne montent rien : `commitOutcome`, `projectName`,
`sharesForProject` et les six verbes de la barre (`homeCommands.test.ts` — le catalogue, la
résolution du dépôt, l'armement du delete) sont couverts, l'écran ne l'est pas. Ce qu'un run vert
ne dit pas :

- ouvrir `/` sans être connecté → l'écran de connexion, puis la page d'accueil ;
- **sans machine moteur** : la liste des projets est remplacée par la phrase qui dit pourquoi,
  le champ d'ajout et « Nouveau projet » sont gris, et la clé et les bibliothèques se règlent
  quand même — c'est le contrôle qui tient tout le paragraphe sur le prix payé ;
- **avec une machine et AUCUN dépôt de bibliothèques** : `Examples` est là, et une de ses démos
  s'ouvre sur `/@local/Examples/<démo>.st0`. C'est le contrôle du jour de l'installation ;
- déplier un espace, recharger la page → le même espace déplié, `?ws=` dans l'adresse ;
- créer un projet → la rangée apparaît **sans rien rafraîchir**, en cinq secondes au pire. Une
  rangée qui met plus longtemps est le signe que la liste ne vient plus de la machine ;
- ouvrir un projet → un nouvel onglet, la page d'accueil intacte derrière ; ctrl-clic et clic du
  milieu font la même chose ;
- quitter un projet depuis l'éditeur, et perdre son moteur au profit de quelqu'un d'autre → les
  deux ramènent ici ;
- créer un projet dans un dépôt **vide** que cette machine n'a jamais vu → le clone avec la
  progression de git, puis le dossier, puis le commit ;
- **« Partages » sur la rangée d'un projet qui en a** → le compte sur le bouton, la popin listant
  les siens et pas ceux du voisin ; sur un projet qui n'en a pas → la popin le dit ;
- le bouton ne doit **pas** ouvrir le projet : la rangée entière est un lien, et c'est le
  `preventDefault` qui l'en empêche ;
- révoquer un partage, puis ouvrir son lien → « introuvable » ;
- **la barre** : double-Shift lui donne le clavier ; `project new` ouvre un champ à trois valeurs
  puis demande le nom ; `project delete init` puis `confirm` supprime, et `confirm` seul refuse ;
  une ligne inconnue est refusée sans partir nulle part.
