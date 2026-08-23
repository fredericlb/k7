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
ses panneaux et sa barre appartiennent tous à un écran que cet appareil ne montre pas.
`ExternalSurface` monte ce dont une surface a besoin — le lien moteur, le pupitre, le document
vidéo, le lanceur de commandes — puis passe la main au composant que le type nomme.

Pas de duplication de logique : ces hooks existent précisément pour qu'un hôte puisse câbler une
surface (`packages/ui-turntables/docs/hosting.md`). Ce qui est répété, ce sont des appels.

Trois choses ne sont pas la surface et sont quand même là, en pied et en tête : le **transport**,
une **ligne de commande**, et le **clavier**. Elles ne viennent pas du même raisonnement que les
panneaux — ce ne sont pas des écrans, ce sont les trois façons de commander celui qu'on regarde.

## Le transport, en tête

`MiniTransport` — celui du shell, écrit à l'origine pour rouler par-dessus un popin qui masque
l'en-tête, et c'est exactement ce cas-ci. Play/pause et l'horloge, rien d'autre : stop, rewind,
record et le métronome sont des décisions sur une session qu'on regarde, et les touches les font
toutes de toute façon.

C'est ce dont un second appareil a le plus besoin. Une tablette près des platines est là où est la
main ; retourner au portable pour appuyer sur play est précisément ce que cet écran existe pour
ne pas avoir à faire.

L'horloge s'abonne toute seule au `playhead` (`shellMeta.tsx`) : à ~20 Hz, un abonnement pris à ce
niveau redessinerait la surface entière à chaque trame.

## Le clavier, entier

`useCommandKeys` est le listener du shell, sorti d'`App.tsx` — mêmes règles de retrait (un champ
qui tape possède ses touches, un bouton focalisé rend Space et Escape), même exception ⌃C sur une
sélection de texte, même **double-Shift**. Un même clavier ne peut pas devenir deux.

Le keymap est celui de la personne : `effectiveKeys(commandPrefs)`, avec les préférences lues chez
`engines.prefs()` comme dans le shell. Une touche de lecture remappée doit marcher sur la tablette
aussi, sinon les deux écrans sont deux instruments.

Le double-Shift ouvre la **ligne de commande** en pied — c'est ce que ce geste veut dire ici, comme
il focalise la barre ancrée ou ouvre la palette dans le shell. L'hôte fournit le geste, le listener
ne fait que le reconnaître.

Ce que la surface répond **elle-même**, avant `/command` :

| lignes | pourquoi |
|---|---|
| `transport play` / `stop` / `toggle` / `rewind` | par la socket, comme le shell : le service de fichiers enverrait ce message-là après un aller-retour HTTP et un parcours du journal d'annulation |
| `transport replay` | un seek au début du roulement courant, puis le verbe nu |
| `transport locate`, `transport loop`, `ui select`, `ui zoom …`, `ui ruler`, `ui lanes` | le curseur et le zoom sont ceux du pane monté (`TimelineHandle`) ; aucun service ne peut les bouger. Sur une surface sans arrangement, la ligne le **dit** — la touche est liée, la commande existe, c'est l'appareil qui n'est pas le bon endroit |
| tout autre `ui …` | nomme un pane, un panneau ou un écran que cet appareil n'a pas — refusé **en mots**, plutôt que posté à un service qui répondrait « unknown command » |

Les verbes de **disposition** (`ui close`, `ui global`, `ui focus next`, les deux fermetures) sont
la seule exception à cette dernière ligne : ils se taisent. C'est ce à quoi Échap et Tab
aboutissent quand il n'y a rien à fermer, et un écran qui répond à Échap par une phrase sur
l'éditeur est un écran qui rouspète à chaque fois qu'on écarte quelque chose.

Les conditions (`caret_track`, `timeline_selection`, `timeline_zoomed`, `timeline_loop`) remontent
de la surface montée. Le shell les tire de son propre état ; ici il y a une surface et elle les
tient toutes. Sans elles, `m` et `s` enverraient une commande à argument vide au lieu de se taire.

## Les quatre types se pilotent

| type | dessiné par | ce que l'hôte lui donne |
|---|---|---|
| `turntables` | `SurfaceTab` | le pupitre (`useTurntableDeck`) |
| `mastering` | `MasteringTab` | le lien moteur : `setPluginParam`, `watchPluginParams`, le magasin de params |
| `viewport` | `ViewportTab` | l'image compilée (`useVideoDoc`) |
| `timeline` | `ExternalTimeline` | tout le reste — voir plus bas |

C'était le pupitre **et rien d'autre**, et la raison tenait debout : les trois autres sont
dessinées par le shell à partir d'un état que lui seul tient. Mais cet état n'était pas le même
dans les trois cas, et c'est ça qui a fini par céder.

