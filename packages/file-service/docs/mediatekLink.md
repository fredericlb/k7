# Où est la médiathèque hébergée, vue de la machine du moteur

Deux valeurs — `MEDIATEK_URL` et `MEDIATEK_TOKEN` — dont tout ce qui parle à st0 depuis ce
service dépend : la synchro du cache (`mediatekPull.ts`), les routes `/mediatek/*`, et la
**clé SSH** que `sshKeys.ts` va chercher pour cloner un dépôt.

## Ce qui les fournit, et ce qui ne les fournit pas

Le superviseur les passe dans l'environnement quand c'est **lui** qui démarre ce service
(`packages/engine-host/src/fileServiceProcess.ts`). C'est le cas avec le capot.

Dans un checkout, ce n'est jamais le cas. La session de dev démarre ce service comme sa propre
ressource Tilt (`scripts/tilt-tasks.mjs` : un paquet rejoint la session en ayant un script
`dev`), donc quand le superviseur arrive, le port répond déjà — `ensure()` classe le service
« foreign » et n'a pas d'environnement à lui passer. Aucune des deux valeurs n'arrive.

Le symptôme n'était pas « la synchro est en veille » mais, à l'ouverture d'un projet :

```
no SSH key on this machine and no hosted library configured (MEDIATEK_URL) to ask for one
```

D'où le repli, sur les mêmes fichiers que le superviseur lit lui-même.

## L'URL : le fichier de st0, par son nom

`~/.studio/web-endpoints/st0.json`, et pas l'origine du premier registre venu. Hébergé, tous
les services partagent une origine à un chemin fixe, donc les deux reviendraient au même. Dans
un checkout, non : chaque backend annonce **son propre port** de loopback, si bien que
« l'origine de n'importe quel registre » tombe sur le 8789 de l8 aussi souvent que sur le 8795
de st0 — et les routes de la médiathèque n'y sont pas.

C'est la même adresse que `packages/git-repos/docs/keys.md` donne pour le dev
(`http://localhost:8795`), obtenue en la lisant plutôt qu'en l'écrivant une deuxième fois.

## Le token : les réglages du superviseur

`~/.studio/engine-tray.json`, clé `mediatekToken` — là où `npm run tokens` l'écrit et où le
superviseur le lit avant de le passer. Le lire directement ne fait que retirer un
intermédiaire absent.

## Et le sujet du token

Savoir où demander ne dit pas encore **pour qui**. Le token qu'une machine détient est celui
d'un service (`sub: "service:l8"`), qui n'a pas de clé à lui, alors que la clé est classée
sous le sujet OIDC de la personne. `sshKeys.ts` nomme donc l'utilisateur dans la requête —
l'email, la seule orthographe que ce service connaisse — et st0 fait le pont vers le sujet.

C'est une décision d'identité, avec son prix : `apps/st0/docs/sshKeyForService.md`.
