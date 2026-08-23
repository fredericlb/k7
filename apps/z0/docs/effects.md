# Les neuf effets du blindtest, refaits pour le studio

z0 déforme un extrait avec neuf effets, écrits en WebAudio dans
`packages/player-web/src/audioEffects.ts` et stockés dans une session comme neuf colonnes
`fx_*`. Cette page dit où chacun est parti, ce qui est fidèle et ce qui ne l'est pas.

La règle appliquée : **jsdsp quand le vocabulaire du graphe l'exprime, le moteur sinon.**
Rien n'a été ajouté au C++ — les deux effets qu'un graphe ne peut pas décrire existaient déjà
comme plugins internes.

| effet z0 | devient | forme |
|---|---|---|
| `lowpass` | `@st0/audio/filter/lowpass` | jsdsp, fidèle |
| `highpass` | `@st0/audio/filter/highpass` | jsdsp, fidèle |
| `overdrive` | `@st0/audio/distortion/overdrive` | jsdsp, fidèle à la normalisation près |
| `chorus` | `@st0/audio/modulation/chorus` | jsdsp, fidèle |
| `pitchvar` | `@st0/audio/modulation/wobble` | jsdsp, autre mécanisme |
| `phaser` | `@st0/audio/modulation/phaser` | jsdsp, **approximation assumée** |
| `bitreduction` | `@st0/audio/distortion/bitcrush` | moteur — AirWindows De Rez |
| `pitch` | `@st0/audio/utility/pitch-shift` | moteur — Tracktion Pitch Shifter |
| `speed` | rien : ce n'est pas un traitement | reste `speed:` sur le morceau de la session |

Les six premiers portent un seul paramètre `Amount`, de 0 à 100, parce que c'est exactement ce
qu'une question de blindtest écrit. Les courbes sont celles de z0 : le passe-bas descend de
20 kHz à 200 Hz géométriquement, le chorus balaie 0,2 à 5 Hz sur 20 ms, l'overdrive pousse
tanh de 1 à 50.

## Comment une question porte ses effets

Pas dans le YAML. Une question déformée est **une version du morceau**, et la médiathèque sait
déjà tenir les versions d'un morceau : son sidecar les liste sous `variants:`, et une valeur
qui ne nomme pas un fichier à côté du master nomme une **chaîne**
([variants.md](../../../packages/mediatek/docs/variants.md)). C'est exactement le cas ici, et
`chains.md` de la médiathèque l'avait écrit avant nous : « z0 traite un morceau avec une ».

Donc :

```
chains/blindtest/deformees/blue-monday/
  graph.yaml            "@in" → pitch → wobble → highpass → chorus → overdrive → "@out"
  nodes/pitch.yaml   extends: "@st0/audio/utility/pitch-shift"
                         params: { "semitones up": 5 }
  nodes/…
```

```yaml
# songs/New Order/Album inconnu/Blue Monday/song.yaml
variants:
  "deformees": "blindtest/deformees/blue-monday"
```

```yaml
# la catégorie, dans la session
name: Déformées
variant: deformees
```

**Un nom sur la catégorie, une chaîne par morceau.** C'est ce qui rend la chose « templatée »
au bon endroit : le YAML de session dit `deformees` une seule fois, et chaque sidecar résout
ce mot vers ses propres valeurs — celles qu'une personne a réglées question par question, et
qui sont l'identité de la question. Une chaîne partagée par tous les morceaux aurait été un
modèle qui perd ce qu'il modélise. Deux morceaux aux réglages *identiques* partagent bien la
même chaîne, en revanche : la déduplication se fait sur la carte d'effets, pas sur le nom.

L'ordre des modules dans la chaîne est fixe — pitch, wobble, bitcrush, lowpass, highpass,
phaser, chorus, overdrive — le pitch d'abord parce qu'il resynthétise, la saturation en
dernier parce qu'elle vient après la mise en forme. z0 n'avait pas d'ordre du tout : il
chaînait les effets dans l'ordre des colonnes Grist.

Ce que ça donne : **16 chaînes** pour 20 emplacements de variante sur 20 sidecars, sous
3 catégories (`Déformées` deux fois, une par session, et `Assourdissant`). Les 15 morceaux de
`Slooow` n'ont rien reçu : ils ne portent que `speed`.

