# Plan — la tonalité, et ce qu'elle coûte vraiment

Troisième point de l'audit du pupitre, et le seul des trois qui n'est pas fait : **aucune tonalité
n'est détectée**. KEY tient la hauteur sans dire laquelle, donc pas de mix harmonique et pas de roue
Camelot.

Les deux autres points sont réglés — la playlist se préchauffe ([prewarm.md](../packages/ui-turntables/docs/prewarm.md))
et la grille se corrige ([grid.md](../packages/ui-turntables/docs/grid.md)). Celui-ci est différent
en nature : ce n'est pas un bouton qui manque, c'est une **mesure**, et elle est dans le C++.

## Où ça vit

`engine/moteur/engine/Waveform.cpp`, le mode `--waveform <fichier>` : une passe qui décode,
construit les enveloppes, détecte les transitoires, estime le tempo, et écrit `{fichier}.cache`.

Trois choses qu'il faut avoir lues avant de proposer quoi que ce soit :

**La passe est ENTIÈREMENT temporelle.** Un décodage en flux, échantillon par échantillon,
sommé en mono ; les trois bandes sortent de deux suiveurs à un pôle, et l'enveloppe de tempo d'un
saut fixe. **Aucune FFT nulle part.** Un chromagramme est habituellement une affaire de FFT, donc
c'est le premier vrai choix de conception, et pas un détail d'implémentation.

**La FFT est pourtant déjà là.** `juce_dsp` est une dépendance déclarée de `tracktion_engine`
(`tracktion_engine.h`, ligne 28), donc `juce::dsp::FFT` est déjà liée et ne coûte rien à atteindre.
Personne ne s'en sert dans le moteur aujourd'hui — mais rien n'est à ajouter au build.

**Le sidecar est VERSIONNÉ**, et c'est la conséquence la plus lourde du plan :

```cpp
// v2 added `transients` + `sensitivity`, v3 `bpm`, v4 the three bands
out += "{\"v\":4,\"fingerprint\":\"";
```

`waveformCache.ts` exige `MIN_CACHE_VERSION = 4`. Passer en v5 **invalide tous les sidecars
existants** : chaque morceau est réanalysé à la première ouverture.

> Ça aurait été rédhibitoire il y a une semaine. Ça ne l'est plus : le préchauffage marche la
> playlist tout seul dès que la surface a sa liste, donc l'invalidation se paie en tâche de fond
> plutôt que sur le premier disque qu'on pose. Les deux points de l'audit se rendent service.

## Ce qu'il faut décider AVANT d'écrire

### 1. FFT, ou un banc de résonateurs ?

| | pour | contre |
|---|---|---|
| **FFT** (`juce::dsp::FFT`) | la façon habituelle ; déjà liée | demande de **tamponner** par trames et de fenêtrer — la passe actuelle ne tamponne rien |
| **Goertzel / résonateurs**, un par demi-ton sur ~5 octaves | épouse la passe existante : un état par filtre, mis à jour par échantillon, comme les suiveurs à un pôle qui sont déjà là | ~60 filtres, coût par échantillon à mesurer |

Le second est le moins étranger à ce fichier : la passe est une boucle par échantillon sans mémoire
de trame, et y greffer un tampon de FFT change sa forme.

### Mesuré — et ça décide

Ce que la passe coûte AUJOURD'HUI, sur six morceaux réels de cette machine
(`--waveform`, RelWithDebInfo) :

| morceau | durée | analyse | du temps réel |
|---|---|---|---|
| Sans titre | 204 s | 386 ms | **0,19 %** |
| En Bande organisée | 376 s | 636 ms | 0,17 % |
| In da club | 249 s | 457 ms | 0,18 % |
| Take on me | 246 s | 456 ms | 0,19 % |
| Money Money Money | 188 s | 389 ms | 0,21 % |
| P.I.M.P | 15 s | 82 ms | 0,54 % |

**Un cinquième de pour cent du temps réel**, et parfaitement linéaire : ~0,19 % sur tout ce qui
dure plus d'une minute (le 0,54 % du morceau de 15 s est le démarrage du processus, pas l'analyse).
Une playlist de vingt morceaux se préchauffe en **une dizaine de secondes**.

Conséquence directe sur le choix ci-dessus : **il n'y a pas de budget à défendre.** Même une
approche dix fois plus chère resterait sous 2 % du temps réel et une playlist tiendrait sous deux
minutes en tâche de fond. Le critère n'est donc pas la vitesse — c'est la JUSTESSE et la forme du
code. Ce qui retire l'argument principal du banc de résonateurs et laisse la FFT, qui est la façon
habituelle, mieux comprise, et déjà liée.

