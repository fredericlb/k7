# La barre du haut

`apps/k7/frontend/src/views/HeaderView.tsx` monte l'`AppHeader` commun. Trois choix y sont
faits, et la page est là pour dire lesquels.

## Ce sont des ENTRÉES, pas des commandes

C'est la ligne que trace `AppHeader`, et c'est la raison pour laquelle ce sont ces éléments-là
qui passent derrière le hamburger sur un téléphone.

Sous le point de rupture, la barre replie donc ses entrées dans un menu qui les **nomme**,
plutôt que de les réduire à une rangée de glyphes : six glyphes anonymes sont une rangée que
personne ne sait lire.

Les icônes restent quand même, parce qu'une entrée nommée **et** dotée d'un glyphe se retrouve
plus vite qu'une entrée seulement nommée.

## Pas de `variant` : le `tint` est la maison

Le `tint` pose 20 % de l'accent de la page sur la barre, donc la barre appartient à la page au
lieu de se poser dessus — c'est ce que veut une application dont la page porte la couleur.

## Le z-index monte à 20

La barre partagée colle à `z-10`, ce qui la met sous les propres couches des pages de k7. Le
`className="z-20"` posé ici est ce qui la garde au-dessus : le retirer la ferait passer
dessous.
