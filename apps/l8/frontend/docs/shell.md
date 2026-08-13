# The shell (`App.tsx` and `main.tsx`)

## What wraps the editor (`main.tsx`)

The gates, outermost first: **AuthGate** (you must be signed in — hosted backend OIDC),
**EngineGate** (pick which registered engine to drive), and **ProjectGate** (rendered by
EngineGate: resolve the repository this editor was opened on into a folder on that engine's
machine — cloning it if it has never been there — then mount the editor). Several tabs may
open one project at once — there is no single-tab lease.

**ProjectGate picks nothing.** l8 no longer knows what a workspace list is: st0 owns the
repositories and links here with an address — `/l8/<repo>/<project>` — and arriving without a
project in it sends you back there. That prefix is the router's `basename`, so the app's own
routes are written below it and cannot rewrite it away. The gate is
`@studio/project-shell`'s — z0's editor mounts the same one — and `components/ProjectGate.tsx` only
supplies this app's wording. Read
[packages/project-shell/docs/launch.md](../../../../packages/project-shell/docs/launch.md)
before touching any of it, in particular why the address is a path and the repository is named
rather than spelled out.

`LocaleProvider` sits above all of them: switching language remounts its children, so
nothing that renders a message may live above it.

`BrowserRouter` sits *outside* the gates. The URL names a **screen of the editor**, and the
gates are conditions for reaching it rather than places of their own — so a deep link like
`/timeline?panel=logs` survives them: you sign in, pick an engine, and land where the link
pointed.

### React.StrictMode is deliberately NOT used

In dev it mounts, unmounts and remounts every component, and for the imperative WebGL
renderer here (the ui-eyes video compositor) each mount creates and then tears down a WebGL
context. On Firefox that context thrash was losing the context and freezing the tab for
seconds while everything was re-uploaded to restore it — confirmed: the freezes stop with
StrictMode off.

StrictMode's double-invoke exists to surface effect-cleanup bugs, but an
async-initialised WebGL renderer cannot be made double-mount-safe cheaply, and the freeze
is a real user-facing cost. So the dev check is forgone here on purpose. (The chains graph
used to be a second such renderer; it is the DOM now, and double-mounts harmlessly.)

### …and the Profiler is behind a flag, for a related reason

`main.tsx` can wrap the tree in a `<Profiler>` feeding `freezeWatchdog`'s `reportCommit`, so a
stall report can say which COMMIT it was and not merely how long it lasted. Only commits over
the watchdog's threshold are kept — but the instrumentation bills **every** commit in the
subtree to find them, and this tree commits on meter frames. It is therefore off unless asked
for: `?profile=1`, or `studio.profile` in localStorage so it survives the reloads an
investigation takes. `installFreezeWatchdog()` itself stays unconditional — the heartbeat and
the `longtask` observer are cheap and are what turn "it froze" into evidence at all.

## The layout (`App.tsx`)

`App` is the l8 web editor itself: the global view — **the timeline over the chains graph,
full width** — with the transport controls and the pane toggles in the header. It is the
wiring and the layout; almost nothing else.

There is a second layout, and it is not a second *choice*: a project whose `project.yaml` says
`project_type: live` has no arrangement, so `App` draws **the chains graph on the whole screen**
and the timeline's furniture goes with it — the transport (every control on it addresses a
position in a song), the minimap (a second view of that song), the pane buttons, the mobile tabs.
The module bench is one. The editor is still one right-click away, as a popin, which is what keeps
the builder reachable there. See
[packages/song/docs/projectMode.md](../../../../packages/song/docs/projectMode.md).

**The timeline itself is a SURFACE, and the project has to ask for it.** `surfaces/timeline.yaml`
(`type: timeline`, `layout: split`) is what puts it in the layout; a folder without one opens on
its graph, keeps its editor, and is warned about in its diagnostics. So `noArrangement` — not
`live` — is what the transport, the minimap and the graph's claim on the column now read: a rig
and a song that has not declared its arrangement look alike on screen and are not the same fact.
See [packages/song/docs/surfaces.md](../../../../packages/song/docs/surfaces.md).

**The VIEWPORT is the second of those**, `surfaces/viewport.yaml`, and it sits above the
timeline in the same column. Its mounting rule is the one that matters: it owns a WebGL context
and one `<video>` per layer, so it is hidden and never unmounted — the same invariant the
editor's undo history relies on, protecting something more expensive. See
[picture.md](picture.md).

The editor is not in it. It had the left half, which meant every song opened with half the
screen showing a YAML file you had not asked for, while the two views of the song that are
*about the song* — where things happen in time, and how the signal flows — shared the other
half. So the default is the two that answer "what is this song", and the editor is summoned:
`ui editor` gives it the screen, and a command that sends it to a file opens it as a popin
(below). It stays mounted throughout, so summoning it costs nothing.

See also [shellRouting.md](shellRouting.md) for how the screen state maps to the URL.

### The Mixer is an ARRANGEMENT of the graph, not a panel

It used to be one of the bottom panels; it is not any more. And it is not a second picture
either: it is **the same graph** — same nodes, same cards, same cables — with the strips pulled
onto one rank.

