# Deux disques, et le piège entre les deux

La médiathèque est **hébergée** ; le moteur ouvre des **chemins sur sa propre machine** et ne
sait pas aller chercher une URL. Ce qui joue n'est donc jamais les octets que cet écran liste :
c'est la copie dans le cache de la machine choisie, atteinte par le service de fichiers de
cette machine-là.

C'est le fait le plus facile à oublier de tout ce service, et il vaut pour tout ce qu'un moteur
joue pour la médiathèque — un morceau, une variante.

| quoi | d'où | pourquoi |
|---|---|---|
| l'audio | le cache de la machine du moteur (`/mediatek` → `root`, plus le chemin de l'entrée et `meta.master`) | le moteur l'ouvre comme un fichier |
| ce qu'on liste à l'écran | la bibliothèque hébergée | c'est de la DONNÉE, et c'est la même des deux côtés |

`cacheRoot` demande sa racine à la machine, `playablePath` la recolle au chemin de l'entrée, et
`cachedOnMachine` répond « cette machine l'a-t-elle » avec un `Range: bytes=0-0` — un octet, pas
le fichier, parce que demander doit coûter moins cher que se tromper.

## Ce que le bouton dit quand il ne peut pas jouer

Il reste grisé et son infobulle dit laquelle des trois raisons s'applique :

- **aucun moteur** — rien n'a été choisi, ou rien n'a répondu à la sonde ;
- **cette machine n'a pas de cache de la médiathèque** — le service de fichiers a répondu, mais
  ne tient aucune bibliothèque ;
- **ce morceau n'a pas de fichier audio** — un dossier avec un sidecar et pas de master, ce qui
  est un état réel (un miroir arrêté en route, un dossier fait à la main) et non une panne à
  cacher.

La distinction compte parce que les trois se réparent différemment, et un bouton simplement gris
invite à deviner.

## Le document

`songPreviewDoc` est **une piste, un clip** : le fichier tel quel. Rien d'autre.

`recordDir` reste vide — un aperçu joue et n'enregistre jamais, et un dossier inventé est un
dossier où le moteur finirait par écrire.

Un seul constructeur de document, donc, et c'est le cas dégénéré : ce que la médiathèque joue
est toujours un fichier. Une chaîne s'écrit dans st0 et se committe dans le dépôt de
bibliothèques du compte, où le moteur qui joue la chanson la charge déjà.

## Une session, un son

L'aperçu part sur `SESSIONS.pl8`, par service **et** par personne. Jouer quelque chose remplace
donc ce que cette session tenait. C'est voulu : faire jouer deux choses à la fois sur un moteur
n'est pas à organiser, c'est à interdire.

## Les deux en-têtes que la machine exige

`apps/pl8/frontend/src/engine/songPreview.ts` envoie l'utilisateur **et** le jeton à chaque appel
au service de fichiers d'une machine. Le jeton n'est pas facultatif en pratique : tout ce qui passe
par `requireEngineToken` est refusé sans lui dès qu'un jeton est configuré — ce que le superviseur
fait toujours sur une vraie machine. Un appel qui n'enverrait que l'utilisateur marche sur un run
de dev nu et répond 401 partout ailleurs ; `cacheRoot` avale ce 401 en `null`, que l'écran formule
« cette machine n'a pas de cache de la médiathèque » — plausible, et faux, ce qui est exactement
la façon dont un oubli de jeton se cache.

Le jeton est **omis** quand il n'y en a pas : une machine qui n'en configure aucun ne garde rien, et
ajouter un en-tête vide ferait échouer une comparaison qui passe.

Une racine de cache n'est pas une copie. Seuls les `modules` sont rapatriés automatiquement
(`packages/file-service/src/mediatekPull.ts`) ; un morceau est sur une machine parce que quelque
chose l'y a mis, et sur une machine neuve il n'y est simplement pas. Le moteur n'ouvrirait alors
rien et jouerait le silence, qui est la seule panne qu'un transport ne sait pas rapporter. D'où le
`Range: bytes=0-0` de `cachedOnMachine`, et le fait que **tout** refus se lit comme absent : traiter
une machine injoignable comme « présente » remettrait le silence.

`playablePath` rend `null` pour un état RÉEL et non pour une erreur avalée : un morceau est un
dossier, et un dossier portant un sidecar sans audio n'a rien à jouer. Le service rapporte une
racine native (`C:\…` ou `/home/…`) tandis que les chemins d'entrée sont POSIX, et le moteur accepte
les deux — ils sont donc joints avec un séparateur choisi d'après la racine plutôt que normalisés
vers une forme que cette app n'a pas à décider.

