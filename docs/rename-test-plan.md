# Recette d'un renommage

Renommer une application, un service ou un préfixe de protocole dans ce dépôt touche des
choses qui ne se plaignent pas quand elles cassent : un dossier d'état, une sentinelle dans
la sortie du moteur, un en-tête HTTP, un identifiant écrit dans un fichier utilisateur. La
plupart de ces fautes se lisent comme un fichier vide, pas comme une erreur. Cette page tient
la **méthode** de vérification ; elle ne décrit aucun renommage particulier.

## Les deux règles

**Ordre imposé.** Chaque phase suppose la précédente verte. Une phase qui échoue rend les
suivantes ininterprétables, parce que le socle est partagé : un moteur qui écrit son
catalogue au mauvais endroit fait apparaître une médiathèque vide, et on cherche le défaut
dans la mauvaise application.

**Chaque contrôle porte sa signature d'échec** : ce qu'on verrait *précisément* si le
renommage était faux à cet endroit. Sans elle, « ça a l'air de marcher » ne prouve rien. La
signature la plus utile est celle qui ressemble à un fonctionnement normal — « le moteur
démarre mais ne trouve aucun espace de travail » se confond avec un premier lancement
légitime, et c'est exactement pour ça qu'il faut l'écrire d'avance.

## L'ordre des phases

1. **Le dossier d'état** (`~/.studio`) — bloquant, et fait à la main. Rien ne démarre
   correctement tant que le contenu n'a pas bougé. On déplace le *contenu*, pas le dossier.
   Le log fusionné et le `engine.pid` ne se reprennent pas : le log est tronqué à chaque
   lancement et ne garderait que des lignes écrites par le moteur d'avant — dont une bannière
   à l'ancien nom, qui se lit comme une panne du renommage. Un `engine.pid` périmé pousse un
   superviseur neuf à adopter un moteur mort plutôt qu'à en lancer un. Ce qui ne se régénère
   pas, c'est `root/`, qui porte les espaces de travail.
2. **Le moteur seul** — compilation, tests unitaires, énumération des périphériques, scan de
   plugins. Aucun superviseur, aucun navigateur. Les sentinelles de sortie (`STUDIO_*_BEGIN` /
   `_END`) sont ce que le TypeScript cherche pour borner une réponse : une sentinelle à
   l'ancien nom donne un moteur qui répond et un appelant qui lit vide.
3. **Superviseur et service de fichiers** — le socle partagé. C'est ici que se vérifient les
   en-têtes `x-studio-{user,workspace,engine-token}` : la route gardée doit répondre avec les
   en-têtes neufs **et refuser** les anciens. Un refus, 401 ou 400 ; si la liste revient, un
   ancien en-tête est resté quelque part.
4. **Le plateau**, si la version empaquetée sert. Le superviseur de la phase précédente est
   interchangeable avec lui sur le même contrat, donc cette phase est optionnelle.
5. **Chaque application, une par une**, du plus petit consommateur du socle au plus gros.
   L'ordre compte : une application qui tient son propre registre de moteurs ne prouve rien
   sur celle d'à côté.
6. **Non-régression** sur les applications qui consomment `packages/*` sans avoir été la
   cible du renommage. Un consommateur des en-têtes hors du socle est le dernier endroit où
   un renommage partiel se voit, donc le premier à contrôler ici.

## Le contrôle qui compte le plus

Un renommage qui touche un identifiant **écrit dans un fichier utilisateur** n'est pas du
même ordre que les autres : le dépôt peut être vert et les projets de la personne cassés.
Ceux-là demandent une migration et une signature d'échec lisible — voir
[packages/song/docs/moduleNamespaces.md](../packages/song/docs/moduleNamespaces.md) pour le
niveau de module, le seul de cette famille.

Le corollaire : un identifiant que personne ne tape et qui ne sort pas de la machine se
renomme sans migration, et parfois ne se renomme pas du tout — le prix d'une migration sur
toutes les machines pour un mot invisible ne se justifie pas.

Sur les built-in du moteur, la vérification se lit sur `complete`, pas sur `params` : un
built-in créé avec succès rend un `params` vide pour certains types, ce qui ne dit rien.
`dumpPluginParams` émet `complete:false` et sort en **2** quand `createNewPlugin` rend
`nullptr`, c'est-à-dire quand le type est introuvable. `resolveBuiltInType`
(`engine/EditBuilder.cpp`) accepte soit le nom affiché soit l'identifiant interne, donc un
`module.yaml` écrit avec la forme humaine survit à un renommage d'id.

## Ce qui repart de zéro, légitimement

À ne pas confondre avec une panne. La liste est à établir *avant* de renommer, parce que
chacune de ces lignes produit un symptôme qu'on prendrait sinon pour un bug :

| | pourquoi |
|---|---|
| une reconnexion | le cookie de session change de nom |
| le choix d'espace de travail | clé localStorage renommée |
| les préférences par service (`~/.studio/prefs/<service>/`) | répertoire renommé |
| `%APPDATA%/Studio/Settings.xml` vierge | nom d'application JUCE renommé — le superviseur rebascule sur le bon périphérique au premier cycle de poll |
| les alias de canaux et défauts MIDI de Tracktion | même cause ; les libellés d'entrée viennent de `preferences.yaml` et sont intacts |
| `branch.<b>.studioParent` | clé git locale — les branches en cours perdent leur parent mémorisé |
| le plateau vu comme une application neuve | identifiant de bundle renommé : un élément de démarrage automatique pointe l'ancien et doit être refait |

## Ce qui ne se renomme pas

`lane` est le mot pour une rangée de clips sur la timeline : un morceau a des `tracks` **et**
des `lanes`. Les éléments `<Lanes>` que l'import DAWproject parse appartiennent au format de
quelqu'un d'autre, et `biPlanes` est un champ du `BITMAPINFOHEADER` de Win32. Un renommage
qui balaie sur le mot plutôt que sur l'identifiant les emporte tous les trois.
