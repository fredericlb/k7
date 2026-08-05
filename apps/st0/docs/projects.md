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

## Le trajet complet

1. Dans **Projets**, on colle une URI SSH. st0 génère la clé de déploiement si elle n'existe
   pas encore, enregistre le dépôt et lance le miroir en tâche de fond.
2. La section affiche l'arborescence, les dossiers-projets marqués de l'application qui les
   ouvre.
3. « Ouvrir dans l8 » (ou m9) mène à `/<app>/?repo=<uri>&project=<dossier>`.
4. L'application demande au file service `GET /workspaces/by-repo?uri=` : cette machine
   connaît-elle ce dépôt ?
5. Sinon, elle le clone, **avec la progression de git à l'écran**
   ([cloneJobs.md](../../../packages/file-service/docs/cloneJobs.md)), puis ouvre le projet.

Les étapes 4 et 5 sont `@studio/project-shell`, montée à l'identique par les deux applications :
une divergence là serait un clone en double ou un 404. Chacune ne connaît que ça — le projet sur
lequel elle a été lancée. Voir
[packages/project-shell/docs/launch.md](../../../packages/project-shell/docs/launch.md), notamment pourquoi les
deux paramètres sont lus à l'import du module et pas dans un composant, et
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

Ce que ça coûte et ce qui l'encadre — route en bearer seul, sujet du jeton devant être le
propriétaire, `no-store`, jamais journalisée — est dans
[packages/git-repos/docs/keys.md](../../../packages/git-repos/docs/keys.md). C'est un
compromis assumé, pas un oubli : le lire avant de le « corriger ».

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

## Ce qui tourne dans l'image

Le conteneur st0 installe `git` **et `openssh-client`** : chaque dépôt est joint par SSH, donc
git seul ne clonerait rien. `openssh-client` porte à la fois `ssh` — que nomme
`GIT_SSH_COMMAND` — et `ssh-keygen`, qui fabrique la paire.

Tout appel à git depuis ce service hébergé porte le même durcissement que le clone du file
service, et pour les mêmes raisons : `GIT_CONFIG_GLOBAL=/dev/null` et `GIT_CONFIG_NOSYSTEM=1`
(un `url.insteadOf` personnel retournerait l'URI SSH en https, privilège compris),
`GIT_TERMINAL_PROMPT=0`, `--` avant l'URI, et des délais bornés.
