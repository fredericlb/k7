# Éditer une session `.z0`

Ce que l'éditeur fait des fichiers, et pourquoi il s'y prend comme ça. La FORME des fichiers
est décrite dans [projects.md](projects.md) ; cette page-ci parle de l'écran par-dessus.

Elle remplace l'écran Grist retiré ([editor.md](editor.md)) : les fonctions décrites ici sont
son portage sur des fichiers, pas une réécriture d'idées. Ce qui n'a **pas** été porté, et
pourquoi, est en bas de page — c'est la partie à lire avant de conclure qu'il manque quelque
chose par accident.

## Un fichier n'est pas un enregistrement

L'éditeur Grist écrivait des lignes dans une base : il pouvait relire, réécrire, et la
question du texte ne se posait pas. Ici la source est un fichier YAML dans un dépôt git, écrit
par un générateur *et* par des humains, commenté, et relu en diff au moment du commit.

D'où la règle qui commande tout le reste :

> On modifie le **document**, jamais les valeurs qu'on en a tirées.

`format.ts` garde donc un `yaml` **Document** par fichier et écrit dedans (`setIn`, `deleteIn`,
un splice sur le nœud pour un déplacement). Le chemin naïf — `parse` → objet JS → `stringify` —
produirait un fichier équivalent *pour un parseur* et méconnaissable pour une personne :
commentaires perdus, guillemets normalisés, ordre des clés refait, et un diff de 400 lignes
pour avoir bougé un `start`. Le test qui tient cette règle est
« changes one scalar and nothing else », et il vérifie explicitement que le commentaire d'en-tête
et les guillemets de `notice:` survivent.

Deux conséquences moins évidentes :

- **Un `Document` doit survivre au rendu.** Le re-parser à chaque frappe rendrait la
  préservation inutile, donc les documents vivent dans `store.ts`, pas dans un `useState`.
- **Vider un champ le SUPPRIME.** `setTrackField(..., undefined)` fait `deleteIn`. Écrire
  `end: 0` serait ajouter une ligne à chaque morceau simplement regardé, et `0` n'est pas ce
  que veut dire une fin absente — c'est « jusqu'au bout ».

## Un morceau a deux formes, et une seule adresse

Le format écrit un morceau à une piste **à plat** (`song:` sur le morceau lui-même) et un
morceau à plusieurs pistes sous `tracks:`. Les deux clés sont exclusives.

`readCategory` normalise ça une fois : un morceau à plat devient un morceau à **une** piste, et
`flat: true` se souvient de la forme réelle. Le reste de l'application ne branche donc jamais
sur les deux formes ; seul `trackPath()` le fait, et c'est le seul endroit où c'est écrit.

Ajouter une deuxième piste à un morceau à plat le **promeut** (`expandToTracks`) : les clés de
piste descendent dans une liste, les clés du morceau (`label`, `status`, `speed`…) restent où
elles sont. C'est la seule transformation de forme que l'éditeur fait, et elle est
idempotente.

Retirer la piste d'un morceau **à plat** est refusé : il n'y a pas de nœud de piste à retirer,
les clés sont celles du morceau, et « replier » supprimerait ses champs avec.

## Le début et la fin

C'est la raison d'être de l'écran. Un blindtest joue un extrait, et le choisir se fait à
l'oreille : `TrackPanel.tsx` décode l'audio, dessine une forme d'onde, joue tout ou seulement
la fenêtre, et pose les bornes depuis l'endroit où on écoute (« Début ici » / « Fin ici »).

L'audio ne vient plus d'une pièce jointe Grist : un `.z0` ne stocke que l'identifiant
médiathèque, donc `mediatek.ts` résout l'adresse en fichier. La règle de résolution est **celle
du chargeur du jeu**, pas une invention d'ici :

> la version demandée par la catégorie si elle existe, sinon le master.

S'en écarter ferait écouter à l'auteur un fichier différent de celui que la partie jouera, ce
qui est exactement le genre d'erreur qu'un éditeur d'extraits ne doit pas permettre. Les tests
de `mediatek.test.ts` la tiennent, y compris le cas des reprises dont l'`original` **est** la
reprise.

`mode: reversed` (la catégorie `a-l-envers`) lit à l'envers, et `speed` change la vitesse : ce
sont les deux seuls traitements que le format porte encore, donc les deux seuls que l'aperçu
applique.

## La médiathèque est facultative

Le catalogue est chargé **après** les fichiers et jamais avant : il ne sert qu'aux libellés et
à l'audio. Une médiathèque en panne doit laisser la session s'ouvrir et se modifier — un
bandeau le dit, les morceaux s'affichent par leur adresse, l'aperçu est indisponible, et
l'écriture marche.

