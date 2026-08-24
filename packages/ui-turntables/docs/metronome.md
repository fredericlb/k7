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
  BPM par leurs warps respectifs ;
- la musique d'une platine est **dix minutes plus loin** ([bpm.md](bpm.md), la marge) ;
- son premier temps est là où l'enregistrement l'a mis, pas sur un temps du document.

Ces deux grilles n'ont aucune raison de se rencontrer. Ce clic-là **flammerait** contre la
musique — pire que pas de clic du tout, puisqu'on s'y calerait.

Et on ne peut pas rattraper ça en donnant au document le tempo de la platine. Ça corrigerait
l'**écartement** et pas la phase ; et la phase n'est pas rattrapable non plus, parce que tenir
la musique immobile pendant un changement de tempo déplace le temps fort du morceau de
`(où on en est − où est le temps) × la variation d'étirement` — soit une vingtaine de temps à
deux minutes du début. L'alignement ne survivrait pas à un pas de fader.

## Ce que le pupitre fait à la place

Une piste de plus dans le document, avec un `4osc` et **un clip MIDI d'une mesure, bouclé**.

Les notes sont placées en temps du document utilisés purement comme une **unité de durée** :
un temps de la platine vaut `DOC_TEMPO / cible` temps du document. À 128 contre un document à
120, ça fait 0,9375 — un nombre non entier, et c'est très bien, personne ne compte ces temps-là.
Le clip démarre sur le temps fort du morceau, via le `transportAt` qui porte déjà l'étirement,
le retard du sync et le slip du fader de pitch. Le tempo du document n'est jamais touché et
aucune platine n'est déplacée.

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

## Le banc

`packages/ui-turntables/scripts/metronome.ts`, pointé sur un moteur qui tourne. La platine joue un
fichier **silencieux**, donc tout ce que la prise d'écoute entend est le clic, et chaque attaque
est comparée à l'endroit où la grille de cette platine dit qu'un temps se trouve. Puis il bouge
le tempo par le **vrai** geste (`nudgedTempos`, slip compris) et repose la même question, parce
que le clip est reconstruit et que c'est le deuxième placement qui peut être faux.

Mesuré : **30 clics, écart maximal 3,0 ms avant le changement et 3,1 ms après**. Les 3 ms sont
le temps de montée du détecteur d'attaque, pas une erreur de placement — le plancher de la
mesure.

## Ce qui n'y est pas

Le niveau est **fixe** (−6 dB sur sa propre tranche). Pas de réglage : le pupitre n'a pas de
place pour un potard de plus, et un métronome qu'on n'entend pas est un métronome éteint.

Il sort par l'**interface du moteur**, avec la musique, pas par le navigateur. C'est la
contrainte qui décide : un clic fabriqué dans l'onglet arriverait avec sa propre latence de
sortie, décalé de quelques dizaines de millisecondes contre la musique — donc inutilisable pour
exactement ce à quoi sert un métronome.
