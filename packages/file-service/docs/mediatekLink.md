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

## Ce que ce repli ne règle pas

`packages/git-repos/docs/keys.md` demande que **le sujet du token SOIT le propriétaire de la
clé** : « `MEDIATEK_TOKEN` représente un compte, donc une machine ne peut tirer que la clé de
son propre utilisateur. C'est vérifié, pas supposé. » La route `/api/projects/ssh-key/private`
cherche bien la clé dans le dossier du sujet du token.

Or `scripts/tokens.mjs` frappe ce token avec `sub: "service:l8"`, et
`packages/engine-host/src/tokensScript.test.ts` épingle cette valeur. Une identité de service
n'a pas de clé : la route répond alors `404 no SSH key yet`, y compris quand la clé de la
personne existe.

Les deux moitiés du dépôt ne sont donc pas d'accord sur ce que ce token représente, et le
trancher est une décision d'identité — pas un détail de plomberie. Tant qu'elle n'est pas
prise, ce repli amène la requête jusqu'à st0 ; il ne lui donne pas le bon sujet.
