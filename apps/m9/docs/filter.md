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

| position | passe-bas | passe-haut | ce qu'on entend |
|---|---|---|---|
| −100 | 200 Hz | 20 Hz | étouffé, il ne reste que le bas |
| 0 | 20 kHz | 20 Hz | **rien** — les deux coins sont hors du matériel |
| +100 | 20 kHz | 4 kHz | mince, il ne reste que l'air |

Ce n'est pas un compromis : c'est aussi le fonctionnement du matériel que ça imite.

Le neutre est **inaudible plutôt que contourné**. Il n'y a pas de bypass dans ce vocabulaire, et
un module qu'il faudrait retirer pour être silencieux est un module qu'une chaîne ne peut pas
automater depuis rien. À 0 les deux coins sont simplement au-delà de ce qu'il y a dans le
morceau.

Les deux moitiés ne sont pas symétriques, et c'est voulu. Le passe-haut s'arrête à 4 kHz là où
le passe-bas descend à 200 : balayer la basse est une montée, et à 4 kHz il ne reste déjà plus
que de l'air. S'il grimpait aussi loin que l'autre descend, la moitié droite emporterait tout le
morceau bien avant le bout de la course.

## Les deux détails de DSP

**L'ordre.** Le passe-bas passe en premier, donc à l'extrême gauche le passe-haut voit un signal
déjà étouffé plutôt que le signal brut.

**`glide` sur les deux coins.** Un biquad recalcule ses coefficients par **bloc**, et c'est un
potard qu'on lance : un saut entre deux blocs est un clic, et une rafale de sauts est le bruit
de fermeture éclair qui fait passer un filtre pour cassé plutôt que pour rapide.

La résonance est **fixe et modeste** (Q = 1). C'est le son pour lequel cet effet est célèbre, et
aussi la façon dont il reprend la marge de manœuvre en plein set : un pic qui sonne à 200 Hz est
plusieurs dB au-dessus du matériel qu'il est censé enlever. Un second potard pour ça devrait
être lié et dessiné ; c'est la valeur qui ne surprend jamais.

## Le chemin, et la synchro dans les deux sens

C'est un module `jsdsp`, donc un **vrai plugin** : le compilateur cuit son graphe dans le
document (1194 octets), le moteur le charge, et le potard prend le chemin du crossfader —
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
