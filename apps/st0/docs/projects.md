# Projets — les dépôts git appartiennent à la médiathèque

La médiathèque est la porte d'entrée du studio : c'est là qu'on voit ses morceaux, ses
samples, ses modules. Ses **dépôts git** y ont maintenant leur place aussi, dans une sixième
section, `/projects`.

Avant, ce niveau appartenait à l8 : `WorkspaceGate` listait les dossiers sous
`~/.studio/root/<vous>/`, offrait un formulaire de clone par URI SSH et une page de clé à
côté. C'était mal rangé — l8 n'est qu'un consommateur parmi d'autres, et « quels dépôts
possède cette personne » est une question de l'accueil, pas de l'éditeur.

C'est aussi la **section d'accueil** : `DEFAULT_SECTION` vaut `projects`. La médiathèque est la
porte d'entrée du studio, et la première chose qu'on veut à une porte d'entrée, c'est son
propre travail. Le catalogue est ce dont un projet *se sert* — il est à un onglet, pas devant.

## Le dépôt des BIBLIOTHÈQUES, avant tout le reste

Un compte en déclare **un**, en haut de la section, avant la liste des dépôts et avant
l'arborescence : les modules et les chaînes que tous ses projets héritent. Sans lui, l8 refuse
d'ouvrir quoi que ce soit — pas par principe, mais parce qu'aucune référence `@st0/…` ne
résoudrait, et qu'un morceau ouvert avec tous ses modules partagés manquants se lit comme un
morceau cassé plutôt que comme un compte qu'on n'a pas fini d'installer.

Un seul, pas une liste : il est monté à un chemin fixe dans chaque espace de travail
(`<espace>/_libraries`, voir
[packages/song/docs/sharedFolders.md](../../../packages/song/docs/sharedFolders.md)), et deux
dépôts qui réclament ce chemin est une question sans réponse. Une deuxième bibliothèque est un
dossier DANS ce dépôt, pas un deuxième dépôt.

Il est enregistré comme les autres — même URI SSH, même clé de déploiement, même identité par
URI normalisée — et rangé dans le même fichier par personne, sous `libraries` à côté de `repos`.
Ce qui diffère est le verbe : `PUT`, parce qu'il y en a un. Le poser deux fois avec la même URI
doit être le poser une fois.

**En changer ne touche aucune machine.** Les espaces de travail déjà clonés gardent l'ancien :
leur sous-module y pointe toujours, et le service de fichiers REFUSE de le réécrire plutôt que
de le faire en silence — remplacer le sous-module sous un projet qui s'en sert changerait tous
ses modules partagés d'un coup, pendant l'ouverture d'un morceau. La carte le dit au moment où
on change, et le message du refus nomme les deux URI.

## La règle qui tient tout

**Le suffixe du dossier nomme l'application.** `mysong.l8` s'ouvre dans l8, `partie.z0` dans
z0 ; c'est tout, et `packages/web-protocol/projects.ts` est la règle entière. Un dossier sans
suffixe n'est pas un projet, même s'il contient un `project.yaml`.

Deux suffixes, parce que deux applications ouvrent un projet. Tout ce qu'un projet l8 peut
ÊTRE est une **forme** à l'intérieur de `.l8` plutôt qu'une sorte de dossier : une chanson
porte ses pistes vidéo et sa surface `viewport` (`packages/song/docs/picture.md`), un set porte
son `songs.yaml` et sa surface `turntables` (`packages/song/docs/setProject.md`).

**st0 ne fait jamais de copie de travail.** Il tient un miroir *bare* et *sans blobs* de
chaque dépôt, uniquement pour répondre « qu'est-ce qu'il y a dedans ». La copie qu'on édite,
qu'on joue et qu'on committe vit sur la machine du moteur, et c'est le file service qui la
fait. Le pourquoi et le comment sont dans
[packages/git-repos/docs/mirror.md](../../../packages/git-repos/docs/mirror.md).

Les deux tiennent ensemble : un nom de dossier est une question sur l'ensemble des chemins, et
l'ensemble des chemins est exactement ce qu'est un arbre git. Aucun contenu de fichier n'est
nécessaire, donc aucun n'est téléchargé. Une règle qui aurait dû **ouvrir** un fichier ne
pourrait pas tourner ici du tout.