Every track ends on a mixer module (`trackMixer`, by plugin type), but a track with a longer
chain ends DEEPER, so by default the mixers sit on a staircase and no zoom shows them all. Give
them a shared rank and dagre lays them side by side, evenly spaced by its own `nodesep`, and
re-ranks whatever has to move to keep every edge pointing down the page. That is the whole
mechanism: `alignModuleRank` in `@studio/ui-chains`, applied between `buildGraph` and `layout`.

The shared rank is the **deepest** of theirs, never a shallower one — pulling a mixer up would
put it above modules that feed it, and an edge that has to climb is a cable drawn backwards.
Sinks are pushed past the row for the same reason.

The camera pulls back a fifth from a perfect fit (`ROW_ZOOM_OUT`). A row framed exactly fills
the pane edge to edge and reads as a wall: the strips are the subject, but what feeds them is
the sentence, and a little air is what says the row belongs to a graph.

One rank puts them on a line; it does not give that line a rhythm. dagre spaces a rank by what
is ABOVE it, so a track carrying a send has a wider column and pushes its mixer away from its
neighbour — a scattered row rather than a console. `spaceModulesEvenly` then re-spaces them
along x with one constant gap, in the song's track order, starting where the row already began.

What that costs is upstream, and it is meant to: the chains feeding the row stop being straight
columns. The dagre waypoints of every cable touching a moved card are dropped with it — they
described a bend around a card that has since moved, and a stale bend is worse than none.
`cablePath` re-derives both ENDS from the nodes themselves, so what is left is a clean lead out
of one socket and into the next.

Known limit: a non-mixer node that happens to sit on the shared rank is not moved out of the
row's way. In practice the row packs TIGHTER than dagre spaced it (gap 24 against `nodesep` 60),
so it shrinks leftward rather than sprawling — but a song that puts something else at that depth
could see an overlap.

The camera then frames those nodes, which is what "zoomed in" means here. It frames on the way
IN only: coming back to the plain graph leaves the camera where you had panned it.

That framing is the whole visible effect, so it must not be allowed to fail quietly. `fitTo`
answers whether it ACTUALLY framed — a pane still hidden has no size and frames nothing — and
the view records the attempt as done only then. Recording a frame that never happened spends
the one chance that key ever gets, and the result is a button that appears to do nothing.

It frames the row **left-aligned**, not centred (`frameOriginX`). A rank wider than the pane,
centred, puts its middle on screen and hides both ends — and the first channel is the one you
look for to know where you are. The tail runs off the right, where it pans.

And it **gives the camera back**. Opening the view remembers where the camera was and closing it
puts it there, through `ChainsCamApi` — a view that borrows the camera to show itself owes it
afterwards, or every visit to the mixer costs you your place in the graph. Remembered on the way
in only, and only once the frame actually happened: saving the row's own camera on a re-run
would hand that back as if it were where you had been.

Which modules are strips is the project's answer, not the package's — `mixerStrips.ts` reads it
off the compiled doc and `useProjectDoc` hands the list up, so the row and the faders can never
be one reload apart.

**A song can have no strips at all, and most do not.** A strip is a module of plugin type
`Mixer` (`trackMixer`, `MIXER_PLUGIN`) at the end of a track, and nothing puts one there for
you — of the songs in a default workspace, none has two. So the button is **disabled** when the
count is zero and says why in its tooltip, and clicking it with one strip sets a status line
saying there is nothing to line up. That silence is what the bottom panel used to break with a
line of text, and dropping the panel dropped the only thing that explained an empty mixer: a
control that answers a click with nothing is worse than one that is visibly unavailable.

The cards themselves were never hand-rolled, and that is why this works at all. A strip's
controls are its module's own panel — the very card the graph draws. There used to be a
hand-rolled strip per track: a VU, a fader, a pan slider, M and S. That was a
second implementation of a channel strip, and it drifted from the one the module's own
`ui.yaml` declares — a module could grow a knob and the panel would never show it. Now
whatever the mixer module's panel says IS the mixer, and the two cannot disagree because
they are the same card in the same graph.

Three consequences, all of them the design rather than gaps:

- **A track with no mixer module has no strip.** It is not "at unity" — it is a track with
  nowhere to put a level, and no card of its own to show. It simply is not in the row.
- **Mute and solo are not here.** They were never the strip's — they are the track's, and
  they live on the timeline (`m`/`s`) and on the graph's track nodes.
- **Two tracks sharing a strip draw one card.** In practice the compiler makes such a strip
  its own bus track, so it arrives once anyway; `mixerModules` de-duplicates regardless,
  because two cards for one value would be two controls fighting.

Two sources, because neither answers alone: the compiled project says *which* modules are
strips (the graph doc does not carry a plugin type), and the graph says what each one looks
like and what feeds it.

The **sockets stay**, and the cables with them. That is the difference from the row this
replaced, which drew the strips alone and dropped every jack because it had no edges to plug
them into. Here you can see what reaches a fader without leaving the view — which is most of
why the mixer belongs in the graph rather than beside it.

`moduleRow` in `@studio/ui-chains` still exists and still lays a bare rank of cards out; it has
no caller since the mixer moved. Listed in [inventaire.md](../../../../docs/inventaire.md)
rather than deleted, because it is tested and the decision to drop it is not this change's.

#### It frames the HEIGHT, and the row pans

