# La barre du haut, depuis qu'elle est partagée

`apps/k7/frontend/src/views/HeaderView.tsx` monte l'`AppHeader` commun. Trois choix y ont été
faits, et deux d'entre eux abandonnent quelque chose : la page est là pour dire quoi.

## Ce sont des ENTRÉES, pas des commandes

C'est la ligne que trace `AppHeader`, et c'est la raison pour laquelle ce sont ces éléments-là
qui passent derrière le hamburger sur un téléphone.

Les icônes étaient auparavant **ce qui faisait tenir la barre** : sous un point de rupture,
`styles.css` masquait chaque libellé et laissait une rangée de glyphes — délibérément plutôt
qu'un hamburger. C'est la décision que cette adoption abandonne : six glyphes anonymes sont une
rangée que personne ne sait lire non plus, et la barre partagée les replie dans un menu qui les
nomme.

Les icônes restent quand même, parce qu'une entrée nommée **et** dotée d'un glyphe se retrouve
plus vite qu'une entrée seulement nommée.

## Pas de `variant` : le `tint` est la maison

C'était `plain`, l'option discrète du temps où la valeur par défaut était un accent plein, et
la raison qu'en donnait l'ancienne doc était « une application dont la page porte la couleur ».
Le `tint` **est** cette raison exaucée : 20 % de l'accent posé sur la page, donc la barre
appartient à la page au lieu de se poser dessus.

## Le z-index, lui, reste

Ce n'est pas le même genre de choix. La barre partagée colle à `z-10` ; l'ancienne `.topbar`
était à 20, au-dessus des propres couches de la page. Retirer le `z-20` ferait passer la barre
sous elles.
