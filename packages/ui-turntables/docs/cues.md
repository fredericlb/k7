# Les repères d'une platine

Huit boutons sous chaque waveform. **Appui court** : la tête de lecture saute au repère.
**Appui long** (1 s) : le repère est posé. Blanc tant qu'il est vide, sa couleur une fois
assigné.

Les huit boutons sont là **même sans morceau**, simplement grisés. Un pupitre dont les
commandes apparaissent et disparaissent avec ce qui est chargé est un pupitre qui bouge sous les
mains : la rangée pousserait le titre vers le haut et la tranche vers le bas à l'instant où un
morceau atterrit, et les huit positions qu'une main est en train d'apprendre ne seraient pas là
pour être apprises. Grisé dit « pas encore » ; absent dit « cherche-le ».

## Le geste, et où il pose exactement

Le repère est posé **à l'instant où le doigt s'est posé**, pas à l'instant où la seconde
s'écoule. Un DJ appuie quand il entend ce qu'il veut marquer ; lui demander de tenir une
seconde de plus placerait le repère une seconde trop tard, à chaque fois — soit un repère qu'il
faut corriger plutôt qu'un repère utilisable.

La position est donc capturée sur le `pointerdown` et n'est **utilisée** que si l'appui dure.
Le minuteur décide lequel des deux gestes a eu lieu ; il ne décide jamais d'où.

La position lue est aussi **extrapolée** : le moteur pousse sa tête de lecture ~20 fois par
seconde, donc le dernier nombre reçu peut avoir 50 ms de retard — ce qui, sur un temps fort,
s'entend.

Un appui court sur un bouton **vide** ne fait rien, plutôt que de sauter à zéro.

## Ce qui est stocké : une position dans le FICHIER

Un repère est une place dans le morceau — où est le drop, un fait sur l'enregistrement. Stocker un
nombre de timeline déplacerait **tous** les repères dès qu'on touche au fader de tempo, en silence.

**Il n'y a plus de conversion à faire.** Une platine est un plateau, son aiguille est déjà en
secondes du fichier, et c'est ce nombre qu'un appui long écrit. `sourceAt` / `transportAt` étaient
cette conversion, du temps où une platine jouait un clip sur une timeline.

Ça a été un vrai défaut, un moment : le bouton lisait la position du TRANSPORT, que plus aucune
platine ne suit depuis que le plateau est le défaut. Poser un repère écrivait donc un nombre sans
rapport avec l'endroit du disque — et y sauter marchait parfaitement, vers le mauvais endroit. Le
bouton lit maintenant l'aiguille de SA platine (`needle`), et le `playhead` a quitté la vue.

## Dans mix.yaml, à côté du morceau

```yaml
cues:
  - "@st0/songs/Alain Bashung/Album inconnu/La nuit je mens"
  - ref: "@st0/songs/Daft Punk/Album inconnu/Around the world"
    markers: [ 12.5, null, 48.25 ]
```

**Et c'est tout ce que ce fichier fait.** Quels morceaux le set joue, c'est la playlist que la
surface nomme qui le dit ([setList.md](setList.md)). Un cue reste ici parce qu'il appartient au
PUPITRE qui joue le morceau et non à une liste que d'autres sets lisent : deux groupes qui
reprennent le même titre ne posent pas l'aiguille au même endroit. Une entrée apparaît donc
quand on pose un repère, pas quand on ajoute un morceau.

À ne pas confondre avec `views/mix.yaml`, qui est un autre fichier : les liaisons du pupitre,
dans `views/`, celles qu'une surface désigne par son `mapping:`. Celui-ci est à la racine du
projet.

Une entrée est **soit** une référence nue **soit** une référence qui porte des réglages. Les
deux, exprès : un morceau qui n'a rien à dire tient sur **une ligne**, c'est-à-dire tous les
morceaux tant que personne n'y a posé de repère. Transformer `cues:` en table de références
vers presque-rien donnerait à chaque entrée l'air qu'il lui manque quelque chose.

`markers` est **positionnel** : l'index 0 est le bouton 1, et `null` est un emplacement vide.
Le bouton 3 reste donc le bouton 3 quoi qu'il arrive aux boutons 1 et 2 — un repère est de la
mémoire musculaire, et une liste qui refermerait ses trous renumérerait le set de quelqu'un en
plein milieu. Seuls les vides **de fin** sont supprimés, d'où un seul nombre pour un repère sur
le bouton 1 plutôt que huit.

Un morceau dont on efface le dernier repère **redevient une référence nue** : une liste que
personne n'a repérée n'est qu'une suite de références nues.

## L'écriture préserve le fichier

Le texte est **édité**, jamais réimprimé depuis un arbre de parse. Les commentaires du scaffold
sont le seul exemple travaillé qu'un lecteur d'un set obtienne, et un pupitre qui les
mangerait au premier repère posé serait un pupitre qu'on ne pardonne pas. `withMarkers` passe
par le `Document` du paquet `yaml`, ce pour quoi il existe.

Une référence que le fichier ne nomme pas est **ajoutée**. Ce n'est pas une politesse : une
platine peut jouer un morceau que quelqu'un vient de retirer de la liste, et refuser le repère
perdrait un geste déjà fait.

L'échec d'écriture est **dit** : le bouton est déjà passé en couleur, donc un échec silencieux
laisserait un repère présent jusqu'au rechargement et absent ensuite.

## Une couleur par BOUTON, pas par repère

Le bouton 3 a la même couleur sur les deux platines et sur tous les morceaux. C'est ce qui
permet à une main de le trouver sans lire — l'intérêt même d'un repère rapide. Les huit couleurs
sont réparties sur la roue et tiennent à distance l'ambre dans lequel l'affichage de tempo
avertit, pour qu'un repère ne se confonde pas avec une alerte.

## Un repère ne déplace QUE sa platine

Cette page a longtemps dit le contraire, et c'était une limite du `seek` plutôt que du problème.

Le moteur n'a toujours qu'un transport (voir [mix.md](mix.md)), mais sauter à un repère n'y touche
plus : c'est le **plateau** qui se déplace, par son `Seek`, et un plateau appartient à une platine.
Poser l'aiguille sur la platine B pendant que la A passe ne bouge pas la A.

Un disque séparé est quatre plateaux, et `plattersOf` les nomme tous les quatre : un repère les
atteint ensemble, sinon les quatre parties se décalleraient entre elles.

Il n'y a plus de borne à ce saut. Un repère est une **fraction du fichier**, donc il ne peut pas
désigner un endroit qui n'existe pas — là où l'ancien mécanisme, qui déplaçait un clip, devait se
retenir de le faire commencer avant le début de la timeline
(`docs/platter-plan.md`, ce que l'étape 4 a supprimé).
