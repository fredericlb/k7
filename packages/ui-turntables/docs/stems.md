# Les stems sur le pupitre — retirer un instrument du disque

Quatre potards par platine, à **gauche** de la platine, au même format que l'EQ : batterie,
basse, reste, voix. **Au centre** le disque joue tel quel ; vers la gauche l'instrument s'en va,
vers la droite il y en a davantage.

Ce que ça fait vraiment est une **soustraction**, et le raisonnement est dans
[`packages/dsp/docs/stemcut.md`](../../dsp/docs/stemcut.md) : la somme des quatre stems ne
redonne pas le morceau, donc la platine joue le disque et lui retire ce qu'on demande, plutôt que
de rejouer quatre fichiers. Au repos, la sortie est le disque **bit à bit**.

## La colonne, et pourquoi elle n'est pas en miroir

Les deux platines se font face — le tempo sur le bord extérieur, l'EQ sur l'intérieur — pour
qu'une main sache sur laquelle elle est sans lever les yeux. **Les stems échappent à cette
règle** : ils sont à gauche des deux. Ce que ces quatre potards retirent est une propriété du
DISQUE et pas de la géométrie du pupitre, et chercher « la basse de la platine de droite » ne doit
pas demander de savoir de quel côté la colonne est posée aujourd'hui.

Même potard, même échelle de tailles, même `justify-center` que la tranche d'à côté
(`ChannelStrip`) — c'est le même geste sur la même sorte de chose, **et la même course** : le
milieu est le neutre et il va des deux côtés, comme un potard d'EQ.

Ça n'a pas toujours été le cas. La course allait de « rien retiré » vers « tout retiré », dans un
seul sens, parce que le module ne savait que soustraire. Un potard qui commence à une extrémité et
dont le neutre est cette extrémité se lit mal : la main ne trouve pas le repos, et la moitié droite
de sa course — ajouter de l'instrument, ce qu'un remix demande tout le temps — n'existait pas. Le
gain du `stemcut` est signé depuis, et le neutre est revenu sous la main.

La colonne **n'a pas d'échelle à elle** : elle prend celle de la tranche, pour que les potards
d'un même pupitre aient tous une taille. Ce n'est sûr que parce qu'elle est plus COURTE à chaque
cran — quatre potards d'EQ contre trois plus le filtre, plus gros, et son filet. `deskLayout.test`
le tient : un cinquième stem, ou un potard dessiné plus grand ici, casserait la propriété — et il
la casserait comme le filtre disparaît quand la tranche ne rétrécit pas, en débordant une boîte
centrée par les deux bouts ([deskLayout.md](deskLayout.md)).

## Quatre états, quatre lectures

| état | ce qu'on voit | ce qu'on fait |
|---|---|---|
| le set ne câble aucune coupe | **pas de colonne du tout** | rien : un pupitre sans stems est un pupitre complet |
| câblé, disque non séparé, `stems:` absent | quatre potards gris, avec la raison au survol | `playlist stems <playlist>`, ou écrire `stems: true` |
| câblé, disque non séparé, `stems: true` | quatre potards gris et **le pourcentage par-dessus** | attendre — ça se fait tout seul |
| câblé et préparé | quatre potards vifs | monter celui qu'on veut faire partir |

Le premier est délibéré : un set qui n'a pas ces lignes dans son `mapping:` n'a rien demandé,
et quatre potards morts seraient pires que pas de potards. C'est aussi pourquoi les
contrôles de stem sont **offerts sans être exigés** — `SURFACE_MAPPING_SKELETON` les propose,
`REQUIRED_CONTROLS` ne les demande pas. « Ce qu'on peut câbler » et « ce qu'il faut avoir câblé
pour que ça se dessine » sont deux listes, et les stems sont ce qui les sépare.

Le deuxième se lit sur la colonne parce que le scan le rapporte : `meta.stems` est vrai quand un
dossier `stems/` est là, lu sur les entrées de dossier déjà en main — pas un syscall de plus par
morceau, et la même question que la commande de préparation pose avant de sauter un morceau.

## Le rattrapage : poser un disque que personne n'a préparé

C'est le troisième état, et il tient à une ligne du fichier de surface :

```yaml
# surfaces/desk.yaml
type: turntables
layout: split
playlist: ete-2026
stems: true              # ce pupitre rattrape un disque non préparé
```