`bounce` est le rendu **hors ligne** (`--render`) et non le transport : il n'ouvre aucun périphérique
audio, donc il ne peut pas entrer en collision avec un moteur qui joue — ce qui est ce qui rend
« traiter toutes les variantes » lançable pendant qu'on en écoute une. `format: mp3` est une
**demande** et non une garantie : le moteur écrit du wav, le mp3 est un transcodage ffmpeg sur cette
machine-là, au mieux. Ce qui revient dit lequel des deux, par son type de contenu, parce que classer
un wav sous `.mp3` produirait une bibliothèque de fichiers qui mentent sur eux-mêmes.

## Le transport tient au-dessus des écrans

`apps/pl8/frontend/src/playback/PlaybackProvider.tsx` tient ce qui joue, et il tient la **seule**
socket moteur de l'onglet. Une socket par écran ne serait sûre que si les écrans se remplaçaient
l'un l'autre, et un morceau qui continue pendant qu'on navigue casse exactement cet arrangement :
son transport doit survivre à l'écran qui l'a lancé, et une deuxième socket serait un deuxième
client sur la même session, pilotant le même document.

L'élément `<audio>` reste monté quelle que soit la destination, y compris quand c'est le moteur ou
mpv qui joue : c'est lui qui rapporte la **durée** du master — la trame d'état du moteur porte une
tête de lecture et aucune longueur — et le garder ici est ce qui laisse un morceau survivre à
l'écran. Quand mpv joue, sa durée à lui gagne : il a déjà lu le fichier.

L'identité de ce qui est chargé est un **chemin**, jamais un nom : deux morceaux peuvent partager
un nom, pas un chemin. Et le nom du document envoyé au moteur porte la variante (`morceau ·
instrumental`), parce que la session est partagée avec tout ce que pl8 auditionne — deux versions
d'un morceau sous un seul nom sont deux lignes indiscernables dans son journal.

## Savoir qu'un morceau s'est terminé tout seul

Les trois destinations ne le disent pas de la même façon, et un enchaînement de file ne doit
avancer que sur une vraie fin :

| destination | signal | ce qu'il faut en faire |
|---|---|---|
| le navigateur | `onEnded` | exact : il ne se déclenche que pour une fin |
| le moteur | `playing` passe à faux | ambigu : c'est aussi ce que fait un arrêt demandé |
| mpv | `idle` | franc, mais un arrêt demandé y ressemble aussi |

D'où le drapeau `weStopped`, posé par **chaque** transition délibérée (start, toggle, close) et
effacé par l'effet qui le lit. Sans lui, appuyer sur pause enchaîne sur le morceau suivant.

`ended` est un **compteur** et non un booléen : ce qu'un lecteur veut est l'événement, et un
drapeau devrait être effacé par celui qui l'a vu. Il n'existe que pour la file, la seule chose ici
qui ait un « suivant ». `now` n'est délibérément pas effacé à la fin — « qu'est-ce que je viens
d'écouter » survit au dernier échantillon — et seule la croix de la barre l'efface.

## Les trois positions

- Le navigateur est suivi en `requestAnimationFrame` pendant qu'il joue : `timeupdate` ne tombe
  qu'environ quatre fois par seconde, ce qui se lit comme un saccadement sur une forme d'onde.
- Le moteur pousse sa trame assez vite pour n'avoir besoin d'aucune boucle ; ce qui est gardé à
  part, c'est **où on lui a demandé d'être**, parce qu'entre la demande et la première trame
  (~20 Hz) c'est la seule réponse honnête.
- mpv est **interrogé** deux fois par seconde : il est ailleurs et n'a aucun moyen de pousser sa
  position ici. Une tique manquée est silencieuse — une machine occupée n'est pas une erreur à
  montrer à quelqu'un qui écoute. Le déplacement du curseur est optimiste, la tique suivante dit la
  vérité : attendre l'aller-retour ferait reculer le curseur sous la souris.

Passé la fin, ni mpv ni le moteur ne rembobinent seuls — mpv est `idle`, le moteur ne rejoue rien —
donc le bouton redemande le fichier depuis zéro. L'élément `<audio>`, lui, rembobine tout seul, ce
qui est exactement le comportement dont a besoin une barre qui survit à la fin d'un morceau.

Un document que la session n'a jamais tenu demande un `reset` avant d'être envoyé : un apply est un
diff, et un diff ne peut pas retirer un greffon que le document stocké du moteur n'a jamais
mentionné.