`project.yaml` n'a pas disparu pour autant — il reste ce qui rend un projet **compilable**, et
`@studio/song` pose toujours cette question-là, sur une vraie copie de travail. Un `.l8` sans
`project.yaml` est donc listé, ouvrable, et échoue à la compilation une fois ouvert, avec le
message de l8. C'est le bon ordre : st0 ne peut pas savoir, et c'est précisément ce qui permet
d'ouvrir un dossier qui n'est pas encore un morceau complet.

**Le file service applique la même règle** (`isProjectDir`, `workspace.ts`), donc ce que la
médiathèque liste et ce que l'arbre de l8 marque ne peuvent pas diverger. Une seule règle, aux
deux bouts.

> **Migration.** Un dossier de projet sans suffixe n'est plus un projet — ni ici, ni dans l8.
> Les cinq démos de `engine/capot/songs/` ont été renommées (`synth-demo.l8`, …) et sont donc
> des projets comme les autres ; leur champ `name:` reste sans suffixe, c'est leur libellé et
> non leur dossier. Un dépôt doit maintenant contenir **au moins un dossier suffixé** : un
> dépôt qui *est* lui-même un projet ne se liste pas, puisque sa racine n'a pas de nom dans
> l'arbre.

L'arbre rendu est du `FileNode` — **le même type** que celui que sert le file service, avec le
même drapeau `project?: boolean` sur les dossiers, plus `app` qui dit laquelle des
applications l'ouvre. Les deux arbres du dépôt dessinent donc les mêmes lignes.

## L'arborescence n'est pas le chemin normal

Ce qu'on vient chercher ici, c'est un projet — pas un dépôt. `GET /api/projects` renvoie donc
`projects: RepoProject[] | null` sur chaque dépôt, et la liste les dessine **en retrait sous le
leur**, chacun menant droit à son application. Le miroir avait déjà calculé cette liste pour en
compter les éléments ; ne renvoyer que le nombre obligeait à un second aller-retour, puis à un
dépliage d'arbre, pour arriver là où on allait de toute façon. Il n'y a pas de champ
`projectCount` à côté : c'est `projects.length`, et deux sources pour un même chiffre finissent
toujours par diverger.

`null` reste distinct de `[]` — « miroir jamais lu » n'est pas « aucun projet », et afficher un
dépôt sans projet alors qu'il n'a pas encore été récupéré serait un mensonge qui se corrige tout
seul dix secondes plus tard, donc que personne ne signalerait.

### Le compte de l'en-tête, et deux façons de le rater

Le badge de l'onglet compte les **projets**, pas les dépôts (`projects/count.ts`) : l'onglet
s'appelle « Projets », et un dépôt qui en contient cinq est cinq choses à ouvrir, pas une. Il a
longtemps affiché `repos.length`, ce qui donnait « 1 » à quelqu'un dont l'unique dépôt tenait
cinq projets — un chiffre juste pour une autre question.

Et son poll tourne sur **toute** section, pas seulement la sienne. Gardé derrière `isProjects`,
il n'était jamais chargé ailleurs et le badge valait zéro partout — un chiffre faux, ce qui est
pire qu'un chiffre absent. Les familles n'ont pas ce problème : `library.summary()` leur donne
un compte au démarrage, et les dépôts venant d'un autre service, ils n'y figurent pas.

En revanche il se tait ailleurs : une panne du service des dépôts ne doit pas barrer l'écran des
morceaux d'un message rouge sur autre chose. Sur sa propre section, où c'est le sujet, il parle.

L'arborescence garde son bouton : elle sert à regarder ce qu'il y a dedans, y compris les
dossiers qui ne sont pas des projets.

### Un projet s'ouvre dans un nouvel onglet

Les deux départs — la rangée en retrait sous le dépôt et le bouton de l'arborescence — sont
des **ancres** portant `target="_blank"`, et non des boutons qui affectent
`window.location`.

C'est la phrase du haut de cette page prise au mot : le catalogue est ce dont un projet *se
sert*, il est à un onglet. Un onglet dont on part n'est plus à un onglet. On ouvre un morceau
dans l8, et cinq minutes plus tard on veut le sample qui manque, ou la chaîne à côté — la
médiathèque doit être encore là, à sa section, avec ses dossiers dépliés. Un aller-retour par
le bouton « précédent » redemanderait `/api/projects`, replierait l'arbre du dépôt, et
arrêterait ce que `PlaybackProvider` était en train de jouer dans cet onglet-ci
([miniPlayer.md](miniPlayer.md)).

