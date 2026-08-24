# The bar at the bottom

Playback lives **above the screens**, in `PlaybackProvider`, and what the song's pane holds is
a *view* of it. A bar at the bottom cannot live with a pane that owns the `<audio>` element and
an editor that stops the engine on its way out: leaving the screen would stop the sound.

```
PlaybackProvider ── the <audio> element, what is loaded, the one engine socket
   ├── the screens (catalogue, song editor, module editor, engine page)
   ├── MiniPlayer        ← the view that outlives all of them
   └── EngineStatusBar
```

## One transport, two readings

`SongPlayer` and `MiniPlayer` show the same thing and neither owns it. The song pane draws the
waveform of the song **it** is open on, which is not necessarily the one playing — you start
one and go and look at another — so it compares `playback.now.path` with its own and shows a
transport at rest when they differ. `path` is the identity: two songs can share a name.

Before the open song is the playing one, the waveform still scrubs: the position goes into a
local `cursor`, and pressing play starts from there. Clicking into a song and hitting play does
the obvious thing, which is what that state is for.

## The bar stays when the song ends

`close()` is the only thing that clears `now`, and it is on the button top right. A song
running out does not clear it, because "what was that" outlives the last sample — the bar then
reads `terminé`, and the play button restarts it from the top.

For the browser that is free: `play()` on an element sitting at the end rewinds itself. For the
engine it is not — the engine resumes from where its playhead was left, and never rewinds
unless it is looping — so the position past the end is turned back into 0 explicitly. See
[playbackTarget.md](playbackTarget.md), "say where to start".

## The progress bar is an `<input type="range">`

Not a div with a click handler. Dragging, the keyboard and the accessible name all come with
it, and a progress bar that cannot be scrubbed is one people try to scrub anyway. It is
`disabled` until a duration exists, since a range with no maximum is a control that lies about
where you are.

The duration comes from the `<audio>` element, which is mounted for whatever is loaded **even
when the engine is what plays it**: the engine's state frame carries a playhead and no length,
and a metadata request is cheaper than a second source of truth.

## One socket

`useModuleEngine` is opened once, by the provider, and handed out through `useEngine()`. One
per screen would be safe only while screens replace one another, and a song that keeps playing
breaks exactly that: its transport has to outlive the screen that started it, and a second
socket is a second client on the same session, driving the same project.

So `SongPlayer` calls `useEngine()`, and `EnginePage` takes `useEngine().client`.

`EnginePage` is why `ModuleEngine` exposes `client` and `connected` at all: its questions are
the MACHINE's — the device list, the session list, the installed catalogue — not a project's,
and wrapping a dozen verbs to keep the object private would buy nothing. `connected` exists
because `phase: ready` only says a socket was made and told to connect, while that page has to
ask its questions once the socket is actually open; `onConnected` does not replay a state it
already reached, so the queries are issued on mount instead.

## La liste de lecture

Clic droit sur un morceau dans l'arbre → « Ajouter à la liste de lecture ». Un morceau qui se
termine enchaîne sur le suivant. Le bouton à droite de la barre l'ouvre : on y déplace et on y
retire des lignes.

### Une file d'attente n'est pas une playlist

Les deux mots se ressemblent, les deux choses n'ont rien à voir :

| | la file d'attente | une playlist |
|---|---|---|
| ce que c'est | **ce qu'on écoute maintenant** | **un document** |
| où elle vit | dans l'onglet, en mémoire | un fichier YAML sous `_playlists/`, dans le dépôt |
| qui la voit | cet onglet | tout le monde, et l'éditeur à gauche |
| survit à | la navigation entre écrans | tout |

Elle ne va donc pas sur le serveur, et elle disparaît au rechargement — comme la file de
n'importe quel lecteur. Ce qu'on veut garder se met dans une playlist, qui s'écrit en st0 sur
ce même catalogue (`packages/song/docs/playlists.md`).

### Elle est tenue par la Library, pas par le provider

Ça a l'air à l'envers, et c'est forcé : `Library` **rend** `PlaybackProvider`, elle est donc
au-dessus du contexte et ne peut pas appeler `usePlayback()`. Or c'est elle qui porte l'arbre
dont le clic droit remplit la file. Le hook `usePlayQueue` vit donc en haut et le provider le
reçoit en prop, puis le rediffuse — une seule file par onglet, au-dessus des écrans, comme le
transport lui-même.

### Une seule chose enchaîne

Cette file est le seul prétendant : elle écoute `ended` et démarre le suivant. Il n'y a donc
aucun arbitrage, et il n'en faut pas — un arbitrage à un seul prétendant n'arbitre rien et
ferait croire à un lecteur qu'il y en a deux. Les playlists s'ouvrent en st0, avec un transport
à elles (`packages/song/docs/playlists.md`).

La forme du bug à éviter le jour où une deuxième chose saura enchaîner ici : deux abonnés
indépendants au même événement, chacun démarrant un morceau, aucun ne sachant que l'autre
existe — le dernier écrit gagne, au hasard. La revendication doit alors être un **compteur** et
non un booléen, parce que deux panneaux peuvent être montés le temps d'une transition d'écran.

### Le démarrage à froid

L'avance n'écoute que la **fin** d'un morceau. Ajouter à une file alors que rien ne joue
resterait donc là indéfiniment — ce qu'un lecteur ne fait pas. Un second effet démarre la tête
quand `now` est nul et que la file n'est pas vide.

Ça ne se déclenche jamais entre deux titres : `now` n'est pas vidé quand un morceau se termine
(« ce que je viens d'écouter » survit au dernier échantillon), donc le cas ne se présente
qu'avant la première lecture ou après avoir fermé la barre.

Et la barre apparaît pour une file non vide, pas seulement pour un morceau chargé : sinon le
bouton qui montre la file vivrait dans une barre que la file ne suffit pas à faire apparaître,
et on ajouterait un morceau sans nulle part où le voir.

### Ce qui est sauté et ce qui arrête

Un morceau sans master est **sauté** : la file continue. Une machine sans cache **arrête** — le
défaut est celui de la destination et non de la ligne, et vider la file pour ça effacerait ce
que quelqu'un vient d'y mettre. Le panneau des playlists de st0 fait le même partage, pour la
même raison.

Enfin, `enqueue` refuse les doublons et `moveTo` prend l'indice VOULU dans la liste finale —
insérer à l'indice de départ ferait un déplacement d'un cran trop court vers le bas, et le
bouton semblerait mort. Les deux sont testés dans `playback/queue.test.ts`.

## Where a failure is said

The engine's own complaints stay on `useEngine().warning`, read by the song's pane. The bar
carries the one failure that belongs to it: a master the browser could not load, which is
silence with nothing else on screen left to say so once the song's pane has been left behind.
