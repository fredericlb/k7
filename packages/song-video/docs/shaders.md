# Le module `shaders` — du GLSL sur l'image, piloté par le son

```yaml
# graph.yaml
modules:
  drums:  [ MIX, glow#audio ]   # la piste alimente le mix ET l'entrée audio du shader
  MIX:    [ OUT ]
  main:   [ glow ]              # la piste vidéo traverse le shader…
  glow:   [ RENDER ]            # …avant d'arriver au compositeur
  RENDER: [ VIDEO_OUT ]
```

Un module de type `shaders` prend **une image**, rend **une image**, et accepte en plus une
**entrée audio facultative** dont le niveau arrive au fragment sous le nom `uAudio`. C'est le seul
module du dépôt dont les ports portent deux signaux différents, et c'est exactement ce à quoi il
sert : une image qui **bouge avec le son**.

| port | signal | obligatoire |
|---|---|---|
| `in` | vidéo | oui — c'est le flux de la chaîne |
| `audio` | audio | **non** — un shader qui n'utilise que ses boutons est un effet vidéo ordinaire |
| `out` | vidéo | une seule sortie |

L'entrée audio n'est jamais le flux : c'est une **entrée latérale**, écrite `drums: [ glow#audio ]`,
donc la vérification positionnelle des ports remplit `in` depuis le flux et celle-ci depuis les
`in:` de l'étape — exactement comme la deuxième entrée d'un crossfade.

## Le dossier d'un shader

```
modules/shaders/glow/
  module.yaml            type: shader, shader: pulse, params: P1..P4
  ui.yaml                le menu déroulant + les quatre boutons
  shaders/
    pulse/
      vertex.glsl
      fragment.glsl
    ripple/
      vertex.glsl
      fragment.glsl
```

Un shader est un **dossier**, pas un fichier, parce qu'un shader est une **paire** : changez le
fragment en gardant le vertex et vous avez un autre effet sur la même géométrie. Nommer la paire
d'après le dossier est ce qui permet au menu de proposer `ripple` au lieu de deux demi-choix qu'on
peut dépareiller.

Un dossier auquel il manque une des deux étapes **n'est pas proposé**. Le proposer compilerait un
programme sans étage de sommets, et l'échec parlerait de GL plutôt que d'un fichier que quelqu'un
n'a pas fini d'écrire.

`shaders/` à côté du `module.yaml` et non dans `assets/`, sur le modèle de `base/` : `assets/` est
une liste plate de fichiers qu'un paramètre NOMME, filtrée par extension (`assetExtFor`). Un shader
est un répertoire — il aurait été la seule entrée de ce dossier à ne pas être un fichier.

## Le menu déroulant est rempli par le DISQUE

```yaml
# ui.yaml
widgets:
  pick: { type: dropdown, col: 0, row: 0, colSpan: 4, bind: "@shader" }
```

Le panneau ne dit **rien** de ses entrées, et c'est tout le sujet : quels shaders existent change
dès que quelqu'un dépose un dossier, et une liste écrite ici serait la copie d'un répertoire qui
se périme entre deux sauvegardes. Le graphe la remplit depuis ce que le chargeur a trouvé
(`moduleShaderChoices`) — le mécanisme exact de `@base`, sur un autre dossier.

`@shader` est un **champ** et non un paramètre, la distinction que trace déjà `base` : les quatre
boutons pilotent un programme qui tourne, celui-ci décide **quel programme est compilé**. Le rendu
l'apprend en reconstruisant la passe, comme le moteur apprend une base en reconstruisant le plugin.

La liste est cherchée dans l'**ascendance** — le module lui-même puis tout ce qu'il `extends` — pour
la même raison que `moduleAssetChoices` : un morceau pointe vers un module partagé à travers
un module local mince, dont le dossier ne contient rien. Un shader local masque un shader hérité du
même nom, et `readShader` cherche dans le même ordre : la liste où l'on choisit et la source que
l'on obtient doivent être d'accord.

## Les uniformes — le contrat

| uniforme | ce que c'est |
|---|---|
| `uTex` | l'image qui entre : la trame de la piste pour la première passe, la sortie de la précédente ensuite |
| `uAudio` | `float` 0..1 — le niveau vivant de la piste câblée sur le port audio, 0 s'il n'y en a pas |
| `uTime` | `float` secondes — la position du **transport**, pas une horloge du moteur de rendu |
| `uResolution` | `vec2` px — le viewport |
| `uP1`..`uP4` | `float` 0..1 — les quatre boutons |

Écrit noir sur blanc parce que rien ne le dira à personne : GL renvoie une localisation nulle pour
un uniforme inconnu **et** pour un uniforme simplement inutilisé, donc les deux sont
indiscernables. Une faute de frappe dans un nom d'uniforme ne produit aucune erreur et aucun effet.

