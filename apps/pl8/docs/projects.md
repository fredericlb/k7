# Projets — pl8 tient le REGISTRE des dépôts, st0 les dessine

Ce service tient la liste des dépôts git d'un compte, détient l'unique clé de déploiement, et sert
`/api/projects`. Il ne les **montre** plus : l'écran est la page d'accueil de st0 (`/`), et
[apps/st0/frontend/docs/projects.md](../../st0/frontend/docs/projects.md) est la page à lire pour
tout ce qui se dessine. Celle-ci ne parle que de ce que ce service détient et de pourquoi c'est
lui.

> **Il ne dit plus ce qu'il y a DEDANS.** Il tenait un miroir *bare* et *sans blobs* de chaque
> dépôt pour répondre à ça — `git clone --mirror --filter=blob:none`, les chemins sans les
> contenus. Le miroir est supprimé, avec son code. C'était une deuxième copie de ce que la
> machine du moteur tient déjà, en retard d'un `git fetch`, et aveugle à un projet committé là-bas
> dont l'envoi n'était pas passé. Le service de fichiers répond désormais
> `GET /workspaces/projects` depuis les espaces de travail clonés. Ce qui reste ici est ce
> qu'aucune machine ne peut tenir : une liste qui appartient à une personne.

> **Ce qui a bougé, ce qui n'a pas.** Il y a eu ici une sixième section, `/projects`, qui était
> même la section d'accueil. Elle est partie entière — l'onglet, son compte, son poll et son
> routage. Aucune route n'a bougé avec elle : `/api/projects`, `/api/shares` et
> `/api/projects/ssh-key` sont toujours ici, et st0 les appelle depuis la même origine. Ce
> déménagement n'a rien changé à la posture de sécurité décrite plus bas — pl8 n'écrit toujours
> dans aucun dépôt.

## Pourquoi c'est ce service qui détient tout ça

Un dépôt appartient à une **personne**, pas à une machine. Ce service est le seul qui survive à
chaque moteur, tienne un volume, et sache déjà nommer quelqu'un : c'est là que vivent les
préférences, les jetons et la session de tout le monde. Une machine de moteur, elle, va et vient
et peut être reformatée un soir sans que le studio y perde une adresse.

## pl8 ne fait aucune copie d'un dépôt

Plus aucune, désormais : la seule qu'il faisait était le miroir. La copie qu'on édite, qu'on joue
et qu'on committe vit sur la machine du moteur, et c'est le file service qui la fait.

La seule chose lourde que ce service détient à propos d'un projet est un **partage** — une copie
gelée, publiée exprès, dont il est bel et bien la seule copie. Ce n'est pas une exception à la
règle du dessus, et [shares.md](shares.md) ouvre en disant pourquoi.

### Le nom du dossier suffit à répondre — et l'argument survit au miroir

**Le suffixe du dossier nomme l'application** : `mysong.st0` s'ouvre dans st0, `partie.z0` dans z0
(`packages/web-protocol/projects.ts` est la règle entière).

Le NOM, et pas le contenu. C'est ce qui rendait la question répondable depuis un miroir sans
blobs : un nom de dossier est une question sur l'ensemble des chemins, et l'ensemble des chemins
est exactement ce qu'est un arbre git. Le miroir n'est plus là, mais la règle reste, et pour une
raison qui n'a jamais dépendu de lui : « qui ouvre ce dossier » et « le moteur peut-il en être
nourri » sont deux questions différentes, et seule la seconde a besoin de lire un fichier.

`project.yaml` reste donc ce qui rend un projet **compilable**, et `@studio/song` pose toujours
cette question-là, sur une vraie copie de travail. Un `.st0` sans `project.yaml` est listé,
ouvrable, et échoue à la compilation une fois ouvert, avec le message de st0. C'est le bon ordre.

**Le file service applique cette règle** (`isProjectDir`, `workspace.ts`), et c'est maintenant le
seul qui l'applique : lister et marquer sont le même code, du même côté. Il n'y a plus deux bouts
à tenir en phase, ce qui est une raison de moins de se tromper.