## Ce qui n'est pas fidèle, et pourquoi

**Le phaser.** z0 empilait quatre passe-tout balayés par un LFO. Le vocabulaire du graphe
(`engine/moteur/engine/DspGraph.h`) ne peut ni l'un ni l'autre, et les deux raisons méritent
d'être écrites une fois pour toutes :

1. `biquad` connaît quatre modes — passe-bande, passe-bas, passe-haut, réjecteur — et **pas
   passe-tout**.
2. Un passe-tout du premier ordre a besoin de `y[n−1]`, et **aucun graphe ne peut le tenir**.
   Le seul nœud qui écrit un fil *nommé* est `adelay`, dont la lecture est bornée à un
   échantillon minimum ; lire ce fil avant son écrivain rend donc `y[n−2]`. Un échantillon de
   retour, exactement, est la chose que la boucle ne sait pas exprimer.

Le module est donc un **peigne balayé** : sec moins une prise courte qui bouge. À l'oreille
c'est le même geste, sur un tracé ce sont des creux harmoniques là où un vrai phaser en a
d'irréguliers. Ajouter un mode passe-tout au `biquad`, ou un LFO au rythme du bloc pour en
balayer un, rendrait la version exacte triviale — dix lignes de graphe. Le built-in
`@engine/phaser` du moteur est un vrai phaser, mais ses trois réglages (Depth, Rate, Feedback)
sont séparés : pas de bouton unique, donc pas la forme d'une question.

**Le wobble.** z0 sommait trois LFO sur le désaccord de la source. Rien ici ne réaccorde un
tampon, alors la hauteur vient d'où elle vient sur une bande : une ligne à retard dont la
longueur bouge. Les trois fréquences sont celles de z0 (0,23 / 0,71 / 1,37 Hz), mutuellement
irrationnelles pour que le voilage ne se laisse jamais prévoir. Ce qui saute, c'est la dérive
aléatoire que z0 injectait toutes les 800 ms : un graphe est une description, évaluée
identiquement à chaque fois, et il n'y a pas de source de bruit dans ce vocabulaire.

**L'overdrive.** Même courbe `tanh(drive·x)`, drive de 1 à 50. La normalisation de z0 divisait
par `tanh(drive)`, et il n'y a pas de `tanh` au rythme du contrôle ; au-dessus de drive 4 ce
diviseur vaut 1 à un demi-pour-cent près, donc une rampe à deux points couvre le bas du bouton.

**Le bitcrush.** Le seul des neuf qu'un graphe ne peut pas décrire *du tout* : quantifier
demande un arrondi, et ce vocabulaire n'a ni arrondi ni division. C'est donc De Rez, l'effet
AirWindows que Tracktion embarque, avec ses deux réglages `Rez` (longueur du mot) et `Rate`
(horloge). Il n'y a pas de bouton unique de 0 à 100 : le plugin n'a pas cette entrée.

**Le pitch.** Décaler la hauteur sans bouger l'horloge demande un rééchantillonneur fenêtré,
c'est-à-dire un algorithme et non un graphe de primitives. Le moteur en héberge déjà un. Et
c'est le seul endroit où la réimplémentation est **meilleure** que l'originale : z0 désaccordait
la source, ce qui accélérait aussi le morceau ; celui-ci ne touche pas à la durée.

**La vitesse.** `speed` n'est pas un effet — c'est la vitesse de lecture, `playbackRate = v/10`
sur la source WebAudio. Aucun module ne peut la changer : un module est un insert, il voit des
échantillons et n'a pas d'horloge. Aucune chaîne non plus, donc `speed:` reste **un champ du
morceau dans la session**, seul survivant des neuf colonnes `fx_*`. Sur un clip, le studio
l'exprime avec deux repères `warp:` (`{ algorithm: elastique, markers: [[beat, secondes], …] }`,
voir `packages/song/src/nodeProject.ts`) — qui étire le temps *sans* descendre la hauteur, là
où z0 faisait les deux d'un coup. Le duo « warp + Pitch Shift » reproduit l'original.

