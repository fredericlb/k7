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

La forme d'onde a été un moment conditionnée à `load`, au motif qu'une bande vide sous une
platine vide est du mobilier. C'est l'argument que les repères refusent déjà, et pour une
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

## Et la tranche de console, qui a failli perdre son filtre

Une platine a **deux** colonnes : celle décrite ci-dessus, et la **tranche** — trois potards
d'EQ, un trait, puis le filtre (`ChannelStrip`). La tranche ne se réduisait pas. Elle demande
**317 px** à taille pleine, et un panneau à mi-hauteur sur une fenêtre de 768 donne à la rangée
environ **206**.

Ses potards sont `justify-center` dans une boîte sans `overflow`. Un contenu plus haut que sa
boîte déborde donc **des deux côtés à parts égales** — et les deux choses aux extrémités sont le
potard du haut et **le filtre**. D'où le symptôme : pas un filtre coupé en deux, un filtre
*disparu*, pendant que les trois bandes d'EQ avaient l'air d'aller bien.

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