> **Migration.** Un dossier de projet sans suffixe n'est plus un projet. Les cinq démos de
> `engine/capot/songs/` ont été renommées (`synth-demo.st0`, …) ; leur champ `name:` reste sans
> suffixe, c'est leur libellé et non leur dossier. Un dépôt doit contenir **au moins un dossier
> suffixé** : un dépôt qui *est* lui-même un projet ne se liste pas, puisque sa racine n'a pas de
> nom dans l'arbre.

### Ce que `GET /api/projects` répond

Le registre, et rien d'autre : `id`, `uri`, `name` (le nom court), `label`, `addedAt`. Plus de
`projects`, plus de `branch`, plus d'état de récupération — les trois décrivaient le miroir.

**Un appelant le lit encore, et pour une raison précise.** La page d'accueil de st0 dessine les
espaces de travail de la machine ; ce registre est ce qui dit si l'adresse portable
`/<dépôt>/<projet>` se résoudra, puisque `by-name` ci-dessous est demandé ici. Une copie que la
machine a et que ce registre ignore s'ouvre par `@local` et pas autrement.

## Le dépôt des bibliothèques est rangé ici aussi

Un compte en déclare **un** : les modules et les chaînes que tous ses projets héritent. Il est
enregistré comme les autres — même URI SSH, même clé de déploiement, même identité par URI
normalisée — et rangé dans le même fichier par personne, sous `libraries` à côté de `repos`. Ce
qui diffère est le verbe : `PUT`, parce qu'il y en a un. Le poser deux fois avec la même URI doit
être le poser une fois.

Un seul, pas une liste : il est monté à un chemin fixe dans chaque espace de travail
(`<espace>/_libraries`, voir
[packages/song/docs/sharedFolders.md](../../../packages/song/docs/sharedFolders.md)), et deux
dépôts qui réclament ce chemin est une question sans réponse.

`libraries: null` est un **200**, pas un 404 : « aucun » est l'état ordinaire d'un compte neuf, et
un code de statut est le mauvais endroit pour garder la différence entre ça et un service en
panne. Seul le second mérite un diagnostic. st0 refuse d'ouvrir un projet sans, et le dit sur sa
page d'accueil avant de cloner quoi que ce soit.

**Un dépôt vide reçoit un commit vide, une fois** : à la première ouverture d'un projet, le
service de fichiers fait la racine qui manque et la pousse (`initIfEmpty`), parce qu'un gitlink
doit pointer sur un commit et qu'un dépôt créé dans une interface web n'en a aucun. C'est lui et
pas pl8, pour la raison juste en dessous.

Il y recopiait le catalogue de ce service — `modules/` et `chains/` — tant que ce volume en
tenait. Il n'en tient plus : un module s'écrit dans st0, contre un projet où le greffon qu'il
nomme est réellement chargé. Il n'y a donc plus rien à semer, et le commit vide est tout ce qui
reste de cette étape.

## Pourquoi pl8 n'écrit dans aucun dépôt

La raison qui compte n'a pas changé avec le miroir, et c'est celle-ci : **en faire un écrivain de
tous les dépôts est un changement de posture de sécurité, pas une fonctionnalité.** pl8 émet la
session de tout le monde et détient l'unique clé de déploiement ; lui donner en plus le droit
d'écrire partout concentre tout au même endroit.

C'était techniquement faisable même depuis un clone bare sans blobs — on peut fabriquer un commit
en plomberie et le pousser — et c'était le piège de l'argument : « on ne peut pas » aurait été
faux, et donc fragile. « On ne veut pas » tient toujours.

Créer et supprimer un projet passent donc par le service de fichiers de la machine, et l'ont
toujours fait. Ce que le déménagement de l'écran a changé, c'est que l'écran et cette machine sont
du même côté ; ce que le retrait du miroir a changé, c'est que la LECTURE les a rejoints.

## Pourquoi la comparaison des URI est normalisée

