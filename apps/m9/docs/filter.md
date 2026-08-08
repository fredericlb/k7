# Le filtre d'une platine

Un potard par platine, sous les trois de l'EQ et séparé d'eux par un trait — ce n'est pas une
quatrième bande, c'est un autre instrument sur la même tranche. Il commande un module `sweep`
posé sur cette platine dans le graphe, et comme tout le reste du pupitre le lien est **déclaré**
dans `views/mix.yaml`.

## Un seul paramètre, et c'est la contrainte qui fait le module

Un contrôle du pupitre pilote **au plus un** paramètre
([viewBindings.md](../../../packages/song/docs/viewBindings.md)). Donc « passe-bas ou
passe-haut » ne peut pas être un second réglage qu'on bascule : il faut que le sens du balayage
soit lisible dans le seul nombre qu'on envoie.

D'où la forme : `Sweep` va de −100 à +100, et les **deux** filtres sont toujours dans la
chaîne. Vers la gauche un passe-bas descend, vers la droite un passe-haut monte, et chacun se
range hors du chemin quand ce n'est pas son tour :

| position | passe-bas | passe-haut | Q | ce qu'on entend |
|---|---|---|---|---|
| −100 | 30 Hz | 20 Hz | 6 | il ne reste que le pic qui siffle |
| 0 | 20 kHz | 20 Hz | 0,707 | **rien** — les deux coins sont hors du matériel |
| +100 | 20 kHz | 10 kHz | 6 | mince, il ne reste que l'air |

Ce n'est pas un compromis : c'est aussi le fonctionnement du matériel que ça imite.

Le neutre est **inaudible plutôt que contourné**. Il n'y a pas de bypass dans ce vocabulaire, et
un module qu'il faudrait retirer pour être silencieux est un module qu'une chaîne ne peut pas
automater depuis rien. À 0 les deux coins sont simplement au-delà de ce qu'il y a dans le
morceau.

Il ferme **loin** : 30 Hz, pas quelques centaines de hertz. Un filtre qui s'arrêterait plus haut
laisse un bourdon boueux ; on attend d'un filtre DJ qu'il enlève le morceau, et le dernier tiers
de la course — là où il ne reste que le pic qui siffle — est justement la partie qu'on utilise.

Les deux moitiés ne sont pas symétriques, et c'est voulu : le passe-haut s'arrête à 10 kHz. À ce
point il ne reste plus que de l'air, et balayer la basse est une montée plutôt qu'une
disparition.

## Ce qui fait le *swoosh* : la résonance

La première version avait Q = 1 — plat, sans pic — et sonnait comme « un filtre normal », parce
que c'en était un. Un coin plat qui glisse sur un morceau ne fait que l'étouffer, progressivement
et platement. Le swoosh que tout le monde connaît est un **pic qui voyage avec le coin**, et
soulève une bande étroite au passage. Le pic EST l'effet.

La résonance **monte** avec la distance au centre : 0,707 (Butterworth, plat) au repos, 6 aux
extrêmes. Un filtre qui ne fait rien ne colore donc rien, et l'ampleur du geste décide de
l'ampleur du chant. Chaque moitié a la **sienne** : partager une seule laisserait le passe-haut
sonner à 20 Hz pendant qu'on descend le passe-bas — un pic garé sur le sub.

**Deux étages par côté**, donc 24 dB/octave et non 12. Une paire de pôles étouffe ; deux, c'est
le mur qu'un filtre DJ dresse. Le premier étage de chaque paire reste **plat** et seul le second
résonne : deux étages résonnants à la même fréquence multiplient leurs pics (Q²), soit un filtre
qui crie avant même de balayer.

**`glide` sur les deux coins.** Un biquad recalcule ses coefficients par **bloc**, et c'est un
potard qu'on lance : un saut entre deux blocs est un clic, et une rafale de sauts est le bruit de
fermeture éclair qui fait passer un filtre pour cassé plutôt que pour rapide.

### Mesuré, pas supposé

Bruit blanc à travers le filtre, chaque bande comparée à la même bande au neutre (donc un pic
apparaît comme un nombre **positif**) :

| bande | à Sweep = −50 |
|---|---|
| 250 Hz | −0,2 dB |
| 400 Hz | **+1,2 dB** |
| 600 Hz | **+3,7 dB** |
| 775 Hz | **+3,9 dB** ← le coin |
| 1 kHz | −2,2 dB |
| 1,3 kHz | −9,1 dB |
| 2,5 kHz | −21,0 dB |
| 10 kHz | −38,6 dB |

Un pic net posé sur un mur de 24 dB/octave, plat en dessous. C'est ça, le swoosh.

Le **trim** final ne reprend que −3 dB aux extrêmes. La première tentative en prenait −6 et
mangeait le pic exactement là où le pic est l'intérêt (+1,2 dB au coin, mesuré) — et la
saturation qu'il prévenait était théorique : le filtre retire 14 dB au signal entier à ce
réglage. Ce qui reste empêche un Q de 6 posé sur un kick à 30 Hz de coûter son master à
quelqu'un.

### Le piège qui a rendu le filtre muet

`geolerp` **trie ses deux bornes** côté moteur (`jmin`/`jmax`, pour qu'un graphe ne puisse pas
demander un rapport négatif). Une paire décroissante ne casse donc pas : elle se lit comme son
propre miroir. Écrit de la façon évidente — `geolerp(20000, 30, down)` — ce filtre se posait à
**30 Hz au repos** et s'ouvrait quand on balayait : le silence, potard au neutre. Mesuré à
−62 dBFS contre un témoin à −24.

Pour descendre, on garde la paire croissante et on inverse le trajet :
`geolerp(30, 20000, sub(1, t))`. Le builder **refuse** désormais une paire décroissante
littérale, avec le message qui donne l'autre écriture — l'erreur est attrapée là où l'auteur
est. Deux tests la figent.

⚠️ Le module `audio/filter/lowpass` de la médiathèque a exactement le même défaut :
`geolerp(20000, 200, t)`, donc son `Amount` fonctionne **à l'envers** de ce que sa doc annonce
(fermé à 0, ouvert à 100). Il est dans le catalogue de st0, pas dans ce dépôt.

## Le chemin, et la synchro dans les deux sens

C'est un module `jsdsp`, donc un **vrai plugin** : le compilateur cuit son graphe dans le
document (2046 octets), le moteur le charge, et le potard prend le chemin du crossfader —
`set-plugin-param`, à chaque pixel. Rien de spécial n'a été ajouté pour lui.

La synchro avec le graphe vient donc gratuitement, par le même mécanisme que l'EQ : le moteur
rapporte ce à quoi un plugin est réglé quelle que soit la surface qui l'a réglé, et pupitre et
graphe lisent le même `deck.params`. Mesuré contre le moteur qui tourne : il charge le plugin,
annonce `Sweep` avec sa plage −100…+100 et son défaut 0, accepte −80 et le renvoie.

C'est la différence avec le tempo, qui a eu besoin d'un canal à lui parce qu'il ne compile en
aucun plugin — voir [deckSet.md](deckSet.md).

## Où il est dans la chaîne

```
deckA → tempoA → eqA → filterA → crossfade → OUT
```

**Dernier des trois.** C'est l'effet qu'une main lance, celui qu'on veut par-dessus ce que l'EQ
a déjà fait — plutôt que d'égaliser après coup ce que le filtre vient de laisser passer.