> Ça renverse ce que ce plan disait avant la mesure. Il annonçait le coût comme la première
> décision ; le coût s'avère être un non-sujet, et le vrai risque est ailleurs — dans le taux de
> bonne réponse, qui n'a pas encore de jeu d'essai pour être mesuré.

### 2. Quel profil, et quelle vérité de terrain ?

Chromagramme sur 12 classes, puis corrélation contre des profils majeur/mineur —
Krumhansl-Schmuckler, ou les profils révisés de Temperley. `argmax` sur 24 donne tonique + mode.

**Aucune étiquette dans les fichiers** — les 302 mp3 ont été scannés, dix portent la moindre trame
de texte ID3, aucun ne porte de `TKEY`. Mais **dix-sept tonalités ont été fournies à la main**, et
c'est avec elles que la section suivante tranche.

Ce qui reste possible sans elle : de la matière SYNTHÉTIQUE, dont la tonalité est connue parce
qu'on l'a écrite. Ça ne mesure pas la justesse sur du vrai matériel — et
`packages/audio-probe/src/key.test.ts` le dit en en-tête plutôt que de laisser croire le contraire.
Ça mesure ce qui casse en silence : une classe de hauteur mal mappée, un profil tourné à l'envers,
une roue dont les voisins n'en sont pas.

### 3. MESURÉ SUR DU VRAI MATÉRIEL — et c'est un échec

Dix-sept morceaux de tonalité connue, décodés en mono 22 k et passés au détecteur
(`@studio/audio-probe/key`) :

| | juste |
|---|---|
| tonalité EXACTE, profil Temperley | **9/17 — 53 %** |
| tonalité exacte, profil Krumhansl | 9/17 — 53 % |
| code Camelot COMPATIBLE (ce dont un DJ a besoin) | 13/17 — 76 % |

**C'est en dessous du seuil que ce plan s'était lui-même fixé.** « Une détection fausse une fois sur
quatre est pire qu'aucune » : celle-ci se trompe une fois sur deux sur la tonalité, et une fois sur
quatre sur la compatibilité. Elle ne doit pas être branchée sur le pupitre en l'état.

Les deux profils sont à égalité, donc la matière ne les départage toujours pas — mais pour une
autre raison qu'avant : ils se trompent tous les deux.

#### Deux vrais défauts trouvés en mesurant

**La trame était en ÉCHANTILLONS et pas en secondes.** 4096 échantillons donnent des bacs de 5,4 Hz
à 22 k mais de **11,7 Hz à 48 k**, la fréquence à laquelle le moteur tourne — donc le portage C++
aurait résolu moins bien que le prototype, en silence. La trame est maintenant une DURÉE
(`FRAME_SECONDS`), et la résolution ne dépend plus du fichier.

**Le bas du spectre ne résolvait pas.** L'écart d'un demi-ton vaut 3,9 Hz à do2 contre 5,4 Hz de
résolution : l'octave du bas étalait chaque note sur ses voisines et votait pour la mauvaise classe.
La borne basse est remontée à do3 (7,8 Hz), qui est le plus bas demi-ton que cette trame sépare.

> Un balayage des paramètres a trouvé 11/17 en remontant la borne à sol3. Écarté : le meilleur de
> vingt-quatre configurations, choisi sur les dix-sept morceaux qui servent aussi à le mesurer,
> n'est pas une estimation — c'est du surapprentissage sur deux morceaux d'écart.

#### Ce qu'il faudrait essayer ensuite

Rien de tout ça n'est promis, et l'ordre est celui du soupçon :

- **la suppression des harmoniques.** Un chromagramme d'énergie brute compte la quinte et la tierce
  de chaque note comme si elles étaient jouées — c'est le défaut connu de la méthode, et ce que les
  HPCP corrigent. C'est le premier suspect ;
- **l'accord de référence.** A=440 est supposé ; un disque un quart de ton à côté vote pour ses
  voisins ;
- **une tonalité par SEGMENT, puis un vote**, plutôt qu'un chromagramme unique sur deux minutes.

#### Ce qui reste vrai malgré tout

| matière | détecté | marge |
|---|---|---|
| I–V–vi–IV majeur, **les douze tonalités** | juste, 12/12 | 0,185 |
| i–iv–V–i mineur, **les douze** | juste, 12/12 | **0,410** |
| i–VI–III–VII mineur (éolien), les douze | **le RELATIF MAJEUR** | 0,185 |

