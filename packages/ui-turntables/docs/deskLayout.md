# Le pupitre s'adapte à sa hauteur

Le pupitre est un **panneau** (`layout: split`, voir
[packages/song/docs/surfaces.md](../../song/docs/surfaces.md)). Sa hauteur n'est donc pas une
constante : la moitié de la colonne à côté du graphe, la fenêtre entière sous `full`, un tiers
d'un téléphone en paysage. `deskLayout.ts` est la fonction qui répond « à cette hauteur-là, on
dessine quoi », et `useContentHeight.ts` est ce qui la mesure.

## Le disque part le premier

À pleine hauteur une platine empile le **disque**, la **forme d'onde**, les **huit repères** et
le **titre**. Cela demande à peu près 510 px de colonne, dont 352 pour le disque seul — donc
dans un panneau à mi-hauteur, le disque à lui seul remplit ce qu'il y a.

L'ordre dans lequel les choses tombent est l'ordre inverse de ce qu'elles valent :

| | ce qui se passe | pourquoi |
|---|---|---|
| 1. le **disque** | rétréci, puis retiré sous 176 px | c'est le plus gros et le moins porteur : ce qu'il dit — où on en est, où sont les repères, que ça tourne — la forme d'onde le dit aussi, **et dit en plus ce qui arrive**. Sous 176 px c'est une pièce de monnaie : l'étiquette est illisible, les rayons de cue se confondent, et la rotation ne se voit plus. |
| 2. le **titre** | retiré sur les colonnes les plus courtes | l'étiquette du disque porte les mêmes mots tant qu'il y a un disque ; cette ligne ne gagne sa place que quand il n'y en a plus. |
| 3. les **repères** | jamais retirés | huit positions fixes qu'une main apprend ne valent rien si elles sont parfois absentes — le même argument que `CueButtons` fait déjà pour les dessiner sur une platine vide. |
| 4. la **forme d'onde** | jamais retirée, et elle GRANDIT | c'est ce à quoi sert une platine. |

### Et dessinée même à vide

La forme d'onde n'est **pas** conditionnée à `load`, malgré l'argument qu'une bande vide sous
une platine vide est du mobilier. C'est l'argument que les repères refusent déjà, et pour une
meilleure raison : un pupitre dont les contrôles apparaissent et disparaissent selon ce qui est
chargé est un pupitre qui bouge sous les mains. La bande pousserait les repères et le titre vers
le bas à l'instant où un morceau arrive, et l'endroit que l'œil a appris ne serait pas là pour
être appris. Vide dit « rien pour l'instant » ; absent dit « regarde ailleurs ».

C'est aussi là que se disent « analyse du morceau… » et une analyse ratée
([waveform.md](waveform.md)) — deux phrases illisibles sur une bande qui n'existe pas.

Le point 4 est le vrai contenu de « cacher les platines » : la forme d'onde **prend la place que
le disque a rendue**, jusqu'à 180 px. Sans cela le panneau serait une bande courte et beaucoup
de vide, ce qui serait pire que le disque.

Pourquoi un plafond à 180 : une forme d'onde se lit pour sa **forme** — où est le drop, où sont
les temps — et passé un certain point plus d'amplitude ne dit rien de neuf. Le reste de la place
sert à ce que les repères et le titre restent là où la main les attend.

## Le bloc de stems, qui ne coûte rien tant qu'il y a un disque

Les quatre potards de stems sont sur la **même ligne que le vinyle**, à sa gauche
([stems.md](stems.md)). C'est gratuit en hauteur, et le tableau ci-dessus explique pourquoi :
`stemStripHeight` vaut au plus 150 px au cran le plus large, quand le plus petit disque qu'on
dessine en fait 176. La ligne fait donc la taille du disque, et le budget est inchangé.

Ce n'est pas une coïncidence à laisser dormir : `deskLayout.test` vérifie
`stemStripHeight(s) <= VINYL_MIN` à chaque cran de l'échelle. Un potard dessiné plus grand ici, ou
une troisième rangée, casserait l'inégalité — et la casserait en silence, en agrandissant la ligne
jusqu'à pousser la forme d'onde hors d'une colonne dont personne ne revérifie la somme.

