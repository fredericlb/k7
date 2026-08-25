# Le casque — préécouter une platine pendant que l'autre passe

Deux boutons dans la barre du bas, à côté du métronome : **A** et **B**, une icône de casque.
Appuyer met cette platine dans les oreilles, sans rien changer à ce que la salle entend.

C'est le geste qui manquait au pupitre pour qu'il soit une table à deux platines : caler le morceau
suivant avant de le lancer.

## Ça ne demandait pas un second transport

Le raisonnement naturel — « préécouter, c'est jouer B pendant qu'A passe, donc deux transports » —
est faux ici, et c'est ce qui rend la chose possible. Les deux platines **jouent déjà en même
temps** : elles sont deux pistes d'un même document, et c'est le crossfader qui décide de ce qui
sort. Il ne manquait pas un second transport, il manquait une seconde **sortie**.

Ce qu'un transport unique interdit toujours : lancer une platine seule, et un repère qui ne déplace
qu'elle ([mix.md](mix.md), [cues.md](cues.md)).

## Pre-fade : avant le crossfader, après l'EQ

Le départ est pris sur `filter<X>`, donc **après l'EQ et le filtre, avant le fade**. Les deux moitiés
comptent :

- **avant le fade** — éloigner le crossfader de cette platine ne doit pas la retirer des oreilles,
  sinon on ne peut rien préparer ;
- **après l'EQ** — couper le grave de la platine qui arrive doit s'entendre au casque *avant* que ça
  touche la salle. C'est le geste de transition le plus courant ; l'entendre après coup ne sert à rien.

## Le bouton ne commute rien

`cue<X>` est un nœud du module `fade`, comme les deux moitiés du crossfade. Son `Mix` est la quantité
de cette platine qui part au casque, et le bouton est cette liaison passant de 0 à 1 — la même
mécanique que le crossfader, l'EQ et les coupes de stems, par `set-plugin-param`.

Il n'y a donc **aucun** interrupteur de cue dans le moteur, et rien de nouveau sur le fil. Au repos
`Mix: 0` : un set commence avec rien dans les oreilles.

C'est un **bouton** et pas un potard, bien que ce qu'il déplace soit un gain : préécouter est oui ou
non, on ne le dose pas. Le volume du casque est le bouton de l'ampli casque de l'interface — un
matériel qui en a un, et une commande de moins à dessiner.

## Non câblé est un état ORDINAIRE — et il y a DEUX façons de l'être

Le bouton est éteint et désactivé dans deux cas qui n'ont pas le même remède, et il dit lequel :

| ce qui manque | ce que le bouton dit |
|---|---|
| le PROJET ne câble pas de départ (`cueWired`) | « migrez le set (`migrateSetCue`) ou reliez `deckA.cue` dans `surfaces/` » |
| la MACHINE n'a pas nommé de paire (`cueLive`) | « nommez-la avec `system cue 3+4`, sinon le cue ne joue nulle part » |

Le second est celui qu'on oublie, et sans lui le bouton **s'allumerait pour ne rien faire** — ce que
[hosting.md](hosting.md) refuse déjà pour « Écouter ici » : une commande qui ne peut pas être honorée
est pire qu'absente.

Le pupitre le sait sans rien demander de neuf : la piste de cue du **document compilé** porte ses
`outputChannels`, et `leavesByItsOwnPair` les lit. Cette fonction interroge les CANAUX et jamais le
mute — un strip `bus_only:` est muté lui aussi et parfaitement audible par ses départs, donc s'y fier
éteindrait les potards d'EQ. Un test fige cette distinction.

`deck<X>.cue` est **offert sans être exigé** — il ne figure pas dans `REQUIRED_CONTROLS`, comme les
quatre stems et pour une raison de même nature : une machine à une seule paire de sortie n'a nulle
part où envoyer un casque, et un pupitre qui refuserait de se dessiner y aurait tort.

## À ne pas confondre avec « Écouter ici »

Deux commandes voisines, deux questions différentes — d'où deux icônes depuis que les boutons CUE
existent :

| | ce que c'est | icône |
|---|---|---|
| **CUE A / B** | une platine vers la **seconde paire de l'interface** — le casque du DJ | un casque |
| **Écouter ici** | le master diffusé dans **cet onglet**, pour un laptop sans monitoring | un portable |

La seconde est décrite dans [hosting.md](hosting.md) et reste absente chez un hôte sans lecteur de
flux. La première dépend de la machine, pas de l'hôte.

## Où ça sort, et ce qui arrive quand il n'y a nulle part

La paire est un fait sur la **machine**, pas sur le set : `system cue 3+4`, rangé dans
`~/.studio/preferences.yaml`. Une machine qui n'en nomme pas joue le bus de cue **nulle part** —
jamais replié sur le master, ce qui mettrait le retour casque dans la salle. Trois portes ferment ce
cas, et elles sont mesurées : `packages/song/docs/cue.md`.

## Ce que ça ne fait pas encore

Un **niveau de casque** dans l'application, et un mélange cue/master : l'ampli de l'interface a son
propre bouton, et une platine par bouton suffit à caler. Le jour où une machine sans bouton physique
en aura besoin, c'est un `Mix` intermédiaire sur le même nœud — rien de structurel.