Elle transforme « ce morceau n'a pas de stems » d'une impasse en un travail : le disque part sur la
platine **immédiatement** et la séparation démarre derrière, `POST /api/stems` sur **pl8** puis un
sondage toutes les deux secondes. Sur pl8 et non sur le service de fichiers : c'est pl8 qui détient
les masters, donc c'est lui qui mène la découpe, en empruntant le modèle du moteur nommé
(`apps/pl8/docs/stems.md`). `library` est le second seam de ce paquet pour cette seule raison.

Le pourcentage s'affiche **par-dessus** les potards éteints — pas au-dessus : la colonne emprunte
l'échelle de tailles de la tranche et n'a que sept pixels de marge au cran le plus serré
(`stemStripHeight`), donc une ligne de texte la ferait déborder.

**Un booléen, et pas une chaîne.** Nommer la chaîne dans ce fichier poserait au projet une
question qui ne le regarde pas : quel module sépare et quel modèle il veut est
une réponse unique pour la machine, écrite une fois par `system stems` dans
`~/.studio/preferences.yaml`. Ce qu'un SET décide, c'est si une heure d'arithmétique a le droit de
démarrer parce qu'on a posé un disque — et ça, ça se décide par set : une machine de répétition et
une machine de scène ne répondent pas pareil.

Quand les fichiers arrivent, le pupitre renvoie le document avec les quatre lanes remplies
(`stemsArrived`). Le morceau ne s'arrête pas, le tempo ne bouge pas, le transport non plus : ce
qui change est ce que `withDecks` trouve à poser.

Trois choses que ça ne fait pas, et chacune est une décision :

- **Rien ne démarre sans `stems: true`.** Une séparation est des minutes d'arithmétique ; elle a
  lieu parce que le projet l'a DEMANDÉE, jamais par défaut. Et rien ne démarre non plus si la
  machine n'a pas de chaîne : la route répond alors un 409 qui nomme `system stems`.
- **Rien ne démarre deux fois.** L'identifiant du job hache le TRAVAIL (`separateJobs.ts`), donc
  poser le même disque sur les deux platines, ou recharger l'onglet, rejoint le calcul en cours.
- **Rien n'arrive sur le mauvais disque.** `stemsArrived` vérifie l'id du morceau, et chaque
  chargement invalide la boucle de sondage précédente. Une séparation dure des minutes : le
  disque qu'elle prépare a largement le temps d'être retiré.

Le pupitre n'envoie **aucune chaîne** : la requête est le morceau, et rien d'autre. Quel module
sépare et quel `.onnx` cette machine détient est une question que le navigateur ne peut pas poser,
et à laquelle la machine a déjà répondu une fois — d'où une route à part, la seule des trois à être
liée à un espace de travail, voir
[stem-separation/docs/stemSplit.md](../../stem-separation/docs/stemSplit.md).

Et l'ordre compte : la route interroge le DISQUE avant de lire la préférence et avant de résoudre
la chaîne. Une machine à qui on n'a jamais dit comment séparer joue donc quand même, potards vifs,
les morceaux qu'on a préparés à la commande.

## Ce qui doit rester vrai

- **Les cinq clips d'une platine sont alignés à l'échantillon.** Même `start`, même warp, même
  `slip` — `withDecks` les remplit en un seul endroit pour ça. Une dérive d'un échantillon ne
  fait pas un instrument plus discret : elle fait un filtre en peigne, et rien à l'écran ne le
  dirait.
- **Un morceau non séparé laisse ses lanes VIDES.** Une lane vide ne soustrait rien, donc poser un
  disque que personne n'a préparé le joue tel quel. Poser quatre clips sur des fichiers absents
  ferait dépendre « mettre un disque » d'une heure de calcul que personne n'a demandée.
- **Le potard parle en proportion, pas en dB.** Ce qu'on demande est une part de l'instrument, et
  l'enlever complètement doit être une position sur la course — ce que −∞ dB n'est pas.
- **Les stems s'écrivent en WAV 24 bits.** Pas en float, pas en FLAC : Tracktion lit un WAV
  directement et décode tout le reste dans un proxy avant de jouer, ce qui se paierait au moment
  précis où on pose un disque — cinq décodages, le mix et ses quatre stems. Le raisonnement
  complet et le tableau des tailles sont dans
  [stem-separation/docs/stemSplit.md](../../stem-separation/docs/stemSplit.md).
