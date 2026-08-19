# st0 sur un écran étroit

La médiathèque est **hébergée** : elle s'ouvre depuis un téléphone aussi facilement que depuis
le poste de travail, et c'est le seul écran du studio dont c'est vrai. Elle était pourtant
dessinée pour une seule largeur — sept onglets, une colonne d'arbre de 240 px et un panneau de
384 px, soit 624 px de chrome avant le premier pixel de contenu.

Un seul point de bascule, `md` (768 px). Pas trois : chaque palier est une deuxième mise en page
à vérifier, et ce qui casse ici casse d'un coup — au-dessous, la place manque pour toutes les
colonnes à la fois ; au-dessus, elle suffit pour toutes.

## Les sections : une liste, et la barre partagée

`SectionNav.tsx` tient la liste ; **la barre est celle de `@frediverse/ui`** (`AppHeader`), qui
rend les deux formes — bande d'onglets au-dessus de son point de bascule, hamburger au-dessous.
Une seule liste, comme avant : deux copies auraient divergé à la première section ajoutée, et une
section qui n'existe que sur un écran est une section qu'on ne trouve pas. Ce qui a changé, c'est
qui dessine les deux formes — st0 les écrivait à la main, et c'est exactement le composant que
`ui: AppHeader adoptable by every app` a rendu partageable.

Trois conséquences, et deux sont des choix qui survivent :

- **Le compte de chaque section reste**, sur le `trailing` de l'item — un emplacement ajouté à
  `AppHeaderItem` pour ça. Pas dans le libellé : le libellé est la chaîne que le menu coche et
  qu'`aria-current` annonce, et un nombre fondu dedans serait lu comme une partie du nom de la
  page — et changerait à chaque fois que le catalogue change.
- **Le nom de la section courante reste dit**, en `subtitle` de la barre plutôt qu'à côté du
  hamburger. Un hamburger seul ne dit pas où l'on est, et c'est la première question qu'on pose à
  un écran de téléphone. Le titre « st0 » ne disparaît plus pour lui laisser la place : les deux
  tiennent, séparés par un point.
- **Le point de bascule des sections est celui de la barre** (`sm`, 640 px), pas le `md` du reste
  de cette page. Un seul palier restait la règle tant que st0 dessinait tout ; la barre partagée
  a le sien, et le faire bouger pour une app le ferait bouger pour toutes.

Le menu se referme sur le choix — c'est le comportement du `DropdownMenu` qu'il utilise, là où
st0 fermait un `Sheet` à la main.

## L'arbre : une colonne qui devient un tiroir

240 px fixes ne laissent rien au contenu sur un téléphone. Sous `md`, l'`aside` sort du flux et
devient un tiroir, ouvert par son propre bouton dans l'en-tête — absent là où il n'y a pas
d'arbre (les dépôts, le moteur et la recherche dessinent toute la largeur eux-mêmes, parce que
rien de ce qu'ils montrent n'est sur le volume).

C'est **le même balisage** dans les deux cas, avec des classes différentes. L'extraire dans un
composant pour le rendre deux fois aurait dupliqué les deux cents lignes d'actions de menu qu'il
porte — le genre de duplication où l'une des deux copies reçoit une action et pas l'autre.

Il se referme sur ce qu'on ouvre, et au changement de section. Le voile n'existe **que** pendant
qu'il est ouvert : un élément invisible qui couvre l'écran est un élément qui avale les clics.

## Ce qui disparaît, et dans quel ordre

Ce qui part en premier est ce dont on n'a jamais besoin dans l'instant :

| élément | seuil | pourquoi |
|---|---|---|
| la version | `lg` | rien ne s'y décide |
| le panneau des paramètres de module | `lg` | 384 px de plus ; ce qu'il montre s'atteint en ouvrant le module |
| la phrase « Trouver des morceaux » | `sm` | l'icône reste, donc le bouton aussi |
| les onglets de section | `sm` | ils passent dans le hamburger de la barre partagée |
| le nom de la section (sous-titre) | 420 px | seuil de `AppHeader`, pas le nôtre |

L'éditeur en deux volets (le morceau) **s'empile** au lieu de se partager la
largeur : deux moitiés d'un écran de téléphone font deux colonnes où rien ne tient. Le YAML
prend la moitié haute, ce qu'il décrit la moitié basse — le même ordre que de gauche à droite.

## Ce qui n'est pas résolu

Le **graphe** — l'aperçu de module, la vue de chaîne — reste un canevas qu'on déplace et qu'on
zoome à la souris. Il fonctionne au doigt pour le déplacement, mais rien n'y a été fait pour le
pincement, et les widgets d'un panneau sont dessinés à des tailles pensées pour un curseur.

Le **constructeur de modules** garde trois colonnes. C'est l'écran le moins susceptible d'être
ouvert depuis un téléphone, et le rendre utilisable là serait une mise en page à part entière
plutôt qu'un ajustement.
