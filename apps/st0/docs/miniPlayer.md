# The bar at the bottom, and what had to move for it

A song used to be playable only from its own screen, by that screen. Leaving it stopped the
sound — the pane owned the `<audio>` element, and the editor stopped the engine on its way out.

That is exactly what a bar at the bottom cannot live with. So playback moved **above the
screens**, into `PlaybackProvider`, and what is left in the song's pane is a *view* of it.

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

## One socket, and why this is what forced it

`useModuleEngine` used to be opened per screen — the module editor's, the song editor's, the
engine page's. That was safe only because those screens replaced one another, and it is exactly
what a song that keeps playing breaks: its transport has to outlive the screen that started it,
and a second socket would be a second client on the same session, driving the same project.

So the provider holds one and hands it out through `useEngine()`. Four call sites changed:

| was | now |
|---|---|
| `SongEditor` opened one and passed it down | asks for the app's, passes it down |
| `ModuleEditor` took `engineId` and opened one | `useEngine()`; the pick follows on its own |
| `ModuleParams` opened one | `useEngine()` |
| `EnginePage` built an `EngineClient` by hand | `useEngine().client` |

`EnginePage` is why `ModuleEngine` exposes `client` and `connected` at all: its questions are
the MACHINE's — the device list, the session list, the installed catalogue — not a project's,
and wrapping a dozen verbs to keep the object private would buy nothing. `connected` exists
because `phase: ready` only says a socket was made and told to connect, while that page has to
ask its questions once the socket is actually open; `onConnected` does not replay a state it
already reached, so the queries are issued on mount instead.

## What the bar does not follow

**A chain variant.** Auditioning one takes the engine's transport away from whatever the bar
was following — one session plays one thing — so `SongVariants` calls `playback.close()` first.
The bar goes rather than going on reporting a master that stopped being audible. A variant is
an audition inside the editor; it is not a thing you walk away from.

## Where a failure is said

The engine's own complaints stay on `useEngine().warning`, read by the song's pane. The bar
carries the one failure that belongs to it: a master the browser could not load, which is
silence with nothing else on screen left to say so once the song's pane has been left behind.
