# Projets — st0 détient les dépôts, l8 les dessine

Ce service **stocke** les dépôts git d'un compte, en tient un miroir pour répondre « qu'est-ce
qu'il y a dedans », détient l'unique clé de déploiement, et sert `/api/projects`. Il ne les
**montre** plus : l'écran est la page d'accueil de l8 (`/l8/`), et
[apps/l8/frontend/docs/projects.md](../../l8/frontend/docs/projects.md) est la page à lire pour
tout ce qui se dessine. Celle-ci ne parle que de ce que ce service détient et de pourquoi c'est
lui.

> **Ce qui a bougé, ce qui n'a pas.** Il y a eu ici une sixième section, `/projects`, qui était
> même la section d'accueil. Elle est partie entière — l'onglet, son compte, son poll et son
> routage. Aucune route n'a bougé avec elle : `/api/projects`, `/api/shares` et
> `/api/projects/ssh-key` sont toujours ici, et l8 les appelle depuis la même origine. Ce
> déménagement n'a rien changé à la posture de sécurité décrite plus bas — st0 n'écrit toujours
> dans aucun dépôt.

## Pourquoi c'est ce service qui détient tout ça

Un dépôt appartient à une **personne**, pas à une machine. Ce service est le seul qui survive à
chaque moteur, tienne un volume, et sache déjà nommer quelqu'un : c'est là que vivent les
préférences, les jetons et la session de tout le monde. Une machine de moteur, elle, va et vient
et peut être reformatée un soir sans que le studio y perde une adresse.

## st0 ne fait jamais de copie de travail

Il tient un miroir *bare* et *sans blobs* de chaque dépôt, uniquement pour répondre « qu'est-ce
qu'il y a dedans ». La copie qu'on édite, qu'on joue et qu'on committe vit sur la machine du
moteur, et c'est le file service qui la fait. Le pourquoi et le comment sont dans
[packages/git-repos/docs/mirror.md](../../../packages/git-repos/docs/mirror.md).

La seule chose lourde que ce service détient à propos d'un projet est un **partage** — une copie
gelée, publiée exprès, dont il est bel et bien la seule copie. Ce n'est pas une exception à la
règle du dessus, et [shares.md](shares.md) ouvre en disant pourquoi.

### Le nom du dossier suffit à répondre

**Le suffixe du dossier nomme l'application** : `mysong.l8` s'ouvre dans l8, `partie.z0` dans z0
(`packages/web-protocol/projects.ts` est la règle entière).

Le NOM, et pas le contenu — c'est ce qui rend la question répondable ici. Un nom de dossier est
une question sur l'ensemble des chemins, et l'ensemble des chemins est exactement ce qu'est un
arbre git : aucun contenu de fichier n'est nécessaire, donc aucun n'est téléchargé. Une règle qui
aurait dû **ouvrir** un fichier ne pourrait pas tourner ici du tout.

`project.yaml` n'a pas disparu pour autant — il reste ce qui rend un projet **compilable**, et
`@studio/song` pose toujours cette question-là, sur une vraie copie de travail. Un `.l8` sans
`project.yaml` est donc listé, ouvrable, et échoue à la compilation une fois ouvert, avec le
message de l8. C'est le bon ordre : st0 ne peut pas savoir, et c'est précisément ce qui permet
d'ouvrir un dossier qui n'est pas encore un morceau complet.

**Le file service applique la même règle** (`isProjectDir`, `workspace.ts`), donc ce que ce
service liste et ce que l'arbre de l8 marque ne peuvent pas diverger. Une seule règle, aux deux
bouts. L'arbre rendu est du `FileNode` — le même type que celui que sert le file service, avec le
même drapeau `project?: boolean`, plus `app`.

> **Migration.** Un dossier de projet sans suffixe n'est plus un projet. Les cinq démos de
> `engine/capot/songs/` ont été renommées (`synth-demo.l8`, …) ; leur champ `name:` reste sans
> suffixe, c'est leur libellé et non leur dossier. Un dépôt doit contenir **au moins un dossier
> suffixé** : un dépôt qui *est* lui-même un projet ne se liste pas, puisque sa racine n'a pas de
> nom dans l'arbre.

### Le compte, sur chaque dépôt

`GET /api/projects` renvoie `projects: RepoProject[] | null` sur chaque dépôt. Le miroir avait
déjà calculé cette liste pour en compter les éléments ; ne renvoyer que le nombre obligeait à un
second aller-retour puis à un dépliage d'arbre pour arriver là où on allait de toute façon. Il
n'y a pas de champ `projectCount` à côté : c'est `projects.length`, et deux sources pour un même
chiffre finissent toujours par diverger.

`null` reste distinct de `[]` — « miroir jamais lu » n'est pas « aucun projet ».

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
panne. Seul le second mérite un diagnostic. l8 refuse d'ouvrir un projet sans, et le dit sur sa
page d'accueil avant de cloner quoi que ce soit.

**Un dépôt vide reçoit un commit vide, une fois** : à la première ouverture d'un projet, le
service de fichiers fait la racine qui manque et la pousse (`initIfEmpty`), parce qu'un gitlink
doit pointer sur un commit et qu'un dépôt créé dans une interface web n'en a aucun. C'est lui et
pas st0, pour la raison juste en dessous.

