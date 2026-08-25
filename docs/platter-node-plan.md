# Plan — le plateau devient un nœud

Suite de [platter-plan.md](platter-plan.md), qui a mis l'étirement DANS le plateau et supprimé
l'hybride. Celui-ci s'attaque à ce que ce plan-là a laissé : **le plateau n'est déclaré nulle
part**. Il est injecté dans le document au moment de l'envoi.

## Où on en est

`grep studio_turntable` sur tout le dépôt ne touche que `packages/ui-turntables/src/deck.ts` et
ses tests. Aucun `nodes/*.yaml`, aucun module de la médiathèque, aucun fichier de projet.

Ce qui se passe réellement : `withDecks` prend le document que le compilateur a produit et lui
**ajoute des plugins** — un `platterPlugin` en tête de chaque piste de platine — puis lui **ajoute
une piste entière**, le métronome. Ce que le moteur joue n'est donc pas ce que le projet déclare.

Trois conséquences, dans l'ordre où elles gênent :

- **le graphe ne montre pas la source.** Sur la vue chaînes d'un set, le signal apparaît de nulle
  part : la première chose visible est le tempo, et ce qui fabrique le son n'est dessiné par rien ;
- **le censor est du code** ([fx.md](../packages/ui-turntables/docs/fx.md)). C'est pourtant
  `Rate = −1` sur un plugin — exactement la forme d'une liaison — mais on ne peut pas lier un
  paramètre d'un plugin que le projet ne déclare pas ;