Quand le disque est tombé (étape 1 du tableau), le bloc n'a plus de voisin. Il prend alors une ligne
à lui et la forme d'onde la paye — elle grandit un peu moins que ce que le disque a libéré. C'est
le second argument de `deskLayout`, et il existe parce que la réponse dépend du SET : un pupitre qui
ne câble aucune coupe de stem ne doit pas réserver la place d'un bloc qu'il ne dessine jamais.

Un troisième test additionne tout le budget — forme d'onde, repères, titre, gaps, bloc — à chaque
hauteur qu'un panneau peut avoir, et exige que la somme tienne dans la colonne. C'est la seule
vérification qui attrape une erreur d'arithmétique ici sans avoir à regarder l'écran.

## Et la tranche de console, qui rétrécit sous peine de perdre son filtre

Une platine a **deux** colonnes : celle décrite ci-dessus, et la **tranche** — trois potards
d'EQ, un trait, puis le filtre (`ChannelStrip`). Elle demande **317 px** à taille pleine, et un
panneau à mi-hauteur sur une fenêtre de 768 donne à la rangée environ **206**.

Ses potards sont `justify-center` dans une boîte sans `overflow`. Un contenu plus haut que sa
boîte déborde donc **des deux côtés à parts égales** — et les deux choses aux extrémités sont le
potard du haut et **le filtre**. Une tranche qui ne rétrécirait pas donnerait donc ce
symptôme-là : pas un filtre coupé en deux, un filtre *disparu*, pendant que les trois bandes
d'EQ ont l'air d'aller bien.

Ici rien n'est **retiré**, contrairement au disque : trois bandes et un filtre, c'est ce qu'une
tranche EST, et une tranche sans aigus n'est pas une tranche plus petite. Elle rétrécit — par
paliers, parce qu'un potard est un objet dessiné et qu'interpoler entre 36 et 32 produirait un
33 que personne n'a choisi :

| rangée | potard | filtre | valeurs |
|---|---|---|---|
| ≥ 317 | 36 | 44 | oui |
| ≥ 285 | 32 | 40 | oui |
| ≥ 203 | 28 | 34 | non |
| ≥ 169 | 24 | 28 | non |
| sinon | 20 | 24 | non |

Ce qui part en premier, ce sont les **valeurs** sous les potards : le chiffre est un confort, le
potard est le contrôle. C'est cette ligne de texte qui paie le fait que le filtre reste à
l'écran — et ce qui rend l'échange acceptable, c'est que le potard porte un **arc** de midi à
l'aiguille dont la longueur est le réglage ([eq.md](eq.md)). La quantité reste lisible sans le
chiffre, et l'arc ne coûte aucune hauteur.

`stripHeight` écrit l'arithmétique noir sur blanc et un test la parcourt de 0 à 900 px : à
chaque hauteur, soit la tranche tient, soit c'est déjà la plus petite. Le `justify-center` sans
`overflow` n'est correct **que** grâce à cette garantie.

## Mesuré, pas transmis

`MixView` observe la **rangée des platines** avec un `ResizeObserver` et lit son `contentRect` —
donc sans le `p-4` du conteneur, ce qui fait que `deskLayout` reçoit exactement ce dont une
`DeckSide` dispose.

Mesurer plutôt que recevoir un booléen `compact` de st0, parce que st0 ne connaît pas ce nombre
non plus : la hauteur dépend de la fenêtre, du panneau des logs, des cartes d'erreur en haut du
pupitre, et de la présence d'un timeline. Un drapeau serait st0 qui devine.

`deskLayout` est **totale** : 0 (avant la première mesure), un négatif ou un pixel fractionnaire
répondent tous par une mise en page dessinable. La première image dessine donc un pupitre
lisible et la seconde le bon, sans qu'aucun `NaN` n'atteigne un attribut de style.

## Le mou tombe AU-DESSUS de la forme d'onde, pas en dessous

Le disque est **plafonné** à 352 px. Une colonne plus haute que ce que `deskLayout` dessine a donc
du mou, et il y en a beaucoup dès qu'on passe le pupitre en plein écran :

| hauteur de colonne | dessiné | mou |
|---|---|---|
| un panneau, moitié d'un 1080 | 470 | **0** |
| un panneau sur un grand écran | 548 | 152 |
| plein écran sur un 1080 | 548 | **452** |
| plein écran sur un 1440 | 548 | **812** |

