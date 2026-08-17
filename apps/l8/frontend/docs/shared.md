# Le mode partagé — l8 ouvert sur un instantané gelé

Une adresse en `/l8/@partage/<token>.l8` ouvre **cette application**, sans compte, sans moteur et
sans copie de travail. Ce qu'elle dessine est un instantané que st0 détient : trois documents
compilés et des rendus audio. Le paquet est fabriqué ailleurs — voir
[`packages/commands/docs/shareBundle.md`](../../../../packages/commands/docs/shareBundle.md) pour
ce qu'il contient, et [`apps/st0/docs/shares.md`](../../../st0/docs/shares.md) pour où il vit et
comment on le retire.

## Une branche, pas trois portes conditionnelles

`main.tsx` lit l'adresse une fois — de la même manière que le `basename` du routeur, donc les deux
ne peuvent pas être en désaccord sur le projet ouvert — et rend soit `SharedGate`, soit la pile
habituelle `AuthGate → EngineGate → ProjectGate`.

Un partage n'a ni compte, ni moteur, ni espace de travail. Ce n'est donc pas la même pile avec
trois interrupteurs : c'est la **mauvaise pile**. Rendre les trois portes conditionnelles aurait
mis trois `if` dans trois fichiers dont aucun n'a de raison de connaître les partages, et chacun
aurait été un endroit où l'oublier.

## Ce qui EMPÊCHE d'écrire tient en une ligne

`fsend` refuse. C'est tout.

```ts
const frozen = cfg().frozen;
if (frozen) throw new ReadOnlyDocument(frozen.why);
```

Toute écriture de toute application montant ce shell passe par là — une bonne vingtaine d'appels
rien que dans `project.ts`. Refuser **au transport** plutôt que fonctionnalité par fonctionnalité
est la seule version de ce refus qui soit vraie : un bouton caché reste une raccourci clavier, une
entrée de barre de commandes et un menu contextuel plus loin, et la vingt-sixième écriture serait
découverte en production.