- **`deckDoc` existe** : un deuxième jeu de pistes construit en code, qui diverge un peu plus à
  chaque fonctionnalité ajoutée (il n'a ni trim, ni niveau, ni écho, ni cue, ni stems).

## Ce qui est DÉJÀ prêt, et c'est la bonne surprise

J'ai commencé par chercher ce qu'il faudrait changer dans le moteur. **Rien.**

| | où | ce que ça donne |
|---|---|---|
| `PluginDoc.deckFile` | `packages/engine-protocol/project.ts` | déjà un champ de premier ordre, commenté « TURNTABLE modules only — the record the platter OWNS » |
| le chargement du disque | `engine/moteur/engine/EditBuilder.cpp` | `dynamic_cast<studio::TurntablePlugin*>` sur le plugin **quel qu'il soit** — générique, comme `namFile` et `irFile` juste au-dessus |
| nommer un built-in | `packages/song/src/nodeProject.ts` | `plugin: { type: internal, name: … }` est déjà la façon dont `eq3` nomme l'égaliseur de Tracktion |

Autrement dit le moteur ne demande pas d'où vient le plugin. Il en construit un depuis `p.type`,
et s'il se trouve que c'est un plateau, il lui pose son disque. Un plateau **compilé depuis un
module** suivrait exactement le même chemin qu'un plateau injecté.

Le protocole avait donc anticipé ce plan et personne ne l'a fini.

## Les trois inconnues sont MESURÉES

Elles l'ont été avant d'écrire une ligne du reste, et deux des trois ont changé le plan.
`engine/moteur/scripts/platter-node-probe.ts` rejoue les deux dernières contre un moteur qui
tourne ; la première se lit dans la source et ne demande rien.

### 1. `role: ""` — sans conséquence, et c'est LA SOURCE qui le dit

`deck.ts` pose `role: "instrument"` ; la branche générique de `nodeProject.ts` pose `role: ""`.

Réponse : le `role` d'un `PluginDoc` est **parsé et jamais lu**. Dans tout le moteur, la seule
lecture hors du SCAN de plugins (`PluginScan.cpp`, une autre structure) est `ParamDump.cpp:87`,
qui le réémet en JSON pour un diagnostic. `EditBuilder` ne branche jamais dessus, et il n'est pas
dans la clé d'identité de `ProjectDiff`.

C'est une réponse plus forte qu'un essai : elle vient de l'ensemble du code, pas d'un cas.
**Rien à faire.**

### 2. Un plateau sans disque — inoffensif, garanti par construction

`TurntablePlugin::applyToBuffer` vide le tampon **d'abord**, puis sort tout de suite si
`frames_ <= 0`. Un plateau sans disque est donc du silence, pas un bruit à découvrir sur scène.

Mesuré par-dessus, sur le moteur qui tourne : le document s'applique, **aucun avertissement,
aucune erreur**. Un plateau déclaré et vide est un état ordinaire.

**Rien à faire non plus.**

### 3. Le disque n'est pas un paramètre — et l'option (b) est REFUSÉE

Le seul vrai obstacle reste : un paramètre est un **nombre**, `deckFile` est un chemin, et il
change quand on pose un disque.

| | ce que c'est | verdict |
|---|---|---|
| **(a)** | `withDecks` ne pose plus QUE `deckFile` sur un plugin que le compilateur a émis | **retenue** |
| **(b)** | un message `set-plugin-file`, comme `set-plugin-param` | **refusée — mesurée** |
| **(c)** | `deckFile` devient un paramètre | impossible : un paramètre est un nombre |

J'avais écrit que (b) « supprime un renvoi de document complet par chargement », à mesurer avant
d'annoncer. Mesuré, sur ce moteur, `applied` faisant l'accusé de réception :

| | médiane sur 7 |
|---|---|
| renvoi IDENTIQUE, 1 piste (rien ne change) | 1,9 ms |
| renvoi identique, **16 pistes** | 1,1 ms |
| poser un AUTRE disque, 1 piste | 2,1 ms |
| poser un autre disque, **16 pistes** | 1,9 ms |

Deux choses, et la seconde est celle qui tranche :

- **le coût ne monte pas avec la taille du document.** Un set réel fait 16 pistes (`mymix` en fait
  exactement 16), et ça ne se voit pas. Le diff est bon marché ;
- **il reste donc environ 1 ms** à gagner. Contre les 85 ms que coûte réellement le geste
  (`platter-plan.md`, un disque simple), dominés par le décodage — que `set-plugin-file`
  n'enlèverait pas non plus, le disque étant chargé à l'insertion.

Un message de protocole et du C++ pour 1 % du geste : **non**. L'option (a) n'est pas une étape
vers (b), c'est la réponse.

> Le premier jet de cette mesure faisait varier les 21 plateaux d'un coup et annonçait 26,6 ms. Ça
> ne mesurait pas la taille du document mais le remplacement de 21 plugins — donc 21 décodages. La
> ligne « 16 pistes » ci-dessus ne fait bouger QU'UN disque, ce qui est la question posée.

## Ce que ça ne résout PAS, et il faut le dire

**Cinq plateaux par platine.** Un disque séparé joue par ses quatre parties, qui partagent une
position, un `Rate` et un `Key` ([stems.md](../packages/ui-turntables/docs/stems.md)). Ça fait
**dix nœuds** pour un set à deux platines, et surtout : un contrôle du pupitre pilote **au plus
un** paramètre, donc « les cinq plateaux de la platine A » n'est pas exprimable comme liaison.

`plattersOf()` — le code qui dérive les cinq identifiants — **reste**. Node-ifier le plateau rend
la source visible et le censor liable ; ça ne supprime pas la connaissance que la platine A est
cinq plateaux. Prétendre le contraire ferait échouer l'étape 3 à mi-chemin.

Le métronome reste aussi : c'est une piste entière construite en code, et c'est un autre plan.

## L'ordre

Les trois inconnues étant levées, il ne reste que du travail, et rien dans le moteur.

1. ~~**Le module.** `@st0/audio/io/turntable`.~~ **FAIT** — voir plus bas.
2. ~~**Le scaffold et la migration.**~~ **FAIT** — voir plus bas.
3. ~~**`withDecks` maigrit.**~~ **FAIT** — voir plus bas.
4. **Le censor devient une liaison.** Demande un ajout au vocabulaire : `MixControl.kind` vaut
   `"fader" | "button"` et un bouton **momentané** n'a pas de mot. Avec `"momentary"`,
   `deckA.censor: { module: platterA, param: Rate }` devient une ligne de `surfaces/desk.yaml`.

Les étapes 1 à 3 sont un lot ; 4 est indépendante et peut attendre. Il n'y a **pas** de cinquième
étape : `set-plugin-file` a été mesurée et refusée ci-dessus.

## Ce que ça efface

- `platterPlugin` et l'injection dans `withDecks`
- `PLATTER_TYPE` comme constante du pupitre
- `censor` comme code, si l'étape 4 se fait
- une raison de plus de garder `deckDoc` : une fois le plateau déclaré, le tenant-lieu ne
  ressemble même plus de loin à ce qui joue

## L'étape 1 est FAITE

`packages/dsp/modules/audio/io/turntable/` — `module.yaml` et `ui.yaml`, pas de jsdsp : le moteur
héberge déjà le plateau, et `type: internal` le nomme comme `eq3` nomme l'égaliseur.

Les plages viennent de `TurntablePlugin.cpp` et non d'une supposition :

| paramètre | plage | repos | |
|---|---|---|---|
| `Rate` | −4…4 | **0** | la vitesse, SIGNÉE. 0 est l'arrêt, pas un neutre : un plateau n'a pas de position neutre |
| `Seek` | 0…1 | 0 | où poser l'aiguille — un SAUT, appliqué quand la valeur CHANGE |
| `Gain` | 0…2 | 1 | |
| `Key` | 0…1 | 0 | tenir la hauteur ; éteint, parce qu'un plateau est un varispeed |

Vérifié de bout en bout — un set qui DÉCLARE son plateau, compilé, puis envoyé au moteur qui
tourne :

```
graph warnings: []
deckA chain steps: [ 'platterA', 'tempoA' ]
deckA:platterA  type=studio_turntable  role=""  params={"Rate":0,"Seek":0,"Gain":1,"Key":0}
=== envoyé au moteur ===  applied: yes   warnings: aucun   errors: aucun
```

Le plugin compilé est **celui que le pupitre injecte aujourd'hui**, au `role` près — dont on a
établi plus haut qu'il n'est jamais lu. Et `deckA` porte enfin deux étapes au lieu d'une : la
source est dans le graphe.

### Deux choses trouvées en chemin

**Le plateau est enregistré mais pas CATALOGUÉ.** `registerBuiltInPlugins` crée bien son type,
mais `builtInPlugins()` ne le liste pas — donc il est absent de `--dump-builtin-params`, absent de
`BUILTIN_PLUGINS`, et le sélecteur de plugins ne l'offre pas. Ça n'empêche rien ici, parce que
`enginePlugin` passe le nom d'un `internal` **tel quel** sans consulter le catalogue. Mais tant
qu'il n'y est pas, ses paramètres ne peuvent être ni proposés ni validés par le constructeur de
modules. Une ligne `e(…)` dans `PluginScan.cpp`, indépendante de ce plan.

**Un paramètre PEUT valoir un fichier**, et le mécanisme existe déjà : `bind: nam` +
`filepicker`, et `nodeProject.ts` transforme le `nam:` d'un module en `namFile`. Une ligne
analogue ferait un `deck:` → `deckFile`. **Ce n'est pas la bonne route pour une platine** : le
disque d'un deck est choisi en direct et ne doit délibérément pas être commité dans le projet
(`deckTrack` le dit). Le noter quand même, parce que la question « pourquoi pas un paramètre »
revient, et la réponse n'est pas « c'est impossible » mais « ce serait écrire le disque dans le
projet ».

## Comment rejouer les mesures

Un moteur qui tourne, puis :

```bash
npx tsx engine/moteur/scripts/platter-node-probe.ts   # [ws://127.0.0.1:8765]
```

Session à lui, `Rate: 0` partout : il ne fait aucun bruit et ne touche pas au projet chargé.
Mesuré le 25 août 2026, sur le moteur de cette machine.

## Ce qu'on saura tout de suite si ça a marché

La vue chaînes d'un set dessine la source. Aujourd'hui elle ne dessine rien avant le tempo ; c'est
le test à l'œil, et il ne demande aucun instrument.

## Les étapes 2 et 3 sont FAITES

**Le scaffold** écrit dix plateaux — un par lane qui joue un fichier, générés par
`platterNodeFiles` comme `stemNodeFiles` génère déjà les lanes et les coupes. Le graphe d'un deck
commence donc par sa source :

```yaml
  deckA: [ platterA ]
  platterA: [ tempoA ]
  stemBassA: [ platterBassA ]
  platterBassA: [ cutBassA ]
```

**`withDecks` n'invente plus rien.** `platterPlugin` a disparu ; `onPlatter` pose trois choses sur
un plugin que le COMPILATEUR a émis — le disque, et `Rate`/`Key`.

Ces deux-là sont là et non dans le fichier du nœud parce que ce sont des états VIVANTS : une
platine qui tourne doit tourner encore après le document suivant, et le fichier dit `Rate: 0`.
`Seek` reste absent, pour la raison inverse — un saut est un message, et un renvoi de document ne
doit pas reposer l'aiguille.

> Le plan disait « il ne pose plus QUE `deckFile` ». C'était faux, et ça s'est vu à l'écriture :
> sans `Rate`, chaque renvoi arrêterait la platine. Trois champs au lieu d'un, et zéro plugin
> inventé — ce qui était la question.

**Les identifiants ont changé**, et c'est ce qui rend la migration obligatoire :
`plattersOf` adresse `deckA:platterA` et `stemBassA:platterBassA` là où le pupitre injectait
`deckA:platter`. Un set non migré n'a rien à patcher : il joue le silence.

`PLATTER_TYPE` survit pour un seul usage — `deckDoc`, le tenant-lieu, qui ne déclare aucun nœud et
reste donc le dernier endroit du fichier qui fabrique un plugin.

### La migration

```bash
npx tsx packages/song/scripts/migrateSetPlatter.ts <projet.st0> --write
```

Sèche par défaut, idempotente, et son test tient un set migré **octet pour octet** à ce que le
scaffold écrit — le même contrat que `migrateSetCue` et `migrateSetStrip`.

**Publier `@st0/audio/io/turntable` dans la bibliothèque du compte AVANT de l'exécuter.** Sans le
module, les dix nœuds ne résolvent pas et le projet refuse de compiler : c'est exactement ce qui a
cassé `mymix` au lot précédent, et l'épilogue du script le dit maintenant.
