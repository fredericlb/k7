# Le métronome

Un bouton dans la barre du bas, à côté du transport. Allumé, un clic marque le temps de la
musique, avec le premier temps de chaque mesure plus haut. Éteint ou noir le reste du temps.

## Il n'est pas toujours proposé, et c'est le sujet

Un clic doit être sur **un** temps. Deux platines qui tournent librement en ont deux, et un clic
sur l'un est un clic contre l'autre — donc le bouton s'éteint plutôt que de choisir. Il s'allume
dans exactement deux cas :

- **une seule platine chargée** : c'est son temps ;
- **les deux synchronisées** : c'est celui du maître, puisque le sync a mis l'autre dessus.

Il faut en plus que ce temps ait été **mesuré**. Un tempo dit à quelle fréquence un temps
arrive, pas quel instant en est un — et `beats.ts` refuse déjà de publier une phase que les
attaques n'ont pas dite (voir [bpm.md](bpm.md), le test de Rayleigh). Un clic sur la mauvaise
moitié du temps n'est pas un métronome dégradé : c'en est un faux, et on se calerait dessus.
Donc pas de phase, pas de clic. Sur les trois morceaux d'`example.st0`, ça exclut le Bashung,
dont le tempo détecté est simplement faux.

L'envie est **retenue** même quand la possibilité disparaît : charger une deuxième platine
éteint le clic, la resynchroniser le rallume, sans repasser par le bouton.

## Pourquoi ce n'est PAS le métronome du moteur

Le moteur en a un — `settings.metronome`, un booléen, et c'est celui de st0. Il clique sur la
grille du **document** : les temps de `DOC_TEMPO`, comptés depuis le transport zéro.

Sur une timeline ça suffit, parce que le tempo du document EST celui de la musique. Sur le
pupitre rien de tout ça n'est vrai :

- le tempo du document est **figé** à 120, exprès, pour que deux platines puissent jouer à deux
  BPM ;
- la musique d'une platine n'est **pas sur la timeline du tout** : elle est dans un plateau, à une
  position que le plugin porte lui-même ;
- son premier temps est là où l'enregistrement l'a mis, pas sur un temps du document.

Ces deux grilles n'ont aucune raison de se rencontrer. Ce clic-là **flammerait** contre la
musique — pire que pas de clic du tout, puisqu'on s'y calerait.

## Ce que le pupitre fait à la place

Une piste de plus dans le document, avec un `4osc` et **un clip MIDI d'une mesure, bouclé**.

Les notes sont placées en temps du document utilisés purement comme une **unité de durée** :
un temps de la platine vaut `DOC_TEMPO / cible` temps du document. À 128 contre un document à
120, ça fait 0,9375 — un nombre non entier, et c'est très bien, personne ne compte ces temps-là.
Le tempo du document n'est jamais touché et aucune platine n'est déplacée.

## Il a l'ÉCARTEMENT et il n'a pas la PHASE

> **Le clic est le dernier habitant du transport, et plus rien ne l'y accompagne.** Une platine est
> un plateau et porte sa propre position ; ce clip, lui, est posé sur une timeline que personne ne
> suit. Il donne donc le bon **écartement** entre deux temps, et un **décalage arbitraire** contre la
> musique — c'est-à-dire un flam, exactement ce que la section précédente refuse au métronome du
> moteur.

C'est vrai depuis que le plateau est le défaut ; l'étape 4 de `docs/platter-plan.md` n'a fait que
cesser de le maquiller. Avant elle, le clip démarrait sur `transportAt(phase)` — une seconde de
transport calculée à partir d'un début de clip qui n'existait plus. Le nombre était faux, mais il
avait l'air d'être quelque chose. Maintenant le clip démarre à **zéro** et la page dit que la phase
manque, ce qui est le même son avec un mensonge en moins.

**Le remède n'est pas décidé.** Deux formes, aucune essayée :

- **un plateau de plus**, qui jouerait un fichier de clic ; il partagerait alors la position et le
  débit des autres, ce que la moitié du travail sait déjà faire (`plattersOf`) ;
- **une ancre vivante** : à un instant donné on connaît l'aiguille de la platine ET le transport,
  donc on sait poser le prochain temps fort. Ça se recalcule à chaque envoi de document, et ça
  dérive dès qu'une main touche le disque.

Le banc qui vérifiait le placement (`scripts/metronome.ts`) mesurait cette phase-là. Il a été
supprimé avec elle : il ne peut revenir qu'avec une ancre à mesurer.

Une mesure bouclée plutôt qu'une note par temps : le clip est reconstruit à **chaque pas** d'un
glissement de tempo, et six minutes de morceau font mille notes à renvoyer et à diffuser pour un
son qui se répète toutes les quatre.

Le clic est une **enveloppe**, pas une forme d'onde : attaque immédiate, fini en trente
millisecondes, rien de tenu. La hauteur est celle de la note, donc le temps fort est simplement
plus haut — comme le `clickTrackEmphasiseBars` du moteur, et pour la même raison : entendre où
commence la mesure EST la fonctionnalité, pas une option séparée.

### La piste reste là quand le clic est éteint

Pas par propreté. `ChangeKind::TrackRemoved` est un **squelette** dans le moteur
(`EngineHost.cpp`) : une piste retirée du document reste dans l'edit. Un métronome qu'on ne
pourrait pas éteindre serait un bug pire que la fonctionnalité n'est une fonctionnalité — donc
le silence est une **liste de clips vide**, et la suppression de clip, elle, est réellement
implémentée.

C'est aussi le motif que le document des platines suit déjà : les deux pistes sont toujours
présentes, chargées ou non, pour qu'un chargement soit un diff et pas une piste qui apparaît.

### Elle est ajoutée, pas déclarée

`withDecks` la met **après** les pistes du projet. C'est la seule piste du document dont
`graph.yaml` ne parle pas, et c'est assumé : le métronome est une commande du pupitre, pas une
propriété du set. Ce que le projet déclare reste l'affaire du projet.

## Le banc qu'il y avait

`scripts/metronome.ts` pointait sur un moteur qui tourne : la platine jouait un fichier
**silencieux**, donc tout ce que la prise d'écoute entendait était le clic, et chaque attaque était
comparée à l'endroit où la grille de cette platine disait qu'un temps se trouve.

Mesuré, du temps des clips : **30 clics, écart maximal 3,0 ms avant un changement de tempo et
3,1 ms après** — les 3 ms étant le temps de montée du détecteur d'attaque, soit le plancher de la
mesure. Le placement était donc juste, et c'est le repère contre lequel une ancre devra se
mesurer.

Le banc lui-même est parti avec la phase qu'il vérifiait : sa question n'a plus de bonne réponse.

## Ce qui n'y est pas

Le niveau est **fixe** (−6 dB sur sa propre tranche). Pas de réglage : le pupitre n'a pas de
place pour un potard de plus, et un métronome qu'on n'entend pas est un métronome éteint.

Il sort par l'**interface du moteur**, avec la musique, pas par le navigateur. C'est la
contrainte qui décide : un clic fabriqué dans l'onglet arriverait avec sa propre latence de
sortie, décalé de quelques dizaines de millisecondes contre la musique — donc inutilisable pour
exactement ce à quoi sert un métronome.