### Pourquoi quatre boutons numérotés

Le module ne peut pas savoir comment un shader appellera ses commandes, et l'auteur d'un shader ne
peut pas renommer un bouton sur un panneau qu'il ne voit jamais. Quatre, c'est ce qui tient sur une
ligne de la grille ; 0..1, c'est ce que veut un uniforme GLSL — aucun shader n'a à normaliser,
aucun panneau n'a à demander les unités. Ce que chacun **signifie** est l'affaire du shader, et se
lit dans les commentaires de son `fragment.glsl`.

Les valeurs sont **bornées** à la compilation, parce qu'elles quittent TypeScript pour GLSL : un
`P1: 4` écrit à la main atteint un shader qui a tout droit de supposer 0..1, et ce qui en sort n'est
pas une image fausse mais une image méconnaissable.

## `uAudio` : d'un vumètre à un uniforme

Le moteur pousse `levels`, un **tableau** de dB par piste, ~20 fois par seconde — sans noms, indexé
sur la liste des pistes compilées. Le chemin complet :

```
EngineState.levels[i]          le moteur, ~20 Hz
 -> levelsForPasses()          apps/st0/frontend/src/shaderAudio.ts — l'index vient de trackOrder
 -> levelToUnit()              -60..0 dB -> 0..1
 -> smoothLevels()             attaque rapide, retour lent
 -> RealtimeDriver.setAudio()  @studio/ui-eyes
 -> uAudio
```

Trois décisions valent d'être énoncées :

- **Linéaire EN DÉCIBELS**, pas en amplitude. Un visuel qui suit l'amplitude reste collé à zéro
  sauf sur les crêtes, parce que c'est ce que fait l'amplitude ; le décibel est déjà l'échelle
  perceptive, et un vumètre à barre est linéaire en dB pour la même raison.
- **Le plancher est −60 dB**, pas le −100 du moteur. Étaler toute la plage tasserait tous les
  niveaux utiles dans le dernier dixième.
- **Le lissage est asymétrique** — montée rapide, descente lente. C'est ce que fait toute
  balistique de vumètre et tout release de compresseur : un lissage symétrique donne soit une
  attaque molle, soit une descente qui clignote, et aucune constante n'évite les deux.

Le document compilé porte le **nom de la piste** (`audioFrom`) et non un nombre : le nombre bouge,
et le figer dans un document mis en cache serait le figer pour de bon.

## Où une passe peut aller : les deux

```yaml
modules:
  main:   [ glow ]         # sur une PISTE — la couche est traitée avant d'être composée
  glow:   [ RENDER ]
  RENDER: [ grade ]        # sur l'IMAGE — la trame entière, une fois les couches composées
  grade:  [ VIDEO_OUT ]
```

Une seule implémentation, autorisée partout où va un câble vidéo. Aucune des deux n'est un cas
particulier de l'autre et les deux sont des chaînes ordinaires ; seul l'endroit où le résultat est
rangé diffère — `VideoTrackDoc.plugins` d'un côté, `VideoProjectDoc.framePlugins` de l'autre, ce
dernier étant le `masterPlugins` de l'image ([videoOutputs.md](videoOutputs.md)).

La chaîne d'une piste tourne à la taille du **viewport** puis est dessinée dans le rectangle de la
piste, plutôt que de tourner à la taille du rectangle. C'est ce qui fait qu'un effet a le même
caractère sur une incrustation que sur une piste plein cadre : un effet ne change pas de nature
parce qu'on a rétréci la piste qui le porte.

## Ce qui ne casse rien

Trois états où l'on **perd l'effet et garde l'image**, et c'est délibéré dans les trois cas :

- `shader:` absent — un nœud qu'on vient d'ajouter ;
- `shader:` nommant un dossier qui n'est pas là — un morceau commité dont les fichiers n'ont pas
  encore été synchronisés ;
- du GLSL qui ne compile pas — un shader qu'on est **en train d'écrire**.

Dans les trois cas le nœud garde sa carte, ses boutons et son menu. Un fragment à moitié tapé ne
doit pas emporter le viewport ; c'est la même posture que `presetFor` tient face à une base
disparue. Le message d'erreur nomme le **nœud** (`glow`) et non le fichier, parce que le nœud est ce
qui est à l'écran et ce sur quoi on cliquerait.

Le `graph.yaml` illisible est traité pareil : la compilation de l'image est *best-effort*, parce que
le compilateur du morceau signale déjà l'erreur, dans l'éditeur, sur la ligne fautive. Perdre les
effets se rattrape en lisant ce message ; perdre la trame est un écran noir sans explication.

## Ce que la compilation décide en silence

