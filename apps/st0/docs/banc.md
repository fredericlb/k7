# Le banc d'essai — un projet l8 dont les modules SONT le catalogue

Un module est un greffon. Ce qu'il fait ne se lit pas dans son fichier : ça s'entend. Et les
noms de ses paramètres, leurs bornes et ses presets d'usine n'existent que dans un greffon
**chargé**, c'est-à-dire dans un projet.

Le banc est ce projet. Un bouton dans Projets, une adresse — `/l8/@banc/modules.l8` — et l8
s'ouvre sur un morceau vide dont le dossier `modules/` est le catalogue de la médiathèque.

## Ce qu'on y fait

Une piste, une tranche, une sortie. Le reste est à câbler, et c'est l'exercice :

```yaml
# chains.yaml
modules:
  banc: [ amps/neural-amp-modeler ]
  amps/neural-amp-modeler: [ mixer ]
  mixer: [ OUT ]
```

Le nom est le chemin du module **sous son dossier de type** : `tape-delay` pour
`modules/audio/tape-delay/`, `amps/neural-amp-modeler` pour
`modules/audio/amps/neural-amp-modeler/`, qui est rangé d'un cran plus loin. La médiathèque
range son catalogue comme ça, et le banc en est le miroir.

> Ce niveau de rangement était supporté par les bibliothèques partagées (`readModuleTree`) et
> **pas** par le `modules/` propre à un projet (`loadModules`), qui sautait en silence un dossier
> sans `module.yaml`. Un module rangé n'était donc pas une erreur : il n'était simplement pas là,
> et chaque symptôme parlait d'autre chose — une chaîne nommant un module « que ce projet n'a
> pas », un 400 de `/module-ui` sur un fichier bien visible dans l'arbre. Les deux marcheurs
> s'accordent depuis (`packages/song/src/filedModules.test.ts`).

Pas d'instance à créer : une instance sert à avoir deux exemplaires d'un module réglés
différemment, et un banc n'en a pas besoin — d'ailleurs il ne pourrait pas, un nom d'instance
ne pouvant pas être celui d'un module du projet, et ici tous les modules du catalogue en sont.

Pour entendre autre chose que du silence, il faut une source : un clip déposé sur la piste, ou
une entrée live — un dossier `modules/io/guitare/` avec `io: in`, `channel: [1]` et
`monitor: "on"`, que la chaîne place **avant** le module qu'on essaie. Le fichier
`modules/io/OUT/module.yaml` du banc porte le modèle en commentaire.

Une fois le module câblé, ouvrir le constructeur dessus donne les vrais paramètres du greffon,
ses banques d'usine, et des potards qui bougent le son qu'on entend
([apps/l8/frontend/docs/moduleBuilder.md](../../l8/frontend/docs/moduleBuilder.md)).

## Le seul projet qui écrit dans la médiathèque

Partout ailleurs, enregistrer un module partagé le **duplique** dans le projet et rebranche les
chaînes sur la copie (`packages/song/docs/moduleFork.md`). C'est la bonne règle : un morceau qui
modifierait un module du catalogue changerait le son de tous les autres morceaux qui s'en
servent, sans que personne l'ait demandé.

Le banc est l'exception, et il l'est parce qu'il n'est **que** ça. On ne l'ouvre pas pour faire
un morceau ; on l'ouvre pour travailler sur le catalogue. Y forker une copie serait écrire dans
un dossier qui est régénéré à l'ouverture suivante, c'est-à-dire jeter le travail en silence.

Alors une sauvegarde dans `modules/` du banc fait deux choses : elle écrit le fichier sur la
machine, puis elle le **pousse** vers la médiathèque hébergée (`remoteWriter`, dans
`@studio/mediatek/remote`). Dans cet ordre, et la seconde peut échouer sans faire échouer la
première : les octets sont sur la machine de toute façon, et une bibliothèque hébergée en panne
doit coûter la synchronisation, pas le travail.

Ce que ça change de posture, dit franchement : **le service de fichiers devient un écrivain du
catalogue**. C'est le même genre de décision que celle qui interdit à st0 d'écrire dans les
dépôts git ([projects.md](projects.md), « Pourquoi st0 ne peut pas »), tranchée dans l'autre
sens — parce que le catalogue est déjà le seul endroit modifiable du studio, et que la seule
chose qui manquait était de pouvoir le modifier depuis un endroit où on l'entend.