`fitTo(..., "height")`, not the default fit-both. This is not a preference: fitting both axes
divides the pane between however many strips the song has, and the camera scale falls with
every track added. Below `WIDGET_MIN_SCALE` (0.6) the renderer drops the widget grid
altogether — so a busy song's mixer would frame to a rank of bare name cards, which is the one
thing this view must not do. Measured on a 1200×280 pane with a 3×6 strip grid:

| strips | fit-both | fit-height |
|---|---|---|
| 4 | k 0.85, card 152×225 | k 0.85, card 152×225 |
| 8 | k 0.66, card 119×175 | k 0.85, card 152×225 |
| 12 | **k 0.44 — widgets dropped** | k 0.85, card 152×225 |

Framing the height instead keeps every strip the same readable size whatever the track count,
and lets the row run off the right, where it pans. A mixer you have to scroll beats one you
cannot read.

One thing the old bottom panel had and this does not: it drew its cards at 1.5× the width
their grid asked for, elbow room that a rank of strips read better with. Here the cards are the
graph's own, at the graph's own size — they are the same nodes, which is the point.

### Recording is a PANE, and it outlives the take

`RecordingPane` goes into the graph slot (below) when a take starts rolling — record enabled
**and** the transport playing — and **stays when the take ends**, until the × puts the graph
back. What you just played is exactly what you want to look at, and a view that vanished on
the last beat took it away at the moment it became worth reading.

It was a fullscreen `absolute inset-0` surface first, then a fixed 200px band in the column.
Both were answers to "how much room may this have", and the slot answers it better by not
being a special case: it is bounded by the same half-pane the note grids and the clip views
get, so the canvas simply fills what it is given and the timeline stays above it.

Four things follow:

- **`rolling` freezes it, it does not mount it.** The engine keeps pushing frames after the
  transport stops, and appending those would scroll what was just played off the left. So the
  pane stops appending and becomes a picture; the frame loop keeps its slot but skips the
  drawing until something changes.
- **The length is remembered, not recomputed.** The live counter reads the playhead, which
  goes back to wherever the transport left it the moment recording ends.
- **Closing is not stopping.** The × puts the graph back and leaves the take rolling, which is
  why it sits beside Stop rather than instead of it.
- **Escape** stops the take, and only while one is rolling — once it is over, the key belongs
  to the shell again. It skips a field being typed in: a capture-phase listener without that
  check eats the Escape that closes the command bar.

The minimap the fullscreen version carried as a child is gone: the shell's own sits at the
bottom of the column, and two of them was one too many. On a phone that means no minimap while
recording, since the shell's is desktop-only.

**`TakeReview` is still there, and the two now both appear after a take.** They are not the
same view and neither does the other's work: the pane is the LIVE monitor, drawn from the
~20 Hz meter frames, and it outlives the take; the review reads the FILE the service wrote —
its waveform under the project's ruler, the onsets you add or refuse, the threshold that finds
them, the button that brings it up to level. The pane arrived while the review was being
written, on a branch that predated it, so neither knows about the other. Deciding which owns
the moment after Stop — or whether the review belongs in the slot too, replacing the pane as it
once replaced the band — is a design call this merge deliberately did not make on its own.

#### The waveform's x axis is musical time

`recordingWindow.ts` owns it, and it is what makes the bar/beat rules mean anything. The
pane keeps one **beat position per engine frame** beside the levels, so x is beats, not
buckets: `WINDOW_BARS` (8) of the take are on screen at any tempo, filling from the left
until the take outgrows the window and then scrolling with the newest frame at the right
edge. Bars are drawn brighter than beats, in the clip editor's two colours, and the beats
drop out below `MIN_BEAT_PX` — the same thinning, for the same reason.

The x axis used to be the bucket index over a fixed 4000-bucket cap, i.e. ~200s of tape
squeezed into the width whether or not the take was 4 seconds long. A grid on THAT axis is
a line every three pixels at 120bpm: a wash, not a ruler. The rules are why the axis changed.

One thing the alignment bought on the way: a track armed **mid-take** has its buffer padded
back to the frame it was armed at, so its envelope starts where it started instead of at
the left edge, a bar or two ahead of everyone else's.

### The piano roll left the bottom panel

There used to be an **Editor** panel showing the clip under the caret. It drew `ClipView`, which
is exactly what the graph's slot draws now — the same component, with the pane's height instead
of a resizable band's. Keeping both was the same roll twice, on two surfaces that could come to
disagree about which clip you meant, and the panel was the worse of the two: shorter, and
answering the caret rather than the click.

`editTarget` did NOT go with it. The caret still reports what it is over, because the command
conditions read it — `hover_midi_sequence` and `hover_audio_clip` are what let a command know
which clip you mean without you naming it. What went is the drawing.

## A view is a LAYOUT, not a mode

Every pane is mounted always, and always the *same instance* — including the editor, which
the default layout does not show, and including the timeline in a `live` project, which no
layout shows at all. Three pieces of state decide what you see, and none of them
mounts or unmounts anything:

- `full` — which pane gets the whole screen (`null` = the layout's own arrangement)
- `focus` — which pane gets the keys; Tab walks the focus ring (`ringPanes`, which is
  `viewPanes(...).ring`: the panes the layout actually shows, so the editor is not on it — and
  focus left on a pane the layout dropped is snapped back, or the keys would go to something off
  screen. That snap is what moves the keys to the graph when a live project opens)
- `panel` — the side panel, independent of both

`view` is the fourth piece and the only one nobody chooses: it is what the open PROJECT is. See
[shellRouting.md](shellRouting.md) and
[packages/song/docs/projectMode.md](../../../../packages/song/docs/projectMode.md).

`f` expands what you are on, Escape backs out. Because nothing is torn down by any of
that, the state that would be expensive to rebuild — the open file and its undo history,
the timeline caret, the zoom stack, the graph canvas — simply never moves. This is the
one invariant to preserve when adding a pane: mount it once, unconditionally, and let the
tables decide its size.

### Escape backs out ONE layer, outermost first

`esc` in `src/keys.ts` is an ordered list and the first match wins, which is what makes the
key mean "back out of the thing in front of me" rather than one fixed action:

| if there is… | Escape does | command |
|---|---|---|
| an overlay in front | closes the topmost one | `ui popin close` |
| …else a graph slot | puts the chains graph back | `ui slot close` |
| …else a fullscreened pane | returns to the layout | `ui {current_view}` |
| …else | closes the bottom panel | `ui close` |

The ladder only works if each rung is **exclusive**, and that is the whole reason
[`src/popins.ts`](../src/popins.ts) exists. Several overlays answer Escape themselves with a
plain bubble-phase `window` listener and no `stopPropagation` — the header's alternative menu, a
lane's alternatives, the phone's hamburger, the help page — and Radix's dialogs do the same. The
shell's own listener is on `window` too, so both fire on the one keypress. That was survivable
while the shell's fallback merely closed the bottom panel; the moment Escape started closing the
graph slot, dismissing a dropdown would have thrown away the clip or the take you had open
behind it.

So an overlay **registers** while it is up (`usePopin(open, close)`) and the shell reads the
registry as its `popin` condition. Two things fall out of it, both deliberate:

- **Registering is not the same as being closed by the shell.** An overlay that already closes
  itself keeps doing so; the registration exists to make the shell's binding resolve to
  `ui popin close` and stop there. Closing twice is closing once, and `closeTopPopin` never
  pops the entry itself — the owner deregisters through its effect's cleanup when it actually
  goes away, so a closer that is refused leaves the stack as it found it.
- **A stack, not a count.** "The current popin" is the last one opened, so a menu opened over a
  dialog is what Escape reaches first.

Three things deliberately do NOT take part. The **pickers** (module, asset — both `TreePicker`)
and the **context menu** already listen in the *capture* phase and swallow the key outright, so
the shell never sees it. The **settings screens and the module builder** are pages that own the
whole surface: the listener returns early for them, exactly as it always did for settings, so no
binding of any kind reaches the layout underneath. And **`RecordingPane`** keeps Escape for
stopping a rolling take, which is neither a popin nor a slot but a transport action.

### Space is the transport, wherever the last click landed

The same listener decides this, and it draws a line the old one did not. It used to stand aside
for `INPUT`, `TEXTAREA`, `BUTTON`, `A`, `SELECT` and anything `contentEditable` — one list, every
key. Two of those groups want different things:

- **Typing** — a field, or CodeMirror — owns every key it is given, Space included. That is what
  makes it a text editor, and nothing here may touch it. Unchanged.
- **A focused control** — a button, a link, a select — keeps the keys the platform gives it,
  except **Space** and **Escape**. Space, because "press Space to play" has to hold whatever you
  clicked last: a button reached by pointer keeps focus, and the transport failing because you
  had just clicked Mute is the bug. Escape, because a focused button does nothing with it, and
  Escape's first job is now to close the overlay that button is sitting in. **Enter** still
  activates a focused button, so a control reached by Tab is still operable from the keyboard.

`blurOnClick` (`keys.ts`) stays, and its job is now narrower: it hands back every *other*
single-key binding — `1`, `m`, `s`, `f` — after a mouse click, which the listener still lets a
focused control keep.

One thing Space deliberately does **not** do here: take the direct route. It resolves to
`transport toggle`, which goes through `runCommand` to the file service like any other command,
while the header's play button sends `play`/`stop` straight over the engine WebSocket. The
WebSocket path *drops* a transport verb while the engine is applying a change
(`useEngineLink.ts`), which is right for a button you can see is disabled and wrong for a key
whose whole promise is that it always works. The two paths are worth knowing about; they are not
the same path, and this one is the one that cannot be silently dropped.

### The editor POPIN

A command that sends the editor to a file (`ui file`, `edit clip`, `edit sequence`) has to do
something when the editor pane is off screen. It used to **fullscreen** it, which answered a
question nobody asked: you wanted the file, and it threw away the timeline or the graph you
were about to read it against.

It opens as a popin instead — over the layout, on a dimmed backdrop, **without the file tree**,
because a command already named the one file it is showing.

It is the SAME EditorTab, in the same place in the tree, wearing different classes. That is
forced by the invariant above and is also what makes it good: the open file, its undo history
and the CodeMirror instance survive being popped out and put back, because nothing unmounted.
A second editor would have been a second undo stack.

Three details it needs to be usable:

- **The popin is the active pane** while it is up (`activePane`), or the pane underneath would
  keep answering the keys.
- **It closes on a click outside, the ×, or Escape** — see the Escape ladder below. Escape used
  to be deliberately excluded here, on the argument that it belongs to the editor: in vim mode it
  leaves insert mode, and a key that both leaves insert mode and closes the window you are typing
  in is a trap. That argument was right and it still holds — it is just already paid for
  somewhere else. The shell's key listener stands aside for a text editor (CodeMirror is
  `contentEditable`), so an Escape typed *into* the file never reaches the shell at all: vim gets
  it, insert mode ends, the popin stays. What reaches the shell is an Escape pressed from outside
  the text — the roll or tracker tab, a toolbar button, the backdrop — where nothing else wants
  it and "close this" is the only reading left. A sequence popin *opens* on its roll, so that is
  the common case rather than the exotic one.
