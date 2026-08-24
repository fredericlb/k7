# pl8 sur un écran étroit

La médiathèque est **hébergée** : elle s'ouvre depuis un téléphone aussi facilement que depuis
le poste de travail, et c'est le seul écran du studio dont c'est vrai. Le piège est le chrome —
une bande d'onglets, une colonne d'arbre de 240 px et ce qui la borde font des centaines de
pixels avant le premier pixel de contenu.

Un seul point de bascule, `md` (768 px). Pas trois : chaque palier est une deuxième mise en page
à vérifier, et ce qui casse ici casse d'un coup — au-dessous, la place manque pour toutes les
colonnes à la fois ; au-dessus, elle suffit pour toutes.

## Les sections : une liste, et la barre partagée

`SectionNav.tsx` tient la liste ; **la barre est celle de `@frediverse/ui`** (`AppHeader`), qui
rend les deux formes — bande d'onglets au-dessus de son point de bascule, hamburger au-dessous.
Une seule liste : deux copies divergeraient à la première section ajoutée, et une section qui
n'existe que sur un écran est une section qu'on ne trouve pas.

Trois conséquences :

- **Le compte de chaque section est sur le `trailing`** de l'item — un emplacement d'`AppHeaderItem`
  prévu pour ça. Pas dans le libellé : le libellé est la chaîne que le menu coche et
  qu'`aria-current` annonce, et un nombre fondu dedans serait lu comme une partie du nom de la
  page — et changerait à chaque fois que le catalogue change.
- **Le nom de la section courante est dit**, en `subtitle` de la barre plutôt qu'à côté du
  hamburger. Un hamburger seul ne dit pas où l'on est, et c'est la première question qu'on pose à
  un écran de téléphone. Le titre « pl8 » tient à côté, séparé par un point.
- **Le point de bascule des sections est celui de la barre** (`sm`, 640 px), pas le `md` du reste
  de cette page. La barre est partagée, donc son palier est à elle : le faire bouger pour une app
  le ferait bouger pour toutes.

Le menu se referme sur le choix — c'est le comportement du `DropdownMenu` qu'il utilise.

## L'arbre : une colonne qui devient un tiroir

240 px fixes ne laissent rien au contenu sur un téléphone. Sous `md`, l'`aside` sort du flux et
devient un tiroir, ouvert par son propre bouton dans l'en-tête — absent là où il n'y a pas
d'arbre (le moteur et la recherche dessinent toute la largeur eux-mêmes, parce que rien de ce
qu'ils montrent n'est sur le volume).

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
| la phrase « Trouver des morceaux » | `sm` | l'icône reste, donc le bouton aussi |
| les onglets de section | `sm` | ils passent dans le hamburger de la barre partagée |
| le nom de la section (sous-titre) | 420 px | seuil de `AppHeader`, pas le nôtre |

L'éditeur en deux volets (le morceau) **s'empile** au lieu de se partager la
largeur : deux moitiés d'un écran de téléphone font deux colonnes où rien ne tient. Le YAML
prend la moitié haute, ce qu'il décrit la moitié basse — le même ordre que de gauche à droite.

## Ce qui n'est pas résolu

La **forme d'onde** se déplace et se zoome à la souris. Elle répond au doigt pour le déplacement,
mais rien n'y est fait pour le pincement, et les contrôles du transport sont dessinés à des
tailles pensées pour un curseur.
