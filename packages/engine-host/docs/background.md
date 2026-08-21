# Une promesse que personne n'attend

Le constat qui a fait écrire cette page : `unhandledRejection`, `uncaughtException` et
`std::set_terminate` ne renvoyaient **aucune correspondance dans tout le dépôt**. Les trois
process de l'axe audio — le superviseur, le service de fichiers, le moteur — n'avaient aucun
filet de dernier recours, et le superviseur lançait sept minuteurs avec `void f()` sans un
seul `.catch`.

## Pourquoi `void f()` est un crash

`void` ne fait rien qu'annoncer à Biome qu'on ne compte pas attendre la promesse. Il ne
l'attrape pas. Depuis Node 15, une promesse rejetée que personne n'attrape **termine le
process** — comportement par défaut, `--unhandled-rejections=throw`.

Le superviseur y était exposé sept fois (`supervisor.ts`, le bloc de démarrage) : `beat`,
`pollPending`, `crashWatch`, `fileServiceWatch`, `pollDevices`, `pollEditPlugins`,
`pollSessions`. Chacun touche le réseau ou le disque. `gatherAddresses` lit
`networkInterfaces()` ; un registre injoignable rend une erreur ; il suffit d'un.

Et le mode de panne n'est pas « le superviseur s'arrête ». C'est : le superviseur meurt,
**le moteur reste vivant derrière lui**, le capot le relance sur son repli (1 → 30 s), et le
nouveau superviseur ré-adopte le moteur par son pidfile. Ça se rattrape, donc ça ne se
remarque pas — ce qui est exactement la raison pour laquelle personne ne l'avait vu.

Le service de fichiers avait quatre sites de la même famille, dont deux dans une route et un
dans un callback de watcher : `prewarmWaveforms` et `refreshPatterns`. Sa protection existante,
`wrap()` (`commons/packages/http/route.ts`), n'attrape que ce que le handler **retourne** — et
`void` retourne immédiatement, donc la garde passe à côté par construction.

## Les deux moitiés sont volontairement asymétriques

| |  |
|---|---|
| **rejet non traité** | journalisé, le process vit. C'est un sondage qui a échoué : ce n'est pas une raison de mourir, et le sondage suivant arrive dans quelques secondes. |
| **exception non attrapée** | journalisée **avec sa pile**, puis on sort. L'état du process n'est plus raisonnable ; le capot (pour le superviseur) et `fileServiceWatch` (pour le service) relancent. |

La tentation est de survivre aux deux. C'est un piège : une exception non attrapée laisse des
invariants cassés et un process qui continue à répondre *faux* est pire qu'un process absent.
Ce que le filet ajoute n'est donc pas la survie — c'est **la ligne qui dit lequel des deux
s'est produit**. Aujourd'hui les deux cas se ressemblent : un process qui a disparu.

## Pourquoi deux copies plutôt qu'un paquet

`packages/engine-host/src/background.ts` et `packages/file-service/src/background.ts` ont le
même corps à la journalisation près. C'est assumé, et c'est le raisonnement déjà écrit dans
`docs/inventaire.md` §4 pour `isMouseWheel` :

- aucun des deux paquets ne peut dépendre de l'autre — le superviseur *lance* le service ;
- leur seule dépendance commune est `@studio/engine-client`, et « le client Node du moteur »
  n'est pas le foyer d'un garde-fou de process : l'y mettre serait le genre de rangement
  qu'un prochain inventaire signalerait ;
- `commons/` est le socle partagé avec `phare`, et y toucher engage deux dépôts ;
- créer un paquet pour dix lignes est une décision, pas un nettoyage.

Ce qui les distingue vraiment est le canal : le superviseur écrit sur `stderr` parce que
`ipcStdio` met `stdout` en quarantaine pour le NDJSON du capot ; le service écrit par
`console.error` avec le préfixe `   ✗ ` de ses voisins. Deux journaux différents, un même
corps — inscrit ici pour que la copie soit un état connu plutôt que de la pourriture.

## Ce que ça ne couvre pas

Le troisième process. `engine/moteur` n'a **qu'un seul** `try`/`catch` dans toute sa
bibliothèque (`NamPlugin.cpp`), sur 52 fichiers, ni `try` au niveau de `main()`, ni
`std::set_terminate`. Toute exception levée depuis un lambda posté sur le thread message
termine le process sans un mot. C'est un lot ouvert, pas une omission de cette page —
voir `docs/constat.md`.
