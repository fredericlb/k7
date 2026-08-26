# Corriger la grille

La grille d'un morceau est **déduite** : le moteur mesure un tempo, et
[beats.ts](../src/beats.ts) place le premier temps par un test de Rayleigh sur les transitoires.
Ça marche souvent. Quand ça rate, ça ratait **définitivement** — il n'existait aucun geste pour le
reprendre, alors que [bpm.md](bpm.md) montre lui-même un morceau (le Bashung) dont le tempo détecté
est faux.

Un set peut maintenant dire que l'analyse s'est trompée.

## C'est le SET qui corrige, pas le fichier

La correction vit dans `mix.yaml`, sur la même ligne que les repères :

```yaml
cues:
  - ref: "@st0/songs/bashung/fantaisie/osez"
    markers: [ 12.5, null, 48.25 ]
    bpm: 87        # l'analyse disait 174
    beat: 0.31     # où tombe le premier temps, en secondes du FICHIER
```

Et pas dans le sidecar, délibérément. Le sidecar appartient au **fichier** et voyage avec lui ;
une grille est une opinion sur la façon dont **ce pupitre-là** joue ce disque. Deux sets qui
reprennent le même morceau peuvent être en désaccord sur l'endroit où commence la mesure, et le
premier ne doit pas écrire par-dessus le second. C'est la même raison qui met les repères ici
plutôt que dans la playlist ([mixFile.md](../../song-schema/docs/mixFile.md)).

Conséquence pratique : la correction se **commite** avec le set, et se relit.

## Les deux champs, et pourquoi ces deux-là

| | ce que c'est |
|---|---|
| `bpm` | ce que le disque EST. Remplace `natural`, pas seulement l'étiquette |
| `beat` | où tombe le premier temps, en secondes du fichier — la phase de la grille |

`bpm` remplace `natural` et non l'affichage, et c'est le point : `Rate = cible / naturel`. Corriger
le seul nombre affiché laisserait le plateau tourner à la mauvaise vitesse en montrant la bonne
valeur — exactement le genre de panne qu'on ne trouve pas.

## Ce qu'un fader déjà bougé garde

Corriger le tempo **ne déplace pas un fader que quelqu'un a posé**. Un fader tiré à 176 pour rouler
contre l'autre platine est une décision ; l'analyse qui se corrige n'est pas une raison de la
jeter. Donc :

- fader au repos (`target === natural`) : il **suit** la correction ;
- fader déjà bougé : `natural` change, `target` reste.

Un test le fige, parce que c'est la ligne dont l'inverse s'entendrait en plein set.

## L'octave, qui est l'erreur qu'un détecteur fait vraiment

Sous le fader, `÷2` et `×2`. Ce ne sont pas des raccourcis parmi d'autres : le tempo détecté est
juste **ou faux d'un facteur deux**, presque jamais faux de 3 %. Un morceau à 87 lu comme 174 est
le cas ordinaire, et deux boutons le règlent sans rien taper.

Grisés tant qu'aucun tempo n'est mesuré : il n'y a alors rien à corriger, et un bouton qui
répondrait sur `0` écrirait `bpm: 0`.

Quand ce set corrige quelque chose, un `GRILLE ✎` apparaît sous les deux boutons. Seulement quand
il corrige : un badge toujours là ne dit rien.

## Le premier temps arrive SANS le doute

Une phase corrigée à la main est exacte par définition, donc elle n'emporte pas le `confident` que
le test de Rayleigh attache à une phase devinée. Ça compte : `canAlign` — la moitié du sync qui
met les temps ensemble et pas seulement les tempos — lit `phase !== undefined`, pas la confiance.
**Corriger la grille d'un morceau que l'analyse n'a pas su lire rallume donc le calage des temps.**

## Ce que ça ne fait pas, et qu'il faut dire

- **Pas de downbeat au sens de la MESURE.** `beat` place le premier TEMPS, pas la première mesure.
  Rien sur ce pupitre ne consomme de mesures : le clic est délibérément sans phase
  ([metronome.md](metronome.md)), et le sync cale des temps. Ajouter un `bar:` que rien ne lirait
  serait un champ à remplir pour rien. Le jour où le clic prend une phase, c'est là qu'il ira.
- **Le 4/4 reste supposé.** `BEATS_PER_BAR` est une constante, et une signature rythmique ne se
  corrige pas ici — pour la même raison : personne ne la lit.
- **Rien n'est détecté de plus.** Corriger n'est pas mesurer. Une meilleure détection de tempo est
  un travail du moteur, dans la passe qui écrit le sidecar.
- **Aucune tonalité.** KEY tient la hauteur sans dire laquelle : pas de mix harmonique, pas de roue
  Camelot. C'est le troisième point de l'audit et il n'est pas fait — il demande un chromagramme
  dans la passe C++, pas un bouton.