- **Any change of layout puts it away.** It is a detour to one file, not a place to be, so it is
  deliberately NOT URL state — a reload lands you in the view, not in the popin.

#### A sequence in the popin has TABS

Text / Roll / Tracker, and only here. A popin was opened by a command that named this
sequence, so "now show me its notes" is the likely next thing; a fullscreen editor pane is the
text editor, and a grid wants more room than a popin has to give.

All three write to the same buffer. A note drawn in the roll makes the file dirty exactly as a
keystroke does, so switching to Text shows the line you just drew and one Save writes it
whichever way you made the change.

**A sequence opens on the ROLL**, not on its text. A command sent the editor here naming this
sequence; its notes are what that was about, and the YAML is one tab away. The tab is chosen per
FILE — keyed on the path — so each newly opened one is answered for what it is rather than
inheriting the last one's tab. That does mean opening a second sequence while you were in
Tracker puts you back on Roll; "the first view is the roll" is the rule that asks for it. It is a
layout effect, so the swap lands before the paint instead of flashing the text editor for a
frame.

### The GRAPH SLOT — what takes the graph's place

The chains slot holds the graph, or one of three other things, until the × puts the graph back.
That is where they have room: the timeline stays above, which is what you read any of them
against.

| what | opened by |
|---|---|
| a sequence's note grid | `sequence edit roll <sequence>` / `sequence edit tracker <sequence>` |
| a clip's content — the waveform for audio, the piano roll for a sequence | clicking the clip in the timeline |
| the take being recorded, and the take just recorded | a take starting to roll (above) |

**One state (`graphSlot`), not three flags.** They cannot be there together, so a union says so:
separate booleans would have had to agree about which wins, and the × would have had to work out
which one it was closing.

A rolling take **evicts** whatever the slot held. That is not arbitration, it is the one case
where something other than a click opens the slot, and while a take rolls the take is the thing.

The two rows can both show a piano roll, and they are **not the same one**. The grid draws a
sequence FILE's `notes:` array (`@studio/ui-editor`, shared with st0, editing the text). The
clip view draws a PLACED clip's compiled notes (l8's own `PianoRoll`, with the transport's
playhead on it). Same picture, different subject — one is a file, the other is a placement.

Four decisions worth keeping:

- **It is not route state.** `routes.ts` carries the LAYOUT — which panes, which is
  fullscreened, which panel. Both of these name a FILE, and no file is in the URL: the editor's
  open one is not either.
- **Whatever opens it makes the slot visible** (`full: null`, `view: global`). A view drawn
  behind a fullscreened timeline is a gesture that reported success and did nothing.
- **`ChainsTab` is HIDDEN beside it, not unmounted** — exactly what happens when the pane is off
  screen, `active` false being what already stops it drawing. It holds the MIDI runtime the whole
  shell reaches for (`midi.md`), so unmounting it would take `ui midi learn` away for as long as
  the slot was busy. This is the pane invariant above, seen from inside one pane.
- **A grid writes every edit**, unlike the popin's tabs. That pane has no buffer and no Save
  button to lose an edit from, and a grid edit is one whole gesture — a note drawn, a step
  typed — so there is nothing a Save would usefully batch. It is the same choice the
  timeline's own roll makes when it runs `sequence note new` on a drawn note.

The two commands are bare-named rather than `ui …` because they name a sequence and open an
editor that WRITES to it — the same reason `event move` and `transport record` are bare. The
`ui` namespace's promise is that a command touches no file.

#### A CLICK on a clip, which is a press that never moved

The timeline already tracked that (`DRAG_SLOP`), to tell a drag from a right-click. A click used
to fall through to `commitMove`, which found a move of zero beats and answered "move cancelled —
no change": a refusal, for a gesture that had asked for nothing. It now shows the clip instead.

Two consequences of putting the click there rather than on the clip element:

- **A frozen or generated lane's clip opens too.** Neither can be MOVED — there is no `clips:`
  entry for a move to rewrite, a frozen clip being a render rather than a placement — so the
  press used to be dropped before it was even tracked. Seeing one asks nothing of the disk, and
  a frozen lane's render is exactly the thing you want to look at.
- **A pending `event move` still wins.** If the command bar is collecting that move, the click
  answers the bar as it always did; showing the clip is what happens when nothing was asked.

What it draws is `ClipView` — so audio and
MIDI are told apart in one place and the two surfaces cannot come to disagree about a clip.

