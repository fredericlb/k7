# Les passes — du GLSL entre la trame et l'écran

`compositor.ts` est la **mise en place** : quel quad va où — sa propre page est
[compositor.md](compositor.md). `passes.ts` est la partie qui exécute le code de quelqu'un d'autre. Le vocabulaire (le module `shaders`, les uniformes, d'où vient
`uAudio`) est dans `packages/song-video/docs/shaders.md` ; cette page-ci est ce que fait le moteur de
rendu avec.

Une `ScenePass` est du texte et des nombres. `@studio/ui-eyes` n'a aucune idée de ce qu'est un
module, un dossier ou un moteur audio — c'est la même frontière que trace `scene.ts`, et c'est ce
qui permet de tester la chose sans projet.

## Trois formes de trame, et la première est la plus courante

```
aucune passe        chaque couche -> un quad -> le canvas
passes sur couche   la trame -> sa chaîne (hors écran) -> le quad composé
passes sur image    tout compose hors écran -> la chaîne -> un blit
```

Un morceau sans shader **n'alloue rien** : ni cible hors écran, ni programme, et `draw` écrit
directement sur le canvas.

## Deux ressources, deux durées de vie

La distinction n'est pas cosmétique.

| | ce que c'est | quand c'est effacé |
|---|---|---|
| `RenderTarget` | là où les couches **s'accumulent**, quand l'image entière sera traitée | une fois par trame |
| `PingPong` | le brouillon entre lequel une **chaîne** rebondit | à chaque passe |

Partager la paire ferait effacer, par la chaîne d'une couche, la cible dans laquelle le composé
s'accumule : **toutes les couches sauf la dernière disparaîtraient** dès qu'une seule reçoit un
shader. Deux durées de vie, deux ressources.

`RenderTarget.bind(clear)` prend un booléen justement pour ça : `true` au premier dessin de la
trame, `false` ensuite. C'est ce que `passes.test.ts` épingle.

Les deux ressources ne sont créées **que si quelque chose les demande**, et elles **survivent à une
reconstruction de scène** tant que le viewport n'a pas changé. Cette branche vaut d'être écrite :
le document est recompilé à chaque frappe dans l'éditeur, et réallouer des textures pleine trame à
chaque frappe se voit à l'écran — c'est l'image qui saccade pendant qu'on tape.

`makeTarget` est partagé par les deux classes pour que leur filtrage ne puisse pas diverger : sinon
un shader d'image adoucirait l'image là où un shader de couche ne le ferait pas.

## Pourquoi une paire et pas une cible

Un shader ne peut pas échantillonner la texture qu'il écrit — c'est indéfini en GL, et en pratique
ça ressemble à un effet qui marche sur une machine et scintille sur une autre. Donc la passe N lit
`a` et écrit `b`, puis on échange.

Les cibles font la taille du **viewport**, pas celle du rectangle de la couche : une passe peut
échantillonner à côté du fragment qu'elle écrit (tout flou le fait), et une cible recadrée sur la
couche lui donnerait le bord du recadrage au lieu de l'image. Ça coûte deux textures RGBA pleine
trame par chaîne, une fois.

C'est aussi ce qui donne son sens à `uResolution` : la chaîne d'une couche tourne à la taille du
viewport puis est dessinée dans le rectangle de la couche, donc un effet vaut la même chose sur une
incrustation que sur une couche plein cadre — il ne change pas de caractère parce que la piste a été
rétrécie.

`runPasses` laisse le RÉSULTAT en texture avant et le framebuffer délié : ses deux appelants — une
couche qu'on va composer, et l'image finie qu'on va recopier — continuent alors de la même façon.

`CLAMP_TO_EDGE` compte plus ici que sur une texture vidéo : sans lui, un shader qui échantillonne
au-delà du bord ramène l'autre côté de l'image, ce qui se lit comme un bug **du shader** plutôt que
de sa cible.

## Le mélange, à l'intérieur d'une chaîne, est ÉTEINT

Une passe **remplace** l'image qu'on lui a donnée. Laisser le `over` allumé composerait chaque
passe par-dessus la précédente au lieu de lui succéder — ce qui ressemble à tous les effets
appliqués à moitié. Il est rallumé pour le quad composé, où le mélange est justement ce qu'on veut.

