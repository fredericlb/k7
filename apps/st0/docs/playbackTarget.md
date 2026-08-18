# Where the médiathèque makes sound

The library is hosted; the engines are not. So "play this" has always had two possible
answers, and until now the app picked one for you and never said which: a song's master
played in the browser, a chain variant played on the moteur. Both were right for their own
reason, and neither was a choice.

It is one now — an icon button in the header, left of the cog, holding a menu of
destinations.

## Why a menu and not a switch

Two destinations is where this starts, not where it stops. Streaming the engine's output back
to this browser is already half-built (`@studio/engine-browser/stream`, unused here), and a
machine that is neither this one nor the current engine is the obvious third. A boolean would
have to be *replaced* the day any of those lands; a list entry does not.

So `frontend/src/playback/targets.ts` is a list, and everything else reads it:

| what | reads |
|---|---|
| the menu rows | `PLAYBACK_TARGETS` — label, hint, icon, `needsEngine` |
| the button's glyph | `playbackTargetInfo(actual).icon` |
| what actually plays | `effectiveTarget(chosen, engineReady)` |
| what a stored id means | `asPlaybackTarget(value)` |

Adding a destination is an entry in that list plus a branch in whatever plays. It is
deliberately **not** a backend change: the preference is stored as a plain string (see
`prefsSchema` in `backend/src/server.ts`), because a `z.enum` would make the vocabulary
something two deployments have to agree on before either can move.

The price of that is `asPlaybackTarget`, and it is worth naming: an id this build has never
heard of — written by a newer one, in another tab — reads as the default rather than as a
destination nothing can play.

## Left of the cog, not inside it

The cog holds what you set once: which engine auditions a module, signing out. Where sound
comes out is changed *while listening* — you hear it on the wrong machine and reach for it —
so it is one click, not two, and its icon answers the question without opening anything.

## The button is honest about the fallback

A remembered "le moteur" pointing at a machine that is switched off must not mean silence.
The bytes are on the hosted library either way, so `effectiveTarget` falls back to the
browser, and both the trigger and the player's header say so (`(repli)`). The preference is
**not** rewritten: the machine coming back should restore what was asked for, not require
asking again.

That is why the menu's engine row is not disabled when nothing answers. A row you cannot
click is a row that cannot explain itself, and "that machine is off" is a different fact from
"this is not possible".

## What the engine branch actually needs

The trap this repo keeps coming back to: **two disks**. The médiathèque this browser talks to
is hosted, while the moteur opens paths on *its own* machine. So the engine branch does not
play what the browser plays — it plays the copy in that machine's cache, found the same way
`SongVariants` finds a variant and m9 finds a deck:

```
GET {fileBase}/mediatek        → the cache's absolute root on that machine   (cacheRoot)
join(root, entry.path, master) → a path the engine can open                  (playablePath)
sendProject(doc); transport()  → the document FIRST, then the verb
```

The document is `songPreviewDoc(path, name)` — a master is the audio itself, so the
chain is empty. That degenerate case is why there is no second document builder here.

### A cache root is not a copy

Only `modules` are pulled automatically (`packages/file-service/src/mediatekPull.ts`). A song
is on a given machine because something *put* it there — a mirror, a k7 publish, an analysis —
and on a fresh machine it simply is not.

The engine would then open nothing and play silence, which is the one failure a transport
cannot report: no error, just no sound. So the player asks **before** the click, with
`cachedOnMachine` — a `Range: bytes=0-0` on that machine's file route, one request rather than
one master — and the two ways it can fail are kept apart, because the answers differ:

- the machine keeps no médiathèque cache at all;
- it keeps one, and this song was never copied into it. The **Analyser** button beside the
  waveform is the way out, since an analysis downloads the master into that cache on its way
  to computing the sidecar.

`root` is `string | null | undefined` for the same reason `choice.loaded` exists next door:
`undefined` is "not looked yet" and `null` is "no cache". Merged into one nullable, the Play
button greys out for the moment every song spends waiting, which reads as a fault rather than
as a wait.

### Say where to start, always

`EngineHost::play` repositions the playhead only when the transport is **looping**; otherwise
it resumes from wherever it was left. And a session outlives the documents put through it — it
is keyed by service and person, not by what is loaded — so the playhead sitting there belongs
to whatever this account last auditioned on that machine: a module preview, a chain variant, a
longer song.

Send a master and press play with no position, and the transport rolls from a point past the
end of the clip. `playing` is true, the playhead advances, the meters move, and there is **no
sound** — a failure whose only symptom is the absence of one.

So `play(doc, fromSeconds)` takes the position, between the document and the verb: the
position belongs to the document just applied, and asking for it after `play` would be heard
as a jump. `SongVariants` passes `0` — a variant is auditioned from the top; the player passes
where the waveform was scrubbed to, which is `0` for a song not started yet.

### A clean edit, because an apply is a diff

The first real "no sound" was none of the above. Measured against the running moteur, the st0
session held this:

```
sessions      → { id: "st0:fred_parapluie_org", playing: true, project: "preview: <a song>" }
edit-plugins  → [ "preview:crossfade / DSP Graph" ]
state         → levels: [-100]        ← the track's output. Silence, while rolling.
```

The song's document was applied — the project name is the song's — and a **module** audition's
plugin was still on the track. The master ran through a `crossfade` graph nobody had asked for
and came out at -100 dB. The transport reported `playing: true` throughout.

