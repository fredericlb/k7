# Le disque se prend à la main

Attraper le vinyle et le tourner : le disque suit le doigt, l'audio suit le disque, et la marche
arrière n'est qu'un signe. C'est ce pour quoi le plateau existe.

## Ce qu'une main donne, c'est une VITESSE

Pas une position. Un DJ ne dit pas « va à 1:42 », il pousse ou retient. Le geste mesure donc l'angle
du pointeur autour du centre et en tire une vitesse angulaire, convertie en débit par la seule
constante qui compte : **un tour vaut `TURN_SECONDS` de disque à vitesse 1**. Un tour par seconde EST
donc un débit de 1,8.

Deux détails que la géométrie punit :

- **Le passage par π.** Sans `shortest`, chaque fois que le pointeur croise l'axe, la différence
  d'angle saute de 2π et le disque part à fond dans le mauvais sens.
- **La borne.** ±4, celle du plugin. Au-delà ce n'est plus une hauteur, c'est du bruit.

## Le disque suit le DOIGT, pas la vitesse intégrée

Tant que la main tient, le dessin est posé sur l'angle du pointeur — pas sur la vitesse lissée qui
anime le disque le reste du temps. C'est la différence entre une manipulation directe et une
animation qui essaie de rattraper : un disque tenu ne coasted pas, il est là où la main est.

`held` porte cet état, et remet la rotation sur son intégration au relâchement.

## Relâcher rend la main, il n'arrête pas

`onScratch(null)` — et `null` n'est pas `0`. Zéro serait « arrête-toi », ce qui n'est pas ce que fait
une main qui lâche : elle rend le disque à ce qu'il faisait. Le pupitre renvoie donc le débit que le
DOCUMENT aurait envoyé, `platterRate(tempo, running)` — la vitesse de lecture si la platine tourne, 0
si elle est à l'arrêt.

## La main l'emporte sur KEY

Une platine en keylock se scratche, et le disque **change de hauteur** pendant qu'on le tient. Ce
n'est pas une concession : c'est le son du geste, et aucune platine ne fait autrement.

Le plateau porte un paramètre `Key`, et le pupitre l'éteint tant qu'une main tient le disque, le
rallume quand elle lâche. Une seule règle, `platterKey(tempo, holding)`, écrite une fois et lue par
le DOCUMENT comme par le geste — un document étant, par définition, ce que la platine fait quand
personne n'y touche.

Deux détails qui portent :

- **Deux messages par geste, pas soixante par seconde.** `scratching` retient qui est tenu, donc
  `Key` ne part qu'aux deux bascules. Un paramètre est un niveau, le renvoyer ne coûterait rien de
  faux, mais soixante messages inutiles par seconde en coûteraient.
- **L'étireur ne va pas en arrière**, et c'est justement la moitié d'un scratch. Le moteur retombe
  de lui-même sur le rééchantillonnage hors de sa plage (`engine/moteur/docs/turntable.md`), donc la
  règle du pupitre et celle du plugin disent la même chose par deux chemins.

## Le débit vers le moteur est étranglé

Un `pointermove` par mouvement de souris, c'est 500 à 1000 par seconde sur une souris moderne, et
chacun envoyait un `set-plugin-param` : une trame WebSocket, un parse JSON et un `post` sur le
thread message du moteur, pendant qu'un rappel ASIO doit être servi toutes les quelques
millisecondes. `scratchDelay` ramène ça à un envoi toutes les 16 ms, soit une seizaine sur mille.

Trois propriétés, et chacune a sa raison :

- **Le premier mouvement passe tout de suite.** Un geste qui démarre une trame en retard s'entend
  comme un disque collé.
- **Ce qui arrive trop tôt attend le RESTE de l'intervalle**, pas une durée fixe, et c'est la
  valeur la plus récente qui part — la main garde sa cadence au lieu de dériver d'une trame par
  mouvement, et sa dernière position gagne.
- **Le relâchement ne passe jamais par la file.** Retardé d'une seule trame, il continuerait de
  scratcher après que la main a quitté le disque. Il vide aussi ce qui attendait, sinon une valeur
  périmée repartirait juste après.

16 ms est loin sous ce qu'une souris produit et loin au-dessus de ce qu'une oreille distingue sur un
geste de la main. Le fader de BPM à côté est étranglé dix fois plus (120 ms), mais sa cadence date
du temps où un pas reconstruisait un clip et n'a pas été remesurée depuis ([bpm.md](bpm.md)).

**Pourquoi ça compte au-delà du confort.** Deux écrans bleus `KMODE_EXCEPTION_NOT_HANDLED` ont eu
lieu sur cette machine avec `st0-engine` comme processus courant et un point d'arrêt à
`FocusriteUsb.sys+0x1ECAD` / `+0x1ED6D` — le pilote atteignant sa propre assertion. Le scratch
n'existait pas lors du premier, donc **ce n'était pas la cause** ; mais noyer le thread message
pendant qu'ASIO attend est exactement le genre de charge qui rend ce genre de défaut plus probable,
et ce débit-là ne servait à personne.

