# Projets — pl8 tient le REGISTRE des dépôts, st0 les dessine

Ce service tient la liste des dépôts git d'un compte, détient l'unique clé de déploiement, et sert
`/api/projects`. Il ne les **montre** pas : l'écran est la page d'accueil de st0 (`/`), et
[apps/st0/frontend/docs/projects.md](../../st0/frontend/docs/projects.md) est la page à lire pour
tout ce qui se dessine. Celle-ci ne parle que de ce que ce service détient et de pourquoi c'est
lui.

> **Il ne dit pas ce qu'il y a DEDANS.** Cette question est celle du service de fichiers, qui
> répond `GET /workspaces/projects` depuis les espaces de travail clonés — la copie de travail
> est chez lui, donc la réponse aussi. Ce qui reste ici est ce qu'aucune machine ne peut tenir :
> une liste qui appartient à une personne.

`/api/projects`, `/api/shares` et `/api/projects/ssh-key` sont servies ici, et st0 les appelle
depuis la même origine.

## Pourquoi c'est ce service qui détient tout ça

Un dépôt appartient à une **personne**, pas à une machine. Ce service est le seul qui survive à
chaque moteur, tienne un volume, et sache déjà nommer quelqu'un : c'est là que vivent les
préférences, les jetons et la session de tout le monde. Une machine de moteur, elle, va et vient
et peut être reformatée un soir sans que le studio y perde une adresse.

## pl8 ne fait aucune copie d'un dépôt

La copie qu'on édite, qu'on joue et qu'on committe vit sur la machine du moteur, et c'est le file
service qui la fait.

La seule chose lourde que ce service détient à propos d'un projet est un **partage** — une copie
gelée, publiée exprès, dont il est bel et bien la seule copie. Ce n'est pas une exception à la
règle du dessus, et [shares.md](shares.md) ouvre en disant pourquoi.

### Le nom du dossier suffit à répondre

**Le suffixe du dossier nomme l'application** : `mysong.st0` s'ouvre dans st0, `partie.z0` dans z0
(`packages/web-protocol/projects.ts` est la règle entière).

Le NOM, et pas le contenu : « qui ouvre ce dossier » et « le moteur peut-il en être nourri » sont
deux questions différentes, et seule la seconde a besoin de lire un fichier. Un nom de dossier est
une question sur l'ensemble des chemins, et l'ensemble des chemins est exactement ce qu'est un
arbre git.

`project.yaml` est donc ce qui rend un projet **compilable**, et `@studio/song` pose cette
question-là, sur une vraie copie de travail. Un `.st0` sans `project.yaml` est listé, ouvrable, et
échoue à la compilation une fois ouvert, avec le message de st0. C'est le bon ordre.

**Le file service applique cette règle** (`isProjectDir`, `workspace.ts`), et il est le seul à
l'appliquer : lister et marquer sont le même code, du même côté. Un seul endroit à tenir juste,
ce qui est une raison de moins de se tromper.

> **Le suffixe est obligatoire.** Un dossier de projet sans suffixe n'est pas un projet — les
> démos de `engine/capot/songs/` s'appellent `synth-demo.st0`, `rack-demo.st0`… ; leur champ
> `name:` reste sans suffixe, c'est leur libellé et non leur dossier. Un dépôt doit contenir **au
> moins un dossier suffixé** : un dépôt qui *est* lui-même un projet ne se liste pas, puisque sa
> racine n'a pas de nom dans l'arbre.

### Ce que `GET /api/projects` répond

Le registre, et rien d'autre : `id`, `uri`, `name` (le nom court), `label`, `addedAt`.

**Un appelant le lit, et pour une raison précise.** La page d'accueil de st0 dessine les espaces
de travail de la machine ; ce registre est ce qui dit si l'adresse portable `/<dépôt>/<projet>` se
résoudra, puisque `by-name` ci-dessous est demandé ici. Une copie que la machine a et que ce
registre ignore s'ouvre par `@local` et pas autrement.

### `by-name` : le nom court redevient une URI, ici et nulle part ailleurs

L'adresse d'un projet est `/<dépôt>/<projet>`, donc un éditeur arrive en tenant un **nom** et rien
d'autre. Il ne doit surtout pas tenir l'URI : celle-ci porte un hôte, un port et un utilisateur, et
une barre d'adresse se copie, se met en signet et se colle dans une conversation. pl8 détient les
dépôts, donc c'est pl8 qui retourne la moitié lisible en ce qu'on donne à git.

Une ambiguïté n'est **pas** « on en prend un » : deux dépôts portant le même nom court répondent
409 avec les deux URI, et on ouvre le projet depuis la page d'accueil de st0.

`by-name` et `libraries` sont montés **avant** `/:id/*`. Ni l'un ni l'autre n'est un identifiant de
dépôt — ce sont des hachages — mais un lecteur ne devrait pas avoir à le savoir pour en être sûr.

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

Rien n'y est semé : un module s'écrit dans st0, contre un projet où le greffon qu'il nomme est
réellement chargé, et ce volume n'en tient aucun. Le commit vide est donc toute cette étape.

## Pourquoi pl8 n'écrit dans aucun dépôt

**En faire un écrivain de tous les dépôts est un changement de posture de sécurité, pas une
fonctionnalité.** pl8 émet la session de tout le monde et détient l'unique clé de déploiement ;
lui donner en plus le droit d'écrire partout concentre tout au même endroit.

Attention au piège de l'argument : « on ne peut pas » serait faux, et donc fragile — fabriquer un
commit en plomberie et le pousser est à la portée de n'importe quel clone, même bare et sans
blobs. « On ne veut pas » tient.

Créer et supprimer un projet passent donc par le service de fichiers de la machine, qui est aussi
celui qui LIT : l'écran, la lecture et l'écriture sont du même côté.

## Pourquoi la comparaison des URI est normalisée

Les deux bouts apprennent l'adresse par des chemins différents : pl8 tient ce qu'on a **collé**,
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

**Pour qui** la machine demande est une question à part, et c'est la plus délicate : le jeton
qu'une machine détient est celui d'un service, qui n'a pas de clé, tandis que la clé est classée
sous le sujet OIDC de la personne. La route accepte donc qu'un jeton de service nomme quelqu'un,
et pl8 tient l'annuaire `email → sujet` qui relie les deux orthographes —
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
n'appelle jamais `git`.

Si un appel à git revenait ici un jour, le durcissement à reprendre est celui du clone du file
service : `GIT_CONFIG_GLOBAL=/dev/null` et `GIT_CONFIG_NOSYSTEM=1` (un `url.insteadOf` personnel
retournerait l'URI SSH en https, privilège compris), `GIT_TERMINAL_PROMPT=0`, `--` avant l'URI,
et des délais bornés — `packages/file-service/src/workspaces.ts` les applique tous.
