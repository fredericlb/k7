# La clé privée, demandée par une machine pour quelqu'un

`GET /api/projects/ssh-key/private` rend la moitié privée de la clé de déploiement au service
de fichiers de la machine du moteur, qui en a besoin pour cloner. Cette page dit **qui** peut
la demander, et pour qui.

## Ce qui ne marchait pas

La règle d'origine était : le sujet du token EST le propriétaire de la clé, donc rien à
nommer et rien à refuser. Sauf que le token qu'une machine détient est celui que
`scripts/tokens.mjs` frappe, et son sujet est `service:l8` — une identité de service, qui n'a
pas de clé. La route répondait donc `404 no SSH key yet`, en envoyant régénérer une clé déjà
présente. La fonctionnalité ne pouvait pas fonctionner telle qu'écrite, sur aucune machine.

## Ce qui a été décidé

Un token de **service** doit nommer la personne : `?user=…`, et le nom donné est honoré. Un
token de **compte** continue de répondre pour lui-même.

Le prix est réel et il a été accepté : qui détient le token d'une machine peut demander la clé
de n'importe qui. C'est ce que coûte **un credential par machine** plutôt qu'un par personne —
l'autre sortie était de frapper et coller un token de compte par machine, ce qui demandait une
interface qui n'existe pas et cassait le test qui épingle `service:l8`.

Ce qui tient encore, et qu'il ne faut pas relâcher :

- **bearer seulement**, jamais le cookie de session : aucune page d'aucun navigateur ne peut
  être amenée à déclencher cette requête, et aucune forme de CSRF ne s'applique ;
- un token de **compte** qui en nomme un autre est **refusé** (403), pas ignoré : rendre
  sa propre clé à une requête qui en demandait une autre se lirait comme un succès ;
- un token de service qui ne nomme personne est refusé (400) plutôt que rabattu sur son propre
  sujet, qui n'a de toute façon pas de clé ;
- `Cache-Control: no-store`, et la valeur n'est journalisée d'aucun côté.

## Le pont d'identité

Les deux moitiés épellent une personne différemment, et c'est délibéré de part et d'autre :

| | ce qu'elle manipule | pourquoi |
|---|---|---|
| le service de fichiers | l'**email** (`x-studio-user`) | c'est ce que le navigateur envoie, et toute son arborescence `~/.studio/root/<slug>` en dépend |
| pl8 | le **sujet OIDC** | `subOf` prend `sub` d'abord ; tout ici est classé sous `fileFor(sub)` |

Aucune des deux ne peut adopter l'autre sans déplacer des dossiers existants. Donc pl8 tient
l'annuaire : `projects/identities.ts` enregistre `email → sub` **au passage de n'importe quelle
requête authentifiée de cette section** — le seul endroit où les deux orthographes sont en main
en même temps, ce service ne minant pas de session mais en vérifiant une.

`subFor()` retombe sur l'identifiant reçu quand l'annuaire ne dit rien. Ce n'est pas une
supposition : là où l'IdP ne renvoie pas d'email, `subOf` utilise déjà le `sub` pour les deux,
les deux orthographes sont une seule chaîne et l'annuaire est vide par construction.

Une personne dont on demande la clé a nécessairement ouvert la page d'accueil de l8 pour y
ajouter le dépôt, donc l'annuaire la connaît avant que la machine ne la nomme. L'écriture est au mieux-effort :
un volume en lecture seule coûte le pont, jamais la requête qui passait par là. Elle est aussi
mémoïsée en mémoire, parce que `/revision` est **sondée** et qu'un annuaire relu à chaque
sondage serait une lecture de fichier par tick.

## Vérifié par

`src/routes/sshKey.test.ts` monte le routeur avec une session simulée et un schéma de tokens
de test : la clé rendue à un service qui nomme, la casse de l'email, le sujet donné brut, le
400 sans nom, le 403 d'un compte qui vise ailleurs, le 401 sans bearer, le 404 quand il n'y a
pas de clé.
