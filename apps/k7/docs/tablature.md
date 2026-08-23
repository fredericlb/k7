# Le carnet de chants : tablature, accords, diagrammes

Trois analyseurs purs — sans framework, donc testables unitairement — transforment du texte
brut en quelque chose qui se dessine. Les paroles restent **des chaînes en stockage** ;
l'analyse n'a lieu qu'à l'affichage.

## Découper une tablature ASCII

`apps/k7/packages/tablature/src/tab.ts` lit le format ASCII courant
(`e|--0--2--3--|`). Comme cette tablature est alignée en chasse fixe, l'index d'un caractère
dans la ligne **est** sa position en x : il n'y a rien de plus à calculer.

Une ligne est reconnue comme corde si, après une étiquette optionnelle, elle n'est faite que de
caractères admis : tirets, barres de mesure, chiffres, espaces, et les lettres de technique
usuelles — `h`/`p` (hammer, pull), `b`/`r` (bend, release), `s` (slide), `t` (tap), `v`
(vibrato), `g` (grace, legato), `l`/`L` (let ring), `x` (note étouffée), `o` (harmonique), plus
quelques symboles.

L'étiquette de corde — `e`, `B`, `A#` — est retirée en tête, mais **le `|` qui la suit
habituellement reste dans le corps**, pour qu'il se dessine comme une barre de début de mesure à
la colonne 0. La colonne où commence le corps est prise en compte pour que toutes les cordes
d'un même système s'alignent sur la même grille.

### Un système est une suite de lignes, pas une suite d'étiquettes

Un système est une **suite maximale de lignes de corde consécutives** ; une ligne vide ou non
tabulaire l'interrompt.

Découper sur les étiquettes a été délibérément écarté : l'accordage standard nomme `E` la
première **et** la sixième corde, donc une règle « étiquette déjà vue, nouveau système »
couperait la dernière corde en système à elle seule.

Le compromis assumé : deux systèmes sans ligne vide entre eux fusionnent en un seul bloc haut.
C'est rare — les exports de tablature les séparent par une ligne vide.

## Reconnaître un accord sans se tromper de mot

`apps/k7/packages/lyrics/src/chords.ts` gère les deux styles de grille : les accords posés
au-dessus des paroles, alignés en chasse fixe, et les accords entre crochets ou parenthèses
dans le texte (`[C]`, `(Am)`).

Le corps d'un accord — sa qualité et ses extensions — est construit à partir d'un **vocabulaire
connu** (`maj`, `min`, `sus`, `add`, `m`, `dim`, `aug`, extensions chiffrées, altérations)
plutôt que d'accepter « n'importe quelles lettres ». C'est ce qui évite que des mots courants
comme « Bad », « Cage » ou « Fed » soient pris pour des accords.

Transposer préserve la qualité et l'extension : seuls la fondamentale et l'éventuelle basse
après le slash bougent, indépendamment l'une de l'autre. Ce qui n'est pas un accord est rendu
tel quel.

Sur une ligne entière, **l'espacement exact entre les jetons est conservé**, pour garder autant
que possible l'alignement des accords au-dessus des paroles. Une dérive de colonne reste
possible quand un jeton change de largeur (`F` → `F#`) : c'est le prix de ne pas réécrire la
ligne.

## Les diagrammes viennent d'une base

`apps/k7/frontend/src/utils/chordDiagram.ts` est le **seul** module qui touche
`@tombatossals/chords-db` : le reste de l'application reste découplé de sa forme.

Deux frictions avec cette base :

- `resolveJsonModule` infère un type littéral énorme dont l'objet `chords` n'a pas de signature
  d'index de chaîne ; un cast vers notre propre forme est ce qui rend `chords[clé]` typable.
- Ses noms de propriétés ne sont pas des noms de notes : les dièses sont en camelCase
  (`Csharp`), certains bémols sont gardés tels quels, et les enharmonies sont repliées. D'où la
  table `ROOT_TO_DB`.

La recherche essaie la qualité exacte, puis la forme slash, puis le triton nu, et rend `null`
quand l'accord n'est pas dans la base plutôt que d'inventer un doigté.