Le marqueur qui autorise ça est un champ de `project.yaml`, `mediatekBench: true`, écrit par le
générateur et par personne d'autre. Il est dans le schéma (`ProjectSettingsSchema` est
`.strict()`), donc un projet qui le porterait à la main s'ouvrirait aussi — c'est une clé
réservée par convention, exactement comme le nom d'espace de travail `Banc`.

## Comment il est fabriqué

À chaque ouverture, et c'est voulu :

1. **une synchronisation complète de la famille `modules`.** `mediatekPull` ne récupère que ce
   que les projets OUVERTS nomment ([mediatekPull.md](../../../packages/file-service/docs/mediatekPull.md)),
   et le banc ne nomme rien — sans cette passe il refléterait ce qui traînait dans le cache pour
   d'autres morceaux. C'est l'attente visible de la première ouverture ;
2. **l'échafaudage**, la première fois seulement (`@studio/song/scaffoldBench`) ;
3. **le miroir** : `modules/` est vidé puis reconstruit depuis le cache. Les définitions
   (`*.yaml`, `*.ts`, `*.vstpreset`) sont **copiées**, parce que ce sont elles qu'on écrit — un
   lien dur qu'on modifie modifierait le cache sur place, et le cache est écrasé à la
   synchronisation suivante. Tout le reste — impulsions, profils NAM, échantillons — est **lié en
   dur** quand le système de fichiers le permet, copié sinon : ce sont les gros fichiers, rien ne
   les édite, et en dupliquer les octets à chaque ouverture serait la seule chose qui rendrait ce
   banc cher.

Un module supprimé du catalogue disparaît donc du banc. C'est le but : un module périmé y
résoudrait encore, compilerait encore et jouerait encore, ce qui est la manière de passer une
heure à déboguer quelque chose qui n'existe plus.

Ce qui **survit** à la régénération est ce qui est à vous : `chains.yaml` et `instances/`.
C'est-à-dire exactement ce que vous câblez — la piste du banc est une instance elle aussi
(`packages/song/docs/trackModules.md`).

## Ouvrir une CHAÎNE dessus

Même banc, même bouton, autre chose dessus. Depuis l'écran d'une chaîne de la médiathèque,
« Ouvrir sur le banc » mène à `/l8/@banc/chains/<chemin>.l8` — le chemin du catalogue, avec
`.l8` au bout. C'est toute l'adresse : elle porte la chaîne, la machine la relit, et aucun des
deux bouts ne tient de table de correspondance qui pourrait dériver de l'autre
(`benchChainPath`, dans `@studio/web-protocol/projects`).

L'argument est celui du module. Une chaîne est un routage qu'on **entend** ; l'éditer contre
rien, c'est faire la moitié du travail. Sur le banc elle a les modules du catalogue à portée,
une piste où poser de la matière, et un vrai moteur derrière.

### La traduction des bords

Une chaîne partagée va de `@in` à `@out` : elle décrit un traitement et ne dit rien de ce qui le
traverse. Un projet l8 n'a ni l'un ni l'autre — il a une piste, une tranche, une sortie. Les
deux fichiers ont sinon exactement la même forme, donc l'ouverture ne **convertit** rien : elle
renomme les deux bords, et la sauvegarde les renomme dans l'autre sens.

| dans la médiathèque | sur le banc |
|---|---|
| `"@in": [ … ]` sous `modules:` | `banc: [ … ]` — la piste |
| une destination `"@out"` | `mixer`, puis `mixer: [ OUT ]` |

Les deux sens vivent dans un seul fichier, `packages/song/src/benchChain.ts`, sous un même jeu
de tests d'aller-retour : séparés ils dériveraient, et une dérive ici veut dire une chaîne
partagée qu'on a silencieusement réécrite. `packages/file-service/src/benchChainProject.test.ts`
refait le tour complet par le disque, parce que c'est le seul chemin du service qui écrit dans un
catalogue **partagé**.

La tranche n'est ajoutée que si quelque chose l'atteint : une chaîne `@in → @out` ne repart donc
pas avec un meuble qu'elle n'a jamais traversé. Et le bloc de commentaires du haut est préservé à
part — `formatChains` réémet un document canonique, ce qui rend l'aller-retour démontrable et
mangerait tous les commentaires ; or celui du haut porte ce que la chaîne EST.

### Ce qui est refusé

Une chaîne qui a déjà un nœud appelé `mixer`, `OUT` ou `banc` ne s'ouvre pas, et le message le
dit. La sauvegarde retirerait la tranche du banc et emporterait le module de la chaîne avec
elle ; renommer d'office changerait la chaîne qu'on est venu éditer. Le portail l'affiche comme
un projet introuvable — la phrase du service est toute l'explication.

