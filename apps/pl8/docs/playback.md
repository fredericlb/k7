# Deux disques, et le piège entre les deux

La médiathèque est **hébergée** ; le moteur ouvre des **chemins sur sa propre machine** et ne
sait pas aller chercher une URL. Ce qui joue n'est donc jamais les octets que cet écran liste :
c'est la copie dans le cache de la machine choisie, atteinte par le service de fichiers de
cette machine-là.

C'est le fait le plus facile à oublier de tout ce service, et il vaut pour tout ce qu'un moteur
joue pour la médiathèque — un morceau, une variante.

| quoi | d'où | pourquoi |
|---|---|---|
| l'audio | le cache de la machine du moteur (`/mediatek` → `root`, plus le chemin de l'entrée et `meta.master`) | le moteur l'ouvre comme un fichier |
| ce qu'on liste à l'écran | la bibliothèque hébergée | c'est de la DONNÉE, et c'est la même des deux côtés |

`cacheRoot` demande sa racine à la machine, `playablePath` la recolle au chemin de l'entrée, et
`cachedOnMachine` répond « cette machine l'a-t-elle » avec un `Range: bytes=0-0` — un octet, pas
le fichier, parce que demander doit coûter moins cher que se tromper.

## Ce que le bouton dit quand il ne peut pas jouer

Il reste grisé et son infobulle dit laquelle des trois raisons s'applique :

- **aucun moteur** — rien n'a été choisi, ou rien n'a répondu à la sonde ;
- **cette machine n'a pas de cache de la médiathèque** — le service de fichiers a répondu, mais
  ne tient aucune bibliothèque ;
- **ce morceau n'a pas de fichier audio** — un dossier avec un sidecar et pas de master, ce qui
  est un état réel (un miroir arrêté en route, un dossier fait à la main) et non une panne à
  cacher.

La distinction compte parce que les trois se réparent différemment, et un bouton simplement gris
invite à deviner.

## Le document

`songPreviewDoc` est **une piste, un clip** : le fichier tel quel. Rien d'autre.

`recordDir` reste vide — un aperçu joue et n'enregistre jamais, et un dossier inventé est un
dossier où le moteur finirait par écrire.

> **Il portait une CHAÎNE.** Le document s'appelait `chainPreviewDoc` et prenait les étapes
> d'une chaîne de la médiathèque comme greffons de la piste, adressés `chain-preview:<module>` —
> la même identité que le nœud dessiné, pour qu'un graphe montrant un filtre que le moteur n'a
> jamais chargé soit impossible. Un bouton **Process** rendait ensuite chaque variante-chaîne
> hors ligne, à côté du master. Tout cela est parti avec la famille `chains`, qui a quitté le
> catalogue : une chaîne s'écrit dans l8 et se committe dans le dépôt de bibliothèques du compte.

## Une session, un son

L'aperçu part sur `SESSIONS.pl8`, par service **et** par personne. Jouer quelque chose remplace
donc ce que cette session tenait. C'est voulu : faire jouer deux choses à la fois sur un moteur
n'est pas à organiser, c'est à interdire.