Sur de la matière SYNTHÉTIQUE le détecteur est juste 12/12 en majeur et 12/12 en mineur avec
dominante, et se trompe de relatif sur un mineur éolien. Ce dernier n'est pas un bug :
`i–VI–III–VII` en do mineur contient **exactement** les sept notes de mi bémol majeur. Aucun chromagramme ne peut les distinguer, parce qu'il n'y a rien à
distinguer — la différence est laquelle des deux sonne comme la maison, et ça n'est pas dans
l'histogramme des classes de hauteur. La deuxième ligne réussit précisément parce que le V y met
une sensible, la seule note que le relatif majeur n'a pas.

**Et cette erreur-là ne coûte rien à un DJ**, ce qui est la raison de continuer : une tonalité et
son relatif partagent l'HEURE Camelot et ne diffèrent que par la lettre — `8A` contre `8B` — et la
roue les déclare compatibles. L'erreur la plus fréquente tombe donc sur un code qui se mixe avec le
bon. Un test le vérifie sur les douze.

La marge, elle, ne sépare PAS ces deux cas (0,185 des deux côtés) : elle dit « c'est l'un de ces
deux relatifs », pas lequel. C'est une information honnête, et il faut la présenter comme telle
plutôt que comme une confiance.

Deux conséquences :

- il faut **la même échappatoire que la grille** : une tonalité corrigeable, dans `mix.yaml`, à
  côté de `bpm` et `beat`. C'est le même geste, le même fichier, la même raison (une opinion de ce
  set-là), et ça coûte un champ `key:` ;
- il faut **dire ce qu'on ne sait pas**. Une corrélation faible doit s'afficher comme un doute et
  non comme une réponse — la grille a déjà ce vocabulaire avec `confident`.

## Ce que ça donne à l'écran

La roue **Camelot** est une pure table : 24 tonalités → `1A`…`12B`, et deux morceaux se mixent si
leurs codes sont identiques, voisins (±1) ou de mode opposé au même chiffre. Aucune mesure là-dedans,
donc rien à décider — mais aussi rien d'utile tant que la mesure n'est pas fiable.

L'affichage tient dans la colonne de tempo, sous KEY, où il est déjà question de hauteur.

## L'ordre

1. ~~**Mesurer le coût.**~~ **FAIT** — 0,19 % du temps réel, donc pas de budget à défendre, et
   c'est la FFT qui gagne par familiarité plutôt qu'un banc de résonateurs par économie.
2. ~~**Se donner une vérité de terrain.**~~ **CHERCHÉE, ABSENTE** — 302 mp3, aucun `TKEY`. Reste la
   matière synthétique, qui valide l'algorithme et **pas** la justesse sur du vrai matériel.
3. ~~**Le chromagramme + les profils.**~~ **FAIT** — `@studio/audio-probe/key`, 16 tests. Goertzel
   plutôt qu'une FFT : un chromagramme veut ~60 fréquences connues, pas un spectre, et cette forme
   est aussi celle qui se porte dans la boucle par échantillon du moteur.
4. **BLOQUÉ** — 53 % de tonalités exactes, 76 % de compatibilité Camelot. Sous le seuil que ce plan
   s'est donné, donc rien ne part vers le sidecar, le C++ ou l'écran tant que ça n'a pas monté.
   Les pistes sont listées plus haut, la première étant la suppression des harmoniques.
5. (après) La correction dans `mix.yaml`, sur le modèle exact de `bpm`/`beat`.
6. (après) Camelot à l'écran, et les voisins.

L'étape 2 est le vrai travail de décision ; 4 à 6 sont mécaniques et ressemblent à ce qui vient
d'être fait pour la grille.

## Ce que ce plan ne prétend pas

Une seule des inconnues est levée : le **coût**, mesuré ci-dessus, et il ne pose pas de problème.
Le reste de ce qui est établi se lit dans la source — la passe est temporelle, la FFT est liée, le
sidecar est versionné et son invalidation est désormais absorbée par le préchauffage.

La justesse EST mesurée maintenant, et elle ne suffit pas : **53 %**. Ce plan ne prétend donc pas
que la tonalité est faite — il prétend qu'elle est chiffrée, que deux vrais défauts ont été trouvés
et corrigés en la chiffrant, et qu'on sait quoi essayer ensuite.

Ce qui est acquis et ne sera pas à refaire : le banc d'essai (dix-sept morceaux étiquetés, décodés
par ffmpeg), la roue Camelot et ses voisins, les tests de transposition qui attrapent un mappage de
classe décalé, et le coût — 0,19 % du temps réel, qui ne sera jamais le problème.

Ce qui reste : un chromagramme qui compte les harmoniques comme des notes.