Et ouvrir un deuxième projet ne coûte alors plus rien : deux morceaux côte à côte sont deux
onglets, ce qui est exactement la façon dont on compare deux mixes.

Le corollaire est le type des props : `RepoList` et `RepoTree` reçoivent un `projectHref`,
pas un `onOpenProject`. **Une adresse et non une action** — la section calcule où mène la
rangée, la vue en fait un lien. Le navigateur fait le reste, et le fait mieux : ctrl-clic,
clic du milieu et « copier l'adresse du lien » marchent parce que c'en est une. Un
`window.open` dans un `onClick` aurait répondu la même chose aux trois.

`rel="noopener"` coupe `window.opener` : l8 n'a rien à dire à l'onglet d'où il vient, et
`@studio/project-shell` ne lit que son adresse à lui
([launch.md](../../../packages/project-shell/docs/launch.md)).

### Comment elle s'ouvre

Le **premier niveau est déplié** dès que le miroir répond, et rien en dessous : un dépôt qui
s'ouvre tout replié cache derrière un clic la seule chose qu'on vient y chercher, et tout
déplier noierait un projet dans le `node_modules` du voisin. Le calcul juste serait « les
dossiers qu'il faut traverser pour voir un projet » ; le premier niveau y arrive presque
toujours et ne dépend pas de ce qui a été chargé.

Ce dépliage est fait **une fois par dépôt**, pas à chaque arbre reçu : ensuite les plis
appartiennent à la personne, y compris ceux qu'elle a refermés, et un rafraîchissement
(bouton, ou `fetch` qui se termine) ne les rouvre pas.

Les lignes sont triées **alphabétiquement, à tous les niveaux**, dossiers et fichiers mêlés :
git répond dans l'ordre de son arbre, qui n'est pas un ordre où l'on cherche quelque chose. Le
comparateur est celui de la médiathèque — `frontend/src/treeOrder.ts`, `Intl.Collator` : la
casse et les accents ne comptent pas, et `prise 2` précède `prise 10`. Les deux arbres de st0
se lisent donc pareil.

## Le trajet complet

1. Dans **Projets**, on colle une URI SSH. st0 génère la clé de déploiement si elle n'existe
   pas encore, enregistre le dépôt et lance le miroir en tâche de fond.
2. La liste affiche chaque dépôt avec **ses projets en retrait dessous** ; un clic sur l'un
   d'eux part directement dans son application, **dans un nouvel onglet**. Le nom du dépôt,
   lui, ouvre l'arborescence — ici même —, où les dossiers-projets sont marqués de la même
   façon.
3. Dans les deux cas on arrive à `/<app>/<nom-du-dépôt>/<dossier>` — `/l8/band/leclip.l8`
   pour une chanson — une ADRESSE, et le dépôt
   par son **nom court**, pas par son URI : une barre d'adresse se copie et se colle, et une
   URI SSH y traîne une machine, un port et un utilisateur.
4. L'application nous redemande l'URI derrière ce nom (`GET /api/projects/by-name/:name`).
   Nous seuls la connaissons. Deux dépôts qui répondent au même nom court font un 409 plutôt
   qu'un choix silencieux.
5. Puis elle demande au file service `GET /workspaces/by-repo?uri=` : cette machine
   connaît-elle ce dépôt ?
6. Sinon, elle le clone, **avec la progression de git à l'écran**
   ([cloneJobs.md](../../../packages/file-service/docs/cloneJobs.md)), puis ouvre le projet.

Les étapes 4 à 6 sont `@studio/project-shell`, montée à l'identique par les deux applications :
une divergence là serait un clone en double ou un 404. Chacune ne connaît que ça — le projet sur
lequel elle a été lancée. Voir
[packages/project-shell/docs/launch.md](../../../packages/project-shell/docs/launch.md), notamment pourquoi
l'adresse est un chemin et non des paramètres — ce qui supprime le `sessionStorage` d'avant.

## Créer et supprimer un projet — pas ici, sur la machine