### Ce qui revient, et ce qui reste

`chains.yaml` (retraduit) et `instances/` repartent vers `chains/<chemin>/` de la médiathèque.
Le reste — `project.yaml`, le miroir `modules/`, et la piste du banc — est le meuble du banc et
n'a rien à faire dans une chaîne que d'autres projets chargent. La piste est dans `instances/`
comme les autres, donc ce qui la retient ici est son NOM (`BENCH_EDGES.track`) et rien d'autre.

Contrairement à un module, l'écriture touche AUSSI le cache local et pas seulement la
bibliothèque hébergée. Le banc réécrit `chains.yaml` depuis le cache à chaque ouverture : sur une
machine sans bibliothèque hébergée — là où le cache EST la bibliothèque — une sauvegarde
seulement poussée serait jetée par l'ouverture suivante.

> Au passage : `write()` recollait le projet actif, **déjà absolu**, sur la racine de l'espace de
> travail. `<racine>/<racine>/<projet>` n'est sous aucune écriture, donc la remontée d'un module
> vers le catalogue ne se déclenchait jamais. Corrigé, et tenu par un test.

### À vérifier dans un navigateur

- ouvrir une chaîne de la médiathèque sur le banc → le graphe montre la piste, le module, la
  tranche, la sortie ;
- insérer un module, sauvegarder, revenir dans st0 → la chaîne montre le module, entre `@in` et
  `@out`, et son en-tête est intact ;
- rouvrir le banc sur la même chaîne → ce qu'on a câblé est là ;
- ouvrir une chaîne qui nomme un `mixer` → refus lisible, et rien de créé.

## Ce qu'il n'est pas

- **Pas un dépôt git.** Il n'a pas d'URI, il ne se clone pas, il ne se pousse pas. Le mettre
  sous gestion de version reviendrait à versionner un cache. C'est pour ça que l'adresse porte
  un nom de dépôt **réservé**, `@banc` : `@` ne peut pas commencer un nom court de dépôt git, donc
  la collision est impossible, et le portail de `@studio/project-shell` prend une autre route en
  le voyant — pas de résolution de nom chez st0, pas de clone, un seul appel à la machine.
- **Pas partagé.** Il vit dans l'espace de travail `Banc` de votre compte, sur la machine
  choisie. Deux personnes ont deux bancs — et, par la règle « un projet, un moteur »
  ([claim.md](../../../packages/engine-registry/docs/claim.md)), deux adresses différentes, donc
  aucune des deux ne prend le banc de l'autre.
- **Pas un morceau.** Rien n'y est arrangé, rien n'y est enregistré (`recordDir` n'y est pas
  posé, la piste n'a pas de clip). Ce qu'on veut garder d'un essai, on le garde dans le module.

  Ça a fini par avoir un nom : le banc est un projet **`live`** (`project_type: live` dans son
  `project.yaml`), c'est-à-dire un projet l8 sans timeline. l8 l'ouvre donc sur le graphe des
  chaînes, plein écran, sans transport ni minimap — ce qui est exactement ce que ce paragraphe
  décrivait avant que le champ existe. Le module s'édite depuis le graphe : clic droit sur un
  nœud, son `module.yaml` s'ouvre par-dessus, et le bouton **Builder** de cette barre d'outils
  ouvre le constructeur. Voir [packages/song/docs/projectMode.md](../../../packages/song/docs/projectMode.md).

  Les bancs déjà créés sont repris à l'ouverture : le dossier est régénéré à chaque fois, mais
  `project.yaml` ne l'est pas — il n'est écrit qu'une fois — donc `ensureBenchProject` y ajoute
  la ligne si elle manque, en préservant les commentaires.

## Ce qu'il faut vérifier dans un navigateur

Rien de tout ceci n'est couvert par une suite verte — `scaffoldBench.test.ts` ne pin que le fait
que le projet généré compile.

- le bouton dans Projets → l8 s'ouvre, avec une attente qui dit qu'elle récupère les modules ;
- l'arborescence de l8 montre tout le catalogue sous `modules/` ;
- câbler un module dans `chains.yaml` → il apparaît dans le graphe et s'entend ;
- ouvrir le constructeur dessus → ses paramètres sont ceux du greffon, pas ceux du fichier ;
- y enregistrer une modification → elle apparaît dans la section Modules de la médiathèque,
  depuis un autre navigateur ;
- rouvrir le banc → la modification est toujours là (elle est revenue par le catalogue), et la
  chaîne câblée aussi ;
- supprimer un module depuis la médiathèque, rouvrir le banc → il n'y est plus.
