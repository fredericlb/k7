# The shell (`App.tsx` and `main.tsx`)

## What wraps the editor (`main.tsx`)

The gates, outermost first: **AuthGate** (you must be signed in — hosted backend OIDC),
**EngineGate** (pick which registered engine to drive), and **ProjectGate** (rendered by
EngineGate: resolve the repository this editor was opened on into a folder on that engine's
machine — cloning it if it has never been there — then mount the editor). Several tabs may
open one project at once — there is no single-tab lease.

**ProjectGate picks nothing.** st0 knows no workspace list: pl8 owns the
repositories and links here with an address — `/<repo>/<project>`, st0 answering the origin root —
and arriving without a project in it draws the home page instead. That address is the router's
`basename`, so the app's own routes are written below it and cannot rewrite it away. The gate is
`@studio/project-shell`'s — z0's editor mounts the same one — and `components/ProjectGate.tsx` only
supplies this app's wording. Read
[packages/project-shell/docs/launch.md](../../../../packages/project-shell/docs/launch.md)
before touching any of it, in particular why the address is a path and the repository is named
rather than spelled out.

**ProjectGate also closes the session again.** Twenty minutes with nobody touching the tab and it
stops rendering the editor — which is what closes the engine socket — flushes the project out of
the engine, and draws a card offering to resume. EngineGate lets go of its lease at the same
moment, since a tab with no socket that kept renewing a claim would be squatting the machine.
[packages/project-shell/docs/idle.md](../../../../packages/project-shell/docs/idle.md) is the
page, including why a playing transport does not count as idleness.

`LocaleProvider` sits above all of them: switching language remounts its children, so
nothing that renders a message may live above it.

`BrowserRouter` sits *outside* the gates. The URL names a **screen of the editor**, and the
gates are conditions for reaching it rather than places of their own — so a deep link like
`/timeline?panel=logs` survives them: you sign in, pick an engine, and land where the link
pointed.

### React.StrictMode is deliberately NOT used

In dev it mounts, unmounts and remounts every component, and for the imperative WebGL
renderer here (the ui-eyes video compositor) each mount creates and then tears down a WebGL
context. On Firefox that thrash loses the context and freezes the tab for seconds while
everything is re-uploaded to restore it.

StrictMode's double-invoke exists to surface effect-cleanup bugs, but an
async-initialised WebGL renderer cannot be made double-mount-safe cheaply, and the freeze
is a real user-facing cost. So the dev check is forgone here on purpose. The chains graph is
DOM and double-mounts harmlessly; the compositor is the one that pays.

### …and the Profiler is behind a flag, for a related reason

`main.tsx` can wrap the tree in a `<Profiler>` feeding `freezeWatchdog`'s `reportCommit`, so a
stall report can say which COMMIT it was and not merely how long it lasted. Only commits over
the watchdog's threshold are kept — but the instrumentation bills **every** commit in the
subtree to find them, and this tree commits on meter frames. It is therefore off unless asked
for: `?profile=1`, or `studio.profile` in localStorage so it survives the reloads an
investigation takes. `installFreezeWatchdog()` itself stays unconditional — the heartbeat and
the `longtask` observer are cheap and are what turn "it froze" into evidence at all.

The flag is `src/profiling.ts`, and it is deliberately ONE flag rather than one per instrument.
The viewport's per-lane drift readout is behind the same one (`picture.md`): it polls at 5 Hz and
re-renders its pane at 5 Hz, which is the same trade as the Profiler's — worth it while somebody
is looking, and an instrument measuring itself the rest of the time. Anything else that costs
per-frame to *report* rather than to draw belongs behind it too.

## The layout (`App.tsx`)

`App` is the st0 web editor itself: the global view — **the timeline over the chains graph,
full width** — with the transport controls and the pane toggles in the header. It is the
wiring and the layout; almost nothing else.

### The header is the shared bar, with st0's contents in it

`@frediverse/ui/app-header` draws it — the same bar pl8 and k7 use — and st0 fills its four slots:

| slot | what st0 puts there |
|---|---|
| `title` / `subtitle` | `st0`, and the build stamp |
| `children` | the project's name, its alternatives picker, the workspace warning, and the **transport** centred over them |
| `items` | **empty** — see below |
| `actions` | the pane row, Playlists (a SET only), Share, the cog — or, on a phone, the one menu they collapse into |

The split between `items` and `actions` is the shared bar's own rule (*a page goes in `items`, a
control goes in `actions`*), and here it lands on a real distinction. A **pane** button fullscreens
something that is already mounted, and Escape backs out of it: `aria-pressed`, not `aria-current`,
and each one carries its key in its tooltip — which is why the row stays as it is rather than
becoming labelled entries that would drop the shortcut.

`items` is **empty**, and stays so while every surface is a pane: the desk is in the icon row with
the rest and gets a tooltip carrying its key, and this app has no other page to name there. The
prop is still passed (empty) rather than dropped,
because it is the shared bar's slot for exactly that kind of page and the next one this app grows
belongs in it. Note the constraint if you do: `AppHeader` folds `items` into a hamburger of its own
below 640 px, and st0's `actions` already collapse into one — two hamburgers side by side being two
answers to "where do I go" — so anything put there must also be in st0's own menu.

The other thing st0 asks the bar for is the padding: it is `px-5 py-3` by default and this app trims
it through the inner box — every row of chrome is a row the panes don't get, and a phone in
landscape is about 400 px tall.

#### The transport in the middle, and what a SET drops from it

Play/pause, stop, the clock, then record — and each **drops focus on click** (`blurOnClick`).
These are the buttons a mouse is most likely to land on right before reaching for Space, and a
focused one eats the keypress. On play/pause the theft is invisible, because the button does what
Space would; on stop and record it is not.

A **set** gets the two that mean something and not the other two, **in the same place**: this is
the bar you reach for whichever project is open, so play and stop must not move around. What it
drops is the clock and record. A set declares no tempo and no time signature (`project.yaml` says
so outright), so the clock would count bars nothing is written against, and record would arm a
lane with nowhere to put a take.

The cluster is absent altogether only where there is **neither** — a project with no timeline and
no desk. Every control here addresses a position in something, and that project has nothing to
address; sound still reaches the engine, played by whatever is wired in the graph. See
[packages/song/docs/surfaces.md](../../../../packages/song/docs/surfaces.md).

The status bar's **Q badge** sits beside it for a related reason: Q1/Q2/Q3 off the measured
latency is a property of the SESSION rather than of a screen — it decides what you can do here
(`@studio/web-protocol/quality`) — and it is the same line the médiathèque shows.

### On a phone, one menu holds everywhere there is to go

`MobileMenu` holds all of it: the panes, then the tools. There is no **bottom tab bar**, and two
things keep one out — it would spend a row of a screen that is ~400 px tall in landscape on a
control used a few times a session, when the panes are what you came to look at; and it could
only ever hold the panes, leaving anything else to a second hamburger beside the first.

**Its rows send `ui <pane>`, never the bare pane name.** `runLocalCommand` refuses a bare one —
pane names are `ui` verbs — so a tap dispatching `timeline` sets the status line to *"timeline"
is a ui command* and changes nothing else.

A pane row is `aria-current`, not `aria-pressed`. On the desktop a pane button toggles fullscreen
and Escape backs out of it; on a phone there is no layout to back out to, so picking one means
"show me that" and the current row is where you are, not a switch left on.

**There is ONE layout**, and no project chooses a second one. `project.yaml`'s `project_type` is
accepted and ignored — the schema keeps it as a plain string so a folder still carrying it loads
— and nothing here reads it: it could say `live` while the folder declared a timeline, a
contradiction `surfaces/` cannot have.

**The timeline itself is a SURFACE, and the project has to ask for it.** `surfaces/timeline.yaml`
(`type: timeline`, `layout: split`) is what puts it in the layout; a folder without one opens on
its graph, keeps its editor, and is warned about in its diagnostics. `noArrangement` is what the
transport, the minimap and the graph's claim on the column read: a rig and a song that has not
declared its arrangement look alike on screen and are not the same fact.
See [packages/song/docs/surfaces.md](../../../../packages/song/docs/surfaces.md).

**The VIEWPORT is the second of those**, `surfaces/viewport.yaml`, and it sits above the
timeline in the same column. Its mounting rule is the one that matters: it owns a WebGL context
and one `<video>` per layer, so it is hidden and never unmounted — the same invariant the
editor's undo history relies on, protecting something more expensive. See
[picture.md](picture.md).

