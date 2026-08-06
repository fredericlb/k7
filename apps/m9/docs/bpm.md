# Le tempo d'une platine, et le sync

Un fader vertical à côté de chaque vinyle, deux boutons SYNC aux extrémités de la barre du
bas. Le bouton dit **qui mène** : appuyer à gauche met les deux disques sur le tempo du
fader gauche, et le fader droit devient gris et bouge tout seul.

## Le fader est le paramètre d'un MODULE

Ce n'est pas une commande que m9 s'invente : le projet le dit. `example.m9` pose sur chaque
platine une instance du module `@mediatek/audio/utility/tempo` de la médiathèque, et le
fader est le `Target BPM` de cette instance. Une instance par platine, parce que chaque
platine joue à son propre BPM et qu'un paramètre appartient à un **usage**, pas à un module.

Ce module est **froid**, et `plugin: {type: offline}` : un changement de tempo est un
étirement temporel, un étirement doit savoir où le fichier se termine, et **le moteur n'a
aucun plugin qui étire le temps** — `PluginScan.cpp` enregistre un Pitch Shifter et rien
d'autre de cet ordre. Tracktion étire un CLIP, par des marqueurs de warp, pas dans un
insert. Voir `packages/song/docs/coldModules.md`.

D'où la conséquence à connaître : **la passe froide n'est pas écrite**. Ce qui suit est la
façon dont le navigateur réalise ce module en attendant, exactement comme il réalise le
crossfade en deux niveaux (voir [mix.md](mix.md)). `warpFor` est le tenant-lieu, et c'est ce
que la passe remplacera.

## Comment un morceau change de tempo, en attendant

Le document ne porte **qu'un** tempo, et il reste fixe (`DOC_TEMPO`, 120). C'est là tout le
montage : chaque platine atteint sa cible par son **propre warp**, donc un seul document
peut jouer deux morceaux à deux BPM différents.

Un `WarpDoc` est une liste de marqueurs `[temps de la timeline, seconde du fichier]`. Deux
marqueurs = un étirement linéaire, et le second suffit à tout dire :

```
secondes réelles = secondes × naturel / cible
temps occupés    = secondes réelles × DOC_TEMPO / 60
```

d'où `beats = secondes × DOC_TEMPO × naturel / (60 × cible)`. Le fichier passe entier entre
les deux marqueurs ; seul le **beat d'arrivée** change.

`elastique` **préserve la hauteur** : un disque étiré ne monte pas en tonalité, contrairement
au plateau d'une platine. C'est le comportement moderne, et ça se sait plutôt que ça se
suppose.

Pas de warp du tout quand la cible est le tempo du morceau : un étirement identité mettrait
le moteur d'étirement dans le chemin pour ne rien changer — du CPU et de la qualité dépensés
pour rien.

## La plage, et pourquoi le sync en sort

Le fader va à **±16 %** du tempo du morceau, la plage large d'une platine. Au-delà, un
étirement cesse de sonner comme le disque.

Le sync, lui, **ne borne pas**. « Synchronisées » veut dire le même tempo ; borner laisserait
les deux platines à des BPM différents pendant que le bouton prétend le contraire. C'est
l'échelle du fader esclave qui s'élargit pour couvrir la valeur qu'on lui impose — sinon la
poignée serait collée en butée pendant que le nombre dirait autre chose.

Le pourcentage sous le fader passe en **ambre** dès qu'on dépasse les ±16 %. Sur du vrai
matériel ça arrive vite : synchroniser un morceau à 90 BPM sur un morceau à 123 BPM est un
étirement de **+37 %**, parfaitement légitime et parfaitement audible. Mieux vaut le voir que
le découvrir dans les enceintes.

Une platine sans tempo détecté ne mène rien et ne suit rien — il n'y a pas de nombre auquel
se synchroniser, et en inventer un serait le mensonge confiant qu'on évite partout ici. Les
deux boutons sont désactivés tant que les deux platines n'ont pas de tempo.

## Pourquoi ça atterrit au relâchement

Le crossfade bouge à chaque pixel parce que c'est un **paramètre de plugin** :
`set-plugin-param`, un message. Un warp est dans le **document** — il n'y a pas de message
pour ça — donc déplacer le fader met le nombre à jour tout de suite et n'envoie le document
qu'au relâchement. Re-warper à chaque pixel reconstruirait le moteur d'étirement à chaque pas
d'un glissement, sur les deux platines quand elles sont synchronisées.

## Ce qu'il faut savoir avant de l'essayer

Le tempo vient du sidecar `{fichier}.cache`, c'est-à-dire de la **même analyse** que la
waveform. Sur cette machine, **4 morceaux sur 279** en ont un. Pour tous les autres, charger
le morceau déclenche l'analyse par le moteur — plusieurs secondes — et d'ici là le fader
affiche `—` et le sync est désactivé. Ce n'est pas une panne, c'est l'état normal d'un cache
qui n'a jamais été analysé ; l'endroit naturel pour préchauffer, plus tard, c'est la liste du
set (`songs.yaml` nomme déjà exactement les morceaux concernés).

## Un seul transport, toujours

Le sync aligne les **tempos**, pas les phases : les deux disques tournent à la même vitesse,
rien ne garantit que leurs temps forts tombent ensemble. Caler la phase demanderait de
décaler un morceau dans le temps, donc un transport par platine — ce que le moteur n'a pas
(voir [mix.md](mix.md)). C'est la moitié qui manque, et elle manque pour la même raison que
le reste.
