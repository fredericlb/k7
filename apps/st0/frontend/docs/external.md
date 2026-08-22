# Une surface, sur un autre appareil

Une surface est un écran que le projet déclare. Certaines sont des choses qu'on utilise **en
s'éloignant de l'ordinateur** — un pupitre qu'on veut sur une tablette posée près des platines,
pas sur le portable derrière. Chaque surface a donc une adresse à elle :

```
<projet>/@external/<nom_de_surface>

https://st0.priv.frediver.se/lemo_mante/mymix.st0/@external/desk
```

Ouverte sur un autre appareil, elle donne **cette surface et rien d'autre**, pilotant le même
moteur que l'onglet qui a le projet ouvert.

## Sous le projet, ce qui ne coûte rien

`parseLaunch` termine un projet au dernier segment qui porte le suffixe de l'app ; tout ce qui
suit est déjà la route de l'app. Donc :

| | |
|---|---|
| `parseLaunch` | inchangé — `{ repo, project }` comme toujours |
| `projectBasename` | inchangé — le routeur monte au même endroit |
| `routes.ts` | rien : `main.tsx` lit l'adresse avant le routeur |

C'est le même choix de forme que `@shares/<token>.st0` a fait pour la raison inverse (un partage
se glisse dans la place du PROJET, une surface externe dans celle de la ROUTE), et le même
sentinelle `@` : il ne peut pas commencer un nom court de dépôt, et il ne peut pas non plus être
un id de surface — `createSurfaceFile` n'accepte que lettres, chiffres, `_` et `-`. La collision
est impossible des deux côtés.

`EXTERNAL_SEGMENT`, `externalUrl` et `parseExternal` vivent dans
[`@studio/web-protocol/projects`](../../../../packages/web-protocol/projects.ts), à côté de
`launchUrl` et `shareUrl`, parce que c'est un **contrat d'adresse** : un côté l'écrit, l'autre la
relit, et une adresse qu'un seul des deux comprend est un 404 que personne ne peut attribuer.

## Les mêmes portes, un rendu différent

Une surface externe a besoin exactement de ce dont l'éditeur a besoin : le compte, un moteur, et
le dépôt résolu en copie de travail sur la machine de ce moteur. Elle emprunte donc la même pile
— `AuthGate → EngineGate → ProjectGate` — et ne change que ce qui est rendu au bout :

```
main.tsx   parseExternal(pathname)  ─┐
                                     ├─ EngineGate external= ─ ProjectGate external=
                                     │        └─ external ? <ExternalSurface/> : <App/>
```

Ce n'est **pas** le shell avec des choses cachées. Le shell avec rien dedans resterait le shell :
ses panneaux, ses raccourcis et sa barre appartiennent tous à un écran que cet appareil ne montre
pas. `ExternalSurface` monte les deux seules choses dont une surface a besoin, et ce sont les
hooks que `App` utilise déjà — `useEngineLink` et `useTurntableDeck` — puis dessine la surface
avec le composant que le pane dessine, `SurfaceTab`.

Pas de duplication de logique : ces hooks existent précisément pour qu'un hôte puisse câbler un
pupitre (`packages/ui-turntables/docs/hosting.md`). Ce qui est répété, ce sont trois appels.

## Toutes les surfaces ont une adresse ; une seule se pilote

| type | à distance |
|---|---|
| `turntables` | **oui** — c'est un jeu de contrôles au-dessus d'un moteur, ce que `SurfaceTab` dessine déjà à partir d'une déclaration et d'un lien |
| `timeline` | non |
| `viewport` | non |

Les deux autres sont dessinées par le **shell**, à partir d'un état que lui seul tient : le
curseur, la pile de zoom, le document vidéo, l'anneau de panes. Les monter ici serait monter le
shell, c'est-à-dire exactement ce que cet écran existe pour ne pas être.

Dit à voix haute plutôt que dessiné vide, et nommé comme une **limite** et non comme une erreur :
l'adresse est bonne, la surface existe, et c'est cet appareil qui n'est pas le bon endroit.

## Obtenir le lien

Dans le **panneau Partager**, en bas : une ligne par surface commandable, avec son type, et sous
elles la phrase qui compte — *même moteur, même session*. Chaque ligne est un vrai lien qui
s'ouvre dans un nouvel onglet, ce qui est la façon la plus courte de l'envoyer ailleurs : on
l'ouvre, on prend la barre d'adresse. À côté, un bouton *Copier*.

C'est ce panneau et pas un autre parce que c'est déjà là qu'on va chercher **toute adresse que le
projet distribue** — le lien gelé, la release k7 — et parce que le geste est le même : on donne un
lien à quelqu'un, ou à une tablette. Ce qui les sépare est dit plus bas.

Le panneau ne liste que les types **commandables**. Toutes les surfaces ont une adresse, mais une
ligne qui mène à « cette surface ne se commande pas à distance » est une ligne qui ne vaut pas la
peine d'être dessinée. `ui external <surface>` reste permissif de son côté : une adresse demandée
par son nom est une adresse qu'on obtient.

