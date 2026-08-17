# Le mode partagé — l8 ouvert sur un instantané gelé

Une adresse en `/l8/@shares/<token>.l8` ouvre **cette application**, sans compte, sans moteur et
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
qu'on empêche — mais il faut le faire, et le premier essai ne l'avait pas fait assez : les clips
se traînaient encore, le geste marchait à l'écran et ne produisait rien. **Un glissé qui se
déroule puis revient en place est pire qu'un glissé qui ne démarre pas**, et une poignée de
redimensionnement qui s'allume sous le curseur est une promesse. Donc :

- `TimelineTab` prend un `readOnly` qui rejoint la garde déjà là pour une piste générée et un
  clip gelé (`if (readOnly || track.generated || c.frozen) return`) — troisième lecture de la
  même phrase : il y a un clip à regarder et rien à écrire. La pression est toujours suivie,
  parce qu'un CLIC est une demande de VOIR le clip et ne demande rien au disque ;
- les poignées de bord ne sont pas inertes, elles sont **absentes** ;
- les cinq rappels d'édition du graphe (`onConnect`, `onDisconnect`, `onReplug`, `onMoveNode`,
  `onEdgeInsert`) et celui de l'image (`onVideoEdit`) sont **optionnels et déjà gardés par le
  moteur de rendu** : un instantané n'en passe aucun, et les prises ne sont pas offertes. Aucun
  drapeau supplémentaire n'a été nécessaire de ce côté.

Les deux menus de l'en-tête disparaissent parce qu'ils n'ont pas de sens ici :
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

## La lecture : une horloge de navigateur qui remplit le même store

`useSnapshotPlayer` substitue **deux verbes** — `transport` et `seek` — juste après
`useEngineLink`, et rien d'autre.

Deux endroits attendaient quand même un moteur, et rendaient le transport inutilisable :

- `waitingForEngine` était `!!ws?.activeProject && !engineReady`. La réponse en conserve de
  `/workspace` dit `activeProject: "."`, et `engineReady` ne devient jamais vrai sans socket —
  donc « waiting for engine… » pour toujours, et la barre grisée avec. Sur un instantané il n'y a
  aucun moteur à attendre : ce drapeau est faux d'emblée ;
- les quatre verbes nus retombaient sur le service de fichiers quand `connected` était faux
  (`if (!connected || engineBusyRef.current) return false`), ce qui est le bon compromis quand il
  Y A un service derrière. Ici il n'y en a pas, donc la barre d'espace ne faisait rien. Le chemin
  local est le seul qui puisse répondre, et il répond toujours. Tout ce qui est en aval — la barre, les touches,
`transport play`, la tête de lecture, `replayAtRef` — lit les mêmes trames de `store`, quel que
soit le côté qui les remplit. Aucun de ces morceaux n'apprend qu'il n'y a pas de moteur.

**Un `<audio>` par fichier, et non un tampon décodé.** Le nombre décide : douze stems de quatre
minutes, c'est ~58 Mo de mp3 à récupérer et **~340 Mo décodés**, ce qu'un téléphone n'a pas. Un
élément média diffuse, fait ses requêtes Range — exactement ce que `streamFile` sert déjà — et
porte le `currentTime` que ce hook publie comme tête de lecture.

Ce que ça coûte : plusieurs éléments ne partagent pas d'horloge. On ne le leur demande donc pas —
**l'un d'eux EST l'horloge** et les autres sont remis dessus dès qu'ils dérivent, correction
inaudible à 80 ms. Si ça s'entendait quand même, on peut décoder à la demande les seuls stems
qu'on démute, sans rien défaire de ce qui est là.

Le graphe audio se construit au **premier verbe de transport**, jamais au montage : un
`AudioContext` fabriqué hors d'un geste utilisateur démarre suspendu, et des éléments en
`preload="auto"` tireraient des mégaoctets pour quelqu'un qui lit le graphe et n'appuiera jamais
sur lecture.

Par défaut on entend **le mixdown**. À la première coupure on passe aux **stems**, une fois et
pour la session : revenir au mixdown quand toutes les pistes sont rallumées serait une seconde
couture audible pour quelqu'un qui ne fait qu'explorer, et les stems somment la même chanson.

`levels` reste **vide** et non mis à zéro : un vumètre sans moteur derrière n'a pas de lecture, et
une rangée de barres à -∞ serait une affirmation sur du silence que rien n'a mesuré.

### Couper et isoler deviennent ce qu'un auditeur veut dire par là

Normalement ce sont des ÉCRITURES : `m` réécrit le bypass de la piste dans `graph.yaml` et `s` la
liste `soloed:` de `project.yaml`, parce qu'une coupure est une décision sur le morceau et pas un
drapeau de session. Ici il n'y a rien où écrire, et `fsend` refuserait — alors `useTrackControls`
prend un mode `local` où l'état optimiste EST la valeur : rien à lancer, rien à réconcilier.

`arm` n'est pas touché et reste une commande : rien ne s'arme sans moteur, et le refus qui le dit
vaut mieux qu'un bouton qui fait semblant.

La résolution vers l'audio est `laneGains`, pure et testée — parce que **l'isolement est un fait
sur l'ENSEMBLE** : une seule piste isolée fait taire toutes les autres, donc la réponse d'une
piste ne se déduit pas de ses deux drapeaux à elle. C'est la règle que le moteur applique à
`soloed:`, énoncée là où il n'y a pas de moteur pour l'appliquer.

Un stem dont le rendu n'a correspondu à aucune piste (`track: ""`) est délibérément absent de la
table : il sonne, et aucun bouton ne l'adresse — ce qui est honnête, là que l'accrocher à un
identifiant inventé allumerait le bouton d'une autre piste.
