# st0 sur un écran étroit

La médiathèque est **hébergée** : elle s'ouvre depuis un téléphone aussi facilement que depuis
le poste de travail, et c'est le seul écran du studio dont c'est vrai. Elle était pourtant
dessinée pour une seule largeur — sept onglets, une colonne d'arbre de 240 px et un panneau de
384 px, soit 624 px de chrome avant le premier pixel de contenu.

Un seul point de bascule, `md` (768 px). Pas trois : chaque palier est une deuxième mise en page
à vérifier, et ce qui casse ici casse d'un coup — au-dessous, la place manque pour toutes les
colonnes à la fois ; au-dessus, elle suffit pour toutes.

## Les sections : une liste, deux formes

`SectionNav.tsx` tient la liste et la rend deux fois — bande d'onglets au-dessus de `md`,
hamburger au-dessous. **Une seule liste** : deux copies auraient divergé à la première section
ajoutée, et une section qui n'existe que sur un écran est une section qu'on ne trouve pas.

Le nom de la section courante est écrit **à côté** du hamburger. Un hamburger seul ne dit pas où
l'on est, et c'est la première question qu'on pose à un écran de téléphone. Le titre « st0 »
disparaît le premier pour lui laisser la place : savoir dans quelle section on est vaut plus que
savoir quelle app on regarde.

Le menu se referme sur le choix — il recouvre l'écran, et le laisser ouvert cacherait exactement
ce qu'on vient de demander à voir.

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
| le titre « st0 » | `sm` | remplacé par le nom de la section |

Les éditeurs en deux volets (chaîne, playlist, morceau) **s'empilent** au lieu de se partager la
largeur : deux moitiés d'un écran de téléphone font deux colonnes où rien ne tient. Le YAML
prend la moitié haute, ce qu'il décrit la moitié basse — le même ordre que de gauche à droite.

## Ce qui n'est pas résolu

Le **graphe** — l'aperçu de module, la vue de chaîne — reste un canevas qu'on déplace et qu'on
zoome à la souris. Il fonctionne au doigt pour le déplacement, mais rien n'y a été fait pour le
pincement, et les widgets d'un panneau sont dessinés à des tailles pensées pour un curseur.

Le **constructeur de modules** garde trois colonnes. C'est l'écran le moins susceptible d'être
ouvert depuis un téléphone, et le rendre utilisable là serait une mise en page à part entière
plutôt qu'un ajustement.
