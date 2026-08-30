# Ce que la médiathèque sait compléter

Un seul écran de pl8 montre du YAML — le sidecar d'un morceau, dans `SongEditor` — et il utilise
le `YamlPane` de `@studio/ui-module-builder`. Il ne complète **rien**. Le mécanisme de complétion
lui-même est décrit dans
[packages/ui-editor/docs/completion.md](../../../packages/ui-editor/docs/completion.md) ; ce qui
suit est l'autre moitié, **d'où viendraient les noms ici**, parce que la réponse n'est pas celle
de st0 et qu'elle ne peut pas l'être.

## Le problème de fond : ce backend n'a pas de disque de moteur

st0 remplit ses `Hints` depuis la machine où tourne son backend : les modules du projet, les
pistes, et le cache de scan (`<state>/exts.json`) que le moteur écrit à côté de lui.

La médiathèque est **hébergée**. Son backend sert un volume de fichiers ; il n'a jamais vu de
scan de greffons, et il ne verra jamais celui de la machine devant laquelle vous êtes. Un
`hints()` calculé ici rend un objet vide, et un panneau qui s'en nourrit ne complète rien.

Un vocabulaire utile devrait donc être demandé ailleurs, et l'endroit dépend du mot :

| ce qu'on écrit | vocabulaire | qui seul peut répondre |
|---|---|---|
| un ref `@engine/…` | les greffons scannés | le **moteur**, par son socket |
| un ref `@st0/…` | les modules de la bibliothèque | le **catalogue**, par une route de listing |
| une destination dans un graphe | les nœuds déclarés | **le fichier lui-même**, dans le tampon |

La troisième ligne est celle qui vaut d'être retenue, parce qu'elle ne coûte rien : les clés de
la section `modules:` **sont** la liste des nœuds, donc le vocabulaire se lit dans le texte à
l'écran et ne se demande à personne. Un vocabulaire qui rend `null` quand le texte ne parse pas
doit alors laisser l'écran garder le dernier jeu lisible — une liste qui se viderait à chaque
frappe n'offrirait rien précisément pendant qu'on écrit la ligne qui en a besoin.

## Le motif qui marche ici

Un écran qui tient **déjà** une liste pour autre chose est le mieux placé pour en faire un
vocabulaire, et n'a besoin de rien demander à personne. C'est ce que fait l'éditeur de playlists
de st0, sur le listing qu'il interroge déjà pour résoudre ses lignes
(`apps/st0/frontend/docs/playlists.md`) — et c'est **ce catalogue-ci** qui lui répond, par
`/api/mediatek/list?family=songs`, à travers l'origine.

## Ce qui n'est pas couvert

**Le sidecar d'un morceau** (`SongEditor`). Ses champs ne sont pas un `FileKind` de projet, donc
`fileKindFor` rend `null` et rien ne se complète. Ce serait un vocabulaire de plus, sur le modèle
ci-dessus — et c'est le seul écran YAML d'ici, donc le seul candidat.