Cette commande la **copie** dans le presse-papier et l'écrit dans la ligne d'état — donc lisible
et recopiable même si le navigateur refuse l'écriture. Elle ne navigue pas : tout l'intérêt est de
porter l'adresse sur un second appareil, et la suivre ici remplacerait l'éditeur devant lequel on
est debout par l'écran de la tablette. Le lien du panneau navigue, lui, mais vers un `_blank` —
c'est la même règle, pas une exception : l'onglet où l'on travaille ne bouge pas.

Construite à partir de `window.location.href`, comme `shareUrl` et pour la même raison : une copie
locale, le proxy du réseau et l'hôte public sont trois réponses différentes, et seul l'onglet sait
laquelle il est en train de lire. La tablette est sur celle du réseau.

## `/external` — le menu, et le point de départ d'une PWA

Un lien qu'il faut aller chercher dans l'éditeur ne sert qu'une fois : la tablette a besoin d'une
page à elle, qu'on ouvre sans rien savoir, et sur laquelle une application installée démarre.
C'est `/external` : **toutes les surfaces commandables de ce compte**, tous projets confondus,
une ligne par surface.

```
GET /workspaces/surfaces        (service de fichiers)
  → [{ workspace, repoName, uniqueName, path, app, active, surfaces: [{id, type}] }]
```

Une seule requête, en dehors de tout projet — comme `/workspaces/projects` juste à côté, et pour
la même raison : un menu qui se remplit ligne par ligne n'est pas un menu. Elle est mémoïsée cinq
secondes, la fenêtre de la liste sur laquelle elle est construite, et elle est **séparée** de
celle-là : la page d'accueil ne dessine aucune surface et n'a pas à payer un scan par projet.

Le service ne dit pas ce qui est commandable, il dit ce qui est **déclaré**. Le tri est celui de
l'app, `isRemotable`, au même endroit que celui que la page de destination applique.

Cette page emprunte la pile de `Home` et non celle de l'éditeur : le compte, `engines.find()`, et
surtout **jamais `hold()`**. Un bail est une revendication SUR UN PROJET ; la prendre depuis un
menu délogerait celui qui joue. Suivre une ligne, en revanche, revendique — par les portes, qui
sont l'endroit pour ça.

### `external`, un nom court réservé

Un segment unique est une adresse de projet valide (`/<dépôt>` ouvre un clone mono-projet), donc
prendre `external` là veut dire qu'un dépôt de ce nom exact n'est plus ouvrable **à sa racine**.
Il rejoint la liste que l'origine tient déjà (`/pl8`, `/k7`, `/z0`, `/api`, `/auth`), avec le même
remède : renommer, ou adresser un projet dedans — `/external/hiver.st0` se lit toujours comme le
dépôt `external`. Le sentinelle `@external` aurait évité l'ombre ; le mot nu est l'adresse
demandée, et un mot réservé se lit dans la barre d'adresse.

### Deux manifestes

`start_url` se résout par rapport à l'adresse du **manifeste**, pas à celle du document : le `.`
relatif de `manifest.webmanifest` vaut `/` d'où qu'on installe. Juste pour l'éditeur, faux ici —
un appareil installé depuis ce menu reviendrait à la page d'accueil à chaque démarrage. D'où
`manifest-external.webmanifest`, `start_url: "external"`, `scope: "."` (donc les surfaces sous un
projet restent dedans), et `main.tsx` qui échange le `<link rel="manifest">` quand le document EST
cette page — à côté de la décision de routage dont ça découle.

### Aucun nouvel onglet

Ni ici ni depuis une surface. Installée, cette application n'a ni onglet ni barre d'adresse : un
`_blank` y ouvrirait une fenêtre dont on ne peut pas revenir. Les lignes naviguent sur place, et
la surface porte en pied un lien **Surfaces** qui remonte — un `<a>` et pas une route, le routeur
étant monté sous un basename qui s'arrête au projet. Les deux écrans d'impasse (surface inconnue,
type non commandable) le portent aussi, pour la même raison.

Le panneau Partager, lui, garde son `target="_blank"` : il est dans l'éditeur, sur la machine
où l'on travaille, et y naviguer sur place remplacerait précisément l'écran qu'on regarde.

### La même adresse des deux côtés

`externalHref` passe par `projectHref`, donc un dépôt inscrit chez pl8 donne `/<dépôt>/…` et le
reste tombe sur `@local`. Ce n'est pas de la cosmétique : le moteur identifie un projet par son
adresse (`projectClaimKey`), et une tablette arrivée en `@local/…` pendant que l'éditeur tient
`/<dépôt>/…` ferait **deux revendications sur un même morceau**, la seconde délogeant la première.
C'est pour ça, et pour rien d'autre, que ce menu interroge le registre de pl8.

Le drapeau `active` vient du marqueur `.studio-active` de l'espace de travail — le projet que
celui-ci a ouvert. Un par espace de travail à la fois, d'où un drapeau et non un filtre : la ligne
marquée « ouvert » atteint un moteur qui est déjà sur ce morceau, et n'importe quelle autre l'en
déplace.

## Ce que ça n'est pas

Ce n'est pas un partage. Un partage (`@shares/<token>.st0`) est un instantané **gelé**, sans
compte, sans moteur et sans source — voir [shared.md](shared.md). Une surface externe est
l'inverse sur les trois points : elle demande le compte, elle exige un moteur, et elle **écrit**
— une platine qu'on charge depuis la tablette est chargée pour tout le monde, parce que c'est le
même moteur et la même session.
