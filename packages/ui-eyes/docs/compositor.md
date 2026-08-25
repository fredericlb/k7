# Le compositeur — quel quad va où

`compositor.ts` est la **mise en place** : une texture par couche, un quad texturé chacune,
composées du bas vers le haut. Ce que fait le GLSL entre les deux est dans
[passes.md](passes.md) ; comment l'image suit la lecture est dans [realtime.md](realtime.md).
Le vocabulaire du document vidéo, lui, est dans `packages/song-video/docs/picture.md`.

C'est **l'unique moteur de rendu** que les deux pilotes partagent, parce que `texImage2D` prend un
`HTMLVideoElement` et un `VideoFrame` de la même façon : le compositeur n'apprend jamais lequel des
deux le pilote.

## Il possède son canvas

Un canvas fourni par React ferait courir deux contextes GL l'un contre l'autre au moindre rendu, donc
le compositeur crée le sien — sauf pour l'export, qui lui passe un `OffscreenCanvas` dont il est
propriétaire.

Dans les deux cas le **tampon** fait la taille en pixels du viewport, c'est-à-dire celle du modèle,
et le CSS ne change que l'affichage : `resize()` n'écrit que `style.width/height`. Le rendu est donc
indépendant de la résolution de l'écran, et une capture d'export est identique à ce qui est à
l'écran.

`preserveDrawingBuffer: true` est là pour l'export, qui relit les pixels après le dessin.

## Repères et mélange

Le viewport a son origine **en haut à gauche**, l'espace de découpe **en bas à gauche** :
`rectToClip` fait la conversion et retourne y. Les trames vidéo arrivent aussi de haut en bas alors
que les textures GL sont de bas en haut, d'où `UNPACK_FLIP_Y_WEBGL` à l'envoi — les coordonnées de
texture restent ainsi les 0..1 évidents.

Le mélange est un `over` en alpha **droit** (non prémultiplié), pour qu'un fond de forme puisse se
mélanger ; sur une texture vidéo, opaque, c'est un no-op. À l'intérieur d'une chaîne de passes il est
éteint, et [passes.md](passes.md) dit pourquoi.

### …sauf la couche qui fond, qui est PRÉMULTIPLIÉE

Une couche en cours de transition est composée avec `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`, le temps
de ce seul blit, puis la fonction est remise. Ce n'est pas un détail de goût :

`mix(uFrom, uTo, p)` contre un texel **transparent** donne `rgb·(1−p)` **et** `a = 1−p`. En alpha
droit, le mélange multiplie ensuite ce rgb déjà assombri par cet alpha : le fondu s'assombrit en
plus de s'effacer, et un fondu enchaîné plonge par le noir. Prémultipliés, les deux côtés se lisent
tels quels et **un seul `mix` est à la fois un fondu enchaîné et un fondu vers rien** — c'est ce qui
fait qu'il n'y a qu'un chemin de code. Une texture vidéo est opaque, donc droit et prémultiplié y
sont identiques ; seule la couche qui fond change de fonction, et une passe ordinaire garde son
alpha droit (le `pulse` du morceau de démo le dit dans son fragment).

Le second côté d'une transition est un texel **1×1 transparent** alloué une fois, plutôt qu'un
branchement dans le GLSL : un `fade_out` n'a pas d'image entrante, et lui en donner une vide est ce
qui lui évite d'être un cas particulier. Ce qui apparaît alors est la **couche du dessous**, pas du
noir — le noir n'est que ce qu'on voit quand il n'y a plus de couche.

`LayerBlend` dit **quels créneaux portent une image cette trame-ci**, au lieu de le déduire de
`hasFrame` : celui-ci ne redescend jamais, donc il ne peut pas répondre « maintenant ».

`draw` passe par une seule fermeture `bindComposite` plutôt que par deux branches par couche : une
couche qui a sa propre chaîne doit **revenir** à cette cible après être passée par le brouillon, et
les deux endroits doivent être d'accord sur laquelle c'est.

## Les formes passent par un canvas 2D

C'est toute la raison pour laquelle une couche de formes réutilise le chemin texturé : Canvas2D
dessine des rectangles, des arcs et du vrai **texte**, et sait lire une couleur CSS — ce que WebGL
brut ne peut pas faire sans atlas de glyphes. Le rendu est **statique**, donc il a lieu une fois par
scène, à la résolution du viewport, et le résultat se compose exactement comme une trame vidéo.

Les conventions, déclarées dans `scene.ts` :

| | ce que ça veut dire |
|---|---|
| `color` | n'importe quelle couleur que le canvas 2D sait lire |
| `x, y` d'un carré ou d'un texte | son coin **haut-gauche** |
| `x, y` d'un cercle | son **centre** |
| `w` d'un texte | une largeur **maximale** : le canvas condense les glyphes pour tenir, il ne renvoie pas à la ligne (texte d'une seule ligne) |

Chaque forme porte sa propre géométrie, donc le rectangle de la couche est ignoré : une couche de
formes couvre le viewport entier.

Les formes ne portent pas de temps, donc elles n'allongent pas `durationSec` — un morceau qui n'a
que des formes n'a pas de fin naturelle à rendre.

## Ce qui est dessiné et ce qui ne l'est pas

Une couche dont aucune trame n'a encore été envoyée est **sautée** : une piste entre deux clips
laisse voir le fond, plutôt qu'un quad noir ou le reste de la trame précédente. Une couche de formes,
elle, est marquée dessinable dès la construction de la scène, puisque son upload a déjà eu lieu.
