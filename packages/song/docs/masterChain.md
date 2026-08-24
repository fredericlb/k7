# `MIX` et `OUT` — les deux sorties, et la chaîne entre elles

> L'image a la même paire, `RENDER` et `VIDEO_OUT`, bâtie sur tout ce que dit cette page —
> avec **une** différence qui compte : elle est ajoutée toute seule.
> Voir [videoOutputs.md](videoOutputs.md).

Un graphe a **deux** sorties intégrées :

| nom | ce que c'est |
|---|---|
| `MIX` | la **somme du mixeur** — là où finit la chaîne de chaque piste. Ne porte aucun paramètre : un niveau appartient à ce qui **sort** |
| `OUT` | la **sortie réelle**, l'interface — et le seul nœud intégré qui porte un paramètre, `Volume`, le niveau de sortie du morceau ([masterVolume.md](masterVolume.md)). C'est ce dont le vumètre d'en-tête répond, et ce que son bouton Fix écrit |

```yaml
# graph.yaml
modules:
  gtr:      [ ampli ]
  ampli:    [ MIX ]        # la piste arrive à la somme, comme toutes les autres
  MIX:      [ compresseur ]  # …et voici la CHAÎNE MASTER
  compresseur: [ egaliseur ]
  egaliseur:   [ OUT ]       # qui repart vers l'interface
```

Le run entre les deux est la **chaîne master** : ses modules traitent le mix entier. C'est la
raison des deux noms — un `OUT` seul ne laisse nulle part où poser un traitement sur l'ensemble.

**Une chanson sans chaîne master ne coûte aucun son.** `masterPlugins` part vide, et `MIX` et
`OUT` sont un seul fil.

## Ce que ça n'est PAS (encore)

À écrire clairement, parce que la lecture naturelle des deux noms est plus forte que ce que le
code fait :

> **Router une piste sur `OUT` ne court-circuite pas la chaîne master.**

Dans Tracktion **toute** piste alimente le bus master, et la chaîne master est posée sur la liste
de plugins de ce bus. Une piste câblée sur `OUT` la traverse donc comme les autres. Les deux noms
sont aujourd'hui une **notation** — ce qui rend le run master exprimable — et non deux
destinations distinctes.

Un vrai contournement demanderait une piste routée hors du bus master (un output device séparé),
ce qui n'est pas fait. En attendant, `OUT` en fin de chaîne de piste veut dire la même chose que
`MIX`, et le script de migration ci-dessous les met d'accord.

## L'ordre sur le bus, et le prix qu'il coûte

```
pistes -> [ chaîne master ] -> masterVolume -> vumètre -> tap de diffusion -> interface
```

L'ordre suit le graphe : `MIX -> [ chaîne ] -> OUT`, et `masterVolume` est le paramètre `Volume`
que porte `OUT` ([masterVolume.md](masterVolume.md)). Tout ce qui vient après, c'est le moteur qui
regarde le signal qui **part** — ce qui est justement l'intérêt de le regarder.

- ces plugins **sont** le mix, et le niveau de sortie en est la dernière étape plutôt qu'une
  décision posée par-dessus ;
- le vumètre et le bouton Fix répondent donc du mix traité, sortie comprise — et c'est ce qui
  permet à Fix d'écrire `OUT` et de voir le témoin d'écrêtage s'éteindre à la passe suivante ;
- un auditeur du flux entend ce que la pièce entend, niveau de sortie inclus.

**Le prix, énoncé plutôt que caché :** un limiteur posé là est en amont du vumètre, donc le témoin
d'écrêtage cesse de voir la somme brute qu'il existe pour attraper. Fix continue de fonctionner —
il baisse la sortie, qui est en aval du limiteur — mais il n'a plus grand-chose à attraper, et
c'est à savoir avant de poser un limiteur.

## Modifier la chaîne master ARRÊTE la lecture

`diff()` compare `masterPlugins` **en bloc** et toute différence force une reconstruction
complète — donc la lecture s'arrête, le temps de rebâtir l'Edit.

Volontairement plus grossier que le diff des plugins d'une piste, qui ajoute et retire en place
justement pour ne pas couper le son. Deux raisons : la liste master n'est pas sur le chemin
incrémental (celui-ci parcourt les *pistes*), et surtout régler le bus de mix est une décision
qu'on prend entre deux passes, là où tripoter la chaîne d'une piste est exactement le contraire.

L'**ordre** fait partie de la comparaison : intervertir le compresseur et l'égaliseur laisse les
deux clés présentes et change le son, donc une comparaison non ordonnée aurait conclu « rien n'a
bougé ».

## `MIX: [ OUT ]` — la ligne que porte tout projet

Tout projet écrit par un gabarit déclare le trajet, **vide** :

```yaml
modules:
  melody: [ synth-melody ]
  synth-melody: [ MIX ]
  MIX: [ OUT ]          # la chaîne master : sa place, sans rien dessus
```

Elle ne coûte **aucun son** — `masterPlugins` reste vide et le document compilé est exactement
celui d'un projet qui ne la porte pas, ce que `masterChain.test.ts` épingle. Ce qu'elle apporte est
ailleurs :

- le graphe a une **carte `OUT`** à dessiner, et c'est le nœud qui porte le niveau de sortie
  ([masterVolume.md](masterVolume.md)) — sans le trajet, rien n'atteint `OUT` et la carte n'existe
  pas ;