`videoChains.ts` prend cinq décisions qui ne se lisent nulle part ailleurs :

- **Une étape dont le module est introuvable renvoie `null`, sans lever.** `validate()` signale déjà
  la référence cassée, par son nom, sur la ligne qui la nomme ; découvrir un module manquant en
  compilant l'image ferait tomber toute la trame pour une étape.
- **Un module qui n'est pas un module d'image sur un fil vidéo n'est pas compilé et n'est pas
  signalé ici non plus** : la vérification des ports refuse déjà l'image vers un module audio, et
  elle en parle en termes de câble plutôt que de trame qui n'a pas su se dessiner.
- **Les étapes contournées sont GARDÉES dans le run compilé.** Le rendu doit *dessiner* une passe
  éteinte, et non recevoir une liste plus courte qu'il ne saurait distinguer d'une chaîne plus
  courte. Un contournement de la chaîne ENTIÈRE (`enabled: false` sur le run) la supprime au
  contraire : c'est le run qui a été retiré, et une pile de commandes désactivées dessinerait les
  réglages de quelque chose qui n'est pas là.
- **Seul le run qui PART vraiment vers le périphérique est la chaîne de la trame.** Un run qui sort
  de la somme et finit ailleurs n'en est pas une, et le traiter comme telle appliquerait une passe
  que l'image n'atteint jamais.
- **Les paramètres d'un effet vidéo sont filtrés aux nombres** — `params:` peut porter une chaîne
  qui nomme un fichier, ce qui ne veut rien dire pour un rendu. Le même tri que `nodeProject` fait
  avant le fil audio. Pour un shader, un `P1..P4` que le module ne mentionne pas vaut **0** et non
  « absent » : l'uniforme existe dans le programme quoi qu'en dise le fichier, et le laisser non
  défini reviendrait à donner au shader ce que GL avait là avant.

L'entrée audio d'un shader est une entrée latérale : elle arrive par les `in:` de l'étape, ce à quoi
`gtr: [ glow#audio ]` se compile. Ce qui est retenu est le **nœud**, le port étant abandonné — le
rendu a besoin d'un nom pour aller lire un niveau, et savoir sur quelle prise il a atterri est déjà
tranché par le fait d'y être arrivé. La première source seulement : les sources d'une étape
remplissent ses ports dans l'ordre et un shader déclare exactement un port audio, donc une seconde
source est une erreur de câblage que la vérification des ports signale déjà.

## Les couches traversées

| | |
|---|---|
| écrit | `modules/shaders/<nom>/` + un run vidéo dans `graph.yaml` |
| déclaré | `src/moduleTypes.ts` — `MODULE_TYPES.shaders`, `SHADER_PARAMS`, `SHADERS_DIR` |
| lu | `src/shaders.ts` — `moduleShaderChoices` / `readShader`, l'ascendance comprise |
| dérivé | `src/chainsGraph.ts` : une piste vidéo est une piste, donc `main: [ glow ]` est un run |
| compilé | `src/videoChains.ts` -> `VideoPluginDoc`, le GLSL **en ligne** |
| le fil | `@studio/web-protocol`'s `WebVideoPlugin` |
| proposé | `packages/file-service/src/graphDoc.ts` — `shader` + `shaders` sur l'étape |
| dessiné | le menu et les quatre boutons, `@studio/ui-chains`' `stepUI` |
| écrit en retour | `@studio/commands`' intrinsèque `@shader` -> `setModuleShader` |
| exécuté | `@studio/ui-eyes`' `src/passes.ts` + `src/compositor.ts` |

Le GLSL voyage **en ligne** dans le document plutôt que derrière une URL : un navigateur ne peut pas
ouvrir un dossier, un shader tient dans une page de texte, le document image est déjà mis en cache
par révision, et une route de plus voudrait dire que l'image peut se dessiner avant que ses
programmes soient arrivés.

## Le vérifier

```bash
npx vitest run packages/song-video/src/shaders.test.ts packages/song-video/src/videoChains.test.ts
npx vitest run packages/ui-eyes/src/passes.test.ts
npx vitest run apps/st0/frontend/src/shaderAudio.test.ts
```

Ces suites prouvent le document, l'ordre des passes et la conversion du niveau. **Aucune ne prouve
qu'un pixel a changé** — il n'y a pas de WebGL2 dans le runner, et `passes.test.ts` dit lui-même ce
qu'un faux contexte peut et ne peut pas établir. La vérification qui reste est celle qu'on fait avec
les yeux : ouvrir `engine/capot/songs/video-demo.st0`, lancer la lecture, et regarder l'image
respirer avec la batterie. Changer le menu de `pulse` à `ripple` doit changer l'effet sans toucher
au câblage.