Sending a document with `plugins: []` did **not** remove it. `drop-session` did, and the
identical document then played at -25.8 dB.

The reason is structural: an apply is a **diff**, and a diff can only remove what the engine's
stored document says is there. An edit that holds a plugin that document does not mention is
therefore unreachable — `needsFullRebuild` never fires, nothing rebuilds, and the plugin stays
for the life of the session. Since a session is keyed by service and person rather than by what
is loaded, "the life of the session" means until the engine process exits.

So a document this session has not held is preceded by `reset()` — `dropSession`, which throws
the edit away so the next apply builds one from nothing. Only when the document CHANGES: a
pause and a resume must not rebuild the edit under the transport.

**What is not established**: how the edit came to hold a plugin its document did not. Auditioning
a module and then playing a master, on a fresh session, removes the plugin correctly — that was
tried and it works. So this is a state the engine can reach and cannot leave, reached by a path
not yet identified. `reset()` makes st0 immune to it rather than fixing it, and the engine-side
inconsistency is still worth hunting.

### The playhead is only ours while our document is loaded

For the same reason, the player does not read `engine.playhead` unconditionally. That session
is shared with everything else st0 auditions, so an unqualified read would draw another
document's position on this song's waveform — and, worse, hand it back as the point to resume
from, which is the bug above with extra steps. `loadedPath` is what makes "is this ours" a
question with an answer.

### What the engine says is kept

`onWarning` was not subscribed to, and that is expensive exactly here: a document naming a file
the engine cannot open raises `clip source not found/invalid: <path>` and then plays silence.
The engine *does* account for itself; st0 was throwing the account away. It is now the first
thing the player's footer says, above every locally-derived message, because it is the only
one that comes from the machine actually holding the file.

Beside it, `sent` — a document went and nothing has rolled — covers the same failure seen from
this side before the machine has said anything. Without it the screen is identical to a
transport nobody asked to start.

## One socket per screen

`SongEditor` opens `useModuleEngine` **once** and hands it to both panes. It used to live
inside `SongVariants`, which was correct while that pane was the only thing here that made the
moteur play; the player can ask for the same engine now, and two hooks would be two
connections to one machine from one tab — the very thing `useEngineChoice` exists not to do.

Stopping on the way out moved with it, to the editor. The panes share a transport anyway: one
engine, one session, one thing playing at a time.

`useModuleEngine` grew two things for this — `onState` (so `playing` and the playhead come
from the machine that is actually playing, never from a hopeful local flag) and `seek`. The
seek is applied locally as well as sent, because the state frame is ~20 Hz and a playhead that
only ever came back from the engine would lag a drag on the waveform enough to read as the
cursor snapping back.

## What the choice does not cover

**Chain variants.** A variant *is* a graph of plugins, and only a moteur runs those. There is
no browser answer to fall back to, so `SongVariants` ignores the destination rather than
offering a choice one side of which would be silence. Same for the module builder, whose whole
point is asking a loaded plugin what its parameters are.

**Samples and recordings.** They have no play button yet, here or anywhere. When they get one,
this is the setting it reads.

So today the destination governs exactly one thing: a song's master. That is the surface where
both answers are real.

## La troisième : les enceintes de la machine

`machine` joue le fichier que la machine cache déjà, par `mpv`, sur ses propres sorties — **sans
rien demander au moteur**. On peut donc écouter pendant que l8 s'en sert. Le pourquoi et les
détails de la machine sont dans
[packages/file-service/docs/machinePlayer.md](../../../packages/file-service/docs/machinePlayer.md).

Deux choses valent d'être dites ici, parce qu'elles sont la conséquence de cette liste :

`needsEngine: true` **bien qu'elle ne lui demande rien**. La machine est découverte par le
registre des moteurs — la sonde ouvre un WebSocket vers le moteur, et c'est de l'hôte qui répond
que `fileBase` et le jeton sont tirés. Sans moteur joignable, il n'y a personne à qui parler. Le
drapeau dit « cette destination a besoin d'un moteur joignable », pas « elle le fait jouer », et
c'est bien ce qu'il faut ici : `effectiveTarget` retombera sur le navigateur, ce qui est le bon
repli.

Elle ne demande **aucune résolution** côté navigateur, à l'inverse du moteur qui a besoin de
`cacheRoot` puis `playablePath`. `NowPlaying.path` est déjà relatif à la médiathèque : il part
tel quel, et c'est la machine qui le résout contre sa propre racine — ce qui est aussi le
garde-fou, un client ne pouvant nommer que ce qu'elle cache.

## The preference, and the trap under it

It lives on the account, beside the engine id, in the same per-user JSON
(`packages/user-prefs/docs/store.md`).

That store **replaces wholesale** — a merge would make a field impossible to clear — which
means two settings that each PUT their own field erase each other. `frontend/src/prefs.ts` is
the answer: one holder for the whole document, `patchPrefs` for a change, and nothing else
calls `savePrefs`. `useEngineChoice` was moved onto it in the same change; before this there
was only one field, so the bug had nowhere to happen yet.

`RegistryClient` in `@studio/engine-browser` is now generic in that shape (`P`), defaulted to
`{engineId?}`. The schema belongs to the host, and a union of every service's fields would be
a shape no service actually has: st0 remembers where playback happens, l8 does not.
