# Les transitions — ce qu'un plan fait en arrivant et en partant

Sœur de [shaders.md](shaders.md) : le même GLSL sur l'image, mais choisi par une **coupe** et non
par un câble.

```yaml
# video_tracks/main.yaml
events:
  - { ref: plan_a, start: 0,  length: 5 }
  - { ref: plan_b, start: 4,  length: 5, fade_in: 1 }                        # 1 s de fondu enchaîné sur plan_a
  - { ref: plan_c, start: 9,  length: 5, fade_in: { over: 1.5, with: wipe } }
  - { ref: plan_d, start: 14, length: 5, fade_out: 2 }                       # part vers ce qu'il y a dessous
```

## Un nombre nu, ou une carte

`fade_in: 1` **est** `fade_in: { over: 1, with: dissolve }`. Le `dissolve` est intégré au rendu,
donc un fondu ordinaire ne demande aucun fichier : un morceau qui n'a pas de dossier `modules/`
peut fondre.

Ce n'est **pas une union** mais un élargissement (`z.preprocess`), et la raison est mesurable :
sur une union, une clé mal tapée ressort en `Invalid input` avec les vraies erreurs enterrées dans
les branches, donc `validate.ts` ne retrouve pas la ligne. Élargi, `{ ovr: 1 }` répond
`unrecognized_keys` sur `events.0.fade_in`, et l'éditeur souligne le bon endroit.

## C'est le plan qui ARRIVE qui porte la transition

Une transition, c'est **un programme et une progression**. Si le `fade_out` de A et le `fade_in`
de B pouvaient tous deux régir le même recouvrement, deux programmes voudraient la même paire et
rien ne trancherait.

> Dans un recouvrement, le `fade_in` du plan entrant EST la transition.

Un `fade_out` est donc exactement le cas où il n'y a pas de plan entrant : l'image s'en va vers
rien, et ce qui apparaît est la **couche du dessous** (ou le fond du viewport pour la couche du
bas). Fondu enchaîné et fondu au noir sont un seul chemin de code ; ce qui diffère est seulement
qu'un second plan soit actif ou non.

Faire glisser un plan sur son voisin est ce qui crée le recouvrement. Le geste ne le crée pas :
ce serait un montage en cascade, et aucun glissement ici n'en fait un.

## `length: 0` — deux cas, dont un seul est refusé

`length: 0` veut dire « jusqu'au bout de la source », et
[`activeAt`](../../ui-eyes/src/timeline.ts) le résout comme « jusqu'au `start` du plan suivant »,
`Infinity` s'il n'y en a pas.

| forme | ce que fait `fade_out` |
|---|---|
| `length: 0`, un autre événement suit | marche : la fin est le `start` du suivant |
| `length: 0`, **dernier de la liste** | la fin est `Infinity` : **refusé**, sur la ligne |

Le refus vit sur `VideoTrackSchema` et non sur le placement, parce qu'un placement seul ne peut pas
savoir s'il est le dernier. « Le dernier plan va jusqu'au bout de sa source » et « le dernier plan
fond en sortie » sont incompatibles ; donnez-lui une longueur et le second redevient possible.

Un `fade_in` n'a jamais ce problème : il est ancré sur `start`, qui est toujours connu.

Corollaire moins visible : un plan en `length: 0` ne peut pas être la moitié **sortante** d'un
fondu enchaîné, puisque sa fin est par construction le début du suivant — le recouvrement vaut
zéro.

## Le dossier d'un module de transition

```
modules/video_transitions/wipe/
  module.yaml          type: video_transition, params: P1..P4
  vertex.glsl
  fragment.glsl
  ui.yaml              les quatre boutons, dessinés par le constructeur de modules
```

Le GLSL est **à plat dans le dossier du module**, et non sous `shaders/<nom>/`. Le niveau
supplémentaire qu'a `shaders` existe pour remplir un **menu déroulant sur une carte**
([shaders.md](shaders.md)) ; une transition NOMMÉE n'a pas de carte. Un `shader:` sur un module de
transition voudrait dire que le fichier écrit `with: wipe` et qu'on obtient `barn-door` — un second
nommage pour un choix que le placement a déjà fait, sans rien pour le montrer. Un dossier de module
est donc une transition, et une seule.

Il manque une des deux étapes : ce n'est pas une transition. Même règle et même raison
qu'`isShaderFolder` — la proposer compilerait un programme sans étage de sommets, et l'erreur
parlerait de GL plutôt que d'un fichier que quelqu'un n'a pas fini.

`with:` nomme **toujours un module local** de `modules/video_transitions/`. Une transition partagée
se rejoint par un module local mince qui l'`extends`, exactement comme un shader :
[`ownerFolders`](../src/shaders.ts) remonte l'ascendance et le premier dossier qui porte les deux
étapes gagne, donc un programme local masque un programme hérité du même nom.

## Les uniformes — le contrat