Le bloc de chaque dépôt porte un **« Nouveau projet »** (le type, et un nom), et chaque
projet un petit **« Supprimer »** avec confirmation. Ni l'un ni l'autre n'est fait par st0, et
c'est la conséquence directe de la règle du haut de cette page.

### Pourquoi st0 ne peut pas

Son miroir est `git clone --mirror --filter=blob:none` : bare, donc aucune copie de travail, et
sans blobs, donc les chemins sans les contenus. Trois raisons, par ordre de gravité :

1. **C'est un cache.** Un miroir que personne n'a lu depuis quinze jours est supprimé et recréé
   au prochain regard. Y écrire la seule copie d'un projet neuf, c'est la mettre dans ce qui est
   conçu pour être jeté.
2. **Le partage est déjà posé** : st0 miroite pour répondre « qu'est-ce qu'il y a dedans », et
   la copie qu'on édite et qu'on committe vit sur la machine du moteur.
3. **Techniquement faisable, et c'est le piège.** On *peut* fabriquer un commit en plomberie et
   pousser depuis un clone bare sans blobs. Mais ça ferait de st0 — le service qui émet aussi la
   session de tout le monde et détient l'unique clé de déploiement — un **écrivain de tous les
   dépôts**. C'est un changement de posture de sécurité, pas une fonctionnalité.

### Ce que la machine sait déjà faire

Tout existait, et rien n'a été ajouté côté file-service :

| pièce | où |
|---|---|
| échafaudage aux réglages par défaut | `POST <fileBase>/project/create` → `createProjectIn` |
| suppression (le dossier est recyclé) | `POST <fileBase>/project/delete` |
| indexer, committer, pousser | la commande `commit` → `packages/commands/src/git.ts` |
| cloner le dépôt s'il n'y est pas | `POST /workspaces/clone` + les jobs à interroger |

st0 appelle ces routes **directement depuis le navigateur**, par la même couture que
`engineMachine.analyse` et `.logs` : c'est déjà la seule façon d'apprendre un fait sur une
machine plutôt que sur la bibliothèque.

### Le clonage est ce qui rend un dépôt vide utilisable

`ensureWorkspace` clone si la machine ne connaît pas encore le dépôt. Sans ça il faudrait déjà
avoir un projet pour pouvoir en ouvrir un, donc pour pouvoir en créer un — un œuf sans poule,
qui rendrait la fonction inutile précisément sur les dépôts neufs. La progression affichée est
celle de git, dans ses mots (« Receiving objects »), parce qu'une attente de trente secondes qui
ne dit rien ressemble à un écran figé.

### Le suffixe décide, et le nom est montré avant

`projectName.ts` est pur et testé : c'est lui qui pose le suffixe, retire un suffixe
déjà tapé — « hiver.z0 » dans un menu qui écrit du l8 donnerait « hiver.z0.l8 », qui ne serait
ni l'un ni l'autre — et refuse les séparateurs plutôt que de les remplacer en silence.

Un suffixe ne se lit **qu'à la fin** : « prise v1 » est un nom de dossier parfaitement
ordinaire, et rien n'y touche. C'est déjà la règle de `projectApp`, et `projectName.test.ts`
la fixe des deux côtés. Le dossier obtenu est affiché sous le champ **avant** de valider,
comme `AddSong` montre l'arborescence déduite avant l'envoi : ici aussi c'est le nom qui
décide de tout.

### Posséder un suffixe et pouvoir être créé sont deux questions

`ProjectApp` vaut `"l8" | "z0"` — k7 n'a pas de projets. Mais le menu ne reflète PAS ce type :
il reflète `SCAFFOLDED_APPS`, et confondre les deux fabrique un dossier dont le suffixe dit une
chose et le contenu une autre. Une seule application y figure, donc le menu offre les trois
**formes** d'un projet l8 plutôt qu'une liste d'applications — voir `PROJECT_SHAPES` dans
`@studio/song`.

Créer demande un **gabarit** — une carte de fichiers que le file-service sait écrire
(`createProjectIn`, et les modules `scaffold*` de `@studio/song`). z0 possède bien les
dossiers `.z0` et n'en a aucun. Le proposer fabriquait donc un dossier `.z0` contenant une
chanson l8 : le suffixe disait une chose, le contenu une autre, et rien ne s'en plaignait
avant que z0 essaie de l'ouvrir.

