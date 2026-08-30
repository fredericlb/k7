# Where the médiathèque makes sound

The library is hosted; the engines are not. So "play this" has more than one possible answer —
this browser, the chosen machine's moteur, that machine's own speakers — and which one is a
CHOICE, not something the app picks for you in silence: an icon button in the header, left of
the cog, holding a menu of destinations.

## Why a menu and not a switch

Two destinations is where this starts, not where it stops. Streaming the engine's output back to
this browser is already half-built (`@studio/engine-browser/stream`, unused here), and a machine
that is neither this one nor the current engine is the obvious third. A boolean would have to be
*replaced* the day any of those lands; a list entry does not.

So `frontend/src/playback/targets.ts` is a list, and everything else reads it:

| what | reads |
|---|---|
| the menu rows | `PLAYBACK_TARGETS` — label, hint, icon, `needsEngine` |
| the button's glyph | `playbackTargetInfo(actual).icon` |
| what actually plays | `effectiveTarget(chosen, engineReady)` |
| what a stored id means | `asPlaybackTarget(value)` |

Adding a destination is an entry in that list plus a branch in whatever plays. It is deliberately
**not** a backend change: the preference is stored as a plain string (see `prefsSchema` in
`backend/src/server.ts`), because a `z.enum` would make the vocabulary something two deployments
have to agree on before either can move. The price is `asPlaybackTarget`: an id this build has
never heard of — written by a newer one, in another tab — reads as the default rather than as a
destination nothing can play.

## Left of the cog, not inside it

The cog holds what you set once: which engine auditions a module, signing out. Where sound comes
out is changed *while listening* — you hear it on the wrong machine and reach for it — so it is
one click, not two, and its icon answers the question without opening anything.

## The button is honest about the fallback

A remembered "le moteur" pointing at a machine that is switched off must not mean silence. The
bytes are on the hosted library either way, so `effectiveTarget` falls back to the browser, and
both the trigger and the player's header say so (`(repli)`). The preference is **not** rewritten:
the machine coming back should restore what was asked for, not require asking again.

That is why the menu's engine row is not disabled when nothing answers. A row you cannot click is
a row that cannot explain itself, and "that machine is off" is a different fact from "this is not
possible".

## What the engine branch actually needs

The trap this repo keeps coming back to: **two disks**. The médiathèque this browser talks to is
hosted, while the moteur opens paths on *its own* machine. So the engine branch does not play what
the browser plays — it plays the copy in that machine's cache, found the same way the DJ desk
finds a deck:

```
GET {fileBase}/mediatek        → the cache's absolute root on that machine   (cacheRoot)
join(root, entry.path, master) → a path the engine can open                  (playablePath)
sendProject(doc); transport()  → the document FIRST, then the verb
```

The document is `songPreviewDoc(path, name)` — a master is the audio itself, so the chain is
empty. That degenerate case is why there is no second document builder here.

### A cache root is not a copy

Only `modules` are pulled automatically (`packages/file-service/src/mediatekPull.ts`). A song is
on a given machine because something *put* it there — a mirror, a k7 publish, an analysis — and on
a fresh machine it simply is not.

The engine would then open nothing and play silence, which is the one failure a transport cannot
report: no error, just no sound. So the player asks **before** the click, with `cachedOnMachine` —
a `Range: bytes=0-0` on that machine's file route, one request rather than one master — and the
two ways it can fail are kept apart, because the answers differ:

- the machine keeps no médiathèque cache at all;
- it keeps one, and this song was never copied into it. The **Analyser** button beside the
  waveform is the way out, since an analysis downloads the master into that cache on its way to
  computing the sidecar.

`root` is `string | null | undefined` for the same reason `choice.loaded` exists next door:
`undefined` is "not looked yet" and `null` is "no cache". Merged into one nullable, the Play
button greys out for the moment every song spends waiting, which reads as a fault rather than as a
wait.

### Say where to start, always

`EngineHost::play` repositions the playhead only when the transport is **looping**; otherwise it
resumes from wherever it was left. And a session outlives the documents put through it — it is
keyed by service and person, not by what is loaded — so the playhead sitting there belongs to
whatever this account last auditioned on that machine, very likely a longer song.

Send a master and press play with no position, and the transport rolls from a point past the end
of the clip. `playing` is true, the playhead advances, the meters move, and there is **no sound** —
a failure whose only symptom is the absence of one.

So `play(doc, fromSeconds)` takes the position, between the document and the verb: the position
belongs to the document just applied, and asking for it after `play` would be heard as a jump. The
player passes where the waveform was scrubbed to, which is `0` for a song not started yet.