**The DESK is the third**, `surfaces/turntables.yaml` (usually named `desk.yaml`), and it sits
directly *over the graph* — last in the column, nearest the chains it is played against. A set
declares no timeline, so those two panes are its whole layout, half each. The pairing is why it is
a pane rather than a screen over the window: a fader on the desk is a param on a module in the
graph, and a screen covering the graph makes "which module is this one on" a round trip. `full`
is how the desk gets the whole window when you do want it whole.

It benefits from the same mounting rule as the viewport, for a different reason: what it holds is
a DOCUMENT — the loaded songs, the crossfader, the six EQ knobs — and a set does not stop existing
because you went to look at the graph. Being a pane is what covers it. See
[packages/ui-turntables/docs/deckSet.md](../../../../packages/ui-turntables/docs/deckSet.md).

The editor is not in it. Giving it the left half means every song opens with half the
screen showing a YAML file you had not asked for, while the two views of the song that are
*about the song* — where things happen in time, and how the signal flows — share the other
half. So the default is the two that answer "what is this song", and the editor is summoned:
`ui editor` gives it the screen, and a command that sends it to a file opens it as a popin
(below). It stays mounted throughout, so summoning it costs nothing.

See also [shellRouting.md](shellRouting.md) for how the screen state maps to the URL.

### The Mixer is an ARRANGEMENT of the graph, not a panel

It is not a panel, and not a second picture either: it is **the same graph** — same nodes, same
cards, same cables — with the strips pulled onto one rank.

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
saying there is nothing to line up. Nothing else explains an empty mixer, and a control that
answers a click with nothing is worse than one that is visibly unavailable.

The cards themselves are not hand-rolled, and that is why this works at all. A strip's
controls are its module's own panel — the very card the graph draws. A hand-rolled strip per
track — a VU, a fader, a pan slider, M and S — would be a second implementation of a channel
strip, and it would drift from the one the module's own `ui.yaml` declares: a module grows a
knob and the panel never shows it. Whatever the mixer module's panel says IS the mixer, and the
two cannot disagree because they are the same card in the same graph.

Three consequences, all of them the design rather than gaps:

- **A track with no mixer module has no strip.** It is not "at unity" — it is a track with
  nowhere to put a level, and no card of its own to show. It simply is not in the row.
- **Mute and solo are not here.** They are not the strip's but the track's, and
  they live on the timeline (`m`/`s`) and on the graph's track nodes.
- **Two tracks sharing a strip draw one card.** In practice the compiler makes such a strip
  its own bus track, so it arrives once anyway; `mixerModules` de-duplicates regardless,
  because two cards for one value would be two controls fighting.

Two sources, because neither answers alone: the compiled project says *which* modules are
strips (the graph doc does not carry a plugin type), and the graph says what each one looks
like and what feeds it.

The **sockets stay**, and the cables with them: you can see what reaches a fader without leaving
the view, which is most of why the mixer belongs in the graph rather than beside it. A rank of
strips drawn on its own would have no edges to plug its jacks into.

`moduleRow` in `@studio/ui-chains` lays a bare rank of cards out, and this view is not its
caller: it re-ranks the graph instead. The row it does lay out is one lane's signal path (below).

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

The cards are drawn at the graph's own size, without the elbow room a lane's row gives itself
(`widthScale`) — they are the same nodes as the graph's, which is the point.

### ONE panel for an audio clip, recorded or not — and clicking one reaches it

`AudioClipPanel` is where an audio clip is looked at, whichever way you got to it: a take that has
just stopped, `ui review <clip>` on an old one, or a **click on an audio event in the timeline**.
One panel for the three, because the route you reach by clicking a clip has to be the one that can
trim it, mark it and bring it up to level.

Everything on the panel below `clip` is therefore OPTIONAL: a clip sitting on a lane has no take,
no count-in and no armed track. Only `beatsPerBar` and `tempo` are worth passing anyway, because
the twelve-bar window should be twelve of *this* song's bars.

`WaveformView` draws the same waveform and can act on none of it: it is the editor's own pane —
the one `e` opens beside a clip's text — a different surface with a different job.

`AudioClipPanel` takes the graph slot, and it is the only place a clip is drawn. While a take
rolls it shows the envelope the engine is pushing, **growing**; the moment the recorder closes the
file it shows that file instead, with its onsets, its threshold and the button that brings it up
to level. `rolling` chooses the picture — it does not mount the panel, which outlives the take, so
closing is the × and not the Stop.

**One panel, and not two.** A live monitor of its own — an envelope per armed track on a bar/beat
grid, drawn straight to a canvas — would take the slot and keep it, so after Stop the monitor
would be the whole screen and the review nowhere: not subtly placed, not on screen at all.

Three things follow from having one:

- **The live picture goes through `Waveform`**, like the file's. `useLiveEnvelope` accumulates one
  sample per engine frame and hands over `{intervalMs, samples}` — the same shape the `/waveform`
  route answers with — so there is one renderer, one set of markers, one behaviour.
- **One envelope, not one per armed track.** It is the LOUDEST armed input per frame: a panel is
  about one clip, and stacking every lane makes it a monitor rather than a view of a take. The
  max is what keeps a quiet second input from being invisible.
- **Nothing is editable while it rolls.** There is no file yet, so there is no onset to place and
  nothing to normalise — the header offers Stop and the elapsed seconds, and that is all it can
  honestly offer.

The live x axis is nominal: `LIVE_FRAME_MS` (50) per frame, because the engine's push is ~20 Hz
and not a clock. A growing take is read for its SHAPE; the moment timings matter, the file is
there and its own waveform has replaced this one.

#### Several passes: the sidebar of takes

When the lane holds **takes** — a loop record, or a punch over an event, leaves one per pass
(`packages/song/docs/takes.md`) — the panel grows a column on its left listing every version there
is to listen to: each take in slot order, then what the lane is playing, marked. `takeOptions` in
`takeReview.ts` derives it from the project doc, and answers empty for a lane with no takes, which
is what keeps the ordinary single-take panel free of a column with nothing to list.

**Clicking a row is `track take select`.** Not a preview: the take goes ONTO the lane, because
the point is to hear the pass in the song — with the rest of the band — and only what a lane
plays reaches the engine. The swap loses nothing and is its own undo, so an audition costs a
command and no material. The playhead is sent to where that take begins, which is what makes the
column's ▶ mean "hear this one from the top".

The lane does not go quiet outside the take: only the clips it lands on are exchanged, so the
rest of the part still plays under the pass you are auditioning
(`packages/song/docs/takes.md`).

Two consequences worth stating:

- **the row you are looking at is the row you would hear.** There is no second notion of a
  "selected but not playing" take for the panel to disagree with the engine about;
- **the numbers do not move while you listen.** A select exchanges two lists rather than
  reordering them, so the column stays put under the pointer.

**Garder celle-ci** is `track take keep <track>`: it keeps whatever is on the lane — the one you
last clicked — and deletes the rest. The button names the decision rather than a number, because
the choice was already made by clicking.

The **other host does not pass takes**: `ClipView` — the panel a click on an audio event opens —
mounts the same component with no sidebar, deliberately. There the clip you clicked is the subject,
and a select would move it off the lane under its own view. Reaching a take from the timeline is
what the indented take rows and their right-click menu are for (`docs/timeline.md`).

`placedAt` comes from the DOCUMENT for this reason (`placedBeat`), and not from the beat the
transport rolled at: that is right for the take that just landed and wrong for one picked out of
the sidebar, since a take plays where it was recorded and not where the last one was.

#### The take's start is the SHELL's, and two surfaces read it

`takeStart` lives in `App`, taken off the store on the `rolling` edge. One source, because two
surfaces draw from it — this panel's counter, and the growing clip on the armed lane
(`RecordingClip`, see `docs/timeline.md`) — and two captures would drift the moment they mounted
at different times, which is a subtler version of the drift below.

It is READ from the snapshot rather than subscribed to: it changes once per take, and a
subscription in the shell would re-render everything 20 times a second for a number that does not
move.

#### The counter measures THIS take

`takeCounter.ts` counts the pre-roll down, then the take up in bar:beat. It is a pure function
and not arithmetic buried in a component that also draws a canvas: what it computes has to be
testable on its own, because a stale number in it is invisible.