## The minimap is not always there

It is a **second view of the timeline**, and that decides where it may appear. While the
timeline itself is on screen the minimap shows what is already there, in less detail, for a
band of height the arrangement could have had — so it is not drawn at all. It comes back the
moment the timeline is hidden: fullscreen another pane and it docks above the command bar,
where it always used to live.

The popin is the case the docked strip cannot serve. It covers the layout, so the minimap has
to come **over** it or not at all — and there it stops being a convenience: a screen with no
visible timeline is one where you have lost the song. That is why the floating one carries a
**mini transport** (play/pause and the clock) and the docked one does not — over a popin,
seeing where you are is worth nothing if you cannot start the tape.

Three rules, all in `App.tsx` beside `visible`:

| what is on screen | the minimap |
|---|---|
| the timeline (the default layout, and `full timeline`) | none — it would say what the timeline already says |
| another pane fullscreened | docked, above the command bar |
| the editor **popin** | floating, pinned to the bottom of the window, with the mini transport |

Only the editor popin. The builder, the docs and the settings are **pages** that take the
whole window and are about something other than this song — and the builder's overlay holds no
engine link at all, so a transport over it would be a row of dead buttons.

The floating strip sits outside the popin's backdrop, so scrubbing it is not the click-outside
that dismisses the popin.

It is **full width**, and that is not decoration: the minimap maps the whole song to the width
it is given, so a centred card would squeeze the arrangement into a strip less legible than the
timeline it stands in for — and the two views of the same song would stop agreeing about where
a bar is. It does not overlap the popin either. The popin's bottom edge is pushed up by the
strip's measured height, so the two share the bottom of the screen instead of fighting for it.
Measured, not a constant: the minimap sizes itself to the track count, so any fixed number
would be wrong for most songs.

## What a click in the timeline does to the pane below

The lower pane holds the chains graph, and a clicked clip's content takes its **place** (the
graph stays mounted, hidden — it owns the MIDI runtime). Two gestures move that slot, and they
are symmetric on purpose:

- **a clip** — its content opens there. The caret parks on it too, which is what fills the
  command conditions (`hover_midi_sequence`); the slot is what SHOWS it, and a click is what
  the caret cannot say on its own, so the slot is told outright.
- **the bare lane** — the caret moves to where you clicked, nothing is under it any more, and
  the slot goes back to the graph. What a click opened, a click on nothing closes; otherwise a
  clip sits parked there until you find its ✕.

### Double-clicking a lane's header lays its modules out in a row

