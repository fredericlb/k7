# Le disque, et ce qu'il montre

Le vinyle n'est plus seulement un décor qui tourne : il **remplit** à mesure que le morceau
passe — vide à 0 %, plein à 100 % — et porte les repères sous forme de cercles.

## Une couche qui ne tourne PAS

Le disque tourne (`m9-spin`), donc la progression et les repères vivent dans un **second SVG**,
frère du premier, immobile.

Dessinés à l'intérieur du disque qui tourne, ils monteraient avec lui : un secteur qui tourne
ne dit rien de l'avancement, et un repère serait à un endroit différent à chaque instant. C'est
la même raison qui tient l'étiquette immobile.

L'ordre dans le DOM est le calque : le disque, puis la progression et les repères, puis
l'étiquette. La couche est `pointer-events-none`, donc le clic passe toujours au centre — un
disque se change par son étiquette.

## Le secteur, et ses deux pièges

Un secteur qui part de midi et tourne dans le sens horaire, translucide : ce qu'il couvre est
la part du morceau **déjà passée**, et les sillons restent lisibles dessous.

Deux détails que la géométrie SVG punit en silence, tous deux figés par un test :

- **À 100 %, un arc dont les extrémités coïncident ne dessine RIEN.** Un disque qui vient de
  finir aurait donc l'air d'un disque pas commencé. Le cercle plein est un chemin à part.
- **Au-delà de la moitié, un arc prend le chemin le plus court** sauf si on le lui interdit
  (`largeArcFlag`). Un morceau à 75 % aurait dessiné son propre complément : presque fini
  affiché comme à peine commencé.

Midi et sens horaire parce que c'est là que toute horloge et tout lecteur DJ mettent le départ.

## Redessiné par frame, jamais par React

La position est lue depuis une **ref** dans une `requestAnimationFrame`, et écrite directement
dans l'attribut `d` du chemin. Une prop aurait re-rendu tout le composant — deux disques, leurs
étiquettes, leurs repères — pour déplacer un bord, plusieurs fois par seconde. C'est
l'arrangement que la waveform utilise déjà, pour la même raison.

Elle est aussi **extrapolée** entre les poussées du moteur (~20 par seconde), sinon un rendu à
60 images par seconde depuis une valeur qui saute 20 fois s'affiche comme une saccade.

## L'horloge du FICHIER, des deux côtés

L'avancement et les repères sont calculés en secondes **dans le fichier**, pas sur la timeline.
Une platine étirée n'est pas plus avancée dans son disque qu'une platine non étirée à la même
mesure — et un repère posé reste au même endroit du cercle quoi que fasse le fader de tempo.
C'est `sourceAt` qui fait la conversion, la même que pour les repères ([cues.md](cues.md)).

Sans longueur connue — les secondes entre le chargement et l'arrivée de l'analyse — le secteur
reste vide et les repères ne sont pas dessinés. Un cercle qui tournerait à une vitesse déduite
d'une durée inventée ne voudrait rien dire.

## Les repères, en couleur de leur bouton

Chaque repère est un cercle posé sur un anneau intérieur, à l'angle de son moment, dans **la
couleur de son bouton** — le 3 est de la même couleur ici, sur le bouton, sur les deux platines
et sur tous les morceaux. C'est ce qui permet de voir qu'on approche du repère 3 sans rien lire.

Un liseré sombre les détache : posés sur un vinyle presque noir et sur un secteur clair, ils
doivent rester lisibles des deux côtés du bord qui avance.