## Ce qui l'offre, et ce qui ne l'offre pas

Le geste est **absent** — pas inerte — sur une platine qui n'a pas de plateau :

| | scratchable ? |
|---|---|
| un disque dessus, KEY allumé ou éteint, séparé ou non | oui |
| platine vide | non |

Un disque **séparé** se scratche comme les autres : ses quatre parties sont quatre plateaux qui
partagent une position, et `plattersOf` les nomme toutes. La main les entraîne ensemble.

Les sillons prennent la main ; **l'étiquette garde son clic**, étant un élément à part au-dessus.
Choisir un morceau et scratcher ne se disputent donc pas le même pixel.

### Le disque n'a plus de raison de refuser

Il y en a eu deux, tour à tour portées par le `<title>` du disque : « KEY est allumé » et « ce disque
est séparé ». **Les deux ont disparu**, et `scratchRefusal` avec elles. Ce qui reste est une platine
vide, qui n'a pas de disque à expliquer.

Ça valait la peine de l'écrire quand même : la phrase venait d'une vraie panne, où tirer un disque
séparé ne faisait rien et où rien ne disait pourquoi. Le comportement était juste, le silence ne
l'était pas — et la bonne réponse s'est avérée être de supprimer le refus, pas de mieux le formuler.

## Ce que ça vaut, mesuré

Le chemin par CLIP a été essayé le premier et refusé sur mesure (voir plus bas). Le plateau a été
mesuré ensuite avec un banc bâti pour lui — un ton constant est un tachymètre exact sous un
varispeed :

| | erreur RMS sur le débit |
|---|---|
| plancher du banc | 0,000 × |
| geste lent | 0,029 × |
| geste rapide (±2, deux fois par seconde) | 0,188 × |

L'erreur **baisse quand on ralentit le geste**, ce qui est la signature de la fenêtre d'analyse et non
d'une limite du mécanisme. Le clip faisait l'inverse. Les chiffres et la méthode sont dans
`engine/moteur/docs/turntable.md`.

Et le délai entre la main et l'audio est **une frontière de bloc, rien de plus** : médiane 2,2 ms
pour un bloc de 5,3, avec une étendue d'exactement un bloc — la forme qui dit que ni le socket, ni la
file du moteur, ni le glissement n'ajoutent quoi que ce soit. `turntable-latency.ts`, et le détail
dans `engine/moteur/docs/turntable.md`.

**Ce qui reste non vérifié, c'est l'écoute.** Que l'audio soit là où la main l'a mise est mesuré ; que
ça sonne comme un scratch ne l'est pas et ne peut pas l'être ici.

## Le chemin qu'on a mesuré et abandonné

Ceci est le dossier du mécanisme précédent. Il n'existe plus — sa page, son code et son banc ont été
supprimés à l'étape 4 de `docs/platter-plan.md` — mais c'est lui qui a payé le plateau, et un
chiffre qui a coûté une décision mérite de survivre à ce qu'il a refusé.

Une platine était un **clip** sur la timeline, et la déplacer voulait dire changer le début de ce
clip. Le moteur répond à un clip déplacé en le **ré-insérant** — « tout ce qu'un clip porte est
appliqué à l'insertion » (`engine/moteur/docs/engineHost.md`) — donc un geste continu payait un
redémarrage d'étireur par pas. Mesuré sur un fichier dont la fréquence encodait sa propre position,
en relisant le ton sur le tap de diffusion :

| ce qu'on mesurait | erreur RMS | pire écart |
|---|---|---|
| aucun déplacement — le plancher du banc | **65 ms** | 73 ms |
| UN déplacement | **57 ms** | 65 ms |
| un pas toutes les 120 ms | 164 ms | 407 ms |
| un pas toutes les 16 ms | 174 ms | 447 ms |

Deux lectures, en sens contraire. **Un déplacement unique tombait sous le plancher du banc** : les
repères et le needle-drop reposaient sur un primitif exact. **Un geste continu ne suivait pas** :
164 ms, c'est un tiers de temps à 128 BPM ; 447 ms, un temps entier. Et la course *entendue*
dépassait la course *demandée* de 60 % à 16 ms — envoyer plus vite empirait le résultat, ce qui est
la signature d'une ré-insertion qui coûte plus cher que l'intervalle.

D'où la conclusion de l'époque, écrite noir sur blanc : **pas de scratch**, parce que ce qui
sortirait serait un hachis. Ce qu'elle n'établissait pas, et qu'elle disait déjà, c'est qu'aucun
mécanisme ne le permettrait — il fallait déplacer la tête de lecture *dans* le moteur. C'est
exactement ce qu'est devenu `TurntablePlugin`, et les chiffres du haut de cette section sont la
réponse.