- il y a un **endroit où déposer un module master**, écrit d'avance, plutôt qu'une ligne à deviner.

C'est un endroit au sens propre : le `+` du graphe est offert **sur ce fil-là**, entre les deux
cartes intégrées (`insertFor`, `packages/ui-chains/docs/graphBuild.md`), et le clic écrit
`node insert MIX OUT <nœud>`. Un projet qui ne porte pas la ligne voit le fil quand même —
le graphe le dessine dès que quelque chose atteint la somme — et le verbe l'écrit alors avant
d'y insérer, pour que le `+` tienne sa promesse d'une seule commande.

Les quatre gabarits l'écrivent (`scaffold.ts`, `scaffoldSet.ts`, `scaffoldBench.ts`, et
`chainToBench` pour une chaîne ouverte sur le banc — qui la retire au retour, puisqu'elle est le
mobilier du PROJET et non de la chaîne éditée).

Un détail que `validate()` doit porter : `from: MIX` est accepté. La somme n'est ni une piste ni
une chaîne, c'est là où toutes arrivent, et la refuser fait avertir **tous** les projets à la
fois, au sujet de la seule ligne qui est toujours juste.

## Migrer une chanson où `OUT` veut dire « la somme »

`OUT` nomme l'interface ; un fichier peut le nommer là où il veut dire la somme. Le script fait
les deux pas — réécrire les destinations, puis ajouter le trajet s'il manque :

```bash
npx tsx packages/song/scripts/migrateMixOut.ts <projet.st0>   # ou un dossier de projets
npx tsx packages/song/scripts/migrateMixOut.ts <projet.st0> --dry
```

Les deux pas sont **indépendants** : un projet qui nomme déjà `MIX` passe le premier garde et
reçoit quand même le second. Relancer le script sur un projet déjà à jour ne fait rien.

Il réécrit **le texte** et non le YAML relu-réémis, pour la raison habituelle ici : un `graph.yaml`
est commenté et édité à la main, et le re-sérialiser reformaterait tout le fichier pour changer un
mot.

Comme les deux noms sont aujourd'hui équivalents en fin de chaîne de piste (voir plus haut), cette
migration ne change **aucun son**. Elle remet le fichier d'accord avec ce que les mots veulent
dire, avant qu'une vraie distinction n'existe.

## Les couches traversées

| | |
|---|---|
| écrit | `graph.yaml` — un run de `MIX` vers `OUT` |
| dérivé | `chainsGraph.ts` : `MIX` démarre un run, comme `@in` et comme une piste |
| compilé | `nodeProject.ts` : ce run a pour propriétaire `@master`, et ses étapes deviennent `masterPlugins` |
| le fil | `@studio/engine-protocol`'s `ProjectDoc.masterPlugins` — toujours envoyé, vide par défaut |
| décodé | `docFromJson` dans `engine/moteur/server/main.cpp` (via `pluginFromJson`, partagé avec les pistes) |
| posé | `populateMasterChain` dans `EditBuilder.cpp`, en tête de la liste master — suivi du gain de sortie |
| dessiné | les cartes `MIX` et `OUT` du graphe (`MAIN_OUT_UI` dans `@studio/ui-chains`), la seconde avec son fader |
| diffé | `ChangeKind::MasterChainChanged` — reconstruction complète |
| mesuré | `engine/moteur/scripts/master-chain.ts` |

Une nuance côté dessin, et une seule : **le graphe ne trace aucun câble VERS `MIX`**. Toutes les
pistes y arrivent — c'est ce qu'est le mixeur — donc ces flèches ne diraient rien que la forme ne
dise déjà, une par piste, à travers toute l'image. Seul le run qui en PART est dessiné,
`MIX → [ chaîne master ] → OUT`, indépendant du reste. Le routage ne bouge pas pour autant : le
moteur lit le document compilé, où chacune de ces pistes arrive toujours à la somme. Voir
`packages/ui-chains/docs/graphBuild.md`.

Ce qui a un prix, et un seul : l'**ondulation** du câble vivant se propage vers l'avant depuis les
pistes que le moteur mesure, donc un nœud où rien n'arrive est un nœud qu'elle n'atteint jamais —
le run master, le câble qui porte toute la chanson, serait le seul immobile pendant la lecture.
`computeLive` amorce donc la marche à `MIX` aussi, dès qu'une piste est mesurée : ce n'est pas une
approximation, puisque **toute** piste alimente le bus master quoi que nomme sa chaîne.

## Le vérifier

Les suites TypeScript prouvent le document, la suite C++ prouve le diff, et **ni l'une ni l'autre
ne prouve que le plugin a atterri sur le bus**. C'est ce que mesure le harnais :

```bash
npx tsx engine/moteur/scripts/master-chain.ts
```

Il rend deux fois la même note en ne changeant que `masterPlugins`, et compare les crêtes. Avec un
`volume` à 0 sur le master : −7,5 dBFS sans la chaîne, −100 dBFS avec.

Un piège qui vaut pour tout module : le paramètre s'appelle **`Volume`**, avec la majuscule que le
plugin publie (`builtinParams.generated.ts`). Une clé en minuscules ne correspond à rien, ne
déclenche aucune erreur, et le rendu sort **identique** — donc rien ne dit que la casse est fausse.