The take's start beat is captured on the `rolling` **edge**, the same edge `useLiveEnvelope`
clears its buffer on — never once per mount, since the panel outlives its take. A capture that
survived one would measure every take after the first against the *first* one's start, while the
position it is compared to is an absolute one in the song: a take punched in at bar 15 reads 56
beats the instant it begins, and a take starting earlier than the last shows a pre-roll of tens
of beats.

Both results are **clamped**, and that is not belt-and-braces: a pre-roll can never be longer than
the pre-roll, and a take can never have run for less than nothing. Whatever the engine does with
its playhead during a count-in — its business, not the counter's — the worst this can show is a
number that stops moving, rather than one nobody can explain.

**The count-in draws nothing, anywhere.** Nothing is recorded during it, so the clip panel shows
the countdown alone and the lane's growing block does not exist yet — `recordingFrom` (the
transport's start plus the pre-roll) is the one number both read, and the counter flips to
"recording" on exactly that beat. Neither may take the TRANSPORT's start instead: a block drawn
from it appears the instant Play is pressed and reaches back over bars the placement that lands
on Stop does not cover, and a picture opened there carries however many bars of click and room
the pre-roll lasted, everything after it sitting that far right of where it is in the file. The
envelope collects from the first recorded frame.

#### How the tab learns a take happened at all

Nobody types a recording. The ENGINE writes the wav, the file service declares the clip and
places it on the lane, and this tab is told by neither — so the document it is drawing is one
clip out of date and nothing in it knows.

The signal is `lastTake` on `/workspace`, read by the 2 s poll (`useActiveProjectFollow`) beside
`activeProject`. The shell does two things with it: `setWs`, which opens the review panel on the
new clip, and a reload, which puts the clip on its lane. Both have to hang off that read and
nothing else — the transport keys go straight to the engine socket (above), so no reply from the
file service comes back to bump a reload, and a take stopped from the header's Stop button would
otherwise be on disk, on the lane, and off the screen.

The first answer only SEEDS: `lastTake` is the service's memory of the newest take it ever
wrote, not an event, so firing on it would reopen this morning's recording every time a tab
loads. `isNewTake` is that rule, and it is a pure function for exactly that reason.

#### …and the panel can be asked for, not only awaited

The automatic appearance is a moment that passes, and it passes more easily than it looks:
`lastTake` is a variable in the file service's MEMORY — its own comment says "never cleared",
true inside one process and false between two — so every restart of that service loses it, and in
dev it restarts on every code change. The ✓ ends it for good as well. A take would otherwise
become unreachable while its file sits in `clips/`.

`ui review <clip>` names one and opens the panel on it. It is a `ui` command because it opens a
VIEW and writes nothing — what the panel then does (`clip process`, `event trim`, `clip onset …`)
is the brain's — and the named clip outranks the automatic one, without the rolling guard: asking
for a clip by name is a deliberate act, not something that appeared while you were playing.

The lane is looked up rather than asked for (`takeReview.ts`), and a clip nothing places opens
just the same, labelled **hors piste**. That is the case it exists for: the waveform, the onsets
and the level are properties of the FILE, and none of them needs a placement. To put such a take
back on a lane, `event add <track> <clip> <timecode>` is the verb.

#### Twelve bars, and the wheel opens it out

A take is often minutes long, and a minute drawn across a pane is a solid block — while the whole
point of looking at one is where the attacks are, where the silence is, whether the onsets landed.
So the panel shows **twelve bars** by default and the wheel zooms, out as readily as in. The header
says `12/34 mes.` with a **tout** beside it, because a window that showed only the first bars
without saying so would read as a clip that had been cut.

Everything moves inside the clip's own `from`/`to`: the panel is **caged to the interval the clip
plays** (see [clipEditors.md](clipEditors.md)), so the bars are the interval's bars, "tout" is the
whole interval, and what a trim cut away is simply not on screen. The file is still fetched whole
(`whole`), so onsets and every command stay in file-absolute seconds.

`Waveform` takes a `view` for this: a span in seconds, absent meaning all of it. A
**window** rather than a zoom factor, since what a host wants to say is "these twelve bars" and not
"×3.7" — and everything crossing that boundary stays in **absolute seconds**. A view is a way of
looking, not a change of units, so a marker's time, a selection, a trim preview and every callback
mean the same thing zoomed or not. Only the pins are filtered: their `left` is absolute px, so one
outside the window would hang in the panel's chrome rather than be clipped by the canvas.

The zoom is **anchored under the cursor** — the moment pointed at stays where it is, the same
promise the timeline and the roll make through `useHZoom` — and a two-finger pinch does the same
on a touchscreen, anchored at the centre of the touches. There is still **no pan** gesture: a pan
would be a second gesture on a surface whose drag already means "select", and zooming out then in
somewhere else reaches every part of the take. `barWindow.ts` holds the maths and its edges: the
anchor (`anchorBars`), a take shorter than the window, a start pushed off either end, a part-bar
take, and a tempo that has not arrived yet (a bar of zero seconds would make every take infinitely
many bars long).

#### Trimming moves the WINDOW, and previews before it does

`event trim <track> <at> [gate-dB]` cuts the head and the tail at a gate. It moves that EVENT's
window (`from`/`to` on the placement) and **never the audio**: a take's head is the tail of a count-in and
the player settling, its foot is a room and a hand leaving a string, and both are things you stop
*playing* rather than things you want destroyed. One line to put back, where a rewritten wav is a
restore from the undo journal.

The button **opens a gate rather than applying one**, because where the silence ends is a judgement
and the waveform is what you judge it on. While the menu is open, the part that would be KEPT is
drawn as a selection over the wave, so the slider is read against the take instead of against a
number. The preview calls **the same `trimWindow`** the command runs — a preview that disagreed
with the act would be worse than none — so the only difference between the two is bucket
resolution.

The gate is **bounded to the window the clip already has**: a re-trim refines `from`/`to` and never
reaches back into material an earlier trim removed (undo is how that comes back).

