# Jouer sur les enceintes de la machine, sans le moteur

Une troisième destination pour la médiathèque : la machine joue elle-même le fichier qu'elle
cache déjà, par `mpv`, sur ses propres sorties. Le moteur n'est pas sollicité.

## Pourquoi pas le moteur

Le moteur sait très bien jouer un fichier — mais il joue **un projet dans une session**, et
cette session est partagée avec tout ce que pl8 auditionne. L'utiliser pour écouter de la
musique, c'est prendre le transport à ce que st0 était en train d'y faire.

Ici on ne lui demande rien. Conséquence directe : on peut écouter pendant que le moteur sert
st0, ce qui est exactement l'usage d'une machine qui est un lecteur et pas un instrument.

**Mais il doit tourner.** La machine est découverte par le registre des moteurs : la sonde du
navigateur ouvre un WebSocket vers le moteur, et c'est de l'hôte qui répond que `fileBase` est
déduit — plus le jeton. Sans moteur joignable, il n'y a pas d'adresse de service de fichiers à
qui parler. D'où `needsEngine: true` sur cette destination alors qu'elle ne lui demande rien.

## Pourquoi rien ne traverse le réseau

Le fichier **est déjà là** : la machine cache la médiathèque. On lui envoie « joue ce
chemin », pas des octets.

C'est ce qui écarte un sink réseau PulseAudio/PipeWire, qui aurait fait l'inverse — le
navigateur télécharge, décode, et renvoie du PCM brut vers une machine qui a le fichier sur son
disque.

## Le chemin est RELATIF, et c'est le garde-fou

Le client envoie `songs/AC-DC/Back in Black/Hells Bells/original.flac`, jamais un chemin
absolu. La machine le résout contre **sa propre** racine médiathèque.

Ce n'est pas de la commodité, c'est la garantie : un client ne peut nommer que ce que cette
machine cache. Un `..` est **refusé** et non normalisé — c'est une tentative, pas une faute de
frappe, et la nommer vaut mieux que la corriger en silence. `machinePlayer.test.ts` le vérifie
sur trois formes d'échappement plus le chemin absolu.

Effet de bord agréable : cette destination ne demande **aucune résolution** côté navigateur,
contrairement au moteur qui a besoin de `cacheRoot` puis `playablePath`. `NowPlaying.path` est
déjà relatif à la médiathèque — il part tel quel.

Et l'état rendu reporte le chemin **demandé**, pas celui que mpv connaît : le sien est absolu,
et le rendre exposerait l'arborescence de la machine à un client qui n'en a pas besoin.

## `--ao=alsa`, et pourquoi c'est le bon défaut ici

La machine visée est **headless**. Or PipeWire et PulseAudio sont des services de session
utilisateur : sans session graphique ils ne démarrent pas tout seuls, et il faudrait
`loginctl enable-linger` pour que le systemd utilisateur parte au boot.

Sur un lecteur dédié, se passer de serveur de son est plus simple **et** plus fiable. D'où
`--ao=alsa` par défaut, remplaçable par `STUDIO_PLAYER_AO` pour une machine qui a un PipeWire
en état de marche.

Le revers à connaître : ALSA brut est **exclusif**. Si le moteur tient déjà la carte (JUCE
l'ouvre et la garde), mpv ne l'ouvrira pas. Sur un lecteur dédié c'est sans conséquence — le
moteur n'est là que pour être découvert. Sur une machine qui joue vraiment des deux côtés, il
faut un PipeWire qui mélange, donc `STUDIO_PLAYER_AO=pipewire` et la session persistante.

## Un mpv par personne, gardé en veille

`--idle=yes` le fait attendre un `loadfile` au lieu de sortir : le relancer à chaque morceau
coûterait un démarrage de processus pour rien. `--no-config` aussi, parce que ce processus est
un organe de ce service et non la session mpv de quelqu'un — un `~/.config/mpv` avec des
scripts n'a rien à faire là.

Le pilotage passe par son [IPC JSON](https://mpv.io/manual/master/) sur un socket unix, une
ligne par message. L'IPC de mpv **n'a ni authentification ni chiffrement** : c'est acceptable
parce qu'il est purement local, et que le portier à jeton du service de fichiers est devant.

L'état est **lu à la demande** plutôt que suivi par les événements : ça évite de le tenir à
jour des deux côtés du socket. Les quatre propriétés partent ensemble sur la même connexion,
donc c'est un aller-retour et non quatre.

## Ce que le navigateur voit

mpv est sur une autre machine : il n'a aucun moyen de pousser sa position jusqu'à la barre du
bas. Elle est donc **interrogée**, deux fois par seconde — assez pour qu'une barre de
progression ne saccade pas, assez peu pour ne pas marteler une machine dont c'est le seul
travail.

La fin d'un morceau est franche, contrairement au moteur dont il faut l'inférer : mpv passe en
veille (`idle-active`). Reste `weStopped`, pour la même raison qu'ailleurs — un arrêt demandé
ressemble à une fin.

Le déplacement dans le morceau est **optimiste** : la poignée suit le doigt et le prochain tour
d'interrogation dit la vérité. Attendre l'aller-retour ferait sauter le curseur en arrière sous
la souris.

Fermer la barre **fait taire la machine**. Sans ça elle continuerait sans nous : c'est un
processus là-bas, pas un élément de cette page.

## Ce qu'il faut sur la machine

`mpv` sur le PATH — c'est tout, et il est sondé à la demande, comme yt-dlp l'est côté pl8. Sans
lui, la route rend 503 avec la phrase, plutôt que d'échouer en silence.
