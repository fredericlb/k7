# `engineAccess` — un seul objet pour joindre un moteur

Les briques de ce package existaient déjà séparément : `registry.ts` (les cinq routes),
`probe.ts` (mesurer), `choose.ts` (la politique), `lease.ts` (le bail). Chaque app les
recomposait à sa façon. `access.ts` ne les remplace pas — il les **lie au préfixe du service**,
une fois.

## Ce que la séparation coûtait

`base` — `""` pour st0, `/l8`, `/m9` — était passé **deux fois**, à deux fonctions
différentes :

```ts
export const engines = registryClient<PublicEngine>(BASE, json); // ici
const ranked = await probeEngines(list, BASE);                   // et là
```

Deux endroits pour un seul fait. Rien n'obligeait une app à tenir les deux à jour, et la
version qui compte le moins bruyamment — celle de la sonde — est celle qui décide si le
**relais** est proposé. Un service pouvait donc lister ses moteurs correctement et n'en
joindre aucun à distance, sans qu'aucun type ne s'en aperçoive.

Ce n'est pas une hypothèse : `probeEngines` n'a reçu son second argument que le jour où le
relais a été branché, et il a fallu retoucher les quatre appels dans les trois apps du même
geste. Le suivant se serait ajouté sans lui.

Passé au constructeur, il n'y a plus rien à garder en phase :

```ts
export const engines = engineAccess<PublicEngine>(BASE, json);
```

## `find()` — la séquence, pas les morceaux

Les trois gates faisaient la même chose dans le même ordre : lister, lire la préférence,
mesurer, appliquer la politique. Trois copies, qui avaient déjà divergé — l8 filtrait sur
`wsUrl` seul, donc offrait un moteur ayant répondu sans jeton, qu'il ne pouvait ensuite pas
sélectionner, et levait un sélecteur devant un unique moteur joignable.

```ts
const { ranked, chosen, ambiguous, rememberedId } = await engines.find();
```

`ranked` sert au sélecteur, `chosen` à démarrer, `ambiguous` à savoir s'il y a une **question**
à poser, `rememberedId` à cocher la ligne du choix — y compris quand ce choix n'a pas répondu,
ce dont un sélecteur a besoin et un démarrage non.

`preferId` prend le pas sur la préférence stockée : c'est la même valeur, mais elle arrive
déjà à jour quand quelqu'un change de moteur depuis un en-tête voisin, là où la requête
répondrait encore ce qui a été enregistré il y a un instant.

## Un registre muet n'est pas une erreur

`find()` avale l'échec des deux requêtes et rend une liste vide. C'est l'état honnête — un
service dont le registre est à terre ne peut effectivement pas être piloté — et c'est un
**écran**, là où une promesse rejetée dans l'effet d'un gate est un spinner éternel. l8 avait
exactement ce cas : sa liste n'était pas gardée, seule sa préférence l'était.

## Ce qui reste au dehors

- **`EngineClient`** : ouvrir le socket, avec la session du service
  (`sessionFor(SESSIONS.l8, …)`). Chaque app tient la sienne, et une seule d'entre elles doit
  la tenir — voir `@studio/engine-protocol/docs/sessions.md`.
- **Le service de fichiers** : `fileBase` sort de la sonde et va dans
  `@studio/project-shell/fileApi`. Il **voyage avec l'adresse qui a répondu** : un socket
  relayé à côté d'un `http://` direct rebâtirait le mur du contenu mixte sur l'autre moitié
  (`@studio/engine-registry/docs/proxy.md`).
- **La politique du sélecteur** : st0 laisse un éditeur ouvert sans moteur, m9 non. C'est une
  différence de produit, pas de plomberie.