Beside it is **operations**: every chain the project and the library offer, normalising among them
(`clip process <clip> <chain>` over a chain naming the médiathèque's `normalize` module). There is
no `clip normalize` and no `track normalize`, and that is the trade — a treatment that can be
followed by another, landing in a stamped render the clip is repointed at, rather than one
hard-coded gain written over the take. See `@studio/commands`' `docs/processChain.md`, which
records what it costs: a single gain shared across a whole track's files.

Nothing above the gate changes nothing, and says so: a take entirely below it is either silence or
a gate set too high, and a window of zero length would play nothing at all.

The envelope reaches the command through `CommandHost.clipEnvelope?()`, optional for the reason
`getAudioDevices?()` is: building it needs the engine, which decodes and downsamples into the
`.cache` sidecar. A host without one refuses the trim by name rather than guessing at a window.

#### Onsets are dragged, not retyped

A detected attack is often a hair off rather than wrong, and refusing it only to add another a few
milliseconds away is two acts for one intention. So a pin can be **dragged**: `Waveform` takes an
`onMarkerMove`, and the panel sends `clip onset move`, which records it as ONE correction and
therefore survives re-detecting at another threshold.

The drag lives on the pin — a DOM button — rather than in the canvas's pointer handling, because
grabbing a pin must not also start a selection underneath and the two would race for the same
pointer. It commits on RELEASE (an onset written on every `pointermove` would be a file write per
pixel) while local state moves the pin as you go, so the hand and the mark stay together. A press
that travels less than 4px is still a **click**, and a click still refuses the onset — the same
threshold the canvas uses, so a twitch while removing a mark does not silently re-place it.

### The clip under the caret is REPORTED, not drawn

`ClipView` is drawn in one place, the graph's slot, at the pane's full height. A second copy of it
in a bottom panel would be the same roll twice, on two surfaces that could come to disagree about
which clip you meant — and the panel would be the worse of the two: shorter, and answering the
caret rather than the click.

`editTarget` is no part of that drawing. The caret reports what it is over because the command
conditions read it — `hover_midi_sequence` and `hover_audio_clip` are what let a command know
which clip you mean without you naming it.

## A view is a LAYOUT, not a mode

Every pane is mounted always, and always the *same instance* — including the editor, which
the default layout does not show. Three pieces of state decide what you see, and none of them
mounts or unmounts anything:

- `full` — which pane gets the whole screen (`null` = the layout's own arrangement)
- `focus` — which pane gets the keys; Tab walks the focus ring (`ringPanes`, which is
  `viewPanes(...).ring`: the panes the layout actually shows, so the editor is not on it — and
  focus left on a pane the layout dropped is snapped back, or the keys would go to something off
  screen. That snap is what moves the keys to the graph when a project declaring no timeline
  opens)
- `panel` — the side panel, independent of both

There is no fourth piece: the LAYOUT is not state. Which panes it holds is a
function of what the project declares, read fresh wherever it is needed. See
[shellRouting.md](shellRouting.md) and
[packages/song/docs/surfaces.md](../../../../packages/song/docs/surfaces.md).

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
plain bubble-phase `window` listener and no `stopPropagation` — the header's alternative menu, the
phone's hamburger, the help page — and Radix's dialogs do the same. The
shell's own listener is on `window` too, so both fire on the one keypress — and since the shell's
fallback closes the graph slot, dismissing a dropdown would otherwise throw away the clip or the
take open behind it.

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
the shell never sees it. The **settings PAGE and the module builder** own the surface they are
on: the listener returns early for them, so no binding reaches the layout underneath. And
**`AudioClipPanel`** keeps Escape for stopping a rolling take, which is neither a popin nor a
slot but a transport action.

The three **docked panels** are deliberately not in that list: a docked panel leaves the panes on
screen, so the keys that drive them have to keep working — Space while you watch a level on the
I/O tab is the whole point of that tab not being
a dialog over the thing it meters. Typing stays safe because the guard that protects it is
about the FOCUSED element, not about which screen is open. Escape is the settings panel's own
and closes it.

## The right column: three panels, one at a time

The end of the bar holds three buttons, and each toggles a panel **docked at the right** of the
pane row — pushing the panes rather than covering them:

| button | panel | what it is |
|---|---|---|
| ♪ (a SET only) | Playlists | the repository's set lists: a searchable dropdown, its songs under it |
| ⇪ | Partager | commit, pull, export, publish — and the badge saying how far behind the repo is |
| ⚙ | Réglages | tabs: Éditeur, I/O, Compte |

`rightPanel` in `App` is one value and not three booleans, because there is **one column**:
two panels open at once would be two columns, and the panes have already given up the width for
one. Opening any of them closes whichever was there, which is what a single value says and
three flags would only promise.

Three panels rather than one set of tabs, because they are three different verbs — what you
**set**, what you **play from**, what you **send**. Playlists is not a tab under the cog:
settings are things you set and leave, a set list is a thing you work from. Nor is the share a
dropdown, which is the wrong shape for a surface that *reports* — a pull says how far behind you
were, an export takes a minute and says where the file went.

None of them is a **pane**. A pane is what the project DECLARES ([shellRouting.md](shellRouting.md),
`packages/song/docs/surfaces.md`); none of this is the project's, which is why none of it is in
the URL either.

## The open file follows the disk (`hooks/useDiskSync.ts`)

Every command in st0 rewrites YAML — `node param`, `track gain`, a clip drag, a bypass click. An
editor that read its file once and never again would hold a snapshot of the past the moment you
touched anything, and the next save would write it back over whatever had happened since.
Silently. **That is a data-loss bug, not a cosmetic one**, and it is what this hook exists for.

Two cases, and they get different answers:

| the buffer is | what happens | why |
|---|---|---|
| **clean** | adopt the new text without asking | nothing to lose, and anything else makes the editor lie about a file nobody touched |
| **dirty** | ask, and do nothing until told | two versions of one file exist and only the person knows which matters |

Gated on `/revision`, the same ~2 ms change token the diagnostics poll reads, rather than
re-reading the file on a timer. The token moves for OUR writes **and** for edits made outside the
app — a `git pull`, another editor — which is exactly the set of events worth reacting to. It is
polled once for the whole app; see `hooks/useRevision.ts`.

### Space is the transport, wherever the last click landed

The same listener decides this, and it draws a line between two groups rather than standing aside
for one list of tag names — `INPUT`, `TEXTAREA`, `BUTTON`, `A`, `SELECT`, `contentEditable` — on
every key:

- **Typing** — a field, or CodeMirror — owns every key it is given, Space included. That is what
  makes it a text editor, and nothing here may touch it.
- **A focused control** — a button, a link, a select — keeps the keys the platform gives it,
  except **Space** and **Escape**. Space, because "press Space to play" has to hold whatever you
  clicked last: a button reached by pointer keeps focus, and the transport failing because you
  had just clicked Mute is the bug. Escape, because a focused button does nothing with it, and
  Escape's first job is to close the overlay that button is sitting in. **Enter** still
  activates a focused button, so a control reached by Tab is still operable from the keyboard.

`blurOnClick` (`keys.ts`) hands back every *other* single-key binding — `1`, `m`, `s`, `f` —
after a mouse click, which the listener lets a focused control keep.

Space takes the **direct route when it can**, and the slow one when it must. `transport
play|stop|toggle|rewind` (`BARE_TRANSPORT` in `localCommands.ts`) are answered by the shell over
the engine WebSocket — the same socket the header's play button uses.

The file service route is a real cost, not a theoretical one: it sends this very message, but only
after an HTTP round trip, after the undo journal has walked the whole project twice to find that a
transport verb changed no file (**62 ms warm, 215 ms cold**, measured on a real song), and behind
whatever else that single-threaded process is doing — a project compile there is **1.5 s**.
Measured end to end on an idle service, one keypress costs **110–145 ms**; over the socket the
engine acknowledges in **13–50 ms**, most of which is waiting for the next 20 Hz state frame. The
delay belongs to the queue, not to the transport.

Two cases still fall through to the service, and they are why the branch is a fallthrough rather
than a send: **no socket of our own**, and an engine **mid-apply**. The WebSocket path *drops* a
transport verb while the engine is applying a change (`useEngineLink.ts`) — a queue there turns
one press into three plays and a rewind — and dropping is right for a button you can see is
disabled and wrong for a key whose whole promise is that it always works. So the key keeps the
slow path for exactly that window.

Nothing is lost by answering them here: they write no file, so there is nothing to journal and
nothing to reload — the `setReloadKey` every other command pays for is pure waste on these.
`transport metronome` is NOT one of them: it rewrites `settings.yaml`.

**Shift+Space** is the shifted pair and survives a focused control by the same listener rule: it
runs `transport replay` — the playhead returns to where playback last started, and rolls again.
That one IS a local command on the WebSocket path, because the seek half only exists there, and
its memory is the shell's own (`replayAtRef` in `App.tsx`): while the transport is stopped the
playhead sits where a play would begin, and the rising edge of `playing` freezes that value — so
a start from a key, the bar, another tab or the CLI all count, and pressing it mid-playback
jumps back and keeps rolling. Shift+space arrives as `" "` with `shiftKey`, so `keyToken` spells
the modifier out (`"shift+space"`) where a shifted letter arrives already uppercased.

### The editor POPIN

A command that sends the editor to a file (`ui file`, `edit clip`, `edit sequence`) has to do
something when the editor pane is off screen. It opens as a **popin** — over the layout, on a
dimmed backdrop, **without the file tree**, because a command already named the one file it is
showing. Fullscreening it would answer a question nobody asked: you wanted the file, and it would
throw away the timeline or the graph you were about to read it against.

**And it opens only once the file has been READ.** `EditorHandle.open` answers whether it landed
and the popin follows that answer; revealed first, a name that resolves to nothing leaves an
editor popped open over your work with no file in it, and no tree beside it to say so. A command
that runs, reports success and does nothing is the one failure this shell says everywhere else it
will not have.

What it resolves is in `src/openInEditor.ts`, and the third of its three passes is the one worth
knowing: **half the callers name a PLACEMENT, not a file.** The right-click on an event offers
`ui file` with a clip's id — `audio_14_0@98.5` (`@studio/song/placementId`) — and the file it
wants is `clips/audio_14_0.yaml`. That `@98.5` is a subsequence of no path, so the fuzzy pass
scores −1 on every file in the project. The material behind the id is tried last, after the
written name has had its say, because a material name is what `materialRefOf` returns unchanged
and an entity may legitimately carry an `@`.

It is the SAME EditorTab, in the same place in the tree, wearing different classes. That is
forced by the invariant above and is also what makes it good: the open file, its undo history
and the CodeMirror instance survive being popped out and put back, because nothing unmounts.
A second editor would be a second undo stack.

Three details it needs to be usable:

- **The popin is the active pane** while it is up (`activePane`), or the pane underneath would
  keep answering the keys.
- **It closes on a click outside, the ×, or Escape** — see the Escape ladder above. Escape
  belongs to the editor as well: in vim mode it leaves insert mode, and a key that both leaves
  insert mode and closes the window you are typing in is a trap. That is already paid for
  somewhere else. The shell's key listener stands aside for a text editor (CodeMirror is
  `contentEditable`), so an Escape typed *into* the file never reaches the shell at all: vim gets
  it, insert mode ends, the popin stays. What reaches the shell is an Escape pressed from outside
  the text — the roll or tracker tab, a toolbar button, the backdrop — where nothing else wants
  it and "close this" is the only reading left. A sequence popin *opens* on its roll, so that is
  the common case rather than the exotic one.
- **Any change of layout puts it away.** It is a detour to one file, not a place to be, so it is
  deliberately NOT URL state — a reload lands you in the view, not in the popin.

#### An INSTANCE in the popin shows its module beside it

A node's file names its per-instance fields, and what those override lives one `extends:` away —
so when the popin's file has an `extends:` that resolves to a file, the popin splits: the
instance on the left, the **module on the right, both editable**. The module side is a small
self-contained editor (`ModuleSidePane`, its own buffer and autosave — the main pane is THE
editor instance and its undo history must stay its own), and its writes follow the same fork
rule as any save: a shared `_modules` file becomes a project copy, and the pane moves onto it.

The resolution is `moduleBehind.ts` — the same answer a ctrl-click on the extends value gives
(`base:` then `module:` in `hints.paths`) — read from the BUFFER, so retyping the extends line
swaps the pane. A base with no file to edit (`@engine/…`, the `@studio/…` track bases) resolves
to nothing and the popin stays one pane. Popin only: the full-screen editor has the tree, and a
second file there is one click away rather than a question.

**Each pane carries its own widgets**, the ones the main editor would give the same file — and
a picture both would carry is drawn ONCE. A slice rack docks THE SLICER at the bottom: the
source waveform with every symbol's window in its own colour, the symbol names in the text
painted to match (`sliceSymbols.ts`; the racks hint carries the source absolute, so no pane
does path arithmetic), and the gutter ▶s auditioning each line. The windows grow draggable
edges only in the pane whose BUFFER holds the symbols — the module's — where a drag rewrites
the two numbers like a keystroke. In the split, that means the slicer sits under the MODULE
pane alone: the instance side would show the identical picture read-only, so it stands down
(the same dock still serves a node opened WITHOUT the split — full screen, or a base with no
file). One picture with coloured windows, rather than an inline waveform under every symbol line.
`rackKeyOf` (projectPaths.ts) is what lets one map answer for both spellings of "this file is a
rack": a module's folder name, a node's stem.

#### The RACK BUILDER popin

`module create rack` (web-local — the building is the browser's) opens a 4×4 pad grid over the
shell. Drop audio files on the pads — several at once fill onward in NOTE order — click one to
hear it (a local object-URL, no server round trip), edit each pad's name (the rack's SYMBOLS)
and name the rack. CREATE uploads the samples beside a fresh `module.yaml` and writes the
module at `modules/instruments/<name>/` — the beside-the-module layout every rack in a real
song already loads — then the shell reloads and the graph's picker offers it.

The notes are the drum-machine page, pinned in `rackBuilder.ts`: bottom-left is 36, rightward,
then the row above — so the grid READS the way it plays, and the symbols are written in that
order, which is the order the hints, the sequencer's rows and the slice colours all walk.
Samples only for now; the slice flavour has its own editor (the docked slicer).

**Each filled pad carries a ✕ beside its ▶.** A drop could REPLACE a sample and nothing could
take one back off, so a multi-file drop landing one cell over could only be undone by starting
the rack again. Clearing revokes the pad's object URL, exactly as a replacing drop already did —
these are blobs the document holds, and a builder filled and cleared a few times would otherwise
carry every sample it had ever seen until the popin closed — and stops the audition when it is
that pad playing, because a sound outliving the pad it came from reads as a fault.

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
separate booleans would have to agree about which wins, and the × would have to work out which
one it is closing.

A rolling take **evicts** whatever the slot holds. That is not arbitration, it is the one case
where something other than a click opens the slot, and while a take rolls the take is the thing.

The two rows can both show a piano roll, and they are **not the same one**. The grid draws a
sequence FILE's `notes:` array (`@studio/ui-editor`, shared with pl8, editing the text). The
clip view draws a PLACED clip's compiled notes (st0's own `PianoRoll`, with the transport's
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

The timeline tracks that (`DRAG_SLOP`), to tell a drag from a right-click, and a press that never
moved shows the clip. Falling through to `commitMove` would find a move of zero beats and answer
"move cancelled — no change": a refusal, for a gesture that asked for nothing.

Two consequences of putting the click on the gesture rather than on the clip element:

- **A frozen or generated lane's clip opens too.** Neither can be MOVED — there is no `clips:`
  entry for a move to rewrite, a frozen clip being a render rather than a placement — so a
  handler hung off moving would drop the press before it was even tracked. Seeing one asks
  nothing of the disk, and a frozen lane's render is exactly the thing you want to look at.
- **A pending `event move` still wins.** If the command bar is collecting that move, the click
  answers the bar; showing the clip is what happens when nothing was asked.

What it draws is `ClipView` — so audio and
MIDI are told apart in one place and the two surfaces cannot come to disagree about a clip.

## The minimap is not always there

It is a **second view of the timeline**, and that decides where it may appear. While the
timeline itself is on screen the minimap shows what is already there, in less detail, for a
band of height the arrangement could have had — so it is not drawn at all. It comes back the
moment the timeline is hidden: fullscreen another pane and it docks above the command bar.

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

The gutter is the row's handle: a click selects it, a double-click focuses it — opening its
`nodes/<name>.yaml`, framing the chains it feeds, and laying **one lane's whole signal path** out
side by side over the graph. `trackModules` walks the same reach the framing uses
(`subgraphForTrack`, so a send out of the lane's own chain is in it) and adds the ORDER a node set
does not carry, then `moduleRow` lays it out — the one caller of that bare rank of cards, drawing
them at 1.5× the width their grid asks for (`widthScale`): elbow room, not bigger controls.

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
call it, and nothing else about the chrome. One frame and not one per occupant: written per
occupant they drift — root shells that fill the pane and root shells that need a compensating
`<div>` around them at the call site, title bars at three type scales, a ✕ that ends up inside
`PianoRoll`, which is a leaf several of them draw — and every new occupant pays it again.

Three ways to wear it, because the occupants genuinely differ:

- **`title` (+ `note`)** — a name, a detail, the ✕. The plain case.
- **`bar`** — a strip of your own, for a header that carries CONTROLS rather than a label: the
  clip panel counts beats and offers Stop while a take rolls. The ✕ is still the frame's, added
  last with `ml-auto`, which reproduces that panel's two headers without it having to say so.
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

## The command bar

It is the last row of the shell, under the minimap when there is one, full width — always there, not
summoned. A double-tap of Shift jumps to it and Escape hands the keyboard back. It runs the
brain's shared commands — the same ones `st0 cmd` runs on the CLI — so the UI adds no command
vocabulary of its own: pick a command, fill its parameters, Enter runs it. The catalogue
and the argument completers live in [`../src/palette.ts`](../src/palette.ts); why it is
docked rather than opened is in [`commandBar.md`](commandBar.md).

## What a command RELOADS — the token, not the counter

Every writing command ends in a reload, and a reload that is one number can only say
**"everything is stale"** — whatever the command actually did. Six consumers key an effect off
it: the compiled document, the graph, the project errors, the file tree, the completion
vocabulary, the open file.

Measured on `01.danse.st0`, per command, on a service that is **one thread** — so these queue
rather than overlap:

| route | cost | can a stretch point have moved it? |
|---|---|---|
| `/hints` | **65 ms / 108 KB** | no |
| `/module-libraries` | **70 ms / 100 KB** | no |
| `/project-doc` | 81 ms / 65 KB | yes |
| `/graph` | 34 ms / 50 KB | sometimes |
| `/tree` | 27 ms / 35 KB | no, unless a file appeared |
| `/project-errors` | 18 ms | yes |
| `/library-chains` | 12 ms | no |

Three things came out of that, and they are three different answers to one question:

- **`quietCommand`** — the gesture says *I will reload nothing*. A mixer knob, a mute, a warp
  point. It passes `want: []` so no graph is built either, and whoever must move re-reads its own
  picture. The `/revision` tick catches the rest within 2 s.
- **`refreshLibraries`** — the pane says *ask me when it can have MOVED, not when anything moved*.
  The two library routes are fetched on mount and by the two acts that write there.
- **`Reload`** — the command says **which files it wrote**, and each consumer decides.

That last one is what the reload key carries. `POST /command` answers with `changed`: the files it
wrote, project-relative, taken straight out of the undo journal's own diff — `recordChange`
brackets every mutation and compares the two images anyway, so naming them is free. `App` holds
`{ key, files }`; `key` is still a counter, because "the same file twice" has to fire twice and a
list cannot say that.

**`files: null` means nobody said, and every predicate reads that as *re-ask*.** That is what
lets a project opened, an undo, a repository pulled and a poll that noticed something name no
files at all, and what makes a service too old or too broken to answer degrade to a plain
counter.

The predicates are [`../src/reloadScope.ts`](../src/reloadScope.ts), and they are pure functions
with a test each, because what they encode is a claim about the SERVICE that is not visible from
here:

- **`movedTheTree`** — did a file appear or disappear? Exactly what `/tree` draws, so this one is
  total: a rewrite never moves it.
- **`movedTheVocabulary`** — could `/hints` differ? Yes for everything except a **rewrite** of a
  clip, a sequence or a curve. Those three are gathered by NAME (`projectHints` keys them off
  their filenames), so a note drawn, a stretch point placed or a curve point moved changes nothing
  the completion source carries. Anchored at the project root on purpose — a module may be called
  `clips`, and `modules/audio/clips/module.yaml` must not read as one.

**The limit, stated because it is real:** a clip's `source` also decides whether it is listed as
an audio or a video clip. A command that repointed an *existing* clip from a wav to an mp4 would
leave that one split stale until the next reload that does ask. Everything else about a clip —
that it exists, where its file is, what it is called — is a name, and names are covered above.

So a warp point, a note, a curve point costs the two routes that answer about the SONG, and
neither of the two that answer about files and names. What is deliberately still unscoped:
`/project-doc`, `/graph` and `/project-errors`, which any project write can genuinely change.

## Live state does not re-render the tree

The transport and the engine's live state arrive over the WebSocket at roughly 20 Hz. Held as
React state on `App`, each frame would re-render the whole editor even when nothing visible
changed. They live in an external store (`engineStore.ts`, and `pluginParamsStore.ts`
for plugin parameters) instead, and components subscribe to just the slice they draw — so
a state frame re-renders the meters, not the tree. Keep it that way: pulling a live value
into `App` state costs a full render per frame.

**"The slice they draw" means a LEAF draws it.** Moving the subscription off `App` is only half
the rule, and the half that is easy to satisfy by accident: a subscription held at the top of
any component re-renders everything that component draws. `s.playhead` read in the body of
`Minimap`, `PianoRoll` or `WaveformView` reconciles a row per clip, 128 key rows, and a whole
canvas twenty times a second — **off screen too**, because every pane here is mounted exactly
once and merely `hidden`. Each has a playhead leaf instead, the shape `TimelineTab` uses
([`timeline.md`](timeline.md)).

The bar takes focus on a **double-tap of Shift**: two lone Shift presses within
`DOUBLE_SHIFT_MS` with no other key between them. `e.repeat` filters out the auto-repeat
stream from a held Shift. The gesture cannot toggle back out, because the shell's key
listener ignores anything typed into an input — Escape is the way out, and has to be.

### The catalogue is the app's; the ARRANGEMENT is the person's

`ui settings commands` opens a page where a command can be renamed, given an icon, and pulled up
or down the order menus list them in. What the commands ARE stays the app's — this is a layer over
the catalogue, kept in `commandPrefs.ts` and applied by `orderCommands` / `labelOf`.

Four decisions, and the last two are the load-bearing ones:

- **Keyed by the canonical LINE** (`event trim`, `ui help`), not by the sid. The sid is the more
  stable id but only the backend's commands have one — the shell's own `ui …` lines do not — and a
  page that could arrange half the catalogue would order a menu it does not draw.
- **The entity a command acts on is the first word of its line**, which is what the filter offers.
  Nothing new to author, and a command added to the app is filterable the day it exists. A
  PLURAL head folds into its singular (`entityGroup`): `events move` lists among the `event`
  ones, marked with a layers glyph. Acting on several at once is the same subject taken several
  at a time, not another subject — and a group holding one command hid it from the only filter
  anyone would look under. Derived from the catalogue, not tabulated: a plural whose singular
  nobody wrote keeps its own group rather than inventing a subject out of a suffix.
- **A partial order.** Commands someone has placed come first, by their number; everything else
  follows in catalogue order. A total order would mean every command added to the app later
  arriving at a position a saved list had already decided — and it is what lets you pull three
  commands to the top without numbering the other two hundred.
- **Applied once, over the palette's built list.** The palette is the one surface that lists every
  command, so ordering anywhere else would leave the page describing an order nothing obeyed. The
  label replaces the sentence the palette MATCHES on, deliberately: someone who renamed a command
  should find it by the name they gave it.

#### A name is a SENTENCE, so there is one field per language

The row carries one text field per locale the app is built with — `en` and `fr` today, read off
Paraglide's `locales`, so a third language grows a third field the day it is added rather than the
day somebody remembers this screen.

One field would mean one string for every language: renaming a command while reading French
would rename what English shows too, with nothing on screen saying so. The split
follows the line the catalogue already draws — `CommandInfo.readable` is `{en, fr}` while the
command's NAME stays the CLI's in every language, because a name is an identifier and a sentence
is an explanation. A person's override is a sentence, so it is translated too.

Three consequences worth knowing:

- **Each placeholder is the catalogue's own sentence IN THAT language**, which is why
  `PaletteCommand` carries `readableBy` — the whole table — beside the `readable` that
  `buildPaletteCommands` already resolved. A placeholder has to be what that field would leave
  standing, or an empty field reads as "nameless" instead of "unchanged".
- **No borrowing between languages.** A command named only in French shows the catalogue's English
  sentence in English. Falling back to the other language would put French words in an English
  menu, which is the thing this split exists to stop.
- **A bare string in the document stands for all locales**, reads in every language, and is not
  rewritten on load. It is expanded across
  them on the first per-language edit — `setCommandLabel` takes `locales` for exactly that, since
  without it renaming in French would drop the name English had been showing, invisibly until you
  switched.
- **`labelIn` answers as AUTHORED, and the trim lives at the two places a name is drawn**
  (`labelOf`, the context menu's row). Trimming in the reader breaks the space bar: the value is
  a controlled input's, so typing `Rogner` then a space holds `"Rogner "` in state and renders
  `"Rogner"` straight back into the field — the space vanishes as it is typed and a name of more
  than one word cannot be entered at all. What somebody is still typing is not what a menu draws,
  and a blank-only override is dropped on write, so nothing needs the reader to tidy up after
  them.

It lives in the ACCOUNT's preferences, not the rig's — what you call a command follows you to
another browser, where which audio interface to open belongs to the machine. `St0Prefs` widens
`EnginePrefs`, which is the extension point that type documents, and `patchPrefs` merges, so
writing this cannot wipe the engine id beside it.

**And the backend's zod schema is what actually decides**, which is worth a paragraph because a
field it does not name costs this feature its persistence. A zod object strips what it does not
declare, so a layer `backend/src/server.ts`'s `prefsSchema` says nothing about is accepted,
answered `{ok:true}` and dropped: renaming a command works, saving says it worked, a reload shows
the catalogue's own names again, and the disk holds `{"engineId": "…"}` alone. Widening
`St0Prefs` is half of adding a preference. The router refuses a write it would have to shorten
(`droppedKeys`, `packages/user-prefs/docs/store.md`), so an omission is a 400 naming the field
rather than a feature that quietly does not last the session.

#### …and this page has a Save button, which nothing else in the shell does

The app's rule is autosave — the editor writes as soon as the buffer parses, and every text pane
here follows it. This page is the second exception after the module builder, and the reason is
not taste: **without a button it is unusable to type in**.

Three costs, all paid per character:

- a `PATCH` of the whole preferences document down the wire, per keystroke;
- a `setState` at the ROOT of the app — `commandPrefs` lives in `App`, because the menus, the
  key listener and the palette all read it — so the entire shell re-renders behind the overlay,
  every character, with the timeline and the graph still mounted underneath;
- `keyForCommand(canonical, prefs)` called once per ROW to fill the shortcut cell, and that call
  builds the whole effective map. Two hundred rows, two hundred rebuilds, per character.

So the page holds a **draft** and writes once, on the button. The middle cost goes because the
draft lives in the leaf; the first because there is one write per save; the third because the
effective map is built once per edit and inverted into `canonical → label`. The rows are
`memo`ised on top of that, which works only because `setCommandPref` copies the document
shallowly: every untouched command's entry keeps its identity, so one row comes back and not two
hundred.

Two things follow from the button and are worth knowing:

- **A shortcut assigned here does not run until it is saved.** The app reads the SAVED document;
  the header says `non enregistré` while the two differ, and `annuler` throws the draft away.
- **Leaving asks.** Unsaved edits are what a Save button makes possible to lose, so `← retour`
  confirms while the draft is dirty. That is the only thing autosave never had to answer for.

**Shortcuts are the fourth field of that layer.** Each row of the page carries a key cell:
click it, press a key, and the pref stores the raw `keyToken` (`"g"`, `"shift+space"`) under
`key:`. Escape renounces the capture, Backspace removes the shortcut (stored as `KEY_NONE` when
the command has a default — deleting the pref would resurrect it), and choosing the default
again drops the field, leaving no entry behind. The rules live in `effectiveKeys` (keys.ts),
pure and tested: an assignment MOVES a shortcut rather than doubling it (the default token goes
dead), a taken token is stolen outright (visible — the losing row reads the same map and its
cell goes blank), and the CONDITIONAL bindings — the esc ladder, `f`'s interpolation, `m`'s
three meanings — are not remappable: they are rules, not shortcuts, and `resolveToken` falls
through to them only for tokens the effective map does not name. App's listener, the help
legend (`shortcutsByCommand`) and the pane buttons' tooltips all read the same map, so a moved
key is advertised wherever keys are shown. The focused-control rule follows the commands rather
than the tokens: what comes back from a focused button is whatever runs a `transport …`
command — wherever the person has put it — plus Escape, with Enter left to the control.

**Context menus draw those icons.** `MenuItem` carries a `verb` — the command WITHOUT the entity and
untranslated (`node bypass`, not `bypasser gtr`) — which is exactly what the prefs are keyed by.
Kept as a field rather than re-derived from `command`, so a menu never has to un-localize a line to
find out which command it is; and two entries for one verb on two different tracks are one command
wearing one icon. `contextMenu.ts` stays a pure function of the catalogue and the thing clicked:
the person's layer is applied by the RENDERER, because an arrangement is a matter of who is
looking and not of what an entry means. The icon gutter is held whether or not there is an icon —
a half-decorated menu with a ragged left edge reads as a rendering fault.

The icons are **lucide**, already this app's icon set, so nothing new is pulled in for them. What
this page adds is resolving one BY NAME, which cannot be tree-shaken: everywhere else imports the
icons it draws, while "whatever the person chose" is not known at build time. `lucideIcons.ts`
loads the set through a dynamic import and caches it, so a surface asking for an icon awaits once
and every surface after it is synchronous. A menu opened before that lands draws its labels and no
icons — the honest degradation, since the label is what an entry MEANS and the icon is how you
recognise it faster the second time.

**The split does not actually happen, and this is worth knowing before trusting the paragraph
above.** The build says `INEFFECTIVE_DYNAMIC_IMPORT`: some thirty components import their icons by
name from `lucide-react`, so the bundler cannot move it into a chunk of its own. The `import()`
buys deferred execution and no deferred download, and naming the namespace retains all ~1500
exports where tree-shaking keeps the forty this app draws. Measured on a real build: the
IconPicker chunk is 1 KB, the main chunk 2.4 MB.

The alternative is a curated subset, statically imported: instant, bounded, tree-shakeable, and
offering two hundred icons where the ask was a complete library. That is a product decision rather
than a refactor, which is why it has not been taken unasked.

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

**A better subject beats the rule.** `selection copy` and `selection paste` sit beside the
catalogue's `selection consolidate`: the head names what all three act on, the rectangle you
drew. The namespace rule alone would make the copy `ui` — it only fills a slot in this shell —
and the paste bare, since it writes through `events add`, which puts one gesture's two halves on
either side of the line. The rule is what a command falls back on when nothing better names it,
not something to obey against a subject that is right there
([clipEditors.md](clipEditors.md)). `ui copy path` is not one of them — that one puts a *path*
on the system clipboard and is a different act.

A line the shell recognises but cannot act on is reported as *handled* rather than passed
down: the backend has no such command either, and "unknown command" would say less.

The tree's verbs are an **`fs` group** — `fs file new`, `fs folder new`, `fs file rename` — and
they share a head with nothing, which is what keeps `isUiLine` two lists and no special case.
`ui file <path>` opens a file; a bare `file <verb>` doing something *to* one would collide with
it on the head alone, and only the second token would tell them apart. The group is worth having
on its own terms too: they are the one family that acts on the workspace's files rather than on
the song.

`ui external <surface>` is the namespace's odd one and belongs to it squarely: it reads an
address and puts it on the clipboard, touching neither the project nor the transport nor even
this shell's view. It **does not navigate** — the whole point of the address is to be carried to a
second device, and following it here would replace the editor you are standing at with the
tablet's screen. The line is echoed in the status bar as well as copied, so a browser that
refuses the clipboard still leaves it readable. The share panel lists the same addresses as real
`<a target="_blank">` links, and that is not a second copy of the behaviour: OPENING one is
navigation, which a command has no business being, while the *Copier* button beside each row
dispatches this line ([external.md](external.md)).

### Every action on screen is a command

There is no button, menu entry or toggle in this shell that the command bar cannot reach.
That is a rule, not a coincidence, and it is what makes the palette a real answer to "what do
you want done" rather than a shortcut list for the half of the app somebody remembered to
wire. It also means a gesture is describable: a bug report, a doc page and a key binding can
all name the same thing.

### …and the log holds every one of them

The Logs panel is a **transcript of what ran**, not of what was typed. Every command reaches it
as a `cmd` line, whichever way it was triggered — the bar, a key, a button, a right-click, a
cable dropped on a knob — because `runCommand` and `quietCommand` are the only two doors and
both log before they dispatch. The buffer is the shell's and fills whether the panel is open or
not; only the tray's merged process log is polled on demand (`useLogs`).

Three cases are worth saying out loud, because each is a command nobody typed:

- **The picker's first half.** Choosing a module from the canvas menu runs a `module new` ahead
  of the `node new` you were prompted for. Unrecorded, it would leave a transcript showing a node
  appearing with no module ever created.
- **A rewritten line.** `canonicalizeCommand` may turn what was typed into another spelling —
  a translated verb name. The log shows both, `typed ⇒ ran`, since a transcript holding a line
  you cannot retype is worse than a slightly longer one.
- **A command aimed elsewhere.** The chains builder's verbs run against a library chain, not the
  open song, so its lines carry the chain's ref: `› [process/normalize] node new x`. Without it
  the transcript would claim an edit to the project that never happened.

What is deliberately NOT in there: anything that goes through a ROUTE rather than a verb — a
file write, a module save, a probe. Those are not commands, and a log that mixed them would stop
answering the question it exists for.

Keeping it costs one habit — **the button runs the command, it does not call the handler**.
Where the two would otherwise be two copies of one behaviour, the behaviour lives in one place:

| what draws it | the command | where the behaviour lives |
|---|---|---|
| the footer's mixer / notes buttons | `ui mixer`, `ui notes` | `toggleMixer` / `toggleDocs` in `App` |
| the footer's panel row | `ui panel <graph\|logs>` | `togglePanel` |
| the log panel's *clear* | `ui logs clear` | `useLogs` |
| a surface's pane button (the desk) | `ui turntables` | `fullscreen` / `setFull` in `App`, like any pane |
| the timeline header's clock / height | `ui ruler`, `ui lanes` | `TimelineHandle` |
| the cog | `ui settings` — toggles its panel | `App` |
| the header's Playlists button, on a SET | `ui playlists` — toggles its panel | `App` |
| the header's Share button | `ui share` — toggles its panel | `App` |
| the settings panel's tabs | `ui settings editor\|io\|account` | `App` |
| the settings panel's *Commandes* | `ui settings commands` — the one that is still a page | `App` |
| the account tab's rows | `ui engine`, `ui workspace quit`, `ui logout`, `ui language` | `App` |
| the share panel's rows | `project commit`, `project pull`, `project export`, `project share k7\|link` | `@studio/commands` and `hooks/useShare.ts` |
| the share panel's *Copier* beside a surface | `ui external <surface>` | `App` — the row itself is an anchor, see below |
| the editor tab's one toggle | `ui vim` | `toggleVim` in `App` |
| Ctrl+Z / Ctrl+Y | `project undo`, `project redo` | `@studio/project-shell/undo` |
| the file tree's right-click menu | `fs file new`, `fs folder new`, `fs file rename`, `fs file move`, `fs file delete`, `fs file upload`, `ui pin`, `ui copy path` | `EditorHandle`, and `FileTreeHandle` under it |
| the clip panel's *stop*, while a take rolls | `transport stop` | the engine |
| a `.dawproject` / `.als` clicked in the tree | `project import <path>` | `useProjectImport` |
| the master meter's *fix* | `project master fix` | `fixClipping` in `App`, over `MasterMeterHandle` |
| the channel strip's mono/stereo pairing | `system channel type <ch> <mono\|stereo>` | `@studio/commands` — the rig's file AND the engine |
| the Playlists panel's *＋* | `playlist new <name>` | `@studio/commands`, in `_playlists/` |
| the Playlists panel's *Séparer les stems* | `playlist stems <playlist>` — the same work, song by song | pl8's `POST /api/stems`, see [playlists.md](playlists.md) |
| the I/O tab's *séparation des stems* | `system stems <chaîne>` | `@studio/commands` — `~/.studio/preferences.yaml`, read by every screen that could start one |

Two of those handles exist only for this: `EditorHandle` carries the tree's own verbs, and
`FileTreeHandle` exposes the two things nothing else holds — the pins, which are that
component's `localStorage`, and the OS file pickers, which are its two hidden inputs.

Three of those rows have TWO answers. `ui select`, `transport locate` and `transport loop`
reach whichever grid is on screen: the clip pane's caret while it is open (the piano roll's or the
sequencer's — see [clipEditors.md](clipEditors.md)), the timeline's otherwise. The commands are
one thing, and which surface answers is a question about what you are looking at, not about the
verb. `ui zoom` stays the timeline's alone: it is the only one that keeps a zoom stack.

`selection copy` has two answers as well, and takes them in ORDER rather than picking one: the
clip pane, then the timeline, first answer winning. It is the only one that asks the pane a
question instead of acting on it, so a pane in front with nothing selected must not end the
question — see [clipEditors.md](clipEditors.md), which holds what that difference costs.

Three things are deliberately NOT commands, and the line is the same one every time — a
command names something you could *ask for*, and none of these is:

- **Disclosure.** Opening a dropdown, expanding a tree folder, showing the sidebar. Asking
  for it and doing it are the same act; there is nothing left for a command to add.
- **A dialog's own buttons.** Confirm, cancel, "continue editing". They answer a question the
  shell asked, so they cannot be reached from a bar that is not the question.
- **Continuous gestures.** Dragging a clip, growing a selection, panning the graph, the
  waveform's onset sensitivity, the roll's velocity drag. The timeline's `event move` is the
  command and the roll's is `sequence note velocity`; the nudging is the view's, as `keys.ts` says.
- **Typing into the open buffer.** The video readers' *Set From* / *Set To* look like actions
  and are not: they write a number into the file the editor is showing, which autosave then
  saves like any keystroke. A command for them would be a command for typing.

The two transport buttons in the header are the clearest place a button does NOT dispatch its
command, and the reason is latency: `transport toggle` is a CLI verb, so it travels to the file
service and back, while the button already holds an open socket to the engine. The command
exists and does the same thing — it is the button that takes the short way.

Two of the Playlists panel's gestures take a road of their own for a different reason each, and
both are in [playlists.md](playlists.md): adding a song from the SEARCH writes into the OPEN
BUFFER rather than the file, because a command writing the file underneath a modified buffer
would race the autosave; and *Séparer les stems* drives pl8's `POST /api/stems` once per line rather than dispatching
`playlist stems`, because that verb reports its lines when it is finished and finishing takes an
hour. The rule this bends is worth stating exactly: what must be reachable from the bar is the
ACT, and it is — the verb does the same work headless. What the button adds is a bar you can
watch, which a command's reply has no shape for.

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
  created — and since a chain names it by its FILENAME alone, that name is the one thing
  only the user can supply, which is why both paths stop at the bar. From a namespace it
  takes one command: a chain cannot name `@engine/…` (`use` takes a local module), so it
  creates the local module that inherits it *and* the node, with the module name
  pre-filled and the node name left to you.

- **`rec <track>`** (the `r` key). An instrument track arms for MIDI capture in the browser;
  an audio track falls through to the backend, which arms it in the engine. Same key, routed
  by whether the track carries a sequence.

## Mobile

A phone shows ONE pane, not the studio layout: the panes are too small side by side and there is
no pointer to drag a splitter with. `full` already means "one pane, whole screen", so the menu
just drives it and the global view is never entered — which is why entering mobile has to land on
a pane. Timeline is the default, being the one pane that says what the song *is*: the editor needs
a keyboard and the graph needs room.

Every row of chrome is a row the panes do not get. On a phone in landscape the whole window
is about 400px tall, so the header and footer are trimmed to what a touch target needs and
no more — and it is why everywhere there is to go is menu rows rather than a row of its own.
The one control that could not simply move is the command bar's opener: a phone has no
double-Shift, so the menu carries it.

## The service worker, and the scope it cannot avoid

**The worker is the SHARED preset's** — every frediverse app gets one, from
`@frediverse/vite-config`, whose `docs/pwa.md` holds the rationale for `registerType`,
`clientsClaim`, `devOptions` and why no manifest is generated. What follows is only what is
st0's, and one thing it owns alone.

`main.tsx` registers it, beside the manifest swap, because both answer the same question — what
app this document IS.

**What it buys is a second opening, not offline.** The shell and its assets are precached, so
st0 starts from disk instead of re-fetching a large bundle over the LAN. It buys nothing
offline, and that is not an omission: the editor reads its project from the file service and its
sound from the engine, both on the musician's machine, so a cached shell with no machine behind
it can only draw the "aucune machine" it already draws.

**The scope is `/`, the whole origin, and it cannot be narrower — this is the part st0 owns
alone.** A worker's scope is a prefix and st0's own routes ARE the root — `/<dépôt>/<projet>`. So
this worker also controls `/pl8`, `/k7`, `/z0`, `/api` and `/auth`, which no other app on this
origin has to think about: mounted under a `base`, their workers reach nothing but their own
prefix. The only thing keeping st0's honest is the `pwaDenylist` it passes to `defineAppConfig`:
without it, a navigation to `/pl8` is answered with st0's `index.html` and the médiathèque
becomes a white page with the editor's router refusing an address it cannot parse. That list is
the same table as `apps/studio/docker/nginx.conf`'s locations — two copies of one fact, and this
is the one a browser enforces. **Check it first if another app on this origin ever serves the
editor's shell.**

**And the thing that actually blocked it for a week: mixed content.** A page over HTTPS that
loads one resource in the clear is flagged "includes resources that are not secure", and that
alone makes it uninstallable — the certificate can be perfect and the manifest complete. Here it
came from the engine probe, which listed every LAN address as a `ws://` candidate and let the
browser refuse them. See `@studio/engine-browser`'s `docs/access.md`.

## The PWA manifest uses RELATIVE urls, deliberately

`public/manifest.webmanifest` has `"start_url": "."` and unprefixed icon `src`s, and neither
is an oversight. A manifest's URLs resolve against **the manifest's own address**, and Vite does
not rewrite the contents of a public file the way it rebases `index.html` — so anything written
`/…` there is origin-absolute and escapes the app.

An origin-absolute `"start_url": "/"` therefore installs whichever app owns the root, which is
st0 today and need not stay so. `.` is right under any mount; `/` is right under exactly one. A
manifest that has to be revisited when the edge's path table moves is a manifest written wrong.

## Where the rest of it went

| piece | file |
|---|---|
| the pane/view/panel tables, transport clock | `src/shellMeta.tsx` |
| the palette catalogue and argument completion | `src/palette.ts` |
| self-contained slices of state | `src/hooks/` — engine link, project doc, track controls, polls, logs, MIDI recording, dialogs |