Les deux bouts apprennent l'adresse par des chemins différents : pl8 a ce qui a été **collé**,
le file service a ce que git a écrit dans `remote.origin.url`. `git@host:moi/depot.git` et
`ssh://git@host/moi/depot` sont le même dépôt ; comparer les chaînes brutes reclonerait ce qui
est déjà là. `normalizeGitUri` replie les deux orthographes sur `host[:port]/chemin`, sans `.git`
et sans l'utilisateur SSH — et c'est aussi ce qui donne son `id` à un dépôt, donc ajouter deux
fois le même n'en fait pas deux.

## Une seule clé, et elle voyage

pl8 détient l'identité git du studio : il génère la paire, garde la moitié privée, et le file
service en récupère une copie par le canal que les deux services partagent déjà
(`MEDIATEK_URL` + `MEDIATEK_TOKEN`). **Une seule clé de déploiement à enregistrer chez
l'hébergeur git**, au lieu de deux.

Ce que ça coûte et ce qui l'encadre — route en bearer seul, `no-store`, jamais journalisée — est
dans [packages/git-repos/docs/keys.md](../../../packages/git-repos/docs/keys.md). C'est un
compromis assumé, pas un oubli : le lire avant de le « corriger ».

**Pour qui** la machine demande est une question à part, et c'est celle qui a coûté le plus : le
jeton qu'une machine détient est celui d'un service, qui n'a pas de clé, tandis que la clé est
classée sous le sujet OIDC de la personne. La route accepte donc qu'un jeton de service nomme
quelqu'un, et pl8 tient l'annuaire `email → sujet` qui relie les deux orthographes —
[sshKeyForService.md](sshKeyForService.md).

## Où vivent les choses

Tout est sous un **dot-dossier** du volume, comme `.prefs` : `writablePath` le refuse
(`packages/mediatek/src/layout.ts:203`) et `revision.ts` ne le parcourt pas, donc rien de tout ça
n'apparaît jamais dans un scan de famille ni dans l'API fichier.

```
<STUDIO_MEDIATEK>/.projects/
  repos/<slug>-<hash>.json      ses dépôts, et son dépôt de bibliothèques
  ssh/<slug>-<hash>/            sa paire de clés
```

> Il y avait un `mirrors/<slug>-<hash>/<id>.git` à côté. Le code qui l'écrivait et le balayait est
> parti ; un volume déjà déployé garde donc le dossier, inerte, et il est supprimable à la main.

Le fichier porte deux champs, `repos` et `libraries`, et l'écriture les FUSIONNE : les deux
s'éditent depuis deux endroits de l'écran et rien ne les sérialise, donc écrire une moitié ne
doit pas pouvoir jeter l'autre.

Le nommage `<slug>-<hash>` est celui de `@studio/user-prefs` (`fileFor`), repris tel quel : un
`sub` OIDC est une chaîne opaque choisie par l'IdP et ne peut jamais être un segment de chemin en
l'état. L'écriture, en revanche, **lève** au lieu d'être silencieuse comme celle des préférences :
perdre une préférence coûte un réglage à refaire, perdre un dépôt qu'on vient d'ajouter donne un
200 pour quelque chose qui n'a pas eu lieu.

## Ce qui tourne dans l'image

Le conteneur pl8 installe `openssh-client` pour `ssh-keygen`, qui fabrique la paire de clés. Il
n'appelle plus `git` du tout : le clone du miroir était le seul appel, et il est parti avec lui.

Ce que ce service faisait quand il en appelait un portait le même durcissement que le clone du
file service, et c'est là qu'il faut le relire si un appel à git revenait ici un jour :
`GIT_CONFIG_GLOBAL=/dev/null` et `GIT_CONFIG_NOSYSTEM=1` (un `url.insteadOf` personnel
retournerait l'URI SSH en https, privilège compris), `GIT_TERMINAL_PROMPT=0`, `--` avant l'URI,
et des délais bornés — `packages/file-service/src/workspaces.ts` les applique tous.