Écrit noir sur blanc pour la raison qui vaut déjà pour `PASS_UNIFORMS` : GL renvoie une localisation
nulle pour un uniforme **inconnu** et pour un uniforme simplement **inutilisé**, donc une faute de
frappe ne produit ni erreur ni effet.

| uniforme | ce que c'est |
|---|---|
| `uFrom` | l'image qui S'EN VA — un texel transparent quand il n'y en a pas |
| `uTo` | l'image qui ARRIVE — transparent pour un `fade_out` |
| `uProgress` | `float` 0..1 — 0 c'est `uFrom` seul, 1 c'est `uTo` seul |
| `uTime` | `float` secondes — la position du **transport** |
| `uResolution` | `vec2` px — le viewport |
| `uP1`..`uP4` | `float` 0..1 — les quatre boutons du module |

`uFrom`/`uTo` plutôt que `uTex`/`uTex2` : ça se lit avec `uProgress`, et surtout ce n'est **pas**
`uTex`, donc un fragment copié depuis un module `shaders` échoue à l'écriture au lieu
d'échantillonner silencieusement du vide.

**`uAudio` est délibérément absent**, et son absence est l'argument de la section suivante : c'est
le seul uniforme d'un shader qui exige un **câble**. Une transition n'a pas de nœud, donc pas
d'entrée latérale `#audio`, donc aucune piste dont elle pourrait lire le niveau. Une image qui bouge
avec le son est un shader sur la couche, pas une transition.

## Nommée, pas câblée

Une transition n'apparaît **jamais** dans `graph.yaml`. Elle est nommée par un placement, comme
`clips/<ref>.yaml` l'est : de la matière, pas une station sur le trajet du signal. Trois raisons :

- **Il n'y a pas de station.** Une chaîne va d'une source à un puits ; une transition se passe
  *entre deux placements d'une même piste*, ce qui est un fait sur l'arrangement de la piste et non
  sur l'endroit où sa sortie s'en va.
- **Elle n'a pas de second câble à prendre.** `MODULE_TYPES.video_transitions` déclare **une** entrée
  vidéo depuis que le type existe, et cette entrée unique est l'aveu : le type a été modelé avant
  qu'on demande d'où venait la seconde image. Le
  [crossfade](../../dsp/modules/audio/utility/crossfade/module.yaml) est là pour montrer qu'un effet
  à deux fils doit déclarer ses propres ports — et une transition ne le pourrait toujours pas, parce
  que la seconde image n'est pas sur un câble : c'est l'entrée suivante de `events:`.
- **Le contrat des uniformes le dit** (`uAudio`, ci-dessus).

Les ports de `video_transitions` restent **déclarés** malgré tout, et ce n'est pas un oubli : les
vider ne les interdirait pas, ça les rendrait *non contraints* — `normalizeInputs` traite une liste
vide comme « pas de vérification ». Et la clé reste dans `MODULE_TYPES` parce que
`moduleKeyFromPath` s'en sert pour reconnaître le dossier ; l'enlever ferait perdre
`modules/video_transitions/` à l'éditeur et au constructeur de modules.

## Ses boutons sont dessinés par le CONSTRUCTEUR de modules

Une carte et ses paramètres appartiennent à une **étape de chaîne**, et un module nommé par un
placement n'en a pas. Le `ui.yaml` posé à côté du module est donc rendu par
`@studio/ui-module-builder` — le bouton **Builder** de la barre d'outils d'un `module.yaml` — qui
dessine déjà boutons et menus depuis ce fichier.

## Ce qui ne casse rien

Un `with:` qui ne nomme rien de connu **ne fait pas tomber la trame** : la transition est
simplement absente du document et le rendu retombe sur le `dissolve` intégré. C'est une divergence
assumée avec [shaders.md](shaders.md), dont la posture est « perdre l'effet, garder l'image » : ici
garder l'image en supprimant la transition **déplacerait la coupe**, c'est-à-dire perdrait
l'*arrangement*. Retomber sur un fondu garde la durée que l'auteur a écrite et ne perd que le
caractère.

Un `graph.yaml` illisible ne coûte aucune transition non plus : elles sont lues sur la **carte des
refs** (`loadModuleRefs`) et non sur le graphe, hors du `try/catch` qui rend la compilation des
chaînes best-effort.

## Le schéma d'une piste vidéo est enfin un garde

Avant ce lot, `loadVideoTracks` passait par un lecteur dont le commentaire disait « nothing
validates here » : `ENTITY_SCHEMAS.video_tracks` était déclaré et mort sur le chemin de la
compilation, et une clé mal tapée dans un `video_tracks/*.yaml` était **silencieusement ignorée**.
Il passe maintenant par `readYamlEntities`, comme `clips/`, donc le refus ci-dessus existe pour de
bon — et une piste qui portait une clé inconnue échoue désormais en le disant.

## Le rendu, en une fonction