The gutter has always been the row's handle: a click selects it, a double-click focuses it —
opening its `nodes/<name>.yaml` and framing the chains it feeds. It now also opens **one lane's
whole signal path**, side by side, over the graph: `trackModules` walks the same reach the
framing uses (`subgraphForTrack`, so a send out of the lane's own chain is in it) and adds the
ORDER a node set does not carry, then `moduleRow` lays it out.

That is the function the mixer used before the mixer became a rank of the graph itself. It went
to [inventaire.md](../../../../docs/inventaire.md) with no caller, on the argument that another
surface would want a bare rank of cards; this is that surface.

The framing still happens underneath, deliberately: closing the row with its ✕ leaves the graph
already framed on the track it was about, which is where you would have wanted to be anyway.

**The cables are drawn here, and they are the graph's own.** A rank of channel strips wants none
— nothing runs between two channels, so every socket would be a plug into nothing — but a lane's
signal path is exactly the question "what feeds what", and a send that skips a module shows as
the longer cable it is. Nothing is invented between neighbours: two cards side by side with no
cable between them is the truth about a lane whose chains do not touch.

They meet the cards on the **sides**, out of the right edge and into the left, because a row is
read across: the top and bottom would send a cable diving under a card to reach the one beside
it. That is `flow: "across"` on the node — it moves where a cable ENDS and nothing else. The
socket plates stay undrawn, since they are CSS-pinned to the top and bottom edges and a plug on
the wrong edge is worse than no plug.

**Every card is given the same height**, the tallest one's. The camera fits the row's height to
the pane, so one height means every card is the height of the view rather than the tallest being
it alone — and a ragged bottom reads as cards of different importance.

### One frame for everything that takes the slot

`GraphSlotPane` is the shell, the title bar and the ✕. The occupants supply a body and what to
call it, and nothing else about the chrome.

It was written four times before that, and the four had drifted: four different root shells —
`relative flex h-full min-h-0 flex-1`, `flex min-h-0 min-w-0 flex-1 flex-col`, the same plus a
background, and a fourth with `w-full` — three title bars at three type scales, and a ✕ that in
one case was not in the occupant at all but inside `PianoRoll`, which is a leaf two of them
draw. The tell was in `App.tsx`: two of the four mounts needed a compensating `<div>` around
them because their root did not fill the pane on its own. That is drift patched at the call
site, and every new occupant paid it again.

Three ways to wear it, because the occupants genuinely differ:

- **`title` (+ `note`)** — a name, a detail, the ✕. The plain case.
- **`bar`** — a strip of your own, for a header that carries CONTROLS rather than a label: the
  recording pane counts beats and offers Stop. The ✕ is still the frame's, added last with
  `ml-auto`, which reproduces both of that pane's layouts without it having to say so.
- **neither** — no bar, and the ✕ floats over the top-right corner. A clip's contents draw their
  own header already; a second row above it would say the same thing twice.

A sequence grid (`sequence edit roll|tracker`) is the third thing that can hold that slot. One
slot and not three flags, so nothing has to agree about which wins and the ✕ always knows what
it is closing. The **Mixer button** is not one of them — it rearranges the graph rather than
replacing it, which is why it clears the slot on its way in.

**Expanding the lanes takes the pane away entirely.** The Expand button in the timeline's
toolbar grows every lane to show what is inside its clips — waveforms, notes — and that height
is precisely what the pane below is holding. So while it is on, the timeline gets the whole
view and the lower pane is `hidden`, on the same terms as `full timeline`. Looking at a chain
is not what you are doing while you are looking inside a clip.

That state lives in `TimelineTab` (it is the timeline's own toolbar) and reaches the shell
through `onView`, beside `selecting` / `zoomed` / `loop` — one channel for "what state is the
timeline in", rather than a second prop that could disagree with it. `hidden` and not
unmounted, as everywhere else here: `ChainsTab` owns the MIDI runtime the whole shell reaches
for ([midi.md](midi.md)).

The caret mark is `pointer-events-none`, so a press landing on it reads as a press on the bare
lane; clips stop propagation, so they never reach the lane's handler at all.

## The command palette
## The command bar

It is the last row of the shell, under the minimap when there is one, full width — always there, not
summoned. A double-tap of Shift jumps to it and Escape hands the keyboard back. It runs the
brain's shared commands — the same ones `l8 cmd` runs on the CLI — so the UI adds no command
vocabulary of its own: pick a command, fill its parameters, Enter runs it. The catalogue
and the argument completers live in [`../src/palette.ts`](../src/palette.ts); why it is
docked rather than opened is in [`commandBar.md`](commandBar.md).

## Live state does not re-render the tree

The transport and the engine's live state arrive over the WebSocket at roughly 20 Hz.
Held as React state on `App`, each frame re-rendered the whole editor even when nothing
visible changed. They live in an external store (`engineStore.ts`, and `pluginParamsStore.ts`
for plugin parameters) instead, and components subscribe to just the slice they draw — so
a state frame re-renders the meters, not the tree. Keep it that way: pulling a live value
into `App` state costs a full render per frame.

**"The slice they draw" means a LEAF draws it.** Moving the subscription off `App` is only half
the rule, and the half that is easy to satisfy by accident: a subscription held at the top of
any component re-renders everything that component draws. `Minimap`, `PianoRoll` and
`WaveformView` each read `s.playhead` in their body and so reconciled a row per clip, 128 key
rows, and a whole canvas twenty times a second — and they do it **off screen too**, because
every pane here is mounted exactly once and merely `hidden`. Each has a playhead leaf now, the
shape `TimelineTab` has used since the frame-rate driver came out of it
([`timeline.md`](timeline.md)).

The bar takes focus on a **double-tap of Shift**: two lone Shift presses within
`DOUBLE_SHIFT_MS` with no other key between them. `e.repeat` filters out the auto-repeat
stream from a held Shift. The gesture cannot toggle back out, because the shell's key
listener ignores anything typed into an input — Escape is the way out, and has to be.

### The `ui` namespace

The shell's own view commands (`LOCAL_COMMANDS` in `palette.ts`) live under a `ui` prefix,
stripped in one place rather than by renaming every branch. Which lines are `ui`'s is a table
of its own — `localCommands.ts` — so a test can hold it against the palette's catalogue. The
pairing is then **enforced both ways**: a `ui` command typed bare is refused, and so is a
non-`ui` command typed with the prefix. `ui` promises "touches nothing of the project, does not
move the transport", and a `ui locate` that quietly moved the playhead would be a worse lie
than having no namespace at all.

It is not "writes no file", and the difference is deliberate: a pin, a language and the vim
flag are remembered — in `localStorage` and in the account's preferences — and remembering how
you like to work is not editing a song. What draws the line is the PROJECT.

A line the shell recognises but cannot act on is reported as *handled* rather than passed
down: the backend has no such command either, and "unknown command" would say less.

Two heads collide and the order settles them: `ui file <path>` opens a file, `file new`,
`file rename`, `file move`, `file delete` and `file upload` do something *to* one. Only the
second token tells them apart, so `BARE_HEADS` is checked **first** — otherwise the pairing
rule above would send every `file <verb>` back with "type: ui file …".

### Every action on screen is a command

There is no button, menu entry or toggle in this shell that the command bar cannot reach.
That is a rule, not a coincidence, and it is what makes the palette a real answer to "what do
you want done" rather than a shortcut list for the half of the app somebody remembered to
wire. It also means a gesture is describable: a bug report, a doc page and a key binding can
all name the same thing.

Keeping it costs one habit — **the button runs the command, it does not call the handler**.
Where the two would otherwise be two copies of one behaviour, the behaviour moved:

| what draws it | the command | where the behaviour lives |
|---|---|---|
| the footer's mixer / notes buttons | `ui mixer`, `ui notes` | `toggleMixer` / `toggleDocs` in `App` |
| the footer's panel row | `ui panel <graph\|logs>` | `togglePanel` |
| the log panel's *clear* | `ui logs clear` | `useLogs` |
| a `view` surface's header button | `ui surface <id>` | `setOpenSurface` |
| the timeline header's clock / height | `ui ruler`, `ui lanes` | `TimelineHandle` |
| the cog menu | `ui settings editor\|io`, `ui engine`, `ui workspace quit`, `ui logout`, `ui language` | `App` |
| the editor settings screen's one toggle | `ui vim` | `toggleVim` in `App` |
| the share menu | `project commit`, `project pull` (the CLI's), `project export`, `project share k7` | `hooks/useShare.ts` |
| Ctrl+Z / Ctrl+Y | `project undo`, `project redo` | `@studio/project-shell/undo` |
| the file tree's right-click menu | `file new`, `folder new`, `file rename`, `file move`, `file delete`, `file upload`, `ui pin`, `ui copy path` | `EditorHandle`, and `FileTreeHandle` under it |
| the recording pane's *stop* | `transport stop` | the engine |
| a `.dawproject` / `.als` clicked in the tree | `project import <path>` | `useProjectImport` |

Two of those handles exist only for this: `EditorHandle` grew the tree's own verbs, and
`FileTreeHandle` exposes the two things nothing else holds — the pins, which are that
component's `localStorage`, and the OS file pickers, which are its two hidden inputs.

Three things are deliberately NOT commands, and the line is the same one every time — a
command names something you could *ask for*, and none of these is:

- **Disclosure.** Opening a dropdown, expanding a tree folder, showing the sidebar. Asking
  for it and doing it are the same act; there is nothing left for a command to add.
- **A dialog's own buttons.** Confirm, cancel, "continue editing". They answer a question the
  shell asked, so they cannot be reached from a bar that is not the question.
- **Continuous gestures.** Dragging a clip, growing a selection, panning the graph, the
  waveform's onset sensitivity. The timeline's `event move` is the command; the nudging is the
  view's, as `keys.ts` says.
- **Typing into the open buffer.** The video readers' *Set From* / *Set To* look like actions
  and are not: they write a number into the file the editor is showing, which autosave then
  saves like any keystroke. A command for them would be a command for typing.

The two transport buttons in the header are the one place a button does NOT dispatch its
command, and the reason is latency: `transport toggle` is a CLI verb, so it travels to the file
service and back, while the button already holds an open socket to the engine. The command
exists and does the same thing — it is the button that takes the short way.

## Two-step flows

Some gestures need a second command the user did not type, and both are held as pending
state in `App`:

- **The graph's `+`.** Clicking an arrow's `+` asks *which* module before writing anything.
  The picker is fed from hints, so it offers what the project already has plus the whole
  plugin catalogue, and picking **pre-writes** a command rather than running one. The
  command only *creates* the module; `runCommand` splices it into the chain once the create
  comes back clean (see `moduleInsert.ts`), so a rejected name never splices a module that
  was never written. Any other command in between means the user moved on, and the pending
  insert is dropped. With no hints there is nothing to show, so it falls back to pre-writing
  the command with the two ends and letting the bar's completion take over.

  Either way the chain will name the *node*, so a node is what is really being
  created — and since a chain now names it by its FILENAME alone, that name is the one thing
  only the user can supply, which is why both paths stop at the bar. From a namespace it
  takes one command: a chain cannot name `@engine/…` (`use` takes a local module), so it
  creates the local module that inherits it *and* the node, with the module name
  pre-filled and the node name left to you.

- **`rec <track>`** (the `r` key). An instrument track arms for MIDI capture in the browser;
  an audio track falls through to the backend, which arms it in the engine. Same key, routed
  by whether the track carries a sequence.

## Mobile

A phone gets tabs, not the studio layout: the panes are too small side by side and there is
no pointer to drag a splitter with. `full` already means "one pane, whole screen", so the
tab bar just drives it and the global view is never entered — which is why entering mobile
has to land on a tab. Timeline is the default, being the one pane that says what the song
*is*: the editor needs a keyboard and the graph needs room.

Every row of chrome is a row the panes do not get. On a phone in landscape the whole window
is about 400px tall, so the header and footer are trimmed to what a touch target needs and
no more.

## The PWA manifest uses RELATIVE urls, deliberately

`public/manifest.webmanifest` has `"start_url": "."` and unprefixed icon `src`s, and neither
is an oversight. A manifest's URLs resolve against **the manifest's own address**, and Vite does
not rewrite the contents of a public file the way it rebases `index.html` — so anything written
`/…` there is origin-absolute and escapes the app.

That was live for a while: the manifest still said `"start_url": "/"` after l8 moved under
`/l8/`, and the origin root is **st0**. Installing l8 as an app opened the médiathèque.

Relative is also the only form that survives both mounts, which is what settles it — `base` is
conditional (`/l8/` when hosted, the root under `STUDIO_WEB_PORT` in the native run), so a
hardcoded `/l8/` would simply break the other one.

## Where the rest of it went

| piece | file |
|---|---|
| the pane/view/panel tables, transport clock | `src/shellMeta.tsx` |
| the palette catalogue and argument completion | `src/palette.ts` |
| self-contained slices of state | `src/hooks/` — engine link, project doc, track controls, polls, logs, MIDI recording, dialogs |
