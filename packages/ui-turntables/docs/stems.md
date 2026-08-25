# Les stems sur le pupitre — retirer un instrument du disque

Quatre potards par platine, à **gauche** de la platine, au même format que l'EQ, disposés
**deux par deux** : batterie et basse en haut, voix et reste en dessous. **Au centre** la partie sonne comme la séparation l'a écrite ; à fond à gauche elle disparaît,
à droite elle monte jusqu'au double.

Ce que ça fait vraiment est une **somme** : un morceau séparé n'est plus joué par sa propre lane,
il est joué par ses quatre parties, et chaque potard dose la sienne. C'est ce que font toutes les
platines à stems du commerce. Le raisonnement, et les deux formes qui ont précédé celle-là, sont
dans [`packages/dsp/docs/stemcut.md`](../../dsp/docs/stemcut.md) : la version qui **soustrayait**
du disque était exacte au repos, bit à bit, et cessait de l'être dès qu'on touchait au tempo.
Au repos, la sortie est maintenant le disque à **34 dB près** — le résidu de reconstruction du
modèle, mesuré et stable.

## Le bloc, et pourquoi il n'est pas en miroir

Les deux platines se font face — le tempo sur le bord extérieur, l'EQ sur l'intérieur — pour
qu'une main sache sur laquelle elle est sans lever les yeux. **Les stems échappent à cette
règle** : sur les deux platines, le bloc est **à gauche**. Ce que ces quatre potards dosent est une
propriété du DISQUE et pas de la géométrie du pupitre, et chercher « la basse de la platine de
droite » ne doit pas demander de savoir de quel côté le bloc est posé aujourd'hui.

**Contre sa platine, pas au bord du pupitre.** Le bloc était la première colonne de chaque moitié,
donc le tempo (platine A) ou l'EQ (platine B) s'intercalait entre les potards et le disque dont ils
viennent. L'ordre est maintenant `TEMPO | STEMS | PLATINE A | EQ` d'un côté et
`EQ | STEMS | PLATINE B | TEMPO` de l'autre : le bloc touche sa platine, et ce qui est mis
en miroir — le tempo dehors, l'EQ dedans — le reste.

Même potard, même échelle de tailles, même centrage que la tranche d'à côté (`ChannelStrip`) —
c'est le même geste sur la même sorte de chose, **et la même course** : le milieu est le neutre et
il va des deux côtés, comme un potard d'EQ.

**Deux par deux, et dans cet ordre-là.** `STEM_GRID` n'est pas `STEMS` : l'ordre du modèle est
`drums, bass, other, vocals`, celui de la main est la section rythmique en haut et ce qui chante
en dessous. Une colonne de quatre obligeait l'œil à descendre la liste ; un carré se vise. Le
premier réflexe d'une soirée est la batterie, le second la basse — ils sont sur la même ligne. Un
test tient les deux moitiés de la propriété : que le carré contienne les quatre stems exactement
une fois, et que la première ligne soit bien la rythmique.

Ça n'a pas toujours été le cas. La course allait de « rien retiré » vers « tout retiré », dans un
seul sens. Un potard qui commence à une extrémité et dont le neutre est cette extrémité se lit
mal : la main ne trouve pas le repos, et la moitié droite de sa course — renforcer l'instrument, ce
qu'un remix demande tout le temps — n'existait pas. Le neutre est au milieu depuis, et il y est
resté à travers les deux changements de forme du module : c'est la seule chose dont il n'y a jamais
eu de doute.

Le bloc **n'a pas d'échelle à lui** : il prend celle de la tranche, pour que les potards d'un même
pupitre aient tous une taille. Ce n'est sûr que parce qu'il est plus COURT à chaque cran — deux
rangées contre trois potards d'EQ plus le filtre, plus gros, et son filet. La marge était de sept
pixels au cran le plus serré quand les quatre étaient empilés ; en deux rangées elle ne l'est plus,
et c'est le seul bénéfice de hauteur du changement. `deskLayout.test` tient quand même la
propriété à chaque cran, parce qu'elle est ce qui autorise l'emprunt — et elle se casserait comme
le filtre disparaît quand la tranche ne rétrécit pas, en débordant une boîte centrée par les deux
bouts ([deskLayout.md](deskLayout.md)).

## Quatre états, quatre lectures

| état | ce qu'on voit | ce qu'on fait |
|---|---|---|
| le set ne câble aucune coupe | **pas de bloc du tout** | rien : un pupitre sans stems est un pupitre complet |
| câblé, disque non séparé, `stems:` absent | quatre potards gris, avec la raison au survol | `playlist stems <playlist>`, ou écrire `stems: true` |
| câblé, disque non séparé, `stems: true` | quatre potards gris et **le pourcentage par-dessus** | attendre — ça se fait tout seul |
| câblé et préparé | quatre potards vifs | monter celui qu'on veut faire partir |

Le premier est délibéré : un set qui n'a pas ces lignes dans son `mapping:` n'a rien demandé,
et quatre potards morts seraient pires que pas de potards. C'est aussi pourquoi les
contrôles de stem sont **offerts sans être exigés** — `SURFACE_MAPPING_SKELETON` les propose,
`REQUIRED_CONTROLS` ne les demande pas. « Ce qu'on peut câbler » et « ce qu'il faut avoir câblé
pour que ça se dessine » sont deux listes, et les stems sont ce qui les sépare.

Le deuxième se lit sur le bloc parce que le scan le rapporte : `meta.stems` est vrai quand un
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

Le pourcentage s'affiche **par-dessus** les potards éteints — pas au-dessus : le bloc emprunte
l'échelle de tailles de la tranche (`stemStripHeight`), et une ligne de texte en plus le ferait
sortir de la hauteur qu'on lui a accordée, quelle que soit la marge du moment.

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
- **La lane du disque est VIDE quand le morceau est séparé.** Les quatre parties *sont* le disque ;
  le jouer en plus le doublerait. C'est le même `withDecks` qui décide les deux, dans les deux sens.
- **Un dossier `stems/` incomplet ne compte pas comme séparé.** `stemsComplete` demande les quatre :
  trois parties sur quatre n'est pas une séparation à moitié réussie, c'est un morceau amputé d'un
  instrument, et le poser sur une platine s'entendrait sans que rien ne le dise.
- **Le tempo ne les gêne plus.** Une somme n'exige aucune annulation, donc chaque partie s'étire
  dans son coin, keylock allumé ou pas ([bpm.md](bpm.md)).
- **Un morceau non séparé laisse ses lanes VIDES**, et c'est sa propre lane qui le joue. Poser
  quatre clips sur des fichiers absents ferait dépendre « mettre un disque » d'une heure de calcul
  que personne n'a demandée.
- **Le potard parle en proportion, pas en dB.** Ce qu'on demande est une part de l'instrument, et
  la faire disparaître doit être une position sur la course — ce qu'un plancher à −60 dB n'est pas.
- **Les stems s'écrivent en WAV 24 bits.** Pas en float, pas en FLAC : Tracktion lit un WAV
  directement et décode tout le reste dans un proxy avant de jouer, ce qui se paierait au moment
  précis où on pose un disque — cinq décodages, le mix et ses quatre stems. Le raisonnement
  complet et le tableau des tailles sont dans
  [stem-separation/docs/stemSplit.md](../../stem-separation/docs/stemSplit.md).
