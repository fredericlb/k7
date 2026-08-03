# Où la médiathèque lit sa configuration

Le backend lit `STUDIO_MEDIATEK` — le volume de la bibliothèque — et **refuse de démarrer
sans elle**. Pas de défaut : `@studio/mediatek` retomberait sur `~/.studio/mediatek`, qui
dans un conteneur est un répertoire vide que personne n'a monté. Le service démarrerait en
bonne santé et servirait une bibliothèque vide, ce qui est la pire panne possible ici.

## Pourquoi `Object.assign(process.env, …)` et pas une valeur

`server.ts` charge sa section de l'`env.yaml` racine avec `loadServiceEnv` et l'**écrit
dans `process.env`**, au lieu d'en garder le résultat dans une constante.

C'est délibéré, et c'est la partie qu'il ne faut pas « nettoyer ». Le chemin de la
bibliothèque n'est pas passé de main en main : chaque consommateur le résout lui-même en
lisant l'environnement, à commencer par `mediatekRoot()`
(`packages/song/src/mediatekRoot.ts`), sur lequel s'appuient `@studio/mediatek`,
`@studio/song` et le service de fichiers.

Un chargeur qui se contenterait de *retourner* la valeur — ce que fait `defineEnv`, qui
valide et rend un objet sans toucher à `process.env` — laisserait donc tous ces
consommateurs sur le repli `~/.studio/mediatek`. Le backend, lui, verrait bien sa valeur et
passerait son propre garde-fou. Résultat : un service qui démarre, se déclare sain, et sert
le mauvais répertoire. Exactement la panne que le garde-fou existe pour empêcher.

L'écriture dans `process.env` est sûre ici parce que rien dans le graphe d'imports ne lit
`STUDIO_MEDIATEK` au moment de l'import : `mediatekRoot()` est une fonction, appelée à
l'exécution. L'ordre des imports n'a donc pas d'importance — ce qui compte, car un
formateur qui réordonne les imports casserait silencieusement une solution qui en
dépendrait.

## Précédence

Le yaml gagne là où il déclare une clé, comme le documente `@frediverse/env` : c'est de la
configuration de dev explicite et par service, et ça empêche une variable ambiante
d'annexer un backend au passage.

En production il n'y a pas d'`env.yaml` — les images l'excluent — donc les variables du
conteneur sont la seule source. Le Dockerfile pose `ENV STUDIO_MEDIATEK=/library`.

## Effet de bord à connaître

`loadServiceEnv` fusionne la section `common` **avec** celle du service, par conception.
Poser des `OIDC_*` réels dans `common` fait donc basculer la médiathèque en dev du stub
« Dev User » vers un vrai fournisseur d'identité. C'est le comportement qu'ont déjà
`k7-backend` et `obscura-backend`, qui lisent le même fichier. Pour garder le stub en
dev, il faut sortir ces clés de `common`.