Il y recopiait le catalogue de ce service — `modules/` et `chains/` — tant que ce volume en
tenait. Il n'en tient plus : un module s'écrit dans l8, contre un projet où le greffon qu'il
nomme est réellement chargé. Il n'y a donc plus rien à semer, et le commit vide est tout ce qui
reste de cette étape.

## Pourquoi st0 ne peut pas écrire dans un dépôt

Son miroir est `git clone --mirror --filter=blob:none` : bare, donc aucune copie de travail, et
sans blobs, donc les chemins sans les contenus. Trois raisons, par ordre de gravité :

1. **C'est un cache.** Un miroir que personne n'a lu depuis quinze jours est supprimé et recréé
   au prochain regard. Y écrire la seule copie d'un projet neuf, c'est la mettre dans ce qui est
   conçu pour être jeté.
2. **Le partage est déjà posé** : st0 miroite pour répondre « qu'est-ce qu'il y a dedans », et la
   copie qu'on édite et qu'on committe vit sur la machine du moteur.
3. **Techniquement faisable, et c'est le piège.** On *peut* fabriquer un commit en plomberie et
   pousser depuis un clone bare sans blobs. Mais ça ferait de st0 — le service qui émet aussi la
   session de tout le monde et détient l'unique clé de déploiement — un **écrivain de tous les
   dépôts**. C'est un changement de posture de sécurité, pas une fonctionnalité.

C'est la raison pour laquelle créer et supprimer un projet passent par le service de fichiers de
la machine, et l'ont toujours fait — avant comme après le déménagement de l'écran. Ce que le
déménagement a changé, c'est que l'écran et cette machine sont maintenant du même côté.

## Pourquoi la comparaison des URI est normalisée

Les deux bouts apprennent l'adresse par des chemins différents : st0 a ce qui a été **collé**,
le file service a ce que git a écrit dans `remote.origin.url`. `git@host:moi/depot.git` et
`ssh://git@host/moi/depot` sont le même dépôt ; comparer les chaînes brutes reclonerait ce qui
est déjà là. `normalizeGitUri` replie les deux orthographes sur `host[:port]/chemin`, sans `.git`
et sans l'utilisateur SSH — et c'est aussi ce qui donne son `id` à un dépôt, donc ajouter deux
fois le même n'en fait pas deux.

## Une seule clé, et elle voyage

st0 détient l'identité git du studio : il génère la paire, garde la moitié privée, et le file
service en récupère une copie par le canal que les deux services partagent déjà
(`MEDIATEK_URL` + `MEDIATEK_TOKEN`). **Une seule clé de déploiement à enregistrer chez
l'hébergeur git**, au lieu de deux.

Ce que ça coûte et ce qui l'encadre — route en bearer seul, `no-store`, jamais journalisée — est
dans [packages/git-repos/docs/keys.md](../../../packages/git-repos/docs/keys.md). C'est un
compromis assumé, pas un oubli : le lire avant de le « corriger ».

**Pour qui** la machine demande est une question à part, et c'est celle qui a coûté le plus : le
jeton qu'une machine détient est celui d'un service, qui n'a pas de clé, tandis que la clé est
classée sous le sujet OIDC de la personne. La route accepte donc qu'un jeton de service nomme
quelqu'un, et st0 tient l'annuaire `email → sujet` qui relie les deux orthographes —
[sshKeyForService.md](sshKeyForService.md).

## Où vivent les choses

Tout est sous un **dot-dossier** du volume, comme `.prefs` : `writablePath` le refuse
(`packages/mediatek/src/layout.ts:203`) et `revision.ts` ne le parcourt pas, donc rien de tout ça
n'apparaît jamais dans un scan de famille ni dans l'API fichier.

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
`sub` OIDC est une chaîne opaque choisie par l'IdP et ne peut jamais être un segment de chemin en
l'état. L'écriture, en revanche, **lève** au lieu d'être silencieuse comme celle des préférences :
perdre une préférence coûte un réglage à refaire, perdre un dépôt qu'on vient d'ajouter donne un
200 pour quelque chose qui n'a pas eu lieu.

Un miroir que personne n'a lu depuis quinze jours est supprimé ; le prochain regard le recrée.
Une éviction coûte une attente, jamais une donnée — le dépôt est ailleurs, et ceci n'en est
qu'une copie.

Un `git fetch` coûte du réseau, donc le miroir n'est pas rafraîchi à chaque demande : à l'ajout,
sur le bouton, et au plus une fois par dix minutes.

## Ce qui tourne dans l'image

Le conteneur st0 installe `git` **et `openssh-client`** : chaque dépôt est joint par SSH, donc
git seul ne clonerait rien. `openssh-client` porte à la fois `ssh` — que nomme `GIT_SSH_COMMAND`
— et `ssh-keygen`, qui fabrique la paire.

Tout appel à git depuis ce service hébergé porte le même durcissement que le clone du file
service, et pour les mêmes raisons : `GIT_CONFIG_GLOBAL=/dev/null` et `GIT_CONFIG_NOSYSTEM=1`
(un `url.insteadOf` personnel retournerait l'URI SSH en https, privilège compris),
`GIT_TERMINAL_PROMPT=0`, `--` avant l'URI, et des délais bornés.