Ce que `snapshot` fait dans `App` est donc une question de ce qu'on **dessine**, jamais de ce
qu'on empêche. Les deux menus de l'en-tête disparaissent parce qu'ils n'ont pas de sens ici :
Partager publie CE projet quelque part (il n'y a pas de projet, seulement une copie), et Réglages
change de moteur, d'espace de travail et de préférences de compte — dont un visiteur n'a rien. Un
menu grisé aurait été une invitation à se connecter, c'est-à-dire exactement ce que le partage
existe pour éviter.

## L'éditeur n'est pas un panneau en lecture seule, il n'est pas là

`viewPanes(view, timeline, viewport, frozen)` le retire de `fullscreen`. Un instantané n'a **pas
de source** — ni `/tree`, ni `/file` — donc ce n'est pas un panneau dont le document se trouve
être figé, c'est un panneau derrière lequel il n'y a rien.

Le retirer de cette liste-là, et pas d'un bouton, est le point : la même liste est lue par les
touches numériques, les onglets mobiles, `ui editor` et **chaque adresse**. Une seule omission
les ferme ensemble. `fromLocation` prend le même drapeau, sinon `/editor` collé dans la barre
d'adresse ouvrirait un panneau que rien ne monte.

## Le moteur : `() => null`, et rien d'autre à faire

`EngineUrl` accepte une fonction, et `null` veut déjà dire « aucun moteur à joindre pour
l'instant » : le client patiente et redemande, au lieu de traiter ça comme un échec de connexion.
C'est la couture qui rend « l8 lui-même » possible sans second chemin de code — le shell se monte
entier, son `EngineStore` reste au repos, `connected` est faux, et les verbes de transport partent
dans un client qui n'a pas de socket.

## Les routes en conserve

Un partage est un dossier de JSON et de rendus. `/tree`, `/hints`, `/commands`, `/io-ports`,
`/git/status` ne nomment **rien** — il n'y a pas de service de fichiers derrière. Laissées
échouer, chaque accroche qui les demande afficherait une erreur disant qu'un service est en
panne, ce qui est **faux** : il est absent par construction, et un visualiseur qui annonce un
serveur cassé alors que tout fait ce qu'il doit est pire que muet.

`FileCfg.frozen.canned` répond à leur place, avant la requête, en texte JSON que chaque appelant
parse — la règle de `fget`, pour que plusieurs composants ne se partagent jamais un objet.

Deux détails qui comptent :

- **les valeurs sont typées**, pas transtypées. Écrire `Hints` en entier a fait échouer la
  compilation sur `paramsByBase`, `paramMetaByBase` et `racks` — trois champs qui seraient arrivés
  à un composant en `undefined`, sur le seul chemin de code que personne n'ouvre ;
- `/revision` rend une **constante**. Plusieurs accroches interrogent ce jeton et rechargent
  quand il bouge ; figé, le shell se stabilise après sa première passe et cesse de demander, ce
  qui est l'énoncé vrai à propos d'un document qui ne peut pas changer.

`/project-errors` rend « aucune erreur », et c'est une réponse et non un bouche-trou : un
instantané est fabriqué à partir d'un projet qui compilait, par la machine qui l'a compilé.

## L'adresse est un `base`, et c'est tout ce qu'il a fallu

`cfg().base` est une chaîne posée une fois. Rien n'exige que ce soit le service de fichiers qui
réponde derrière, donc st0 sert les mêmes formes GET depuis le paquet et l8 ne s'en aperçoit pas.

La seule couture à ajuster était le NOM : `fget` demande `/project-doc` parce que c'est la route
du service de fichiers, et l'instantané appelle les mêmes octets `project-doc.json` parce qu'un
fichier a besoin d'un nom. La route publique accepte les deux orthographes — un `||` — plutôt que
d'apprendre à l'un des deux côtés l'existence de l'autre.

`mediaUrl` n'est pas traité et n'a pas besoin de l'être : il fabrique `<base>/media?…`, qui tombe
sur le 404 terminal du routeur public. Une forme d'onde de clip n'a rien à lire ; elle n'en
dessine pas.

## La clé se calcule ici

`shareKey(token)` fait un `sha256` dans le navigateur, parce que st0 range le HACHÉ et jamais le
secret : un segment de chemin atteint chaque journal d'accès. Cela demande `crypto.subtle`, donc
un **contexte sécurisé** — sur du http en clair, ailleurs que sur localhost, il n'y a pas de
digest du tout. Le refus est levé avec une phrase plutôt que laissé remonter en
`undefined is not a function` : c'est un déploiement, pas un bug, et le remède est de servir la
page en https.

## Ce qui reste à faire : la lecture

Le son n'est pas encore joué. Ce qui est décidé, et pourquoi :

**Un `<audio>` par stem, derrière un `MediaElementAudioSourceNode` et un `GainNode`** — et non le
`SongPreloader` de z0, qui décode tout en `AudioBuffer`. Le nombre décide : douze stems de quatre
minutes font ~58 Mo de mp3 à transférer et **~340 Mo décodés en mémoire**, ce qui est fatal sur un
téléphone. Un élément média diffuse, fait ses requêtes Range — ce que `streamFile` sert déjà — et
donne un `currentTime` pour la tête de lecture.

Le mixdown est **l'horloge** : il est toujours présent, il est ce qu'on entend par défaut, et les
stems se resynchronisent sur lui plutôt que les uns sur les autres. Les coupures et les isolements
de l8 deviennent des gains sur ces nœuds.

Ce que ça coûte : la synchronisation entre plusieurs éléments média n'est pas parfaite, et c'est
le compromis assumé. La parade si ça s'entend est de décoder **à la demande** les seuls stems
qu'on démute, ce que la forme ci-dessus permet d'ajouter sans être défaite.
