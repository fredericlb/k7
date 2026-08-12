# Une playlist, c'est un fichier

Une playlist est une liste ordonnée de morceaux que la médiathèque tient déjà, chacun
pouvant nommer l'une des variantes de son morceau. Elle vit sous `playlists/`, à la
profondeur qu'on veut :

```
playlists/ete-2026.yaml
playlists/live/repet-du-jeudi.yaml
```

```yaml
# playlists/live/repet-du-jeudi.yaml
title: Répèt du jeudi
items:
  - AC-DC/Back in Black/Hells Bells
  - song: Nirvana/Nevermind/Lithium
    variant: instrumental
  - song: Miles Davis/Kind of Blue/So What
    variant: sans-voix
```

## Le fichier EST l'entrée

C'est la seule famille avec `samples` dont l'entrée est un fichier et non un dossier, et
c'est pour la même raison : il n'y a rien à ranger à côté d'une playlist. Un morceau, une
chaîne et un module sont des dossiers parce que chacun porte ce que son fichier nomme — un
master, ses nodes, ses assets. Une playlist ne porte que des renvois vers des choses
classées ailleurs ; un dossier autour d'elle serait une boîte vide.

D'où l'absence de marqueur `playlist.yaml` : c'est **l'extension qui fait la règle**
(`PLAYLIST_EXT`), là où `scanChains` cherche un `chains.yaml` et `scanModules` un
`module.yaml`. Ce n'est pas un oubli d'uniformité, c'est la conséquence de la phrase
au-dessus.

## Deux écritures pour une ligne

Une ligne est soit une chaîne de caractères, soit une association :

| ce qu'on écrit | ce que ça veut dire |
|---|---|
| `- Nirvana/Nevermind/Lithium` | le master de ce morceau |
| `- {song: …, variant: instrumental}` | cette version-là de ce morceau |

La forme courte existe parce que c'est ce que quelqu'un tape réellement pour le cas
courant, et la forme longue parce qu'une variante a besoin d'un deuxième mot. Une ligne qui
ne nomme **aucun** morceau est jetée plutôt que rattrapée : `- [x]` est une ligne mal
écrite, et fabriquer `"[object Object]"` comme référence mettrait à l'écran une rangée qui
ne pointe vers rien qu'on puisse aller regarder. Même discipline que `readVariants`.

## Les renvois ne sont pas vérifiés ici

`parsePlaylist` garde `song` **verbatim**, exactement comme `SongVariant.ref`. Le catalogue
invalide une famille à la fois (voir la note sur la révision dans `catalogue.ts`), donc une
liste de playlists qui dépendrait de la liste des morceaux servirait une réponse périmée
chaque fois qu'un morceau bouge — et inversement.

Résoudre un renvoi demande de tenir la liste des morceaux, et c'est donc le travail de
celui qui la tient : ici, le panneau de droite de st0 (`apps/st0/docs/playlists.md`), qui
est aussi le seul endroit où « ce morceau n'existe pas » est une question à laquelle on
peut répondre. C'est le même partage que pour les variantes de type `chain`, et pour la
même raison — voir [variants.md](variants.md), « ce que le scan ne confirme pas ».

## Ce que le scan lit quand même

Deux choses, dont aucune n'est porteuse : `title:` pour ce que la liste affiche, et le
nombre d'items. Sans titre, c'est le nom du fichier qui sert.

Un fichier qui **ne parse pas** est listé tout de même, avec `catalogued: false` — le même
mot qu'un dossier de morceau que personne n'a rangé. Il est sur le disque : un catalogue
qui le cacherait vous laisserait incapable de cliquer sur la chose qu'il faut aller
réparer.

`parsePlaylist` rend `null` dans ce cas, et non une playlist vide. Les deux sont des faits
différents et une surface les dit différemment : un fichier qui ne parse pas est à
corriger, un `items:` vide est à remplir.

## Écrire une ligne, sans repasser par le sérialiseur

`appendPlaylistItem` ajoute une ligne **au texte**. C'est la même discipline que
`withVariant` dans `write.ts`, et pour la même raison : ces fichiers portent des
commentaires et un ordre que quelqu'un a choisi, et parser vers un objet pour le
re-sérialiser jetterait les deux sans bruit. Faire un aller-retour d'une setlist par un
sérialiseur, c'est le changement que personne ne remarque avant que ses notes aient disparu.

Il rend `null` — plutôt qu'une approximation — pour les formes qu'il ne sait pas étendre :
une séquence en flot répartie sur plusieurs lignes, ou un `items:` qui n'est pas une liste.
La surface désactive alors son bouton et dit pourquoi ; écrire un deuxième `items:` plus bas
produirait un fichier dont les deux moitiés se contredisent.

`yamlScalar` cite **quand il le faut et seulement là**. Les chemins de morceaux sortent de
`segment()` et portent donc légitimement des espaces, des `&` et des parenthèses — tout cela
va très bien sans guillemets au milieu d'un scalaire, et pas du tout en tête. Sont cités : ce
qui commence par un indicateur, ce qui contient `: ` ou ` #`, et ce que YAML lirait comme
autre chose qu'une chaîne (`No`, `null`, `42`). Tout citer serait plus simple à écrire et
mettrait deux conventions dans un fichier qui s'édite aussi à la main.