Le brouillon est effacé en **noir transparent** et jamais sur le fond de la scène : les passes
d'une couche tournent **avant** la composition, donc tout ce que le shader n'écrit pas doit rester
traversable, sinon la couche masque tout ce qui est dessous. Même chose pour la cible d'image : le
fond est ajouté au blit final, sinon un shader d'image traiterait le fond comme s'il était de
l'image.

## Le contrat des uniformes

`PASS_UNIFORMS` est un **contrat**, pas une commodité. Un shader est écrit contre cette liste et
rien ne dit à son auteur qu'il s'est trompé de nom : GL renvoie silencieusement un emplacement nul
pour un uniforme inconnu — et pour un uniforme simplement INUTILISÉ aussi, donc les deux sont
indiscernables d'ici. Écrire la liste est le seul endroit où cette différence peut être notée.

`uTex` est ce que la passe lit : la trame de la couche pour la première passe d'une chaîne, la
sortie de la passe précédente ensuite. C'est tout ce qui les fait s'enchaîner.

Un emplacement nul dans un `PassProgram` est donc **normal** — un shader qui ignore `uP3` n'a pas
de `uP3`, et écrire dans un emplacement nul est un no-op en WebGL, pas une erreur.

## L'attribut est lié à l'emplacement 0 AVANT le lien

```ts
gl.bindAttribLocation(prog, 0, PASS_ATTRIB);
gl.linkProgram(prog);
```

Toutes les passes partagent l'unique tampon de sommets que le compositeur a déjà installé. Sans
cette ligne, un shader déclarant ses attributs dans un autre ordre lit le quad sur l'emplacement
que l'éditeur de liens a choisi — donc ne dessine rien, sur certaines machines seulement.

## `setLive` est séparé de `setScene`

`uAudio` bouge au rythme des vumètres du moteur (~20 Hz), `uTime` à celui du transport, et une
scène est reconstruite quand le **document** change. Les replier dans la scène voudrait dire
recompiler chaque programme vingt fois par seconde.

Les niveaux sont **poussés** par l'hôte, jamais tirés : c'est la frontière de ce paquet. Le pilote
les garde entre deux rapports, et la plupart des trames en réutilisent un — cette réutilisation
**est** le lissage, vu comme un maintien plutôt qu'un saut.

`uTime` est la position du **transport**, fournie par la boucle qui lit déjà l'horloge. Une horloge
propre au moteur de rendu dériverait de la lecture en une mesure.

Les niveaux sont donnés par passe, **clés sur l'identifiant de la passe** — le `<owner>:<index>`
compilé — parce que c'est ce qui survit au renommage de tout le reste. Une passe pour laquelle
personne n'a fourni de niveau garde celui qu'elle avait, c'est-à-dire le 0 avec lequel elle a été
compilée quand aucun audio n'est câblé.

## Un shader cassé n'emporte rien

`compilePass` renvoie `null` et une ligne dans la console. Une passe qui n'a pas compilé est
simplement absente de la chaîne ; la couche se dessine comme si elle n'existait pas. Un shader est
du source qu'on est **en train d'éditer**, et un fragment à moitié tapé ne doit pas éteindre le
viewport. C'est la même posture que tout le chemin de l'image tient face à un dossier de shaders
manquant : on perd l'effet, on garde la trame.

Le message nomme le **nœud** (`glow`), pas le fichier : le nœud est ce qui est à l'écran et ce sur
quoi on cliquerait pour le corriger.

Les deux étages sont supprimés une fois attachés : le programme les garde en vie jusqu'à sa propre
suppression, et sans ça une reconstruction de scène fuirait un objet shader par passe et par
reconstruction.

## Le vérifier

```bash
npx vitest run packages/ui-eyes/src/passes.test.ts
```

Contre un **faux** contexte GL, et le fichier dit lui-même pourquoi : il n'y a pas de WebGL2 dans
ce runner, et ajouter un contexte natif serait une lourde dépendance pour une poignée
d'assertions. Ce qu'un faux prouve quand même est la partie qui casse pour de bon — l'ORDRE
des liaisons, des effacements et des dessins. Les deux bugs épinglés là (la chaîne d'une couche qui
efface le composé, le mélange à l'intérieur d'une chaîne) sont du séquencement, et aucun des deux
n'a besoin d'un pixel pour être attrapé.

Ce qu'il ne prouve pas, c'est qu'un shader dessine la bonne image. Cette vérification-là se fait
avec les yeux : ouvrir `engine/capot/songs/video-demo.st0` et regarder.
