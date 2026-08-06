# Les trois vues de m9

m9 est **l8 sans la timeline**. Il s'ouvre sur un projet — un dossier `*.m9` dans un dépôt,
choisi depuis la section Projets de st0 — et montre une vue à la fois. L'arbre du projet reste
sur le côté, parce que c'est ce sur quoi on travaille et non le mobilier d'une vue.

| vue | ce qu'elle est |
|---|---|
| **Mix** | Le set : les morceaux que `songs.yaml` nomme, une platine, sa chaîne. Voir [setList.md](setList.md). |
| **Édition** | L'arbre et le fichier ouvert, en texte. Le même CodeMirror que l8 (`@studio/ui-editor`), la même complétion dérivée des schémas Zod, la même réponse de fourche à l'enregistrement. |
| **Graphe** | Les chaînes du projet compilé, dessinées par `@studio/ui-chains-react` — le même pipeline que l'onglet Chains de l8. |

## Pourquoi Mix est encore les platines

La question posée était « placeholder ou platines ». Un écran vide qui annonce ce qu'il fera
un jour n'apprend rien ; les platines, elles, marchent, et elles font déjà la chose que le vrai
mixage fera — envoyer un `ProjectDoc` au moteur et le laisser jouer. Elles restent donc en
place, et `deck.ts` est ce que le mixage du projet reprendra.

Ce qui a changé, c'est **ce qu'elles listent**. Mix était la seule vue qui ne parlait pas du
projet ouvert — elle montrait tout le cache de la médiathèque, et l'arbre disparaissait
parce qu'il montrait un projet que rien à l'écran ne concernait. Elle lit maintenant le
`songs.yaml` du projet, donc l'arbre reste sur toutes les vues. Ce qui n'a pas encore
changé : le document envoyé au moteur est celui de la platine, pas celui du set. Les deux
moitiés sont dans [setList.md](setList.md).

## Ce que m9 n'a pas, et ce n'est pas un oubli

- **Pas de timeline.** C'est la ligne qui sépare les deux applications.
- **Pas de barre de commandes.** La prop `command` du graphe est obligatoire — le paquet refuse
  de faire semblant — donc `GraphView` passe un stub qui le dit tout haut. Voir
  [chains.md](chains.md).
- **Pas de constructeur de modules.** Le catalogue s'édite dans la médiathèque, seul endroit
  éditable ; m9 lit les modules locaux du projet.
- **Pas de forme d'onde, pas de vidéo, pas d'export.** Ce sont les routes que l8 garde pour lui
  dans son propre client ; tout le reste passe par `@studio/project-shell`.

## L'adresse

`routes.ts` est la carte, `useViewRoute.ts` la boucle — mêmes deux fonctions pures et même
piège que dans l8 et st0 : deux effets passifs qui se répondent font un ping-pong si aucun des
deux ne sait dire « il n'y a rien à faire ». Les tests les font tourner **en séquence** ; un
test à une seule étape ne détecterait pas la boucle.

```
/mix                              la vue
/graph
/edit/tracks/bass.yaml            …et le fichier ouvert, projet-relatif
```

Le routeur est **hors** des portes (`main.tsx`), comme dans l8 : l'adresse nomme une vue du
projet, et les portes sont des conditions pour y arriver, pas des lieux. Un lien vers `/graph`
survit donc à la connexion et à la résolution du dépôt.

## Les trois portes

`AuthGate → moteur → ProjectShell`. La dernière est `@studio/project-shell` : elle résout le
dépôt que st0 a nommé en un dossier sur la machine du moteur, le clone si cette machine ne l'a
jamais vu (avec la progression de git), puis ouvre le projet. l8 monte exactement la même —
seuls les mots changent. Voir [packages/project-shell/docs/launch.md](../../../packages/project-shell/docs/launch.md).