## La phase appartient au backend

Une deuxième chose que la lecture du code laisse deviner trop tard : **la phase de la partie
est décidée sur le serveur**, et `backend/src/game/phase.ts` est le seul endroit qui la change.
`setServerPhase` est le point de passage unique — `flushBuzzes`, la dépêche des `remote_action`,
`handleNext`, le verrou d'inscription y passent tous — et il fait trois choses d'un coup :

1. il **dérive le verrou des buzzers** de la nouvelle phase. `phaseAcceptsBuzzes` est la seule
   définition : `song` et `registration` sont ouverts, tout le reste est fermé. Personne ne
   pose `buzzersLocked` à la main ;
2. il **persiste** l'état ;
3. il **diffuse** `phase_change` à tous les clients, écran principal et buzzers.

Faire autrement — laisser un écran poser sa phase et l'annoncer — casse dès qu'il y a deux
télécommandes ou deux buzzers en course, ce qui est le cas normal.

Le déverrouillage n'est pas symétrique du verrouillage, et c'est voulu : rouvrir les buzzers
**réémet un `locked: true` ciblé** aux appareils encore en pénitence, avec le temps qu'il leur
reste. Sans ça, une mauvaise réponse punie d'un cooldown serait pardonnée par la question
suivante.

Enfin, un buzz n'est pas traité tout de suite : les buzz sont **collectés pendant 150 ms** et le
plus ancien horodatage gagne. C'est ce qui rend la course jouable sur des téléphones dont la
latence réseau varie ; c'est aussi pourquoi `flushBuzzes` est le seul endroit qui fait passer
`song` → `answering`.

## Qui joue le son, et qui le dessine

Une seule des six SPA tient un `AudioContext` : **`monitor-web`**. `audioPlayback.ts` y possède
le `SongPreloader` de `@studio/player-web` et le pilote depuis le WebSocket (`next`,
`phase_change`, `audio_command`). Le presenter ne joue plus rien du tout — il ne lui reste que
son bip de buzz et le tic des trois dernières secondes, deux `<audio>` ordinaires.

C'est ce qui explique une demi-douzaine de bizarreries qui, lues une par une, passent pour des
oublis :

- **Le presenter ne précharge pas.** `preloadCategory` lui est passé en no-op : `monitor-web`
  réagit au *même* `next` et fait le préchargement pour de bon. Le presenter n'en voit que le
  reflet, par les diffusions `preload_progress` / `preload_failed`, qui alimentent sa barre.
- **Il n'a jamais besoin d'un geste utilisateur.** Un `AudioContext` ne démarre qu'après un
  clic ; sans contexte, il n'y a rien à débloquer, donc l'écran reprend la partie tout seul au
  chargement au lieu d'afficher un « cliquez pour commencer ».
- **Son timecode reste à `0:00`.** L'heure de lecture est sur l'autre machine ; l'afficher
  demanderait une diffusion par frame pour un chiffre décoratif.
- **La machine à états score/reveal/multi est chez `monitor-web`.** Le presenter reçoit
  `reveal_state` et `multi_state` et les dessine, un point c'est tout — d'où des champs comme
  `multiRemovedTracks` qui ne sont écrits par aucune logique locale.
- **Les intentions partent en `audio_command`** (`play`, `pause`, `stop`, `set_gain`,
  `set_playback_rate`, `set_duck`, `mute_multi_track`…). C'est le seul vocabulaire par lequel
  un écran demande quelque chose au son.

Et une conséquence sur l'ordre des messages : le backend diffuse `phase_change` **avant**
`next`. L'écouteur de phase écrit donc en premier, et la phase de rendu propre au presenter
(scoreboard, pause, mystery-question) que pose le gestionnaire de `next` gagne sur le même
tick. Inverser les deux diffusions ferait clignoter la phase.

### Le mode playlist joue autrement

`online/src/lib/playlistPlayer.ts` n'est pas un `SongPreloader` : c'est **deux `<audio>` qui
tournent**, l'un qui joue pendant que l'autre précharge la piste suivante. Le motif est la
mémoire — un extrait de 30 s stéréo décodé coûte ~10 Mo de RAM, donc cinquante pistes
dépasseraient le demi-gigaoctet. Le prix à payer est qu'**aucun effet WebAudio ne s'applique**,
ce qui tombe bien : une playlist n'en porte aucun, et toutes ses catégories sont en mode `""`.

