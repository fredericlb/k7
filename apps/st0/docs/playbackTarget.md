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

The document is `chainPreviewDoc(path, name, [])` — a master is the audio itself, so the
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