`HAS_SCAFFOLD` répond la question app par app, dans un `Record` et non une liste : ajouter une
application à `ProjectApp` ne compilera plus tant que personne n'aura répondu pour elle.

### Le verbe est `project commit`, et un succès doit se prouver

Deux pièges se sont refermés ensemble, et ils méritent d'être écrits parce qu'ils se cachaient
l'un l'autre.

**Le verbe.** `commands.yaml` déclare `project commit`, pas `commit`. Une ligne qui ne
correspond à aucune commande **ne lève pas** : `runCommand` répond « unknown command ». Rien
n'était donc committé, et rien ne le disait.

**La lecture de la réponse.** La première version cherchait des mots d'échec connus et
concluait au succès pour tout le reste. C'est le mauvais défaut : elle a donc annoncé que tout
allait bien pour une commande qui n'existait pas. `commitOutcome` exige maintenant une **preuve
positive** — une ligne `committed …` — et rend la sortie brute pour tout le reste, y compris ce
qu'elle ne reconnaît pas. C'est cette sortie qui nommera la prochaine dérive entre ce code et
`commands.yaml`.

Il est pur et dans son propre module, sans le moindre import : c'est ce qui le rend chargeable
par un test, `machine.ts` touchant `../api` — donc `window` — dès son chargement.

**Et une faute latente du file-service, révélée par là.** Sa liste des commandes qui ne
demandent pas de projet actif était `/^(channels|channel|audio|commit|pull)\b/` : elle ne
reconnaît **ni** `project commit` **ni** `project pull`, donc les deux commandes git étaient
refusées avec « no project » dès qu'aucun projet n'était ouvert — à rebours de son propre
commentaire, et de `repoDir: ws.root` posé juste au-dessus « so it works with no project open ».
Personne ne l'avait vu parce que la barre de commandes de l8 a toujours un projet ouvert ; st0,
qui crée un projet sans jamais l'ouvrir, est le premier appelant à arriver sans.

### Un envoi raté n'annule pas la création

Le commit vient après, et sa plainte est rapportée séparément : le dossier est là, sur la
machine, et seul l'envoi a manqué — hors ligne, pas d'amont. Le dialogue se ferme, la section
affiche « créé, mais : … ». Supprimer le projet pour faire propre serait jeter le travail de
quelqu'un pour une panne de réseau, et lever inviterait à recommencer une création qui a eu lieu.

Après coup, st0 demande explicitement un `git fetch` de son miroir : le poll n'en fait un qu'au
plus toutes les dix minutes, et la liste serait sinon restée telle quelle — un clic qui a l'air
de n'avoir rien fait.

Sans machine joignable, les deux boutons sont grisés **et disent pourquoi**. C'est un état
ordinaire de cette page, qui fonctionne parfaitement sans machine pour tout le reste.

## Pourquoi la comparaison des URI est normalisée

Les deux bouts apprennent l'adresse par des chemins différents : st0 a ce qui a été **collé**,
le file service a ce que git a écrit dans `remote.origin.url`. `git@host:moi/depot.git` et
`ssh://git@host/moi/depot` sont le même dépôt ; comparer les chaînes brutes reclonerait ce qui
est déjà là. `normalizeGitUri` replie les deux orthographes sur `host[:port]/chemin`, sans
`.git` et sans l'utilisateur SSH — et c'est aussi ce qui donne son `id` à un dépôt, donc
ajouter deux fois le même n'en fait pas deux.

## Une seule clé, et elle voyage

st0 détient l'identité git du studio : il génère la paire, garde la moitié privée, et le file
service en récupère une copie par le canal que les deux services partagent déjà
(`MEDIATEK_URL` + `MEDIATEK_TOKEN`). **Une seule clé de déploiement à enregistrer chez
l'hébergeur git**, au lieu de deux.

Ce que ça coûte et ce qui l'encadre — route en bearer seul, `no-store`, jamais journalisée —
est dans [packages/git-repos/docs/keys.md](../../../packages/git-repos/docs/keys.md). C'est un
compromis assumé, pas un oubli : le lire avant de le « corriger ».

