# Lier une surface au graphe

Une surface « mappée » — le pupitre DJ, la tranche de mastering — porte un `mapping:` dans son
fichier de `surfaces/`, keyé par CONTRÔLE :

```yaml
mapping:
  deckA.eqLow: { module: eqA, param: Low-shelf gain }
```

Transformer ça en « pose ce paramètre sur ce plugin » demande de répondre à trois questions, et
`bindings.ts` en tient **deux**. La troisième appartient à la surface, et c'est tout l'intérêt de
cette page.

| question | qui répond |
|---|---|
| ce module est-il dans les chaînes de ce projet ? | **ici** (`stepsByModule`) |
| quel widget dessine ce paramètre, et donc quelle est sa plage ? | **ici** (`widgetFor`) |
| comment convertir « où est le contrôle » en « que vaut le paramètre » ? | **la surface** |

## Pourquoi dans ce paquet

Parce que c'est la moitié **graphe** de la jointure, et que lire un graphe est le métier de ce
paquet. `widgetDenorm` — l'autre moitié, celle qui déploie un 0..1 dans la plage d'un widget —
est déjà dans `graph.ts`, à côté.

Les deux consommateurs en dépendent déjà, donc rien de nouveau n'entre dans un `package.json`.
Et le type d'entrée est **structurel** (`SurfaceMapping`) plutôt qu'importé de
`@studio/song-schema` : la FORME du fichier est validée là-bas, ce qu'elle veut dire contre un
graphe se décide ici, et ce paquet garde ses deux dépendances.

## Ce qui n'est PAS ici, et ne doit pas y venir

L'échelle. Et ce n'est pas un oubli — les deux surfaces sont en désaccord, délibérément :

- **le pupitre** normalise le contrôle dans sa propre plage puis laisse le widget la déployer
  (`valueFor` → `widgetDenorm`). Un fader de tempo n'a pas d'unité à lui : il est « quelque part
  entre les deux bouts du knob du module » ;
- **la tranche de mastering** refuse de normaliser. Ses nombres sont des dB, des Hz, des
  millisecondes, et l'intérêt est justement de pouvoir les lire contre un vumètre. Sa plage EST
  celle du widget, sans conversion.

Faire descendre l'une des deux ici rendrait l'autre fausse. Voir
[mastering.md](../../../apps/st0/frontend/docs/mastering.md) et
[controls.md](../../ui-turntables/docs/controls.md).

## La politique « sans plugin »

Le seul paramètre de comportement, et il vaut la peine d'être compris parce qu'il rate en
silence.

`buildGraphDoc` donne un `pluginId` à **chaque** étape d'une chaîne — y compris à celles dont le
compilateur n'émet aucun plugin, un module `offline` faisant littéralement
`if (rawType === OFFLINE_TYPE) continue`. Une étape peut donc porter une adresse que le moteur
ne connaît pas.

| politique | qui | ce qu'elle fait |
|---|---|---|
| `track` | le pupitre | une étape sans plugin se lie par la **piste** dont sa chaîne tire sa matière — c'est ainsi qu'un fader de tempo étire un clip |
| `refuse` | le mastering | une étape sans plugin est **refusée** : cette surface est l'image d'UN plugin chargé, donc un potard sans plugin ne ferait rien |

Les intervertir ne casse rien de visible : `set-plugin-param` part vers une adresse que le moteur
n'a pas, aucune erreur, aucun log, et le potard bouge sans que rien ne se passe. C'est pour ça que
c'est un type et non un booléen, et que le test le fige des deux côtés.

> À ne pas confondre avec `hasPlugin()`, qui pose une question voisine à un autre document : le
> graphe décrit ce qu'on DESSINE, le document compilé ce qui JOUE. Voir
> [controls.md](../../ui-turntables/docs/controls.md).

## Une ligne qui ne résout pas est DITE

Trois façons d'échouer, et les trois sont **rapportées** plutôt que jetées — un `mapping`
appartient à CE projet et nomme les nœuds de CE projet, donc une ligne qui ne résout pas est une
faute de frappe sur son propre fichier.

Le WIDGET manquant est le seul cas non fatal : sans lui il n'y a pas de plage, mais la cible
existe, et la déclarer cassée serait faux.

Un contrôle **nommé et non câblé** (`null`, ce dont un squelette de surface est fait) est sauté
**sans un mot**. `unmappedControls` le rapporte une fois, en portail au-dessus de toute la
surface. Le dire deux fois donnerait deux phrases pour une seule ligne à remplir.

Et les deux surfaces ne se nomment pas pareil dans « X n'est pas un contrôle … » — d'où le `noun`,
qui est la seule chose que l'appelant a à dire de lui-même.
