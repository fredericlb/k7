# Le jeton par moteur : ce qu'il prouve, et ce qu'il ne protège pas

Cette page existe parce que l'en-tête de `registry.ts` a longtemps affirmé le contraire de ce
que fait le code :

> ~~The per-engine token NEVER leaves the server.~~

C'est faux, et ça l'a toujours été. Corrigé ici plutôt que retiré en silence : une phrase de
sécurité fausse est pire qu'une phrase absente, parce qu'on construit dessus.

## Ce qui se passe réellement

Le moteur répond à `whoami` — **sur n'importe quelle socket, sans authentification préalable** —
par son id, son jeton et son timing audio :

```
// engine/moteur/server/main.cpp, la branche `whoami` / `hello`
ws.send(json{{"type", "whoami"}, {"id", engineId}, {"token", engineToken}, …}.dump());
```

Et le navigateur le lit et le garde : `packages/engine-browser/src/probe.ts` le range dans
`RankedEngine.token`, parce que c'est ce qu'il doit présenter au registre pour sélectionner ce
moteur-là.

Donc : quiconque peut ouvrir une WebSocket vers le port du moteur obtient le jeton. Et ce port
n'est pas forcément local — le superviseur lance le moteur avec `STUDIO_ENGINE_HOST` à
`0.0.0.0` (`packages/engine-client/src/engineDaemon.ts`), alors que le défaut du binaire est
`127.0.0.1`. Sur un réseau de répétition ou un wifi de salle, le jeton est lisible par la salle.

## Ce que le jeton prouve quand même

Il n'est pas inutile, et le supprimer serait une régression. Il répond à une question précise :
**« ce moteur qui se présente sous cet id est-il celui qui s'est enregistré ? »**

`verifyToken` empêche un sosie de se faire passer pour un moteur déjà connu — un second process
qui annoncerait le même id ne peut pas produire le jeton que le premier a déposé au registre.
C'est de l'anti-confusion, pas de l'anti-intrusion.

Formulé autrement : le jeton est un **identifiant non devinable**, pas un secret. Il protège
contre la collision et contre l'erreur, pas contre quelqu'un qui est déjà sur le réseau.

## Le modèle de confiance réel

Ce que l'axe audio suppose aujourd'hui, en clair :

- **La machine du musicien est de confiance.** Le moteur, le superviseur et le service de
  fichiers tournent chez la personne qui joue.
- **Le réseau local l'est aussi**, par défaut, du fait du `0.0.0.0`. C'est ce qui permet à un
  téléphone de piloter le transport depuis la scène, et c'est le même trou.
- **L'authentification réelle est ailleurs** : le cookie de session que st0 frappe, et que pl8,
  k7 et z0 se contentent de vérifier.

Rien de tout cela n'est absurde pour un outil de scène. Ce qui l'était, c'est de l'écrire à
l'envers dans le fichier que quelqu'un lira avant d'ajouter une surface.

## Ce qu'il faudrait pour que la phrase redevienne vraie

Un lot de conception, pas un correctif — il n'est pas pris :

1. `whoami` ne rend le jeton qu'à une socket déjà authentifiée, ou ne le rend plus du tout et le
   registre l'apprend par un autre canal (le superviseur le connaît déjà : c'est lui qui
   enregistre le moteur).
2. Le navigateur ne présente plus le jeton mais un **ticket** émis par le registre — la
   mécanique existe déjà pour le relais (`issueEngineTicket` / `verifyEngineTicket` dans
   `proxy.ts`), et c'est exactement la forme qui conviendrait.
3. `STUDIO_ENGINE_HOST` revient à `127.0.0.1` par défaut, avec l'ouverture LAN en choix
   explicite plutôt qu'en défaut silencieux.

Le point 2 est le plus proche : la moitié du chemin est écrite, et elle n'est couverte par
aucun test aujourd'hui (`proxy.test.ts` ne teste que le chemin HTTP du relais).

Voir `docs/constat.md` pour la place de ce point dans l'ensemble.