**Le tirage se fait ici, pas dans le backend.** `/playlists/:id/tracks` répond à la question
« qu'y a-t-il dans cette playlist » ; un point d'entrée qui renverrait un ordre différent à
chaque appel mentirait sur ce qu'il décrit. Dans quel ordre on est *interrogé* est une
propriété de la partie, et `sessionFromPlaylist` est la couture où une playlist en devient une.
Le tirage a lieu **une fois par sélection**, donc il tient toute la manche et ne change qu'en
re-choisissant la playlist — et rien n'est perdu à le refaire, puisqu'une manche de playlist
ne garde aucun point de reprise. Une session préparée, elle, garde son ordre écrit : celui-là
est composé, et le `from`/`to` de `order` le découpe par index.

Le `path` de chaque morceau vise la redirection du backend plutôt qu'une URL de CDN, pour la
même raison que ci-dessus : une signature Deezer meurt au bout d'un quart d'heure, et une
partie un peu longue calerait en son milieu.

Deux conséquences dans ce fichier : le préchargement ne **rejette jamais** (il se résout sur
`canplaythrough`, sur erreur, ou sur un délai de 15 s), parce que la porte d'entrée de la partie
l'attend et qu'une piste morte ne doit pas figer le jeu ; et `resumeContext()` doit être appelé
**synchroniquement** depuis le clic de démarrage, avant tout `await`, sinon le navigateur refuse
le `play()` programmatique qui suit.

Enfin, `monitor-web` sait **reprendre après un rechargement** : le backend ne rediffuse pas le
`next` courant à la connexion, alors la page va chercher `/api/game` elle-même et le rejoue,
catégorie préchargée d'abord pour que l'évènement `song` trouve ses tampons en cache.

## Où vivent les sources

Sur le volume de la médiathèque, `modules/audio/<catégorie>/<nom>/`, qui est le seul catalogue
éditable (voir `AGENTS.md` à la racine). Chaque module jsdsp y tient quatre fichiers :
`module.yaml`, `jsdsp.ts` — la source, le fichier qu'on modifie —, `jsdsp.json` — la
construction, régénérée dès que la source est plus récente — et `ui.yaml`, le panneau.

Le `.json` n'est pas un cache qu'on peut ignorer : c'est ce qui part dans le document, parce
que le moteur ne lit aucun fichier. `compileNodeProject` relance la source dans un processus
enfant quand elle est plus neuve et réécrit le `.json` à côté.

## Ce qui a été vérifié

Sans jouer une seule note — un second moteur à côté de celui qui tourne bloquerait le pilote
ASIO, ce que `engine/moteur/AGENTS.md` raconte en détail :

- les huit modules se résolvent par `loadModuleRefs`, avec **zéro anomalie** sur toute la
  bibliothèque (`libraryModuleIssues`) ;
- un projet qui en insère un se compile : les six jsdsp arrivent en `type: "DSP Graph"` avec
  leur graphe inline, `bitcrush` en `"De Rez"` et `pitch-shift` en `"Pitch Shifter"` ;
- les six graphes se construisent avec le vrai `GraphBuilder` et n'emploient que des types de
  nœuds que `DspGraph::build` accepte ;
- les **16 chaînes** passent par `chainSteps()` — la fonction même que le dessin et la lecture
  d'une variante emploient — et rendent la suite d'étapes attendue ; chaque `nodes/*.yaml`
  nomme un module qui existe, sans orphelin ni étape sans nœud ;
- le scan de la médiathèque les liste toutes les 16 dans la famille `chains`, donc pl8 les
  montre ;
- côté sessions, chaque `variant:` de catégorie trouve, pour chaque morceau concerné, soit un
  fichier à côté du master (28), soit une chaîne qui existe (20) ; 18 retombent sur le master,
  ce qui est la règle.

Ce qui n'est pas vérifié, et ne peut pas l'être ici : **le son**. Aucun de ces réglages n'a été
écouté.