C'est aussi ce qui fait que le sélecteur de morceaux répond à la frappe sans requête : la liste
est déjà en mémoire.

## L'enregistrement

Débounce à 800 ms, puis un `PUT /file` par fichier modifié. `Ctrl+S` veut dire « maintenant »,
pas « du tout » — la même règle que les éditeurs de st0
([autosave.md](../../../packages/ui-editor/docs/autosave.md)).

Un échec **remet les fichiers dans la file** et l'affiche. Une modification perdue en silence
est pire qu'une erreur visible, et l'onglet est la seule copie de ce qui n'est pas encore
écrit.

Le bouton **YAML** montre le document tel qu'il sera écrit, modifications non enregistrées
comprises. Ce n'est pas une deuxième vue du même fichier : c'est le contrôle de ce que
l'éditeur s'apprête à commettre dans le dépôt.

## Ce qui n'a pas été porté, et pourquoi

| l'écran Grist faisait | ici |
|---|---|
| **lister les sessions** et en ouvrir une | non porté, **délibérément** : cet éditeur est ouvert SUR un projet par son adresse, et le choix se fait sur la page d'accueil de st0. Un deuxième sélecteur est exactement ce que `packages/project-shell/docs/launch.md` refuse. |
| **téléverser un audio** sur la piste | non porté : l'audio vit dans la médiathèque, et l'y déposer est le travail de pl8. Une piste nomme une adresse ; elle ne porte pas d'octets. |
| **neuf colonnes `fx_*`** par morceau | portées, sous `effects: { … }`. Les COLONNES ont disparu, pas la notion : `categories/deformees.yaml` porte bien `effects: { bitreduction: 78, chorus: 100, … }` par morceau, et [projects.md](projects.md) le montre dans son exemple `multi`. Ce que la variante remplace, c'est le cas où le traitement est *enregistré* dans la médiathèque ([effects.md](effects.md)) ; les deux coexistent. |
| **`youtubeId`** éditable | porté, sous le nom du format (`youtube:`), avec `file:`, `artist:` et `title:`. |
| **le modal de bibliothèque** (réutiliser une catégorie, un morceau, une piste) | porté pour les MORCEAUX (`SongPicker`), sur la médiathèque plutôt que sur des lignes Grist. Réutiliser une *catégorie* n'a plus de sens : une catégorie est un fichier, et deux manches sur la même se font déjà avec `songs:` dans l'ordre. |

## Deux formes que le format documente mal

Les fichiers réels en portent deux que [projects.md](projects.md) mentionne à peine, et qu'un
« setter » naïf abîme sans rien casser d'apparent :

- **`answer:` est un bloc littéral** (`answer: |`) dans les trente cas de la session 2304 —
  plusieurs orthographes acceptées, une par ligne. Écrire une valeur multi-lignes avec un
  `setIn` ordinaire la replierait sur une ligne entre guillemets : même valeur, diff
  méconnaissable. D'où le champ **textarea** et le `Scalar.BLOCK_LITERAL` de `format.ts`.
- **`effects: { … }` existe bel et bien**, par morceau. La page des projets dit que les neuf
  colonnes `fx_*` de Grist ont disparu « pas au profit d'un champ », ce qui se lit comme « les
  traitements sont partis » — alors que son propre exemple `multi` en montre un et que
  `deformees.yaml` en porte un par morceau. Les deux mécanismes coexistent : une variante quand
  le traitement est *enregistré* dans la médiathèque, `effects:` quand il est calculé à la
  lecture.

Et un troisième détail, invisible jusqu'à ce qu'on écrive : une pause sans message est
`- pause:`, alors que `yaml` écrit `null` par défaut. `serialize()` sort donc les documents
avec `nullStr: ""`, faute de quoi une pause ajoutée ici s'écrirait `- pause: null` à côté de
celles de la migration — même sens, deux orthographes, et un diff sur chaque fichier touché.

## Ce qui manque encore

- **Réordonner les pistes** d'un morceau à plusieurs pistes (on peut en ajouter et en retirer,
  pas les permuter).
- **Renommer le fichier** d'une catégorie : le slug est fixé à la création. Le nom affiché,
  lui, se change librement — c'est `name:`, pas le nom du fichier.
- **Aucune validation d'ensemble** : rien ne signale une catégorie qu'aucune manche ne joue, ni
  un morceau dont l'adresse ne répond plus. La plage d'une manche est vérifiée contre sa
  catégorie, et c'est tout.