Tout ce dont le compositeur, le pilote et l'export ont besoin tient dans `layerFrameAt`
(`packages/ui-eyes/src/timeline.ts`) : pure, sans GL ni DOM, donc c'est **le seul endroit où la règle
vit**, et le rendu temps réel et le rendu image par image ne peuvent pas en avoir deux lectures.

Elle rend au plus deux plans, et le **dernier dans l'ordre du fichier gagne**. C'est un changement
de comportement pour un recouvrement qui existait déjà — avant, le premier gagnait — et sans lui un
fondu enchaîné se terminerait puis **reviendrait brutalement** au plan sortant pour le reste du
recouvrement. Le commentaire « une coupe appartient au plan SUIVANT » ne vaut donc plus que pour des
plans jointifs ; sous recouvrement, la règle est « au plus deux, le dernier est l'entrant ».

Le reste est dans [compositor.md](../../ui-eyes/docs/compositor.md) (le prémultiplié et le texel
transparent), [passes.md](../../ui-eyes/docs/passes.md) (le second contrat d'uniformes) et
[realtime.md](../../ui-eyes/docs/realtime.md) (le second `<video>`, et pourquoi il n'existe que là
où un `fade_in` le demande).

## Fondu au noir, et à quel noir

Le préview efface au jeton `--sh-background` et le **rendu au noir vrai**. L'asymétrie est
délibérée : une trame vide montre déjà le fond de l'application, donc le préview reste cohérent avec
lui-même, tandis qu'un fichier exporté qui aurait cuit le gris du chrome dans ses images serait
faux pour tout le monde. Un `fade_out` sur une couche haute ne descend de toute façon pas vers le
noir mais vers **la couche du dessous**.

## Ce qui n'est pas là

- **Trois plans qui se recouvrent.** Une piste a deux décodeurs ; trois plans simultanés ne sont pas
  rendables, et les deux du dessus gagnent.
- **Un `fade_out` qui révèle le plan d'en dessous sur la MÊME piste.** Une révélation appartient au
  plan entrant, et son `fade_in` est à son propre `start`.
- **Des paramètres par placement.** `P1..P4` appartiennent au module : deux sens de balayage sont
  deux modules, dont l'un `extends` l'autre.

## Les couches traversées

| | |
|---|---|
| écrit | `fade_in:` / `fade_out:` sur un événement de `video_tracks/<lane>.yaml`, et `modules/video_transitions/<nom>/` |
| déclaré | `packages/song-schema/src/moduleTypes.ts` — `TRANSITION_CATEGORY`, `DISSOLVE` |
| validé | `packages/song-schema/src/yaml/entitySchemas.ts` — l'élargissement, et le refus du `fade_out` sans fin |
| gardé | `packages/song/src/loader.ts` — `loadVideoTracks` passe par le schéma |
| lu | `src/videoTransitions.ts` — l'ascendance de `src/shaders.ts` |
| compilé | `src/videoTracks.ts` -> `VideoClipDoc.fadeIn`, et `src/videoProject.ts` -> `VideoProjectDoc.transitions`, le GLSL **en ligne** |
| le fil | `packages/web-protocol/types.ts` — `WebVideoFade`, `WebVideoTransition` |
| servi | `packages/file-service/src/workspace.ts` — `toWebVideoTracks`, `videoProjectDoc` |
| adapté | `apps/st0/frontend/src/scene.ts` -> `packages/ui-eyes/src/scene.ts` |
| décidé | `packages/ui-eyes/src/timeline.ts` — `layerFrameAt`, la seule règle |
| décodé | `packages/ui-eyes/src/realtime.ts` et `packages/ui-eyes/src/export.ts` |
| dessiné | `packages/ui-eyes/src/compositor.ts` + `packages/ui-eyes/src/passes.ts`, le fondu intégré dans `packages/ui-eyes/src/transitions.ts` |
| complété | `packages/song-schema/src/yaml/fields.ts` — les deux mots de la carte d'un fondu |

## Le vérifier

```bash
npx vitest run packages/song-video/src/videoTransitions.test.ts
npx vitest run packages/song-schema/src/yaml/videoTrackYaml.test.ts
npx vitest run packages/ui-eyes/src/timeline.test.ts packages/ui-eyes/src/compositor.test.ts
```

La première prouve la lecture du dossier, l'ascendance, les deux refus et le bornage des boutons ;
la deuxième, les deux écritures d'un fondu, l'erreur **localisée** d'une clé mal tapée, et le refus
du `fade_out` sans fin ; la troisième, la règle de trame et l'ordre des appels GL — quelle fonction
de mélange est en vigueur pour quel tracé, quelle texture sur quelle unité, et ce qui est alloué.

**Aucune ne prouve qu'un pixel a changé** : il n'y a pas de WebGL2 dans le runner, et
`compositor.test.ts` le dit de lui-même. La vérification qui reste est celle qu'on fait avec les
yeux — ouvrir `demos/video-demo.st0`, faire chevaucher les deux plans, donner un
`fade_in` au second, et regarder la coupe devenir un fondu.
