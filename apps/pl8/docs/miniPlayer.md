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
local `cursor`, and pressing play starts from there.

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

`EnginePage` is why `ModuleEngine` exposes `client` and `connected` at all: its questions are
the MACHINE's — the device list, the session list, the installed catalogue — not a project's,
and wrapping a dozen verbs to keep the object private would buy nothing. `connected` exists
because `phase: ready` only says a socket was made and told to connect, while that page has to
ask its questions once the socket is actually open; `onConnected` does not replay a state it
already reached, so the queries are issued on mount instead.

## The play queue

Right-click a song in the tree → "Ajouter à la liste de lecture". A song that ends chains into
the next. The button right of the bar opens it: rows can be moved and removed there.

### A queue is not a playlist

The two words look alike; the two things have nothing to do with each other:

| | the queue | a playlist |
|---|---|---|
| what it is | **what you are listening to now** | **a document** |
| where it lives | in the tab, in memory | a YAML file under `_playlists/`, in the repository |
| who sees it | this tab | everyone, and the editor on the left |
| survives | navigating between screens | everything |

So it never goes to the server, and it disappears on reload — like any player's queue. What you
want to keep goes into a playlist, written in st0 over this same catalogue
(`packages/song/docs/playlists.md`).

### The Library holds it, not the provider

That looks backwards and is forced: `Library` **renders** `PlaybackProvider`, so it is above the
context and cannot call `usePlayback()` — and it is the one holding the tree whose right-click
fills the queue. The `usePlayQueue` hook therefore lives at the top and the provider receives it
as a prop, then re-broadcasts it: one queue per tab, above the screens, like the transport
itself.

### Only one thing chains

This queue is the sole claimant: it listens for `ended` and starts the next. So there is no
arbitration, and none is needed — arbitration with one claimant arbitrates nothing and would
make a reader believe there are two. Playlists open in st0, with a transport of their own.

The shape of the bug to avoid the day a second thing can chain here: two independent subscribers
to the same event, each starting a song, neither knowing the other exists — last write wins, at
random. The claim then has to be a **counter** and not a boolean, because two panels can be
mounted for the length of a screen transition.

### The cold start

Advancing only listens for the **end** of a song, so adding to an empty-transport queue would
sit there indefinitely — which no player does. A second effect starts the head when `now` is
null and the queue is not empty.

It never fires between two tracks: `now` is not cleared when a song ends ("what I have just
heard" outlives the last sample), so the case only arises before the first play or after closing
the bar.

And the bar appears for a non-empty queue, not only for a loaded song: otherwise the button that
shows the queue would live in a bar the queue is not enough to raise, and you would add a song
with nowhere to see it.

### What is skipped and what stops

A song with no master is **skipped**: the queue carries on. A machine with no cache **stops** —
the fault belongs to the destination and not to the row, and emptying the queue for that would
erase what someone has just put in it. st0's playlist pane makes the same split, for the same
reason.

Finally, `enqueue` refuses duplicates and `moveTo` takes the INTENDED index in the final list —
inserting at the starting index would make a downward move one notch short, and the button would
seem dead. Both are tested in `playback/queue.test.ts`.

## Where a failure is said

The engine's own complaints stay on `useEngine().warning`, read by the song's pane. The bar
carries the one failure that belongs to it: a master the browser could not load, which is
silence with nothing else on screen left to say so once the song's pane has been left behind.