- Le `mastering` ne demandait au shell qu'**un lien moteur**, que cet écran a déjà.
- Le `viewport` ne demandait qu'un **document vidéo**, qui est un `GET /video-doc`.
- La `timeline`, elle, demandait bel et bien le shell — mais ce qu'elle en tirait, c'était le
  curseur, le zoom et la sélection, et ceux-là n'ont jamais appartenu au shell : ils appartiennent
  au **pane**, et `TimelineTab` les tient lui-même. Ce que le shell fournissait vraiment, c'est
  l'écriture : les commandes, les menus, la boucle. `ExternalTimeline` les recâble sans lui.

Il ne reste donc aucune surface qui n'ait qu'une adresse. Les deux écrans d'impasse — surface
inconnue, type non pilotable — sont devenus un seul : l'adresse ne nomme aucun fichier de
`surfaces/`.

### La timeline, sur une tablette

Le même `TimelineTab` que le pane du shell, avec les mêmes gestes d'écriture, chacun vers la même
ligne de commande :

| geste | ligne |
|---|---|
| déplacer un clip | `event move` |
| tirer une poignée | `event resize` |
| tirer un coin de fondu | `event fadein` / `event fadeout` |
| le bouton du coin | `track new` |
| couper / solo / armer | `track mute`, `track solo`, `transport arm` (`useTrackControls`) |
| déplacer une image | une **écriture de fichier**, pas une commande — le CLI n'a pas de verbe pour un placement d'image (`useVideoEdits`, `picture.md`) |

Trois choses viennent d'ailleurs que du shell parce qu'il n'y en a pas :

`useSurfaceCommands` est le lanceur — `/command`, une clé de rechargement, une ligne de statut, et
un crochet pour ce que l'écran répond lui-même (le tableau plus haut). Il demande `want: []` à
chaque fois : le graphe que le service sait construire au passage est pour le canevas des chaînes,
et il n'y en a pas ici. Sa clé de rechargement suit le **jeton `/revision`** et pas seulement nos
propres écritures — une tablette est un second écran sur un projet qu'on édite aussi sur le
portable, donc l'essentiel de ce qu'elle doit suivre n'est pas d'elle.

Le **graphe** est refetché ici, sur ce même jeton, là où le shell le prend du pane des chaînes :
sans lui la gouttière ne dessinerait ni le ⋮ des alternatives ni les courbes d'automation.

Le **menu contextuel** est celui du shell, `contextMenu.ts`, et le bubble ⋮ est `nodeMenu` — sorti
de `App.tsx` pour ça : deux dérivations d'un même menu, c'est deux menus qui finissent par offrir
des alternatives différentes sur le même nœud.

### Une ligne, et pas une barre de commandes

Une entrée de menu est soit **complète** — le clic a rempli tous ses arguments, elle s'exécute —
soit elle en doit encore un, et dans le shell celles-là partent dans la barre à moitié écrites.
Il n'y a pas de barre ici. Les jeter aurait retiré « New alternative… » d'un menu dont c'est tout
le sujet ; en construire une aurait reconstruit le shell.

Le pied porte donc **une ligne**, remplie par ces entrées, ouverte par le double-Shift, et tapable
en propre. Pas de complétion, pas de palette, pas de catalogue derrière : ce qui rend ces trois-là
utiles, c'est un clavier — mais la ligne elle-même sert justement quand il y en a un, ou quand un
menu vient d'y déposer une commande à finir.

Elle est en pied de l'HÔTE et non de la timeline : le double-Shift doit répondre sur un pupitre
comme sur un arrangement, et un menu ouvert sur n'importe quelle surface doit avoir où déposer sa
ligne.

### Ce qui n'est pas offert

La capture **MIDI**. Elle se fait dans le navigateur qui tient le clavier, et celui-ci est à
l'autre bout de la pièce ; `transport arm` marche, lui, parce que c'est l'armement du **moteur**.
Et `trackIds` n'est pas passé au `viewport` : cette liste sert à indexer le tableau `levels` du
moteur pour un shader à entrée audio, ce que presque aucun n'a — la donner voudrait dire compiler
la chanson sur un appareil qui ne fait que montrer son image.

## Obtenir le lien

Dans le **panneau Partager**, en bas : une ligne par surface, avec son type, et sous elles la
phrase qui compte — *même moteur, même session*. Chaque ligne est un vrai lien qui s'ouvre dans un
nouvel onglet, ce qui est la façon la plus courte de l'envoyer ailleurs : on l'ouvre, on prend la
barre d'adresse. À côté, un bouton *Copier*.

C'est ce panneau et pas un autre parce que c'est déjà là qu'on va chercher **toute adresse que le
projet distribue** — le lien gelé, la release k7 — et parce que le geste est le même : on donne un
lien à quelqu'un, ou à une tablette. Ce qui les sépare est dit plus bas.

Le panneau liste **toutes** les surfaces déclarées. Il n'en filtrait qu'un type tant qu'un seul se
pilotait ; les quatre se dessinent maintenant, et un filtre ici cacherait une adresse qui marche.

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
C'est `/external` : **les surfaces du projet que le moteur tient**, une ligne par surface.

```
GET /workspaces/surfaces        (service de fichiers)
  → [{ workspace, repoName, uniqueName, path, app, active, surfaces: [{id, type}] }]
GET /engine/served
  → { project: { workspace, path } | null }
```