Empilé par le haut, ce mou tombait **après le titre** : la forme d'onde, les repères et la boucle
remontaient vers le milieu de l'écran, loin du bord qu'une main cherche, et le bas de la colonne
était vide. C'est pour ça que le défaut ne se voyait pas en panneau (mou nul) et sautait aux yeux
en plein écran.

`DeckSide` met donc `mt-auto` sur le bloc **forme d'onde + repères + boucle + titre** : tout ce
qu'on TOUCHE est ancré au bas de la colonne, et le mou passe au-dessus.

Et le disque ne reste pas collé en haut de ce mou : la rangée qui le porte est `flex-1` plutôt que
`shrink-0`, donc elle prend tout ce que le bloc du bas laisse, et son propre `items-center` met le
disque au **milieu** de cette place. Les potards de stems sont dans la même rangée, à sa gauche
([stems.md](stems.md)), et suivent sans rien demander. Pas de `min-h-0` dessus : une rangée qui
peut rétrécir sous le disque qu'elle porte le ferait déborder, et `deskLayout` a justement calculé
qu'il tient.

L'inégalité que ça suppose est tenue par un test (`deskLayout.test`, « the slack a tall desk has ») :
la colonne ne dessine jamais **plus** que sa hauteur — sinon le bloc serait poussé hors du bas — et
en dessine strictement **moins** en plein écran, sinon l'ancrage ne servirait à rien.

### La colonne du milieu suit, et le crossfader tombe sur la forme d'onde

Le pupitre a trois colonnes, et deux d'entre elles viennent d'être ancrées en bas. La troisième
devait suivre, sinon le mou du plein écran tombait sous le crossfader pendant que les platines
l'avaient au-dessus.

Le crossfader ne visait pas la bonne ligne non plus. Il était poussé vers le bas par un bloc de
faders haut de `disque + forme d'onde + gap`, ce qui le posait sur **la rangée de repères**. Or ce
qu'il mélange, ce sont les deux bandes : sa place est celle de la **forme d'onde**.

Il est donc dessiné dans une boîte de la hauteur exacte de la forme d'onde, suivie — **sans gap** —
d'une rangée haute de `underWave(layout)`. Le bloc du milieu fait ainsi la même hauteur que le bloc
d'une platine, et les deux ancrés au même pied tombent sur la même ligne :

| hauteur | disque | forme d'onde | haut de la bande |
|---|---|---|---|
| 470 (panneau) | 274 | 80 | 286 — crossfader 286 |
| 700 | 352 | 80 | 516 — crossfader 516 |
| 1000 (plein écran) | 352 | 80 | 816 — crossfader 816 |
| 1360 | 352 | 80 | 1176 — crossfader 1176 |

`underWave` vit dans `deskLayout.ts` avec les quatre constantes qu'il additionne : une copie dans la
vue serait une copie qui se périme en silence. `deskLayout.test` (« where the crossfader lands »)
tient l'égalité à toutes les hauteurs, titre dessiné ou non — c'est tout ce qui garantit
l'alignement, puisque `MixerColumn` ne calcule aucun nombre de son côté.

#### Et sa LARGEUR : `self-stretch`, pas `w-full`

Le crossfader doit finir là où finit la forme d'onde d'à côté. Il déborde donc de sa colonne de
`CROSSFADE_BLEED` de chaque côté — le `gap-4` de la rangée, le `w-16` de la tranche, le `gap-2` de
la section — par deux marges négatives.

Ce qui donne sa largeur est **`self-stretch` dans un conteneur en colonne** : un élément étiré est
dimensionné au conteneur **moins** ses marges, donc deux marges de −88 le font 160 + 176 = 336, bord
à bord entre les deux bandes. `w-full` dans une rangée n'est **pas** la même chose : il vaut 100 %
tout court, soit 160, et les marges ne font alors que le décaler de 88 vers la gauche. Le pupitre a
passé une révision comme ça — la barre trop courte et posée de travers — et rien ne pouvait le dire.

Les trois nombres de `CROSSFADE_BLEED` sont une **copie** de classes écrites dans trois autres
fichiers, et une copie périmée ne casse rien : la barre s'arrête un peu avant, c'est tout.
`crossfadeReach.test` relit donc ces classes et refuse la somme si l'une d'elles a bougé.