**Pour qui** la machine demande est une question à part, et c'est celle qui a coûté le plus :
le jeton qu'une machine détient est celui d'un service, qui n'a pas de clé, tandis que la clé
est classée sous le sujet OIDC de la personne. La route accepte donc qu'un jeton de service
nomme quelqu'un, et st0 tient l'annuaire `email → sujet` qui relie les deux orthographes —
[sshKeyForService.md](sshKeyForService.md).

## Où vivent les choses

Tout est sous un **dot-dossier** du volume, comme `.prefs` : `writablePath` le refuse
(`packages/mediatek/src/layout.ts:203`) et `revision.ts` ne le parcourt pas, donc rien de tout
ça n'apparaît jamais dans un scan de famille ni dans l'API fichier.

```
<STUDIO_MEDIATEK>/.projects/
  repos/<slug>-<hash>.json      ses dépôts, et son dépôt de bibliothèques
  ssh/<slug>-<hash>/            sa paire de clés
  mirrors/<slug>-<hash>/<id>.git  les miroirs bare, sans blobs
```

Le fichier porte deux champs, `repos` et `libraries`, et l'écriture les FUSIONNE : les deux
s'éditent depuis deux endroits de l'écran et rien ne les sérialise, donc écrire une moitié ne
doit pas pouvoir jeter l'autre.

Le nommage `<slug>-<hash>` est celui de `@studio/user-prefs` (`fileFor`), repris tel quel : un
`sub` OIDC est une chaîne opaque choisie par l'IdP et ne peut jamais être un segment de chemin
en l'état. L'écriture, en revanche, **lève** au lieu d'être silencieuse comme celle des
préférences : perdre une préférence coûte un réglage à refaire, perdre un dépôt qu'on vient
d'ajouter donne un 200 pour quelque chose qui n'a pas eu lieu.

Un miroir que personne n'a lu depuis quinze jours est supprimé ; le prochain regard le
recrée. Une éviction coûte une attente, jamais une donnée — le dépôt est ailleurs, et ceci
n'en est qu'une copie.

## Deux polls, et c'est voulu

La médiathèque a **un** poll pour toutes ses sections, parce qu'elles partagent un volume et
une carte de jetons. Projets a le sien, parce qu'il vient d'un autre service. Les fondre
ferait dépendre chaque tick du catalogue de `/api/projects` — et un `git fetch` qui traîne
empêcherait la médiathèque de se rafraîchir.

Un `git fetch` coûte du réseau, donc le miroir n'est pas rafraîchi à chaque affichage : à
l'ajout, sur le bouton, et au plus une fois par dix minutes. C'est la raison pour laquelle
`useGitStatus` dans l8 est déjà sur un timer de dix minutes.

### Le jeton dit « à jour », pas « en main »

La carte `seen` retient, par section, la révision de ce qui a été chargé la dernière fois. Elle
répond à « le volume a-t-il bougé depuis ? » — et **pas** à « est-ce que l'écran tient encore
cette liste ? ». Or `entries` n'en tient qu'une à la fois.

C'est ce qui produisait un spinner qui ne s'arrêtait plus : en revenant sur une section déjà
vue et inchangée, le vidage de l'affichage laissait le jeton intact, donc le poll ne rechargeait
rien, donc rien ne remplaçait le vide. Un rechargement de page « réparait » parce qu'il repart
avec des jetons vides — le signe qu'il fallait chercher du côté d'un état survivant.

Les deux vont donc ensemble maintenant, dans un seul effet sur `section` : on jette la liste
**et** le jeton. Dans un effet et non dans le clic d'onglet, parce que le bouton « précédent »
et un lien profond changent aussi de section (voir [routing.md](routing.md)) sans passer par lui.

## Ce qui tourne dans l'image

Le conteneur st0 installe `git` **et `openssh-client`** : chaque dépôt est joint par SSH, donc
git seul ne clonerait rien. `openssh-client` porte à la fois `ssh` — que nomme
`GIT_SSH_COMMAND` — et `ssh-keygen`, qui fabrique la paire.

Tout appel à git depuis ce service hébergé porte le même durcissement que le clone du file
service, et pour les mêmes raisons : `GIT_CONFIG_GLOBAL=/dev/null` et `GIT_CONFIG_NOSYSTEM=1`
(un `url.insteadOf` personnel retournerait l'URI SSH en https, privilège compris),
`GIT_TERMINAL_PROMPT=0`, `--` avant l'URI, et des délais bornés.
