# Les effets du pupitre, au-delà du filtre

Trois choses, et **une seule est un module**. C'est la remarque à retenir de cette page : sur une
table de mixage, « effet » recouvre des mécanismes qui n'ont rien à voir entre eux, et les mettre
tous dans le graphe aurait produit deux modules qui ne servent à rien.

| | ce que c'est | où ça vit |
|---|---|---|
| **écho** | un délai à réinjection | un module, `@st0/audio/time/echo`, lié par `deckA.echo` |
| **echo-out** | couper la voie, laisser la queue sonner | **un geste** : deux contrôles du pupitre bougés ensemble |
| **censor** | le disque part à l'envers tant qu'on tient | **un geste** : le `Rate` du plateau, comme un scratch |

## L'écho, et pourquoi il est APRÈS le fader de voie

```
deckA → tempoA → trimA → eqA → filterA ─┬→ levelA → echoA → fadeA → MIX
                                        └→ cueA → CUE
```

`echoA` est posé **après** `levelA`, et ce n'est pas un détail de rangement : c'est ce qui rend
l'echo-out possible. Baisser le fader de voie coupe alors **l'entrée** du délai, pas sa sortie —
la ligne à retard continue de se vider et les répétitions sonnent seules. Câblé avant le fader,
il serait coupé avec tout le reste, et l'effet le plus connu d'une table DJ n'existerait pas.

C'est le même raisonnement que le départ casque, qui est branché sur `filterA` pour rester
**avant** le fader ([cue.md](cue.md)) : dans les deux cas la place dans la chaîne EST la
fonctionnalité, et pas une préférence.

Le module lui-même est la fonction `echo()` de `@studio/dsp`, écrite dans un `jsdsp.ts` à côté
de son `module.yaml` — un module est un DOSSIER qu'on copie, donc il porte sa source.

Trois paramètres, dont **un seul** est un geste : `Mix` est ce que le potard du pupitre bouge,
`Time` et `Feedback` se règlent une fois dans `nodes/echoA.yaml` et se laissent.

### Ce qu'il ne fait pas : suivre le tempo

`Time` est en **millisecondes**, posé à la main, et le défaut du scaffold est 375 ms — la croche
pointée à 120 BPM. Le pupitre connaît pourtant le BPM de chaque platine : il le mesure, il le
publie, le fader de tempo s'en sert. Ce qui manque est une **liaison** qui porterait ce nombre
jusqu'à ce paramètre, pas une information.

C'est donc une limite énoncée et non une impossibilité. La dire ici est le point : un écho DJ
qu'on croit calé sur le morceau et qui ne l'est pas s'entend comme un défaut de la machine.

### Il est OFFERT, jamais exigé

`deckA.echo` n'est pas dans `REQUIRED_CONTROLS` — même règle que le cue et les stems
([controls.md](controls.md)). Un set qui ne câble aucun effet est un set complet, et le gate ne
doit pas réclamer une ligne dont l'absence n'est pas une panne.

Sur la tranche, le potard d'écho est donc **absent** plutôt que grisé, ce qui est l'autre moitié
de la règle des repères : grisé dit « pas encore », absent dit « ce set n'en a pas ». Un potard
grisé enverrait quelqu'un chercher un module à réparer là où il n'y a rien de cassé. C'est aussi
pour ça qu'il coûte une rangée à `stripHeight` **seulement** quand une platine en câble un
([deskLayout.md](deskLayout.md)).

## L'echo-out : un geste, pas une liaison

Tenir le bouton envoie l'écho à fond **et** ferme le fader de voie. Deux paramètres — et un
contrôle du pupitre en pilote **au plus un**
([viewBindings.md](../../../packages/song/docs/viewBindings.md)).

La sortie n'est pas d'assouplir cette règle : c'est de remarquer que l'echo-out n'a pas besoin
d'être une liaison. Il **compose deux contrôles que le pupitre a déjà** — `deckA.echo` et
`deckA.level` — exactement comme une main le ferait avec les deux commandes à l'écran. Rien de
nouveau n'atteint le moteur : ce sont les deux mêmes `set-plugin-param` qu'un doigt aurait
envoyés.

Ce que ça donne gratuitement : le geste est **réversible sans état caché**. Au relâchement, le
fader revient là où il ÉTAIT — `heldLevel` s'en souvient — et pas à son `home`. La nuance compte
sur un set : rouvrir d'autorité une voie que quelqu'un avait délibérément laissée basse est
exactement le genre de service qu'on ne rend pas en public.

Et il est **grisé sans écho câblé**, avec la raison : sans module à ouvrir, tenir le bouton ne
ferait que couper la voie, ce qui n'est pas l'effet demandé mais ressemble à une panne.

## Le censor : le plateau, et rien d'autre

Aucun module, aucune liaison, aucun paramètre. Le disque **part à l'envers** tant que le bouton
est tenu, et se remet à jouer normalement au relâchement.

C'est possible parce qu'une platine est un **plateau** qui porte son propre transport
(`engine/moteur/docs/turntable.md`) : son `Rate` est un nombre signé, donc −1 est déjà « en
arrière à la vitesse du disque ». Le pupitre a même déjà le chemin — c'est `sendScratch`, celui
qu'utilise la main sur le vinyle ([scratch.md](scratch.md)). Le censor est donc **un scratch que
le pupitre exécute** au lieu de le suivre.

Deux conséquences qui tombent toutes seules et qu'on aurait dû écrire à la main autrement :

- **la hauteur suit la vitesse**, parce que `platterKey` traite une main sur le disque comme un
  varispeed. Un censor qui garderait la hauteur ne sonnerait pas comme un censor ;
- **le relâchement rend le disque à ce qu'il faisait** — `rate === null` renvoie le plateau à la
  vitesse que le document aurait envoyée, tempo étiré compris.

Il n'a donc pas de contrôle dans `controls.ts`, et c'est cohérent avec le reste : le scratch non
plus n'en a pas. Ce qui vit dans `views/mix.yaml` est ce qui **déplace un paramètre d'un
module** ; un geste sur le plateau est réalisé par le pupitre lui-même.

Il est grisé sur une platine **vide** : un disque doit être là pour qu'« à l'envers » veuille
dire quelque chose.

### Les deux boutons sont MOMENTANÉS

Ils écoutent `pointerdown` / `pointerup`, jamais `click`. Et `pointerleave` autant que
`pointerup` : une pression qui se termine **en dehors** du bouton doit se terminer quand même,
sinon une main qui glisse laisse le disque tourner à l'envers pour de bon. C'est le bug qu'on ne
trouve qu'en public.

Ils sont dans la **barre du bas**, aux côtés des SYNC et des casques, et pas sur la tranche : la
tranche est la colonne des réglages qu'on POSE, la barre du bas celle des choses qu'on FAIT.