Deux requêtes, sur le même tick, en dehors de tout projet — comme `/workspaces/projects` juste à
côté, et pour la même raison : un menu qui se remplit ligne par ligne n'est pas un menu. La
première est mémoïsée cinq secondes, la fenêtre de la liste sur laquelle elle est construite, et
elle est **séparée** de celle-là : la page d'accueil ne dessine aucune surface et n'a pas à payer
un scan par projet.

Le service ne dit pas ce qui vaut la peine d'être ouvert, il dit ce qui est **déclaré**, et ce que
le moteur tient. Le croisement est celui de l'app.

### Seulement le projet chargé

Ce menu listait la machine entière : chaque ligne d'un autre projet **déplaçait** le moteur, parce
qu'un moteur tient un projet par session (`packages/engine-protocol/docs/sessions.md`). Suivre une
ligne au hasard depuis une tablette était donc un moyen de s'interrompre soi-même à travers la
pièce, et la seule ligne utile — celle du projet ouvert — était noyée dans les autres.

Le filtre est `/engine/served`, et pas le drapeau `active` que porte chaque ligne. Les deux ne
répondent pas à la même question : `active` est le marqueur `.studio-active` d'un **espace de
travail**, un par espace, écrit par le dernier qui a ouvert — une machine avec trois marqueurs
reste un moteur qui tient une chanson. `served`, c'est la note du service de fichiers sur ce qu'il
a **envoyé**, une par session, donc un projet pour tout le compte
(`packages/file-service/docs/activeProject.md`).

C'est une croyance sur un autre processus, comme toutes les lectures de `served` : le moteur peut
avoir redémarré. On ne lui pose pas la question ici — `prewarmEngineForActive` la pose déjà, avec
son throttle, et un menu qui nomme une seconde de trop un projet que le moteur vient de lâcher se
corrige au tick suivant.

Le projet est donc le **titre** de la page, et « Surfaces » la ligne en dessous — dans ce sens-là,
parce que c'est ce que la page est : un menu d'écrans DE QUELQUE CHOSE. Les lignes portent leur
type au lieu de répéter le seul point commun qu'elles ont, et le badge « ouvert » a disparu avec
la question : toutes le seraient. Tant que le moteur ne nomme rien, le mot générique reprend le
titre et il n'y a rien à mettre dessous.

Deux vides, et ils ne disent pas la même chose. *Aucun projet ouvert sur le moteur* — le disque
est peut-être plein de surfaces, mais aucune ne rejoindrait quoi que ce soit ; on ouvre un projet
dans l'éditeur, là où la personne est. *Aucune surface dans ce projet* — celui qui est chargé n'en
déclare pas.

Cette page emprunte la pile de `Home` et non celle de l'éditeur : le compte, `engines.find()`, et
surtout **jamais `hold()`**. Un bail est une revendication SUR UN PROJET ; la prendre depuis un
menu délogerait celui qui joue. Suivre une ligne, en revanche, revendique — par les portes, qui
sont l'endroit pour ça.

Et cette revendication-là ne déloge pas l'éditeur. Un même compte sur un même moteur, c'est une
seule session et un seul projet chargé : la règle « un moteur par projet » exempte ce cas, et sans
cette exemption ouvrir une surface renvoyait le portable sur *« ce projet a été ouvert
ailleurs »*. Voir `packages/engine-registry/docs/claim.md`.

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
étant monté sous un basename qui s'arrête au projet. L'écran d'impasse — l'adresse ne nomme aucun
fichier de `surfaces/` — le porte aussi, pour la même raison.

Le panneau Partager, lui, garde son `target="_blank"` : il est dans l'éditeur, sur la machine
où l'on travaille, et y naviguer sur place remplacerait précisément l'écran qu'on regarde.

### La même adresse des deux côtés

`externalHref` passe par `projectHref`, donc un dépôt inscrit chez pl8 donne `/<dépôt>/…` et le
reste tombe sur `@local`. Ce n'est pas de la cosmétique : le moteur identifie un projet par son
adresse (`projectClaimKey`), et une tablette arrivée en `@local/…` pendant que l'éditeur tient
`/<dépôt>/…` ferait **deux revendications sur un même morceau**, la seconde délogeant la première.
C'est pour ça, et pour rien d'autre, que ce menu interroge le registre de pl8.

Le drapeau `active` que porte chaque ligne reste ce qu'il était — le marqueur `.studio-active` d'un
espace de travail — et n'est plus lu par cette page : il répond à une question voisine et pas à la
sienne, voir *Seulement le projet chargé* plus haut.

## Ce que ça n'est pas

Ce n'est pas un partage. Un partage (`@shares/<token>.st0`) est un instantané **gelé**, sans
compte, sans moteur et sans source — voir [shared.md](shared.md). Une surface externe est
l'inverse sur les trois points : elle demande le compte, elle exige un moteur, et elle **écrit**
— une platine qu'on charge depuis la tablette est chargée pour tout le monde, parce que c'est le
même moteur et la même session.