### A clean edit, because an apply is a diff

An apply is a **diff**, and a diff can only remove what the engine's stored document says is
there. An edit holding a plugin that document does not mention is therefore unreachable —
`needsFullRebuild` never fires, nothing rebuilds, and the plugin stays for the life of the
session, which means until the engine process exits.

The symptom is silence while everything reports fine. Asking the running moteur reads
`sessions` → the song's own project name, `playing: true`; `edit-plugins` → a plugin from some
other audition still on the track; `state` → `levels: [-100]` while rolling. Sending a document
with `plugins: []` does **not** remove it; `drop-session` does, and the identical document then
plays at −25.8 dB.

So a document this session has not held is preceded by `reset()` — `dropSession`, which throws the
edit away so the next apply builds one from nothing. Only when the document CHANGES: a pause and a
resume must not rebuild the edit under the transport.

**What is not established**: how the edit comes to hold a plugin its document does not. On a fresh
session the removal works correctly, so this is a state the engine can reach and cannot leave, by
a path nobody has identified. `reset()` makes pl8 immune to it rather than fixing it, and the
engine-side inconsistency is still worth hunting.

### The playhead is only ours while our document is loaded

For the same reason, the player does not read `engine.playhead` unconditionally. That session is
shared with everything else pl8 auditions, so an unqualified read would draw another document's
position on this song's waveform — and, worse, hand it back as the point to resume from, which is
the bug above with extra steps. `loadedPath` is what makes "is this ours" a question with an
answer.

### What the engine says is kept

`onWarning` is subscribed to, and it earns its keep exactly here: a document naming a file the
engine cannot open raises `clip source not found/invalid: <path>` and then plays silence. It is
the first thing the player's footer says, above every locally-derived message, because it is the
only one that comes from the machine actually holding the file.

Beside it, `sent` — a document went and nothing has rolled — covers the same failure seen from
this side before the machine has said anything. Without it the screen is identical to a transport
nobody asked to start.

## One socket for the tab

`PlaybackProvider` opens `useModuleEngine` **once** and hands it out through `useEngine()`. Two
hooks would be two connections to one machine from one tab — the very thing `useEngineChoice`
exists not to do — and a song that keeps playing across screens needs the socket to outlive any
one of them. One engine, one session, one thing playing at a time.

`useModuleEngine` carries two things for this — `onState` (so `playing` and the playhead come from
the machine that is actually playing, never from a hopeful local flag) and `seek`. The seek is
applied locally as well as sent, because the state frame is ~20 Hz and a playhead that only ever
came back from the engine would lag a drag on the waveform enough to read as the cursor snapping
back.

## What the choice does not cover

**Samples and recordings.** They have no play button, here or anywhere. When they get one, this is
the setting it reads. So the destination governs exactly one thing: a song's audio, master or
variant.

## The third: the machine's speakers

`machine` plays the file the machine already caches, through `mpv`, on its own outputs — **asking
the engine for nothing**. So you can listen while st0 is using it. The why and the machine-side
detail are in
[packages/file-service/docs/machinePlayer.md](../../../packages/file-service/docs/machinePlayer.md).

Two things follow from it being an entry in this list. `needsEngine: true` **although it asks the
engine for nothing**: the machine is discovered through the engine registry — the probe opens a
WebSocket to the moteur, and `fileBase` and the token are taken from the host that answers. With no
reachable engine there is nobody to talk to. The flag says "this destination needs a reachable
engine", not "it makes the engine play", and that is what is wanted here: `effectiveTarget` falls
back to the browser.

And it needs **no resolution** browser-side, unlike the engine, which wants `cacheRoot` and then
`playablePath`. `NowPlaying.path` is already relative to the médiathèque: it goes as is and the
machine resolves it against its own root — which is also the guard, a client being able to name
only what it caches.

## The preference, and the trap under it

It lives on the account, beside the engine id, in the same per-user JSON
(`packages/user-prefs/docs/store.md`).

That store **replaces wholesale** — a merge would make a field impossible to clear — which means
two settings that each PUT their own field erase each other. `frontend/src/prefs.ts` is the answer:
one holder for the whole document, `patchPrefs` for a change, and nothing else calls `savePrefs` —
`useEngineChoice` included.

`RegistryClient` in `@studio/engine-browser` is generic in that shape (`P`), defaulted to
`{engineId?}`. The schema belongs to the host, and a union of every service's fields would be a
shape no service actually has: pl8 remembers where playback happens, st0 does not.
