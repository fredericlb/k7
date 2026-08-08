# Les platines comme document

`useDeckSet` possède ce que les deux platines SONT — ce qui est chargé, à quel tempo, où sont
le crossfader et les six potards d'EQ — et tous les gestes qui changent l'un ou l'autre. Il est
appelé une fois, par `Studio`.

## Pourquoi pas dans MixView

Parce que Studio démonte MixView dès qu'on ouvre Graphe, et **un set ne cesse pas d'exister à
ce moment-là**. Tant que l'état vivait dans la vue :

- le graphe n'avait aucun moteur à interroger, donc ses potards affichaient le nombre que le
  fichier déclare et rien d'autre ;
- un aller-retour par le graphe ramenait le crossfader au centre et les EQ à plat, pendant que
  le son restait où on l'avait mis ;
- et le potard de tempo du graphe ne pouvait pas être tourné du tout : étirer un morceau
  demande les morceaux chargés et le document compilé, partis avec la vue.

Les trois sont le même nœud. MixView **dessine** les platines et n'en possède rien ; ce qui
lui reste en propre est la liste du set, les enveloppes de waveform et le sélecteur de
morceaux — des choses qui ne survivent pas à l'onglet parce qu'elles n'ont pas à le faire.

## Les deux chemins vers le moteur, toujours

| | crossfade, EQ | tempo |
|---|---|---|
| dans le document | un vrai plugin | **rien** (`offline`) |
| envoi | `set-plugin-param`, à chaque pixel | le document entier, cadencé à 120 ms |
| qui connaît la valeur | le **moteur** (`deck.params`) | ce hook (`deck.moduleParams`) |

C'est ce partage qui explique tout le reste. Le moteur rapporte ce qu'un plugin vaut, quelle
que soit la surface qui l'a réglé — donc pupitre et graphe lisent la même chose. Pour un module
`offline` il n'y a rien à interroger : la valeur n'existe que sur la surface qui le RÉALISE, et
ce hook la prête au graphe.

## Tourner le tempo depuis le graphe

Le graphe ne connaît qu'un module et un paramètre — c'est tout ce qu'un nœud porte. Il n'a
aucune idée de ce qu'est une platine. `controlDriving` lit donc la liaison **à l'envers** :
`views/mix.yaml` dit déjà quel contrôle pilote le `Target BPM` de `tempoA`, et relire la même
ligne dans l'autre sens est ce qui empêche les deux surfaces de diverger. Repointez
`deckA.tempo` vers `tempoB` et le potard du graphe sur `tempoB` devient celui de la platine A,
sans que ni l'un ni l'autre n'ait été prévenu.

Seules les liaisons **sans plugin** répondent. Une liaison qui en a un possède sa propre prise
— le graphe envoie `set-plugin-param` et ne pose jamais la question — et répondre lui donnerait
deux routes vers le moteur, ce qui est la façon dont une valeur finit appliquée deux fois.

Le graphe n'annonce pas la fin d'un geste à son hôte, contrairement à un fader qui envoie un
`pointerup`. Le commit final est donc **temporisé** (`GRAPH_SETTLE_MS`) : assez long pour ne pas
tomber en plein glissement, assez court pour que la valeur exacte où le potard a été lâché
arrive vite.

## Ce qu'un appelant PÉRIMÉ doit quand même lire juste

Les fonctions rendues sont capturées par les vues et appelées plus tard. `measured` s'exécute
depuis la closure du rendu qui a lancé la requête d'enveloppe, plusieurs rendus plus tôt.

Lire `loads` sur cette closure renverrait le document **sans le morceau qu'on vient de poser** —
une platine qui joue une seconde puis se tait. Idem pour les dérivés : le compile peut atterrir
entre le clic et le retour de l'analyse, donc `measured` doit résoudre ses liaisons contre le
projet tel qu'il est MAINTENANT.

D'où les refs (`loadsRef`, `fadersRef`, `derived`) et le fait que tout envoi passe par
`commitRef.current` : une ref est le même objet à chaque rendu, donc un appelant périmé lit ce
qui est vrai à l'instant où il appelle.
