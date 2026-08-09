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
tracks:
  banc: [ amps/neural-amp-modeler, mixer ]
modules:
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

Ce qui **survit** à la régénération est ce qui est à vous : `chains.yaml`, `tracks/` et
`instances/`. C'est-à-dire exactement ce que vous câblez.

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
