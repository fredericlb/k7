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

## La règle qui tient tout

**Le suffixe du dossier nomme l'application.** `mysong.l8` s'ouvre dans l8, `myset.m9` dans
m9 ; c'est tout, et `packages/web-protocol/projects.ts` est la règle entière. Un dossier sans
suffixe n'est pas un projet, même s'il contient un `project.yaml`.

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
à m9 d'ouvrir un projet qui n'est pas un morceau l8 complet.

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
même drapeau `project?: boolean` sur les dossiers, plus `app` qui dit laquelle des deux
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
3. Dans les deux cas on arrive à `/<app>/<nom-du-dépôt>/<dossier>` — une ADRESSE, et le dépôt
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
l'adresse est un chemin et non des paramètres — ce qui supprime le `sessionStorage` d'avant — et
[apps/m9/docs/views.md](../../m9/docs/views.md) pour ce que m9 fait d'un projet.

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
  repos/<slug>-<hash>.json      la liste des dépôts d'une personne
  ssh/<slug>-<hash>/            sa paire de clés
  mirrors/<slug>-<hash>/<id>.git  les miroirs bare, sans blobs
```

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
