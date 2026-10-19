# The shell (`App.tsx` and `main.tsx`)

## What wraps the editor (`main.tsx`)

The gates, outermost first: **AuthGate** (you must be signed in — hosted backend OIDC),
**EngineGate** (find which registered engine to drive, without asking: the one most COMPATIBLE
with the project — it has the plugins the project uses, `engineCompat.ts` — then the best latency
class, then the strongest machine by performance score, among TRUSTED engines only — the one the
account chose before, one this browser reached on its own machine or network, or the server's own;
anyone may register an engine, so any other one waits in the list for a click —
`@studio/engine-browser/docs/access.md`, "Who is taken unasked"), and **ProjectGate** (rendered by
EngineGate: resolve the workspace this editor was opened on into a folder, then mount the editor).
Several tabs may open one project at once; there is no single-tab lease.

**The project opens BEFORE its engine is found, and without one at all.** The files are the
server's file hub's, which answers with no engine bound, so EngineGate opens the project on the
hub's own ticket and looks for an engine beside it. Someone who has never heard of an engine must
still see their song: a full-screen picker in front of it read as "k7 does not work". The editor's
link asks for its URL on every dial and waits for the search's answer, so the engine picked by the
search is reached without a reconnect delay; a pick made later — from the header, or the list drawn
over the project — remounts the editor, as a switch always did. Once an engine is held, the files'
ticket names it, and that is what binds it at the hub (`packages/file-hub/docs/fileHub.md`).

**Every wait is one bar along the bottom** (`@studio/project-shell/progress`), never a screen: the
sign-in check, the files, the address resolved, the sync, then — with the project already drawn —
the engine looked for, the copy, the apply and the warm-up (`components/StartupBar.tsx`). A wait
that hides the project tells a beginner nothing about what they are waiting FOR; a line under a
song they can already read and edit does.

**Play waits for the same bar.** An engine whose socket is up does not yet hold the project: its
files may still be on their way, and the edit it builds when they land drops a transport already
rolling. So Play stays "loading the project" until the file service's `engineLoad` is null, read on
every `/workspace` poll (faster while it is not), rather than freeing on the engine's first frame.

**ProjectGate picks nothing.** The home page links here with an address —
`/@local/<workspace>/<project>`, k7 answering the origin root — and arriving without a project in
it draws the home page instead. That address is the router's `basename`, so the app's
own routes are written below it and cannot rewrite it away. The gate is `@studio/project-shell`'s,
and `components/ProjectGate.tsx` supplies this app's wording
alone. Read
[packages/project-shell/docs/launch.md](../../../../packages/project-shell/docs/launch.md)
before touching any of it, in particular why the address is a path and the workspace is named
rather than spelled out.

**ProjectGate also closes the session again.** Twenty minutes untouched and it stops rendering the
editor — which is what closes the engine socket — flushes the project out of the engine and draws
a card offering to resume. EngineGate lets go of its lease at the same moment, since a tab with no
socket that kept renewing a claim would be squatting the machine.
[packages/project-shell/docs/idle.md](../../../../packages/project-shell/docs/idle.md) is the
page, including why a playing transport does not count as idleness.

`LocaleProvider` sits above all of them: switching language remounts its children, so nothing that
renders a message may live above it.

`BrowserRouter` sits *outside* the gates. The URL names a **screen of the editor**, and the gates
are conditions for reaching it rather than places of their own — so a deep link like
`/timeline?panel=logs` survives them.

### React.StrictMode is deliberately NOT used

In dev it mounts, unmounts and remounts every component, and the imperative WebGL renderer here —
the ui-eyes video compositor — creates and tears down a context per mount. On Firefox that thrash
loses the context and freezes the tab for seconds. An async-initialised WebGL renderer cannot be
made double-mount-safe cheaply, so the dev check is forgone: the chains graph is DOM and
double-mounts harmlessly, the compositor is the one that pays.

### …and the Profiler is behind a flag, for a related reason

`main.tsx` can wrap the tree in a `<Profiler>` feeding `freezeWatchdog`'s `reportCommit`, so a
stall report says which COMMIT it was and not merely how long it lasted. Only commits over the
watchdog's threshold are kept — but the instrumentation bills **every** commit in the subtree to
find them, and this tree commits on meter frames. So: `?profile=1`, or `studio.profile` in
localStorage so it survives the reloads an investigation takes. `installFreezeWatchdog()` stays
unconditional — the heartbeat and the `longtask` observer are cheap and are what turn "it froze"
into evidence at all.

The flag is `src/profiling.ts`, and it is deliberately ONE flag rather than one per instrument.
The viewport's per-lane drift readout is behind the same one (`picture.md`): it polls and
re-renders its pane at 5 Hz, the same trade — worth it while somebody is looking, and an
instrument measuring itself the rest of the time. Anything else that costs per-frame to *report*
rather than to draw belongs behind it too.

### On Firefox two of the three instruments see nothing

**Firefox implements no Long Tasks API**, so `observe({entryTypes: ["longtask"]})` is a silent no-op
there and an empty ring reads exactly like a quiet thread; the Profiler being off by default empties the
commit ring for a second, unrelated reason. Only `beginActivity()` breadcrumbs really report — and a stall
report concluding *"nothing on the main thread"* from that silence tells the reader to stop looking in
the app. So the watchdog **asks whether it can see** (`PerformanceObserver.supportedEntryTypes`) and says so
once at startup when it cannot.

It has to be TOLD about the second one: an empty commit ring reads identically whether the Profiler
is off or every commit was fast, and the browser cannot answer that — only the app knows. So
`installFreezeWatchdog({ commits: PROFILING })`, and every report then names the instruments that
were **blind** for it, whether or not it found anything: silence from a channel that was switched
off is not evidence, and a tally line can otherwise look like a whole answer when half the report
was never listening.

Given a stall on Firefox: turn the Profiler on (`?profile=1`), since commits DO work there and will name
one if React is the cause; if that stays quiet, reproduce in a Chromium browser, where the long-task
observer attributes the block.

### The fourth line, which speaks when the other three cannot: `tally()`

The three rings above all answer *"what was in flight, and long"*, and that question goes blind two
ways at once. A ring of 64 spans **rotates inside a three-second stall**, so the work that caused it
can be gone by the time the report is written. And a thread saturated by four hundred short tasks has
**no single span long enough to name** — the thresholds that keep the instrument cheap are exactly what
hide it. Both produce the same empty report as a stall that had nothing to do with the app.

`tally(name, ms, bytes?)` adds work up instead of timing it individually: one map lookup per call, read
and **reset on every heartbeat** so a tally never outlives its window and starts measuring the session.
It is always on — it needs neither the Profiler nor a long-task observer — so on Firefox it is the one
line that reports at all.

Two transports report into it, and between them they cover the JSON this thread parses: the file
service (`setFileApiTally`, per VERB and ROUTE — a path carrying a file name would make every read
its own line and the busiest route unfindable) and the engine socket. A stall naming neither is a
stall that is not about data arriving, which is worth knowing in one line.

`fget` is where the second one earns its keep: it collapses a burst of readers into ONE request and
then parses **per caller**, deliberately, since two callers handed one object could corrupt each
other's. The price is real — four readers of a large document parse it four times, on this thread —
and `GET /hints x4` is what says so.

### What NONE of it can see: the cycle collector

Every instrument on this page measures **script**. The heartbeat is starved just as thoroughly by
anything else the main thread does between tasks — so a stall from outside JS arrives as a large
overshoot with every ring empty and every tally at zero. That is not a quiet thread; it is a thread
busy doing something no JS instrument is holding a stopwatch on.

**The measured case, and the one to suspect first when a stall is Firefox-only.** A 9 s profile of
this app sitting on a timeline: 58 % of the main thread in GC/CC, **2 509 of 4 755 samples with the
cycle collector on the stack**, and a single `CCSlice` of **3 804 ms** — the freeze, arriving after
fifteen ~50 ms slices back to back. The self time is all CC graph building (`EntrySlot<PtrInfo*>`,
`CCGraphBuilder::AddNode`, `EdgePool`, `TraversalTracer::onEdge`).

**Chrome cannot reproduce it, and that is not reassurance.** The cycle collector is Gecko's, for
reference cycles spanning XPCOM/DOM C++ and JS; Chrome has no equivalent pass. So "Chrome is fine"
is evidence *for* this reading, and never evidence that the app allocates reasonably.

What feeds it is the size of what is LIVE, and churn on top — objects made and dropped, especially
ones with both a C++ and a JS half. A DEV build multiplies both hard: `jsxDEV`, `runWithFiberInDEV`
and `validatePropertiesInDevelopment` on the stack mean React's development build. Measure a
production build before reading anything into the app's own code.

**React's DEV build is also a LEAK, and the worst of the three.** It records one `performance.measure`
per component render, with a `detail` object for its DevTools track, and the browser keeps every
entry until somebody clears it — about 140 a second on the editor. Measured after a long dev session:
the tab at **3.5 GB**, one CC visiting **8.9 million** live objects and freeing 28 000, slices up to
131 ms, and the cycle collector at **79 %** of the tab's CPU while the app's own JS was 13 %. So every
studio app's entry calls `clearDevPerfEntries`
(`commons/packages/ui/src/dev-perf.ts`) at boot, which clears the measures and marks every few
seconds in DEV and does nothing in production. Nothing of the apps reads them: the profiler records
them as markers as they happen, so a recording still shows them.

A same-site tab shares the content process, and so the profile: a home page left open beside an
editor is in it. Its workspace poll stores a list only when the list CHANGED (`Home.tsx`), since a
fresh array every three seconds re-rendered every project row and its menus for nothing.

Graphics is the other thing none of it can see, and two rules of this app exist because of it:

- `packages/ui-chains/docs/wobble.md` — the cables are drawn on a canvas: writing `d` on an SVG path
  puts the layer on WebRender's blob-image path, and one moving cable re-serialises, re-parses and
  re-uploads the whole group every frame (62 % of the content main thread in paint, measured).
- [timeline.md](timeline.md) — live state is drawn by leaves: a timeline BODY subscribed to the
  20 Hz engine frame re-renders an arrangement's worth of DOM to move one line (36 % in graphics at
  ~154 paints/s, measured).

The tool for all of this is the Firefox Profiler, and the rows to read are the ones outside JS.
`~1 280 MozAfterPaint in 9 s` — 142 paints per second on an idle tab — is the number that says the
graphics reading applies; a `CCSlice` in the marker table is the number that says this one does.

`EngineClient` tallies every JSON frame by type, with its byte length, for two things nothing else
sees: the `JSON.parse` runs **before** the message type is known, so no span could open around
it and a slow parse was attributed to nothing at all; and a 20 Hz frame is far under every threshold
here however much it costs in aggregate. `ws state x600 (4.2MB)` is a diagnosis; four blank rings are
not.

## The layout (`App.tsx`)

`App` is the k7 web editor itself: **one page at a time, full width** — the timeline, the graph, the
desk, the frame, the master strip or the editor — with the transport controls and the page buttons in
the header. Two pages are never split side by side; the one way to see a second view under the page is
the footer's bottom panel (`event`, `graph`, `mix`, `logs`), which opens on half the main column's height
until its divider is dragged. It is the wiring and the layout; almost nothing else.

### The header is the shared bar, with k7's contents in it

`@frediverse/ui/app-header` draws it — the bar phare's apps use too — and k7 fills its four slots:

| slot | what k7 puts there |
|---|---|
| `title` / `subtitle` | **nothing**, inside a project — see below |
| `children` | the project's name, the engine playing it, the workspace warning, and the **transport** centred over them |
| `items` | **empty** — see below |
| `actions` | the **master meter**, then the pane row — or, on a phone, the one menu that also holds the side panels' buttons |

**No brand name and no build stamp: the project's name has the left of the bar.** The brand is what
the home page says — repeating it over a song names the tool rather than the work — and the stamp
goes with it, being the tooltip of that name on the home page (`../../../docs/versioning.md`).

**The master meter is at the RIGHT end, first in `actions`.** The bar and the fader under it are a
control rather than a caption, so they belong on the side the bar keeps its controls; and the meter
being the widest thing in the row, leaving it on the left made the transport's `mx-auto` centre it
over what was left rather than over the pane. It stays ahead of the icon row because it is read
while playing, not clicked, and the divider after it is what says so.

The **way back to the home page** is a back arrow just left of the project's name, and the name
links there too. Projects open in the home page's tab rather than a new one, so the arrow is the
gesture that ends a session. It is a whole-page navigation, and on a frozen share there is no arrow
and the name is plain text (`docs/shared.md`).

**The engine is named right after it** (`components/EngineSwitch.tsx`), because which machine plays
the song is the first thing to check when it sounds wrong or not at all. It is said as WHERE THE
SOUND COMES OUT — "Sound on <machine>", or "Sound in this browser" when the engine streams to the
page (its `whoami`'s `audioToBrowser`) — since a laptop driving the desktop at home is silent with no
other clue; with no engine it reads "No sound — choose an engine", in amber. Its menu lists the engines
MEASURED when it opens, not a list kept from the gate, and picking one moves the project there
without the full-screen picker: the files are the server's, so a switch costs the playing position
and nothing else. An engine another tab or person holds is shown and refused before the click.

A **warning triangle** follows the name when that engine lacks a plugin the open project uses —
its compatibility under 100 — and its tooltip says the score and which plugins are missing
(`hooks/useEngineCompat.ts`). Scored in the browser when the files are the server's, by the file
service beside the engine when they live on its machine (`/project-compat`). Nothing is drawn while either half is unknown: a warning that might
be false is worse than none.

The split between `items` and `actions` is the shared bar's own rule (*a page goes in `items`, a
control goes in `actions`*), and here it lands on a real distinction. A **pane** button shows a page
that is already mounted, and exactly one of them is lit — the page on screen: `aria-current="page"`,
not `aria-pressed`, since pressing the lit one changes nothing rather than switching it off. Each one
carries its key in its tooltip, which is why the row stays icons rather than labelled entries that
would drop the shortcut.

`items` is **empty** while every surface is a pane, and the prop is still passed rather than dropped
because it is the shared bar's slot for exactly that kind of page. Note the constraint if you use
it: `AppHeader` folds `items` into a hamburger of its own below 640 px and k7's `actions` already
collapse into one — two hamburgers side by side being two answers to "where do I go" — so anything
put there must also be in k7's own menu.

### The bar is `plain`, not the house tint

k7 passes `variant="plain"` to the shared bar, the card surface with a hairline under it, where every
phare app keeps the violet tint (`commons/packages/ui/docs/app-header.md`). A DAW lights things all
the time — the page on screen, a selection, Play — and those are violet; a violet bar around them
leaves the accent nothing to mark. The footer and the home page's sidebar take the same surface
(`projects.md`).

### One colour per meaning, across every view

k7 keeps its own values over the shared palette in `src/index.css`, and every surface that draws a
song reads them, canvases included (through the CSS variable, since a canvas cannot take `var()`):

| meaning | token | why one |
|---|---|---|
| the playhead | `playhead` | the timeline, the roll, the step grid, the minimap, the takes view, the clip's waveform and the desk drew five different lines; an audition's line stays amber, being another clock |
| mute, solo, arm | `mute`, `solo`, `arm` | the timeline's solo and the graph's were two yellows; a lit pad takes dark type, which reads on all three |
| the meter's zones | `meter-ok`, `meter-hot`, `meter-clip` | the header, the desk and the graph's faders say the same thing about the same level |
| violet as text | `primary-text` | no one violet passes both as a fill under white type and as text on this ground (`primary` is the fill) |
| text below muted | `faint` | it replaces `/50`–`/70` fades of the muted grey, which fell to 2.4:1 |

Takes, slices and cues are a SERIES, coloured by order from `@studio/song-schema`'s
`seriesColors.ts`; a track keeps its category colour, and one the compile has not coloured yet is
that scheme's `other` grey rather than a type hue of its own.

**Surfaces are told apart by fill.** The ground is one step deeper than the shared theme's, the
card a step above it, and a hover a step above that — `accent` and `muted` were the same grey, so a
hovered row looked like a panel. A panel that is a surface (the home page's workspaces, the settings
sections, the libraries card) is its fill with no outline; a hairline is kept where it SEPARATES
something, between a header and its rows.

### The bar is 30 px, and its height is a rule rather than a number

Every row of chrome is a row the panes don't get, and a phone in landscape is about 400 px tall.
So k7 trims the shared bar's own `px-5 py-3` through its inner box — `py-[3px]` on the desktop —
and sizes the controls to match: `toolSize` is `icon-xs` (24 px) and every button in the bar takes
it, the transport included. The three pixels are what keeps a pressed button's own background off
the bar's edge: below that the row reads as a strip of buttons rather than as a bar.

**A bar's height IS its tallest child**, which is the rule to keep: padding alone buys nothing while
a 36-pixel button is still in the row, and one control left at the default puts the whole bar back
where it was. Anything added here is 24 px or under — the share's download
button is `h-6` for that reason, and the badges are `text-xs py-0.5`.

**A phone keeps `icon` and `py-1`.** The one button up there is the menu everything else collapses
into, and a 24-pixel target under a thumb is a miss; the pixels are cheaper than the tap. That is
the only reason `toolSize` reads the breakpoint instead of being a constant.

#### The transport in the middle, and what a SET drops from it

**Centred on the BAR, not between its neighbours.** The cluster is taken out of the flow —
`absolute left-1/2 top-1/2` with the two translates — against the shared bar's inner box, which k7
makes the containing block with `[&>div]:relative`. Centred as a flex item it would sit in the
middle of whatever the project name on one side and the icon row on the other left over, so it
moved every time a name got longer or a surface added a button: a control you reach for without
looking must not be somewhere else on the next project.

Nothing reserves its width, so the shell MEASURES whether it has the room (`shell/useCentredFits.ts`):
would a cluster centred on the bar clear the last thing in the left group and the first of the
actions, by 12 px? While it would, it is centred; when it would not — a narrow window, a long engine
name — it joins the row at the left group's end instead of drawing over its neighbours. The test
reads where the bar's centre is, never where the transport sits now, so the answer cannot flip back
the moment it moves.

Play/pause, stop, the clock, then the record button, and each **drops focus on click**
(`blurOnClick`). These are the buttons a mouse is most likely to land on right before reaching for
Space, and a focused one eats the keypress. On play/pause the theft is invisible, because the button
does what Space would; on stop and on record it is not.

**Record turned on with nothing armed arms a track first** — the caret's, else the song's only one
(`armForRecord` in `App.tsx`). Record mode with no armed lane leaves Play dead, and someone who has
never heard of arming reads that as a broken button; a track with no input still refuses on the
status line, which then says why.

**Loop sits beside the clock.** On, it turns the loop off; off, it loops the timeline's selection
when there is one, and otherwise four bars from the playhead — so the one gesture needs nothing
selected first. The region is the engine's session state, as Shift+L's is.

**The footer's tempo and time signature edit themselves on a click**, through `project tempo` and
`project meter`, which write `project.k7x` — the two numbers were otherwise reachable only by editing
the file.

**One record, whatever the lane holds.** The circle flips the ENGINE's record state, and play records
every lane armed there (`transport arm`) — and the MIDI-armed lane too, which the BROWSER captures
(`useMidiRecording.ts`): the engine never hears a controller, so the notes are timed here, in
playhead beats interpolated between frames ([playhead.md](playhead.md)). Arm, record, play is one
gesture for audio and MIDI alike, so there is no second button to know about; `midiRecord` in App is
what the takes view sets for a MIDI pass, and nothing in the bar shows it. Which half a lane arms is
its arm button's business (`rec <track>` reaches the same split): `useTrackControls.ts` resolves it
by what the lane holds and what feeds it, and one red lane reads both.

The engine counts in even when it records no lane of its own, since the browser's take is owed the
same count (`engine/k7-runtime/docs/engineHost.md`); what is played during it belongs to no take,
bar a downbeat a hair early (`inTake`). While a MIDI take rolls, the lane draws it growing and the
event panel draws its notes as they are played (`MidiTakeRoll.tsx`) — a window that follows the
playhead, since the clip's own piano roll fits its view once and a take outgrows it. When the take
ends it lands as a NEW clip placed where it was played, as an audio take does, and that clip's piano
roll replaces the live one.

**A record is one take, not a mode.** Record goes OFF when the roll that recorded stops — the
engine clears its own in `stop()`, and App clears `midiRecord` on the same edge. Left on, the next
Play is another take, and an ordinary take mutes the armed lane at its punch-in: an armed track that
plays silent reads as a broken track, not as a record still lit. Pressing a record while it rolls
ends the take there and keeps playing; during the engine's count-in there is no take yet, so it
stops the roll (`engine/k7-runtime/docs/engineHost.md`).

**Play waits for an arm.** With record on and no lane armed — audio, MIDI or picture — Play
is greyed and `transport play` (Space included) is refused with the two ways out (`recordWithoutArm`
in App). Rolling then would be a take of nothing: the engine plays on without recording, and the
record panel opens on a pass that captures no lane. A rolling transport can always be stopped.

The picker in the bar's right end — LEFT of the output meter — chooses **which input** feeds the
take. The recorder listens to every input the browser exposes until one is picked — right for the
one-keyboard rig, wrong the day a pad grid shares the desk and its notes land in the same sequence.
The list re-offers itself when a device is plugged in mid-session, and the browser's permission
prompt rides the first press of whichever control needs the access.

The cluster is absent where there is nothing here to address, and there are two such cases.

A project with **neither a timeline nor a desk**: every control here addresses a position in
something, and that project has none; sound still reaches the engine, played by whatever is wired in
the graph. See [packages/song/docs/surfaces.md](../../../../packages/song/docs/surfaces.md).

…and the **DESK alone on screen** (`deskOnly`), the ordinary state of a set. Each deck is a platter
carrying its own position, so the transport there drives nothing but the metronome's click — and
each deck has its own PLAY, at the foot of its tempo column
([../../../../packages/k7-plugins/docs/turntables/mix.md](../../../../packages/k7-plugins/docs/turntables/mix.md)). Buttons that
look like they start the music without starting it are worse than none. The test is the SCREEN and
not the project: a project that declares a desk *and* a timeline keeps its transport the moment
the timeline is showing or the viewport's window is up, because there it moves something you can see.

A set that still shows the cluster gets the two that mean something and not the other two, **in the
same place**: this is the bar you reach for whichever project is open, so play and stop must not
move around. What it drops is the clock and record. A set declares no tempo and no time signature,
so the clock would count bars nothing is written against, and record would arm a lane with nowhere
to put a take.

The **engine's health** sits in the header, right of the engine switch (`components/EngineLink.tsx`):
the connection light, the Q badge and the engine process's memory. They describe the engine that
switch names, so they stand beside its name rather than at the far end of the status bar. Q1/Q2/Q3
off the measured latency is a property of the SESSION rather than of a screen — it decides what you
can do here (`@studio/web-protocol/quality`) — and it is the same line the médiathèque shows. A phone
keeps the light alone. The light changes SHAPE as well as colour — a dot when connected, an unplugged
plug when not — so it reads for someone who cannot tell red from green.

A link that stays down says so in words, on a strip under the header
(`components/EngineLostStrip.tsx`): a red dot is easy to miss while every gesture quietly does nothing.
The strip is an OVERLAY on a zero-height anchor, not a row: arriving two seconds into an outage, a
row would push every pane down under the pointer, mid-gesture. It covers the panes' top edge instead,
on the card surface so it reads over whatever is there, until the link is back or it is dismissed.
It waits two seconds before showing, because the client reconnects on its own and a blip that
flashed a banner would teach people to ignore it. Its Retry dials at once rather than waiting out the
backoff; its close hides it for this outage only, and the next one is announced again. A transport
press made while the link is down is DROPPED with a sentence on the status line rather than queued:
the client's outbox would otherwise play it up to thirty seconds later, when the person has moved on.

### On a phone, one menu holds everywhere there is to go

`MobileMenu` holds all of it: the panes, then the tools. There is no **bottom tab bar** — it would
spend a row of a screen ~400 px tall in landscape on a control used a few times a session, and it
could only ever hold the panes, leaving anything else to a second hamburger beside the first.

**Its rows send `ui <pane>`, never the bare pane name.** `runLocalCommand` refuses a bare one, so a
tap dispatching `timeline` sets the status line to *"timeline" is a ui command* and changes nothing
else.

A pane row is `aria-current`, not `aria-pressed`, exactly like the desktop's header row: picking one
means "show me that page", and the current row is where you are, not a switch left on.

**There is ONE layout**, and no project chooses a second one. `project.k7x`'s `project_type` is
accepted and ignored — the schema keeps it as a plain string so a folder still carrying it loads —
and nothing here reads it: it could say `live` while the folder declared a timeline, a contradiction
`surfaces/` cannot have.

**The timeline itself is a SURFACE, and the project has to ask for it.** `surfaces/timeline.k7x`
(`type: timeline`, `layout: split`) is what puts it in the layout, and it is the **home page** — the
one a project opens on, `/` and `ui global` lead to, and Escape comes back to. A folder without one
opens on the first pane it does declare (a set's desk, a rig's graph), keeps its editor, and is warned
about in its diagnostics. `noArrangement` is what the transport and the minimap read: a rig and a song
that has not declared its arrangement look alike on screen and are not the same fact. See
[packages/song/docs/surfaces.md](../../../../packages/song/docs/surfaces.md).

**The VIEWPORT is the second**, `surfaces/viewport.k7x` — and NOT a page: a floating window over
whichever page is up, moved and sized by hand, shown and hidden by `ui viewport` or its button beside
the pages. It owns a WebGL context and one `<video>` per layer, which is the most expensive thing the
never-unmount rule below protects: hiding the window keeps both. See [picture.md](picture.md).

**The DESK is the third**, `surfaces/turntables.k7x` (usually named `desk.k7x`). A set declares no
timeline, so the desk is its home page. A fader on the desk is a param on a module in the graph, and
the bottom panel's `graph` is how both are read at once. What it holds is a DOCUMENT — the loaded
songs, the crossfader, the six EQ knobs — and a set does not stop existing because you went to look
at the graph. See
[../../../../packages/k7-plugins/docs/turntables/deckSet.md](../../../../packages/k7-plugins/docs/turntables/deckSet.md).

The editor is never the home page: every song would open on a k7x file you had not asked for, rather
than on a view that is *about the song*. `ui editor` gives it the screen, and a command that sends it
to a file opens it as a popin (below). It stays mounted throughout, so summoning it costs nothing.

See also [shellRouting.md](shellRouting.md) for how the screen state maps to the URL.

### The Mixer is a bottom PANEL: the graph, arranged

The `mix` panel is not a second picture. It is **the same graph** (same nodes, same cards, same cables)
with the strips pulled onto one rank: `alignModuleRank` in `@studio/ui-chains`, between `buildGraph`
and `layout`, drawn by `GraphPanel` given its `strips`. It is a panel and not a page so that the
timeline stays on screen above the faders it is mixing.

Every track ends on a mixer module (`trackMixer`, by plugin type) but a track with a longer chain
ends DEEPER, so by default the mixers sit on a staircase no zoom shows them all of. The shared rank
is the **deepest** of theirs, never a shallower one — pulling a mixer up would put it above modules
that feed it, and an edge that has to climb is a cable drawn backwards. Sinks are pushed past the row
for the same reason.

One rank puts them on a line; it does not give that line a rhythm, since dagre spaces a rank by what
is ABOVE it. `spaceModulesEvenly` re-spaces them with one constant gap in the song's track order, and
the cost is upstream and meant to be: the chains feeding the row stop being straight columns, and
every moved card drops the dagre waypoints of the cables touching it — a bend around a card that has
since moved is worse than no bend, so `cablePath` re-derives both ENDS from the nodes themselves.

Known limit: a non-mixer node that happens to sit on the shared rank is not moved out of the row's
way. In practice the row packs TIGHTER than dagre spaced it (gap 24 against `nodesep` 60), so it
shrinks leftward rather than sprawling — but a song that puts something else at that depth could see
an overlap.

The camera frames those nodes once, as the panel opens, pulled back a fifth from a perfect fit:
a row framed exactly fills the pane edge to edge and reads as a wall. The panel owns its camera, so
the graph's page keeps its own place.

That framing is the whole visible effect, so it must not fail quietly. `fitTo` answers whether it
ACTUALLY framed (a pane with no size yet frames nothing), and the panel records the attempt as done
only then.

Which modules are strips is the project's answer, not the package's: `mixerStrips.ts` reads it off
the compiled doc and `useProjectDoc` hands the list up, so the row and the faders can never be one
reload apart. Both sources are needed — the compiled project says *which* modules are strips (the
graph doc carries no plugin type), the graph says what each looks like and what feeds it.

**Every audio lane has a strip**, and `track new` writes it with the lane
([packages/song/docs/trackMixer.md](../../../../packages/song/docs/trackMixer.md)): a module of
plugin type `Mixer` (`trackMixer`, `MIXER_PLUGIN`) last in the lane's run.
`scripts/migrateTrackMixer.ts` gives one to a lane that has not got one.

A song can still have **none** — one whose lanes all run into buses, or one with no `graph.k7x` at
all. So the button stays **disabled** at zero and says why in its tooltip, and `ui panel mix` opened
anyway says so in the panel. Nothing else explains an empty mixer, and a control that answers a click
with nothing is worse than one visibly unavailable. That is why the mix button sits apart from the
loop that draws the other panel buttons.

A strip's controls are its module's own panel — the very card the graph draws. A hand-rolled strip per
track would be a second implementation of a channel strip and would drift from what the module's
`ui.k7x` declares. Three consequences, all of them the design rather than gaps:

- **A track with no mixer module has no strip.** It is not "at unity" — it is a track with nowhere
  to put a level. It simply is not in the row.
- **Mute and solo are not here.** They are the track's, not the strip's, and they live on the
  timeline (`m`/`s`) and on the graph's track nodes.
- **Two tracks sharing a strip draw one card.** `mixerModules` de-duplicates, because two cards for
  one value would be two controls fighting.

The **sockets stay**, and the cables with them: you can see what reaches a fader without leaving the
view, which is most of why the mixer belongs in the graph rather than beside it. A rank of strips
drawn on its own would have no edges to plug its jacks into.

#### It frames the HEIGHT, and the row pans

`fitTo(..., "height")`, not the default fit-both. Fitting both axes divides the pane between however
many strips the song has, and below `WIDGET_MIN_SCALE` (0.6) the renderer drops the widget grid
altogether — so a busy song's mixer would frame to a rank of bare name cards, the one thing this view
must not do. Measured on a 1200×280 pane with a 3×6 strip grid:

| strips | fit-both | fit-height |
|---|---|---|
| 4 | k 0.85, card 152×225 | k 0.85, card 152×225 |
| 8 | k 0.66, card 119×175 | k 0.85, card 152×225 |
| 12 | **k 0.44 — widgets dropped** | k 0.85, card 152×225 |

Framing the height keeps every strip the same readable size whatever the track count and lets the row
run off the right, where it pans. A mixer you have to scroll beats one you cannot read. The cards are
drawn at the graph's own size, without the elbow room a lane's row gives itself (`widthScale`) — they
are the same nodes as the graph's, which is the point.

`moduleRow` in `@studio/ui-chains` lays a bare rank of cards out, and this view is not its caller: it
re-ranks the graph instead. The row it does lay out is one lane's signal path (below).

### ONE panel for an audio clip, recorded or not — and clicking one reaches it

`AudioClipPanel` is where an audio clip is looked at, whichever way you got to it: a take that has
just stopped, `ui review <clip>` on an old one, or a **click on an audio event in the timeline**. One
panel for the three, because the route you reach by clicking a clip has to be the one that can trim
it, mark it and bring it up to level. Everything below `clip` is therefore OPTIONAL — a clip sitting
on a lane has no take, no count-in and no armed track — and only `beatsPerBar` and `tempo` are worth
passing anyway, because the twelve-bar window should be twelve of *this* song's bars.

`WaveformView` draws the same waveform and can act on none of it: it is the editor's own pane, a
different surface with a different job.

`AudioClipPanel` takes the graph slot, and it is the only place a clip is drawn. While a take rolls it
shows the envelope the engine is pushing, **growing**; the moment the recorder closes the file it shows
that file, with its onsets and the button that brings it up to level. `rolling` chooses the picture — it
does not mount the panel, which outlives the take, so closing is the × and not the Stop.

**One panel, and not two.** A live monitor of its own would take the slot and keep it, so after Stop the
monitor would be the whole screen and the review nowhere. Three things follow:

- **The live picture goes through `Waveform`**, like the file's. `useLiveEnvelope` hands over
  `{intervalMs, samples}` — the same shape the `/waveform` route answers with — so there is one
  renderer, one set of markers, one behaviour.
- **One envelope, not one per armed track.** The LOUDEST armed input per frame: a panel is about one
  clip, and stacking every lane makes it a monitor rather than a view of a take. The max is what
  keeps a quiet second input from being invisible.
- **Nothing is editable while it rolls.** There is no file yet, so there is no onset to place and
  nothing to normalise — Stop and the elapsed seconds is all it can honestly offer.

The live x axis is nominal: `LIVE_FRAME_MS` (50) per frame, because the engine's push is ~20 Hz and
not a clock. A growing take is read for its SHAPE; the moment timings matter, the file is there and
its own waveform has replaced this one.

#### The take's start is the SHELL's, and the counter measures THIS take

`takeStart` lives in `App`, taken off the store on the `rolling` **edge**. One source, because two
surfaces draw from it — this panel's counter and the growing clip on the armed lane (`RecordingClip`,
`docs/timeline.md`) — and two captures drift the moment they mount at different times. READ from the
snapshot rather than subscribed to, since it changes once per take and a subscription in the shell
would re-render everything 20 times a second for a number that does not move.

The edge, never once per mount, because the panel outlives its take: a capture that survived one would
measure every take after the first against the *first* one's start, while the position it is compared
to is absolute in the song — a take punched in at bar 15 reads 56 beats the instant it begins.
`useLiveEnvelope` clears its buffer on the same edge.

`takeCounter.ts` counts the pre-roll down, then the take up in bar:beat. It is a pure function and not
arithmetic buried in a component that also draws a canvas, because a stale number in it is invisible.
Both results are **clamped**: a pre-roll can never be longer than the pre-roll, and a take can never
have run for less than nothing, so whatever the engine does with its playhead during a count-in the
worst this shows is a number that stops moving.

**The count-in draws nothing, anywhere.** Nothing is recorded during it, so the panel shows the countdown
alone and the lane's growing block does not exist yet — `recordingFrom` (the transport's start plus the
pre-roll) is the one number both read. Neither may take the TRANSPORT's start instead: a block drawn from
it reaches back over bars the placement landing on Stop does not cover, and a picture opened there sits
however many bars of click and room to the right of where it is in the file.

#### How the tab learns a take happened at all

Nobody types a recording. The ENGINE writes the wav, the file service declares the clip and places it
on the lane, and this tab is told by neither — so the document it is drawing is one clip out of date
and nothing in it knows.

The signal is `lastTake` on `/workspace`, read by the 2 s poll (`useActiveProjectFollow`) beside
`activeProject` — every 200 ms from the moment a take stops until it lands, or for 15 s. Two seconds
is the length of a whole breath between Stop and a picture, and the fast rate is bounded because a
take that never lands (a session serving nothing) must not leave the tab hammering the service. Until
the file's picture has loaded, the panel keeps the take's live envelope on screen: the take as it was
heard is a truer picture of it than a "reading" line. The shell does two things with it: `setWs`, which opens the review panel on the new
clip, and a reload, which puts the clip on its lane. Both have to hang off that read and nothing else
— the transport keys go straight to the engine socket (below), so no reply from the file service comes
back to bump a reload, and a take stopped from the header's Stop button would otherwise be on disk, on
the lane, and off the screen.

The first answer only SEEDS: `lastTake` is the service's memory of the newest take it ever wrote, not
an event, so firing on it would reopen this morning's recording every time a tab loads. `isNewTake` is
that rule, and a pure function for exactly that reason.

#### …and the panel can be asked for, not only awaited

The automatic appearance is a moment that passes: `lastTake` lives in the file service's MEMORY, so every
restart of that service loses it, and the ✓ ends it for good as well. A take would otherwise become
unreachable while its file sits in `clips/`.

The bin beside the ✓ discards the take: `event remove` on its event, which closes the panel too. The
file stays in `clips/`, so the discard is one Ctrl+Z like any other edit; deleting the file would make
a misclick on the bin final, and that is the one button on the panel placed to be pressed in a hurry.

`ui review <clip>` names one and opens the panel on it — a `ui` command because it opens a VIEW and writes
nothing, what the panel then does (`clip process`, `event trim`, `clip onset …`) being the brain's. The
named clip outranks the automatic one, without the rolling guard: asking for a clip by name is a
deliberate act.

The lane is looked up rather than asked for (`trackPlacing` in `rows.ts`), and a clip nothing places opens just
the same, labelled **hors piste**. That is the case it exists for: the waveform, the onsets and the
level are properties of the FILE, and none of them needs a placement. `event add <track> <clip>
<timecode>` is the verb that puts such a take back on a lane.

#### Twelve bars, and the wheel opens it out

A minute of take drawn across a pane is a solid block, while the point of looking at one is where the
attacks are and whether the onsets landed. So the panel shows **twelve bars** by default and the wheel
zooms, out as readily as in. The header says `12/34 mes.` with a **tout** beside it, because a window
showing only the first bars without saying so reads as a clip that had been cut.

Everything moves inside the clip's own `from`/`to`: the panel is **caged to the interval the clip
plays** ([clipEditors.md](clipEditors.md)), so "tout" is the whole interval and what a trim cut away is
simply not on screen. The file is still fetched whole (`whole`), so onsets and every command stay in
file-absolute seconds.

`Waveform` takes a `view` for this: a span in seconds, absent meaning all of it. A **window** rather
than a zoom factor, since what a host wants to say is "these twelve bars" and not "×3.7" — and
everything crossing that boundary stays in **absolute seconds**, so a marker's time, a selection, a
trim preview and every callback mean the same thing zoomed or not. Only the pins are filtered: their
`left` is absolute px, so one outside the window would hang in the panel's chrome.

The zoom is **anchored under the cursor** — the same promise the timeline and the roll make through
`useHZoom` — and a pinch does the same, anchored at the centre of the touches. There is **no pan**
gesture: it would be a second gesture on a surface whose drag already means "select", and zooming out
then in elsewhere reaches every part of the take. `barWindow.ts` holds the maths and its edges,
including a tempo that has not arrived yet — a bar of zero seconds would make every take infinitely
many bars long.

#### Trimming moves the WINDOW, and previews before it does

`event trim <track> <at> [gate-dB]` cuts the head and the tail at a gate. It moves that EVENT's window
(`from`/`to` on the placement) and **never the audio**: a take's head is the tail of a count-in and the
player settling, its foot is a room and a hand leaving a string, and both are things you stop *playing*
rather than things you want destroyed. One line to put back, where a rewritten wav is a restore from
the undo journal.

The button **opens a gate rather than applying one**, because where the silence ends is a judgement and
the waveform is what you judge it on. While the menu is open the part that would be KEPT is drawn as a
selection over the wave, so the slider is read against the take instead of against a number. The
preview calls **the same `trimWindow`** the command runs — a preview that disagreed with the act would
be worse than none — so the only difference is bucket resolution.

The gate is **bounded to the window the clip already has**: a re-trim refines `from`/`to` and never
reaches back into material an earlier trim removed — undo is how that comes back. A take entirely below
the gate changes nothing and says so.

Beside it is **operations**: every chain the project and the library offer, normalising among them
(`clip process <clip> <chain>` over a chain naming the médiathèque's `normalize` module). There is no
`clip normalize` and no `track normalize`, and that is the trade — a treatment that can be followed by
another, landing in a stamped render the clip is repointed at, rather than one hard-coded gain written
over the take. See `@studio/commands`' `docs/processChain.md` for what it costs: a single gain shared
across a whole track's files.

The envelope reaches the command through `CommandHost.clipEnvelope?()`, optional for the reason
`getAudioDevices?()` is: building it needs the engine, which decodes and downsamples into the `.cache`
sidecar. A host without one refuses the trim by name rather than guessing at a window.

#### Onsets are dragged, not retyped

A detected attack is often a hair off rather than wrong, and refusing it only to add another a few
milliseconds away is two acts for one intention. So a pin can be **dragged**: `Waveform` takes an
`onMarkerMove` and the panel sends `clip onset move`, recorded as ONE correction and therefore
surviving a re-detect at another threshold.

The drag lives on the pin — a DOM button — rather than in the canvas's pointer handling, because grabbing
a pin must not also start a selection underneath and the two would race for the same pointer. It commits
on RELEASE, an onset written on every `pointermove` being a file write per pixel. A press that travels
less than 4px is still a **click**, and a click still refuses the onset — the same threshold the canvas
uses, so a twitch while removing a mark does not re-place it.

### The clip under the caret is REPORTED, not drawn

`ClipView` is drawn in one place, the bottom panel's `event`, and it answers the CLICK rather than the
caret. A panel that followed the caret would redraw a roll at every step of `hjkl` and drop the clip you
were working on as soon as the caret moved off it.

`editTarget` is no part of that drawing. The caret reports what it is over because the command
conditions read it — `hover_midi_sequence` and `hover_audio_clip` are what let a command know which
clip you mean without you naming it.

## A page is a PANE, and there is one on screen

Every pane is mounted always, and always the *same instance* — including the editor, which is never
the home page. Three pieces of state decide what you see, and none of them mounts or unmounts
anything:

- `full` — the page on screen, never empty: `null` in the state means the project's home page (the
  timeline, else the first pane declared), resolved against the layout before anything reads it.
  There is no split: two panes sharing the window each got too little of it to work in, and a second
  view under the page is the bottom panel's job
- `focus` — which pane gets the keys, which is the page on screen; Tab walks the pages of the ring
  (`ringPanes`, which is `viewPanes(...).ring`, so the editor is not on it)
- `panel` — the bottom panel, independent of both

There is no fourth piece: which pages exist is not state. It is a function of what the project
declares, read fresh wherever it is needed. See [shellRouting.md](shellRouting.md) and
[packages/song/docs/surfaces.md](../../../../packages/song/docs/surfaces.md).

Because nothing is torn down by a change of page, the state that would be expensive to rebuild — the
open file and its undo history, the timeline caret, the zoom stack, the graph canvas — simply never
moves. This is the one invariant to preserve when adding a pane: mount it once, unconditionally, and
let `full` decide whether it is `hidden`.

### Escape backs out ONE layer, outermost first

`esc` in `src/keys.ts` is an ordered list and the first match wins, which is what makes the key mean
"back out of the thing in front of me" rather than one fixed action:

| if there is… | Escape does | command |
|---|---|---|
| an overlay in front | closes the topmost one | `ui popin close` |
| …else an open event | lets it go and closes its panel | `ui slot close` |
| …else a page other than home | returns to the home page | `ui global` |
| …else | closes the bottom panel | `ui close` |

The ladder only works if each rung is **exclusive**, and that is the whole reason
[`src/popins.ts`](../src/popins.ts) exists. Several overlays answer Escape themselves with a plain
bubble-phase `window` listener and no `stopPropagation` — the phone's
hamburger, the help page, Radix's dialogs — and the shell's own listener is on `window` too. Both fire
on the one keypress, and since the shell's fallback closes the graph slot, dismissing a dropdown would
otherwise throw away the clip or the take open behind it.

So an overlay **registers** while it is up (`usePopin(open, close)`) and the shell reads the registry as
its `popin` condition. Two things fall out of it, both deliberate:

- **Registering is not the same as being closed by the shell.** An overlay that already closes itself
  keeps doing so; the registration exists to make the shell's binding resolve to `ui popin close` and
  stop there. `closeTopPopin` never pops the entry itself — the owner deregisters through its effect's
  cleanup, so a closer that is refused leaves the stack as it found it.
- **A stack, not a count.** "The current popin" is the last one opened, so a menu opened over a dialog
  is what Escape reaches first.

Three things deliberately do NOT take part. The **pickers** (module, asset — both `TreePicker`) and the
**context menu** listen in the *capture* phase and swallow the key, so the shell never sees it. The
**settings PAGE and the module builder** own the surface they are on: the listener returns early. And
**`AudioClipPanel`** keeps Escape for stopping a rolling take, which is neither a popin nor a slot but a
transport action.

The **docked panels** are deliberately not in that list: a docked panel leaves the panes on
screen, so the keys that drive them have to keep working — Space while you watch a level on the I/O tab
is the whole point of that tab not being a dialog over the thing it meters.

## The right column: four panels, one at a time

The right end of the FOOTER holds four buttons, after a separator, and each toggles a panel **docked at
the right** of the pane row — pushing the panes rather than covering them. They sit at the bottom right
because the footer is where every other panel button is, and that corner is the nearest one to the
column they open; the header keeps the pages and the meter. A phone has no room in its footer and keeps
them in its menu.

**Every button that opens a panel is a TAB** (`components/FooterTab.tsx`), the bottom panels' and these
alike: the shared header's tabs upside down, hanging from the footer's top rule, the open one taking the
page's background and opening into the panel it shows. A lit button says a toggle is on; a tab says
WHICH of several places you are looking at, which is what a panel row is. The footer wears the header's
card surface for it, since a tab in the page's own colour on a bar of the same colour is not seen. The notes
button stays a toggle: it opens nothing.

The buttons:

| button | panel | what it is |
|---|---|---|
| ♪ (a SET only) | Playlists | the workspace's set lists: a searchable dropdown, its songs under it |
| ⌾ | Références | the workspace's reference tracks — what you listen AGAINST ([references.md](references.md)) |
| ☑ | Tâches | the workspace's task list, `TODOS.md` at its root ([tasks.md](tasks.md)) |
| ⟲ | Historique | the open song's undo steps, newest first |
| ⇪ | Partager | export, publish |
| ⚙ | Réglages | tabs: Éditeur, I/O, Compte |

**The I/O tab lists the INTERFACE's inputs, not the song's** (`components/IoPanel.tsx`): every
input device the engine reports, each with its meter and a tuner on the line below, and beside it
the song's input nodes that listen there — or `unused`. A song declaring one input on a sixteen-channel
interface would otherwise hide the fifteen you are trying to find a signal on. Until the engine has
answered, the rows are the song's declared inputs.

**The History panel LIGHTS, it does not travel** (`components/HistoryPanel.tsx`). Hovering a step
rings what it touched on the graph and the timeline — the live ones, as they are now —
rather than swapping them for the project as it was. A step carries the files it
changed, so the marks are read off PATHS (`historyMarks.ts`): a track file is its lane, a sequence
or clip file every placement of that material, a chain file its chain — or only the node a journal
step's command line names in it. A file that is the whole song's (`project.k7x`) lights nothing,
since lighting everything says nothing. Undone steps stay in the list, dimmed: they are what Ctrl+Y
brings back, until the next edit drops them.

Under the journal, the same panel lists the WORKSPACE's sync history (`syncHistory.ts`): its
checkpoints and latest edits from every device, read from the relay's log
(`packages/file-hub/docs/history.md`). The two stay apart because they answer different questions:
the journal is this project's undo, local and offline; the sync history is what every replica
agreed on. A row opens on what it changed as plain text before and after, with no diff library, and
"Restore to here" asks first, because a restore reaches every device at once. It is the panel's one
write, and it is an edit like any other, so it is itself in the list.

`rightPanel` in `App` is one value and not one boolean each, because there is **one column**: two panels
open at once would be two columns, and the panes have already given up the width for one.

**The column animates its WIDTH** (`components/RightPanel.tsx`), because the panels push the panes
rather than cover them — a slide-over would promise the panes had not moved. There is one wrapper
holding whichever panel is open, not one per panel: two wrappers mid-swap would be two columns for
the length of an animation, squeezing the panes and releasing them for nothing. The panel inside
keeps its own width and is clipped, so nothing reflows while the column travels, and the content
being drawn on the way OUT is the last one open — by then the caller has stopped choosing a panel.
`motion-reduce` skips the travel.

Panels rather than one set of tabs, because they are different verbs — what you **set**, what you
**play from**, what you **listen against**, what you **send**. Settings are things you set and leave, a
set list is a thing you work from, and a reference is a thing you put on beside what you are doing. Nor is the share a dropdown, which is the wrong shape for a surface that *reports* — an export
takes a minute and says where the file went.

None of them is a **pane**. A pane is what the project DECLARES ([shellRouting.md](shellRouting.md),
`packages/song/docs/surfaces.md`); none of this is the project's, which is why none of it is in the URL
either.

## The open file follows the disk (`hooks/useDiskSync.ts`)

Every command in k7 rewrites k7x — `node param`, `track gain`, a clip drag, a bypass click. An editor
that read its file once and never again would hold a snapshot of the past the moment you touched
anything, and the next save would write it back over whatever had happened since. Silently. **That is a
data-loss bug, not a cosmetic one.**

| the buffer is | what happens | why |
|---|---|---|
| **clean** | adopt the new text without asking | nothing to lose, and anything else makes the editor lie about a file nobody touched |
| **dirty** | ask, and do nothing until told | two versions of one file exist and only the person knows which matters |

Gated on `/revision`, the same ~2 ms change token the diagnostics poll reads, rather than re-reading the
file on a timer. The token moves for OUR writes **and** for edits made outside the app — a change the live-sync relay brought in,
another editor — which is exactly the set of events worth reacting to. It is asked once for the whole
app, at once when the relay pushes a change notice and on a slow poll otherwise; see
`hooks/useRevision.ts` and `conflicts.md`.

### Space is the transport, wherever the last click landed

The key listener draws a line between two groups rather than standing aside for one list of tag names
— `INPUT`, `TEXTAREA`, `BUTTON`, `A`, `SELECT`, `contentEditable`:

- **Typing** — a field, or CodeMirror — owns every key it is given, Space included. That is what makes
  it a text editor, and nothing here may touch it.
- **A focused control** — a button, a link, a select — keeps the keys the platform gives it, except
  **Space** and **Escape**. Space, because "press Space to play" has to hold whatever you clicked last:
  a button reached by pointer keeps focus, and the transport failing because you had just clicked Mute
  is the bug. Escape, because a focused button does nothing with it, and Escape's first job is to close
  the overlay that button is sitting in. **Enter** still activates a focused button, so a control
  reached by Tab is still operable from the keyboard.

`blurOnClick` (`keys.ts`) hands back every *other* single-key binding — `1`, `m`, `s`, `f` — after a
mouse click, which the listener lets a focused control keep.

Space takes the **direct route when it can**. `transport play|stop|toggle|rewind` (`BARE_TRANSPORT` in
`src/ui/commands/transport.ts`) are answered by the shell over the engine WebSocket — the same socket the header's
play button uses. The file service route is a real cost, not a theoretical one: it sends this very
message, but only after an HTTP round trip, after the undo journal has walked the whole project twice to
find that a transport verb changed no file (**62 ms warm, 215 ms cold**, on a real song), and behind
whatever else that single-threaded process is doing — a project compile there is **1.5 s**. End to end
on an idle service one keypress costs **110–145 ms**; over the socket the engine acknowledges in
**13–50 ms**, most of it waiting for the next 20 Hz state frame. The delay belongs to the queue, not to
the transport.

Two cases still fall through to the service, which is why the branch is a fallthrough rather than a
send: **no socket of our own**, and an engine **mid-apply**. The WebSocket path *drops* a transport verb
while the engine is applying a change (`useEngineLink.ts`) — a queue there turns one press into three
plays and a rewind — and dropping is right for a button you can see is disabled and wrong for a key
whose whole promise is that it always works.

Nothing is lost by answering them here: they write no file, so there is nothing to journal and nothing
to reload. `transport metronome` is NOT one of them: it rewrites `settings.k7x`.

**Shift+Space** runs `transport replay` — the playhead returns to where playback last started, and rolls
again. That one IS a local command on the WebSocket path, because the seek half only exists there, and
its memory is the shell's own (`replayAtRef` in `App.tsx`): while the transport is stopped the playhead
sits where a play would begin, and the rising edge of `playing` freezes that value, so a start from a
key, the bar, another tab or the CLI all count. Shift+space arrives as `" "` with `shiftKey`, so
`keyToken` spells the modifier out (`"shift+space"`) where a shifted letter arrives already uppercased.

### Ctrl+Z stops at the end of the text, and Ctrl+S answers

Ctrl+Z in the text pane spends the buffer's own history first. When it is spent, the next press
does NOT reach the project journal: it says so, and only a second press within three seconds does.
Someone pressing Ctrl+Z through their typing must not silently undo a clip they moved on the
timeline a minute earlier. The toast then names the ACTION undone — the journal entry's label, a
command line or `edit <file>` — and an empty journal says "Nothing to undo" rather than nothing.

Ctrl+S anywhere but the text pane — which flushes its own buffer — answers that k7 saves by
itself, instead of letting the browser offer to save the page.

### Headphones, said when a live input becomes audible

A live rig monitors its input on purpose (`packages/song/docs/liveProject.md`), so the moment the
input reaches a channel it is heard — and a laptop's own mic and speakers feed back. The scaffold
stays audible; what changes is that it is SAID, in a toast that stays until dismissed, at the two
moments it becomes true: a channel picked on the input's card (`node param <input> @channel …`), or
a project opened whose graph already has a monitored input with a channel (`headphonesHint.ts`).
Once per project per browser: a warning repeated on every open would be read by nobody.

### The editor POPIN

A command that sends the editor to a file (`ui file`, `edit clip`, `edit sequence`) has to do something
when the editor pane is off screen. It opens as a **popin** — over the layout, on a dimmed backdrop,
**without the file tree**, because a command already named the one file it is showing. Fullscreening it
would answer a question nobody asked: you wanted the file, and it would throw away the timeline or the
graph you were about to read it against.

**And it opens only once the file has been READ.** `EditorHandle.open` answers whether it landed and the
popin follows that answer; revealed first, a name that resolves to nothing leaves an editor popped open
over your work with no file in it and no tree beside it to say so — a command that reports success and
does nothing being the one failure this shell says everywhere else it will not have.

What it resolves is in `src/openInEditor.ts`, whose third pass is the one worth knowing: **half the
callers name a PLACEMENT, not a file.** The right-click on an event offers `ui file` with a clip's id —
`audio_14_0@98.5` (`@studio/song/placementId`) — wanting `clips/audio_14_0.k7x`, and that `@98.5` is a
subsequence of no path, so the fuzzy pass scores −1 on every file in the project. The material behind
the id is tried LAST, after the written name has had its say, because `materialRefOf` returns a
material name unchanged and an entity may legitimately carry an `@`.

It is the SAME EditorTab wearing different classes, which the mounting invariant forces and which is also
what makes it good: the open file, its undo history and the CodeMirror instance survive being popped out
and put back. A second editor would be a second undo stack.

Three details it needs to be usable:

- **The popin is the active pane** while it is up (`activePane`), or the pane underneath would keep
  answering the keys.
- **It closes on a click outside, the ×, or Escape.** Escape belongs to the editor as well: in vim mode
  it leaves insert mode, and a key that both leaves insert mode and closes the window you are typing in
  is a trap. The shell's listener stands aside for a text editor (CodeMirror is `contentEditable`), so an
  Escape typed *into* the file never reaches the shell. What reaches it is an Escape pressed from outside
  the text — the roll or tracker tab, a toolbar button, the backdrop — where "close this" is the only
  reading left.
- **Any change of layout puts it away.** It is a detour to one file, not a place to be, so it is
  deliberately NOT URL state — a reload lands you in the view, not in the popin.

#### An INSTANCE in the popin shows its module beside it

A node's file names its per-instance fields, and what those override lives one `extends:` away — so when
the popin's file has an `extends:` that resolves to a file, the popin splits: the instance on the left,
the **module on the right, both editable**. The module side is a small self-contained editor
(`ModuleSidePane`, its own buffer and autosave — the main pane is THE editor instance and its undo
history must stay its own), and its writes follow the same fork rule as any save: a shared `_modules`
file becomes a project copy, and the pane moves onto it.

The resolution is `moduleBehind.ts` — the same answer a ctrl-click on the extends value gives (`base:`
then `module:` in `hints.paths`) — read from the BUFFER, so retyping the extends line swaps the pane. A
base with no file to edit (`@engine/…`, the `@meta/…` track bases) resolves to nothing and the popin
stays one pane. Popin only: the full-screen editor has the tree, and a second file there is one click
away rather than a question.

**Each pane carries its own widgets**, and a picture both would carry is drawn ONCE. A slice rack docks
THE SLICER at the bottom — one picture with coloured windows, rather than an inline waveform under every
symbol line: the source waveform with every symbol's window in its own colour, the symbol names in the
text painted to match (`sliceSymbols.ts`), and the gutter ▶s auditioning each line. The windows grow
draggable edges only in the pane whose BUFFER holds the symbols, so in the split the slicer sits under
the MODULE pane alone and the instance side stands down rather than showing the identical picture
read-only. `rackKeyOf` (projectPaths.ts) is what lets one map answer for both spellings of "this file is
a rack": a module's folder name, a node's stem.

#### The RACK BUILDER popin

`module create rack` (web-local — the building is the browser's) opens a 4×4 pad grid over the shell.
Drop audio files on the pads, name each pad (its TAP) and name the kit, and choose where the samples go:
this project's `samples/` (the default — `@project/<kit>/…`) or one of the account's libraries'. CREATE
uploads them there and makes the kit a NODE, `nodes/<kit>.k7x`, of the LIBRARY's
`instruments/k7-rack`, on its `samples` engine — `@k7-core`'s when it has one, else any library's (`rackModuleRef`) —
through `node new <ref>`, so the node lands in the graph, journalled and extending the library module
as it stands, then its taps in one write rather than a reload per pad. The builder writes no sampler
of its own: one per workspace would be one copy of the same `type: rack` per workspace, so a library
holding none is said on the popin before any upload runs. A kit is the node's and a
sample lives in a samples/ folder, never in a module (`packages/song/docs/racks.md`), so the builder no
longer writes a module at all. Auditioning is a local object-URL, with no server round trip.

The notes are the drum-machine page, pinned in `rackBuilder.ts`: bottom-left is 36, rightward, then the
row above — so the grid READS the way it plays, and the symbols are written in that order, which every
other surface then walks.

**Each filled pad carries a ✕ beside its ▶.** A drop REPLACES a sample, so without one a multi-file drop
landing a cell over could only be undone by starting the rack again. Clearing revokes the pad's object
URL — these are blobs the document holds, and a builder filled and cleared a few times would otherwise
carry every sample it had ever seen — and stops the audition when it is that pad playing, because a sound
outliving the pad it came from reads as a fault.

#### A sequence in the popin has TABS

Text / Roll / Tracker, and only here. A popin was opened by a command that named this sequence, so "now
show me its notes" is the likely next thing; a fullscreen editor pane is the text editor, and a grid
wants more room than a popin has to give.

All three write to the same buffer, so a note drawn in the roll makes the file dirty exactly as a
keystroke does and one Save writes it whichever way you made the change.

**A sequence opens on the ROLL**: its notes are what the command was about, and the k7x is one tab away.
The tab is chosen per FILE — keyed on the path — so each newly opened one is answered for what it is
rather than inheriting the last one's tab. It is a layout effect, so the swap lands before the paint
instead of flashing the text editor for a frame.

### The TAP CHAIN popin — one pad's own chain of effects

`ui tap chain <node> <tap>`, a pad's **Edit chain…**, opens `TapChainEditor.tsx` on the subchain that
pad feeds (`packages/song/docs/racks.md`, "A tap with a chain of its own"): the modules in order, each
moved or removed, **Add module…** through the ordinary module picker, and the cards themselves below.

- **Every button is a command** — `node tap chain add|move|remove` — so the popin holds no state of
  its own and re-reads the graph after each, as every pane here does. The first module added makes the
  subchain and routes the tap; the last one removed takes both away (`packages/song-edit/src/tapChain.ts`).
- **The cards are the lane view's.** `TrackModulesPane` draws any list of nodes when handed one, with
  no lane card, inputs or frame, so a knob here is the same knob, on the same stores, as on the graph.
- **The chain starts at a node called `input`**, cabled into its first card: a pass-through that says
  where the sound arrives from and does nothing else — no controls, no menu, no file. Without it the
  cards float with nothing feeding them, and a reader cannot tell which end the signal enters
  (`moduleRow`'s `lead`, in `packages/ui-chains/src/graph.ts`).
- **The picker hands back a ref** rather than placing a node (`onRef` on its state): the chain is
  written by the verb, not by `node new` and a splice. This project's own modules leave as `@workspace/…`.
- **Not a modal dialog.** It is a hand-rolled overlay at `z-40`, under the pickers' `z-50`, as the rack
  builder is: a modal dialog makes everything outside it unclickable — the module picker it opens
  included — and closes on the click that reaches it. Escape still backs out one layer (`usePopin`).

### The GRAPH SLOT — what takes the graph's place

The chains slot holds the graph, or one of three other things, until the × puts the graph back. That is
where they have room: the timeline stays above, which is what you read any of them against.

| what | opened by |
|---|---|
| a sequence's note grid | `sequence edit roll <sequence>` / `sequence edit tracker <sequence>` |
| a clip's content — the waveform for audio, the piano roll for a sequence | clicking the clip in the timeline |
| the take being recorded, and the take just recorded | a take starting to roll (above) |

**One state (`graphSlot`), not three flags.** They cannot be there together, so a union says so: separate
booleans would have to agree about which wins, and the × would have to work out which one it is closing.
A rolling take **evicts** whatever the slot holds — the one case where something other than a click
opens it, and while a take rolls the take is the thing.

The two rows can both show a piano roll, and they are **not the same one**. The grid draws a sequence
FILE's `notes:` array (`@studio/ui-editor`, shared with the media library, editing the text). The clip view draws a
PLACED clip's compiled notes (k7's own `PianoRoll`, with the transport's playhead on it). Same picture,
different subject — one is a file, the other is a placement.

Four decisions worth keeping:

- **It is not route state.** `routes.ts` carries the LAYOUT — which panes, which is fullscreened, which
  panel. Both of these name a FILE, and no file is in the URL: the editor's open one is not either.
- **Whatever opens it makes the slot visible** (`full: null`, `view: global`). A view drawn behind a
  fullscreened timeline is a gesture that reported success and did nothing.
- **`ChainsTab` is HIDDEN beside it, not unmounted.** It holds the MIDI runtime the whole shell reaches
  for (`midi.md`), so unmounting it would take `ui midi learn` away for as long as the slot was busy.
- **A grid writes every edit**, unlike the popin's tabs. That pane has no buffer and no Save button to
  lose an edit from, and a grid edit is one whole gesture, so there is nothing a Save would batch.

The two commands are bare-named rather than `ui …` because they name a sequence and open an editor that
WRITES to it — the same reason `event move` and `transport record` are bare.

#### A CLICK on a clip, which is a press that never moved

The timeline tracks that (`DRAG_SLOP`) and a press that never moved shows the clip. Falling through to
`commitMove` would find a move of zero beats and answer "move cancelled — no change": a refusal, for a
gesture that asked for nothing. Two consequences of putting the click on the gesture rather than on the
clip element:

- **A frozen or generated lane's clip opens too.** Neither can be MOVED — there is no `clips:` entry for
  a move to rewrite — so a handler hung off moving would drop the press before it was tracked. Seeing one
  asks nothing of the disk, and a frozen lane's render is exactly the thing you want to look at.
- **A pending `event move` still wins.** If the command bar is collecting that move, the click answers
  the bar; showing the clip is what happens when nothing was asked.

What it draws is `ClipView`, so audio and MIDI are told apart in one place.

## The minimap is not always there

It is a **second view of the timeline**, and that decides where it may appear.

| what is on screen | the minimap |
|---|---|
| the timeline (the default layout, and `full timeline`) | none — it would say what the timeline already says |
| another pane fullscreened | docked, above the command bar |
| the editor **popin** | floating, pinned to the bottom of the window, with the mini transport |

The popin is the case the docked strip cannot serve. It covers the layout, so the minimap has to come
**over** it or not at all — and there it stops being a convenience: a screen with no visible timeline is
one where you have lost the song. That is why the floating one carries a **mini transport** (play/pause
and the clock) and the docked one does not — over a popin, seeing where you are is worth nothing if you
cannot start the tape. Only the editor popin: the builder, the docs and the settings are **pages** about
something other than this song, and the builder's overlay holds no engine link at all, so a transport
over it would be a row of dead buttons.

The floating strip sits outside the popin's backdrop, so scrubbing it is not the click-outside that
dismisses the popin. It is **full width**: the minimap maps the whole song to the width it is given, so a
centred card would squeeze the arrangement into a strip less legible than the timeline it stands in for.
The popin's bottom edge is pushed up by the strip's MEASURED height — the minimap sizes itself to the
track count, so any fixed number would be wrong for most songs.

## What a click in the timeline does to the event panel

Two gestures move the slot. **A clip's click** selects it and nothing more: the caret parks on it,
which is what fills the command conditions (`hover_midi_sequence`). **Its double-click** opens its
content in the bottom panel's `event`, under the timeline still on screen, and lights that button. A
single click does not open the panel because the panel takes half the window and folds the lanes:
selecting a clip to move or edit it must not change the layout under the pointer. **The bare lane**
moves the caret to where you clicked and lets the event go — a click on nothing clears what was open.
The panel stays up and says nothing is open, since it was asked for; Escape and its footer button close it.

The caret mark is `pointer-events-none`, so a press landing on it reads as a press on the bare lane;
clips stop propagation, so they never reach the lane's handler at all.

### Double-clicking a lane's header lays its modules out in a row

The gutter is the row's handle: a click selects it, a double-click focuses it — opening its
`nodes/<name>.k7x`, framing the chains it feeds, and laying **one lane's whole signal path** out side by
side over the graph. `trackModules` walks the same reach the framing uses (`subgraphForTrack`, so a send
out of the lane's own chain is in it) and adds the ORDER a node set does not carry, then `moduleRow` lays
it out **as drawn** (`asDrawn`): every card at the size the graph gives it, so the row is a view of the
same nodes and not a bigger version of them. The framing
still happens underneath, deliberately: closing the panel leaves the graph already framed on the
track it was about.

**The cards are GLUED** (`moduleRow`'s `gap: 0`): a lane's path is one strip read left to right, and
two cards touching IS the cable between them. That arrow is still in the row, marked `glued` — the
canvas draws no cable for it, since cables paint over the cards and one between two touching cards
would be a loop drawn backwards across the seam, but the live ripple still walks it, so a send further
on keeps moving. **The cables that remain are the graph's own**: a send that skips a module shows as
the longer cable it is. Nothing is invented between neighbours: a seam with no arrow behind it is the
truth about a lane whose chains do not touch, and it offers no `+`. Cables meet the cards on the
**sides** (`flow: "across"`, which moves where a cable ENDS and nothing else), because a row is read
across and top-and-bottom would send a cable diving under a card to reach the one beside it. The socket
plates stay undrawn, being CSS-pinned to the top and bottom edges: a plug on the wrong edge is worse
than no plug.

**Every card takes the row's whole height** — the tallest card's, the lane's clip list included —
so the row reads as one band and the side cables run straight, and the camera zooms so that height
is the pane's whole height (`fitAxis="height"`, `fitPad={1}`, over a
box `moduleRow` draws round the cards and nothing else). The row is a few cards you came to work on,
so it is drawn as large as the pane allows; the width runs off the right and the wheel walks along
it.

**The LANE leads its own row** (`moduleRow`'s `track`), without the colour band its card wears on the
graph: the whole row is about that lane, so the band would say nothing the row does not. Its cards draw no top or bottom
border either (`.dgx-node.across`): the row reads as one strip, divided only where two modules meet. The signal starts there and its fader is the
first thing in the path, so a row that began at the first plugin was a path with its head cut off — and
the cable out of the lane, the one that says which lane this is, had nothing to leave from. It is the
same card the graph draws, matched on the node's KIND rather than its name, since `trk:` exists precisely
so a lane and a module may share one — clip list included, as the graph draws it. It stands taller
than the plugin cards, and that costs them nothing: no card is stretched to its height, and the zoom
cap keeps a tall row from shrinking or growing the rest. **What feeds the lane comes before it**
(`moduleRow`'s `inputs`): an input, and whatever stands between it and the lane, since that is where
the signal really starts — and the seam between input and lane takes a `+` like any other, which is
how a preamp goes in. A lane that reaches no module and no input leads nothing: the row stays empty and
the pane says so, a single card with no cable not being a signal path.

**A `+` waits on each seam**, shown while the pointer is on it, and **one stands past the last card**,
always shown (`@studio/ui-chains`'s `rowSeams.ts`, drawn by `ui-chains-react`'s `Seams.tsx`). Both ask
the same "which module?" a cable's `+` asks on the graph, and run the same `node insert`. The tail
splices into the arrow OUT of the last card: before the lane's mixer when the row pinned one right —
the fader closes the path, so a module added "at the end" belongs ahead of it — and otherwise into
whatever that card's chain feeds, offered only when that chain has ONE way out, since a fork does not
say which branch "the end" is. In a chain project a seam whose left card is a module shows a **second button** on hover, lower down
(at 80% of its height) and wearing a branch icon: the picked module is made, then STACKED under that
left card (`node stack`) — the two become a subchain run in the card's place, drawn as one column, and
a branch off a card already in a column adds to it. It sits on the seam rather than under the card
because the seam is where a person already looks to add something, and the card's bottom is its bar. The pick gets **no position**: this row's coordinates are its own, so a
point taken from it would pin the new node somewhere meaningless in the real graph. Handed none,
`node insert` lets the layout decide.

**A card drawn here is the graph's card, so it is handed the graph's callbacks** — the bypass, the
alternative badges, the waveform's subscription, the lane's fader and mute, and the browser a file-valued param's
button opens. A control drawn from the same card definition and wired to nothing is the worst of the
three possible states: a `<select>` that will not open reads as a broken app, where an absent control
reads as a view that does not offer it. What this row deliberately does NOT hand them is the
CANVAS-shaped half — dragging a card (`onMoveNode`, whose coordinates are the row's own and would be
written into `graph.k7x` as pins), and the cable gestures, which have no bare canvas here to drop a
loose end on. Rack pads are lit but not firing: auditioning one needs the host's own laid-out nodes to
find the sound behind the symbol, which is `ChainsTab`'s `triggerRack` and has not been lifted out.

### One frame for everything that takes the slot

`GraphSlotPane` is the shell and the title bar. The occupants supply a body and what to call it, and
nothing else about the chrome — written per occupant they drift, into title bars at three type scales.
**Every bottom panel has a ✕ at its top left, and it takes no height** — a panel has only half the
window, so the ✕ is never a row of its own. A view with a toolbar column (`ModeStrip`: the clip editors,
a lane's modules) draws it as the column's FIRST item; any other view gets it floating over its corner.
The view's toolbar CLAIMS it at mount (`components/PanelClose.tsx`), so a panel shows one ✕ whatever it
holds. It runs `ui close`, as the footer's panel buttons and Escape do. Three ways
to wear the frame, because the occupants genuinely differ:

- **`title` (+ `note`)** — a name and a detail. The plain case.
- **`bar`** — a strip of your own, for a header that carries CONTROLS rather than a label: the clip panel
  counts beats and offers Stop while a take rolls.
- **neither** — no bar. A clip's contents draw their own
  header already; a second row above it would say the same thing twice. A lane's row of modules wears
  none either: its first card IS the lane, so a bar naming it would be that card's name again, and
  the row gets the height back. When there is no row to draw — loading, an error, a lane that reaches
  no module — the pane says so in its body, where the row would be.

The **mix panel** is not an occupant. It is a panel of its own beside `event`, and opening it leaves the
slot alone.

**Filling the slot opens the `event` panel.** A lane's modules, a clip's waveform or piano roll, a
grid, a take review — each is asked for, and a request the user cannot see is a miss, so every road
into the slot (`onOpenClip`, `sequence edit`, `ui review`, a lane header's double-click, a take
starting to roll) goes through `openEvent`, which also sets `panel` to `event`. The page is left as it
was: the clip opens under the timeline it was clicked on. Toggling the panel off keeps the event, so
the button brings it back; the keys and the footer's mode badges act only on an event that is on
screen (`shownSlot`).

## The command bar

It is the last row of the shell, under the minimap when there is one, full width — always there, not
summoned. It runs the brain's shared commands — the same ones `k7 cmd` runs on the CLI — so the UI adds
no command vocabulary of its own. The catalogue and the argument completers live in
[`../src/palette.ts`](../src/palette.ts); why it is docked rather than opened is in
[`commandBar.md`](commandBar.md).

It takes focus on a **double-tap of Shift**: two lone Shift presses within `DOUBLE_SHIFT_MS` with no other
key between them, `e.repeat` filtering out a held Shift's auto-repeat. The gesture cannot toggle back out,
because the shell's key listener ignores anything typed into an input — Escape is the way out, and has to
be.

## What a command RELOADS — the token, not the counter

Every writing command ends in a reload, and a reload that is one number can only say **"everything is
stale"** — whatever the command actually did. Six consumers key an effect off it: the compiled document,
the graph, the project errors, the file tree, the completion vocabulary, the open file.

Measured on `01.danse.k7`, per command, on a service that is **one thread** — so these queue rather than
overlap:

| route | cost | can a stretch point have moved it? |
|---|---|---|
| `/hints` | **65 ms / 108 KB** | no |
| `/module-libraries` | **70 ms / 100 KB** | no |
| `/project-doc` | 81 ms / 65 KB | yes |
| `/graph` | 34 ms / 50 KB | sometimes |
| `/tree` | 27 ms / 35 KB | no, unless a file appeared |
| `/project-errors` | 18 ms | yes |
| `/library-chains` | 12 ms | no |

Four answers to one question follow from that:

- **`quietCommand`** — the gesture says *I will reload nothing*. A mixer knob, a mute, a warp point. It
  passes `want: []` so no graph is built either, and whoever must move re-reads its own picture. Its
  token is adopted QUIETLY (`noteQuietRevision`): the tick compares against it, so it does not turn a
  knob into a wave of re-reads — errors, plugins, tasks, the desk, the mastering graph — and `get`
  never hands it out, so a component that re-renders for another reason does not pick it up either.
  Only when the reply's `revBefore` is the token this tab already held, though: otherwise something
  else landed in between — another tab, the CLI, another replica — and the write is announced like any tick.
  The two that must still follow a knob take `useQuietWrites` as a second trigger: the open file,
  which may be the one written, and the history, where the write is a row. A knob cannot break the
  compile, so the errors waiting for the next real change is the accepted cost.
- **`bypassModule`** — the gesture changes the GRAPH and nothing else. A module's on/off is the
  canvas's to redraw: it asks `want: ["graph"]`, draws the answer, and bumps no reload. The full
  reload was every route above re-asked over the tunnel — the compiled project recompiled — for one
  node turning grey. A lane's own card is the exception and takes `runCommand`: its bypass IS the
  lane's mute, which the mixer and the timeline draw out of `/project-doc`.
- **`refreshLibraries`** — the pane says *ask me when it can have MOVED, not when anything moved*. The two
  library routes are fetched on mount and by the two acts that write there.
- **`Reload`** — the command says **which files it wrote**, and each consumer decides.

### A graph only when one is on screen

`runCommand` asks for the graph (`want: ["graph"]`) only while a view of it is on screen — the chains
pane, the graph or mix panel, a lane's own row (`graphOnScreen`). A delete on the timeline otherwise
paid a full graph rebuild, 120–160 ms measured against the 15–30 ms the edit itself took, for a
picture nobody was looking at. A HIDDEN chains pane does not refetch on a reload either: it keeps
the key it last drew and asks when it is shown again. The armed lane's MIDI device is re-read off the
graph only when the reload could have moved a chain (`movedTheChains`): a lane's events, a clip, a
sequence or a curve wire nothing.

That last one is what the reload key carries. `POST /command` answers with `changed`: the files it wrote,
project-relative, taken straight out of the undo journal's own diff — `recordChange` brackets every
mutation and compares the two images anyway, so naming them is free. `App` holds `{ key, files }`; `key`
is still a counter, because "the same file twice" has to fire twice and a list cannot say that.

**`files: null` means nobody said, and every predicate reads that as *re-ask*.** That is what lets a
project opened, an undo, a relayed change and a poll that noticed something name no files at all, and
what makes a service too old or too broken to answer degrade to a plain counter.

The predicates are [`../src/reloadScope.ts`](../src/reloadScope.ts), pure functions with a test each,
because what they encode is a claim about the SERVICE that is not visible from here:

- **`movedTheTree`** — did a file appear or disappear? Exactly what `/tree` draws, so this one is total: a
  rewrite never moves it.
- **`movedTheVocabulary`** — could `/hints` differ? Yes for everything except a **rewrite** of a clip, a
  sequence or a curve. Those three are gathered by NAME (`projectHints` keys them off their filenames), so
  a note drawn, a stretch point placed or a curve point moved changes nothing the completion source
  carries. Anchored at the project root on purpose — a module may be called `clips`, and
  `modules/audio/clips/module.k7x` must not read as one.
- **`movedTheChains`** — could the WIRING differ? No when only `tracks/`, `clips/`, `sequences/` or
  `curves/` were written. Only the MIDI-in lanes key on it (`chainsKey`): `/graph` itself is not
  arrangement-free, since a track's card lists its clips' extents and an automation label draws its
  curve, so every view of the graph keeps the raw key.
- **`movedTheSurfaces`** — only a file under `surfaces/` is read for `/surfaces`.
- **`movedTheAudio`** — could there be a new waveform to prewarm? A placement, a clip, or any file that is
  not k7x — an upload, a take, a render. A knob, a cable or a mute decodes nothing.

Each consumer takes a counter of its own, `useScopedKey(reload, predicate)`, which moves only when its
predicate says so — an effect's dependency rather than a test inside it, so a skipped reload costs no render.

A mute or solo goes through the quiet path and then reloads with the files it wrote, not with `null`: it
rewrites `graph.k7x` and nothing the surfaces or the prewarm read.

**A graph a command hands back is tagged with the reload key it answers.** The chains pane takes it only
at that key, and a new one is a trigger of its own, since a bypass returns one with no reload behind it.
Without the tag, a graph handed back while the pane was hidden would be drawn when it was next shown, over
a reload that came after it. A tag that turns out wrong costs a fetch, never a stale picture.

**The limit, stated because it is real:** a clip's `source` also decides whether it is listed as an audio
or a video clip. A command that repointed an *existing* clip from a wav to an mp4 would leave that one
split stale until the next reload that does ask. What is deliberately still unscoped: `/project-doc`, `/graph`,
`/project-errors` and `/video-doc`, which nearly any project write can genuinely change, and the open
file's disk check, whose path is workspace-relative where `files` is project-relative.

## A fault stays in its pane

Every pane is mounted at once and hidden rather than unmounted, and in React an uncaught throw
unmounts the ROOT — so one fault in a pane nobody is looking at would take the whole app with it
mid-session. Each pane and panel therefore sits in a `PaneBoundary` ([`../src/PaneBoundary.tsx`](../src/PaneBoundary.tsx)):
it draws a card saying which pane failed and a Retry, with the raw message folded under Details — it
is for a bug report, not for the person reading the card — writes the fault to the Logs panel, and clears itself
on the next reload, since new data is a new chance. One more wraps the whole tree in `appMain.tsx`,
the last line before a white page. `createRoot`'s `onCaughtError` / `onUncaughtError` put every
fault in the console with its component stack, and a promise nobody caught goes to the Logs panel.

**A missing chunk is a deploy.** The open page names hashed files the server no longer has, so the
first failed dynamic import reloads the page once ([`../src/chunkReload.ts`](../src/chunkReload.ts),
on Vite's `vite:preloadError`), which fetches the new shell. A second failure within a minute is not
a deploy and is left to the boundary to say. The backend answers a missing `/assets/*` with a 404
rather than with `index.html`: served as a script, the page would fail on a MIME type and say
nothing useful.

**A failed read keeps what the view had.** A 4xx is the service's answer about the project — it
does not compile, the file is not there — and replaces the view; a 5xx, a timeout or no answer
says nothing about the project and does not ([`../src/readFailure.ts`](../src/readFailure.ts)). The
surfaces list matters most: it decides which panes are MOUNTED, and a blip read as "none" would unmount
the timeline, the viewport, the desk and the master strip, with their state. The DJ
desk applies the same rule to its cue sheet, and writes no cue until it has read the sheet once —
the write is the whole file.

## Live state does not re-render the tree

The transport and the engine's live state arrive over the WebSocket at roughly 20 Hz. Held as React state
on `App`, each frame would re-render the whole editor even when nothing visible changed. They live in an
external store (`engineStore.ts`, and `pluginParamsStore.ts` for plugin parameters) instead, and
components subscribe to just the slice they draw. Pulling a live value into `App` state costs a full
render per frame.

**"The slice they draw" means a LEAF draws it.** Moving the subscription off `App` is only half the rule,
and the half that is easy to satisfy by accident: a subscription held at the top of any component
re-renders everything that component draws. `s.playhead` read in the body of `Minimap`, `PianoRoll` or
`WaveformView` reconciles a row per clip, 128 key rows, and a whole canvas twenty times a second — **off
screen too**, because every pane here is mounted exactly once and merely `hidden`. Each has a playhead
leaf instead, the shape `TimelineTab` uses ([`timeline.md`](timeline.md)).

**The status line is live state too.** A timeline drag re-states it on every snapped cell, so it is
not `App` state: it is the small store in `src/statusLine.ts`, written through `setStatus` and read by
one leaf, `components/StatusText.tsx`. A menu hint borrows the same line through the same store. What
the panes REPORT to `App` — the caret, the timeline's view, what the editor has open — goes through a
setter that keeps the current object when the new one says the same thing (`src/shellEquality.ts`), and
the editor reports an open sequence by PATH, never its text, so a keystroke is not a new shell state.

## The catalogue is the app's; the ARRANGEMENT is the person's

`ui settings commands` opens a page where a command can be renamed, given an icon, told which right-clicks
may offer it, and pulled up or down the order menus list them in. What the commands ARE stays the app's — this is a layer over the catalogue,
kept in `commandPrefs.ts` and applied by `orderCommands` / `labelOf`.

- **Keyed by the canonical LINE** (`event trim`, `ui help`), not by the sid. The sid is the more stable id
  but only the backend's commands have one — the shell's own `ui …` lines do not — and a page that could
  arrange half the catalogue would order a menu it does not draw.
- **The entity a command acts on is the first word of its line**, which is what the filter offers — so a
  command added to the app is filterable the day it exists. A PLURAL head folds into its singular
  (`entityGroup`): `events move` lists among the `event` ones, marked with a layers glyph, because acting
  on several at once is the same subject taken several at a time and a group holding one command hides it
  from the only filter anyone would look under. Derived from the catalogue, not tabulated: a plural whose
  singular nobody wrote keeps its own group rather than inventing a subject out of a suffix.
- **A partial order.** Commands someone has placed come first, by their number; everything else follows in
  catalogue order. A total order would mean every command added later arriving at a position a saved list
  had already decided — and this is what lets you pull three commands to the top without numbering the
  other two hundred.
- **Applied once, over the palette's built list.** The palette is the one surface that lists every command,
  so ordering anywhere else would leave the page describing an order nothing obeyed. The label replaces
  the sentence the palette MATCHES on, deliberately: someone who renamed a command should find it by the
  name they gave it.

It lives in the ACCOUNT's preferences, not the rig's — what you call a command follows you to another
browser, where which audio interface to open belongs to the machine. `K7Prefs` widens `EnginePrefs`,
which is the extension point that type documents, and `patchPrefs` merges, so writing this cannot wipe the
engine id beside it.

**And the backend's zod schema is what actually decides**, because a field it does not name costs this
feature its persistence. A zod object strips what it does not declare, so a layer
`backend/src/server.ts`'s `prefsSchema` says nothing about is accepted, answered `{ok:true}` and dropped:
renaming works, saving says it worked, a reload shows the catalogue's own names again, and the disk holds
`{"engineId": "…"}` alone. Widening `K7Prefs` is half of adding a preference. The router refuses a write
it would have to shorten (`droppedKeys`, `packages/user-prefs/docs/store.md`), so an omission is a 400
naming the field rather than a feature that quietly does not last the session.

### A name is a SENTENCE, so there is one field per language

The row carries one text field per locale the app is built with — `en` and `fr` today, read off
Paraglide's `locales`, so a third language grows a third field the day it is added rather than the day
somebody remembers this screen. One field would mean one string for every language: renaming a command
while reading French would rename what English shows too, with nothing on screen saying so. The split
follows the line the catalogue already draws — `CommandInfo.readable` is `{en, fr}` while the command's
NAME stays the CLI's in every language, because a name is an identifier and a sentence is an explanation.

- **Each placeholder is the catalogue's own sentence IN THAT language**, which is why `PaletteCommand`
  carries `readableBy` — the whole table — beside the `readable` that `buildPaletteCommands` resolved. A
  placeholder has to be what that field would leave standing, or an empty field reads as "nameless"
  instead of "unchanged".
- **No borrowing between languages.** A command named only in French shows the catalogue's English
  sentence in English. Falling back to the other language would put French words in an English menu,
  which is the thing this split exists to stop.
- **A bare string in the document stands for all locales** and is not rewritten on load. It is expanded
  across them on the first per-language edit — `setCommandLabel` takes `locales` for exactly that, since
  without it renaming in French would drop the name English had been showing, invisibly until you
  switched.
- **`labelIn` answers as AUTHORED, and the trim lives at the two places a name is drawn** (`labelOf`, the
  context menu's row). Trimming in the reader breaks the space bar: the field is a controlled input, so a
  trailing space vanishes as it is typed and a name of more than one word cannot be entered at all.

### …and this page has a Save button, which nothing else in the shell does

The app's rule is autosave, and this page is the second exception after the module builder. The reason is
not taste: **without a button it is unusable to type in**. Three costs, all paid per character — a `PATCH`
of the whole preferences document; a `setState` at the ROOT of the app, since `commandPrefs` lives in
`App` where the menus, the key listener and the palette all read it, so the whole shell re-renders behind
the overlay; and `keyForCommand(canonical, prefs)` once per ROW, each call building the whole effective
map.

So the page holds a **draft** and writes once, on the button: the second cost goes because the draft
lives in the leaf, the third because the effective map is built once per edit and inverted into
`canonical → label`. The rows are `memo`ised on top of that, which works only because `setCommandPref`
copies the document shallowly — every untouched entry keeps its identity, so one row comes back and not
two hundred.

Two things follow from the button: **a shortcut assigned here does not run until it is saved** — the app
reads the SAVED document, the header says `non enregistré` while the two differ, and `annuler` throws the
draft away — and **leaving asks**, since `← retour` confirms while the draft is dirty. That is the only
thing autosave never had to answer for.

### Shortcuts are the fourth field of that layer

Each row carries a key cell: click it, press a key, and the pref stores the raw `keyToken` (`"g"`,
`"shift+space"`) under `key:`. Escape renounces the capture, Backspace removes the shortcut (stored as
`KEY_NONE` when the command has a default — deleting the pref would resurrect it), and choosing the default
again drops the field.

The rules live in `effectiveKeys` (keys.ts), pure and tested: an assignment MOVES a shortcut rather than
doubling it, a taken token is stolen outright and visibly, and the CONDITIONAL bindings — the esc ladder,
`f`'s interpolation, `m`'s three meanings — are not remappable, being rules rather than shortcuts;
`resolveToken` falls through to them only for tokens the effective map does not name. App's listener, the
help legend (`shortcutsByCommand`) and the pane buttons' tooltips all read the same map, so a moved key is
advertised wherever keys are shown. The focused-control rule follows the COMMANDS rather than the tokens:
what comes back from a focused button is whatever runs a `transport …` command, wherever the person has
put it.

### …and the fifth is WHERE the right-click offers it

A multi-select per row (`components/CommandMenuPicker.tsx`), listing the entities of `MENU_ENTITIES`: a
track, an event, a bloc, a réglage, a repère… Several at once, because one verb genuinely belongs on two
menus — `node param` is offered on a block and on the knob itself.

It is **a layer over a catalogue that already has an answer**: `commands.yaml`'s own `menu:` says where a
command belongs, and a command that says nothing is offered wherever its arguments fit
([contextMenu.md](contextMenu.md)). So the cell shows the catalogue's list until somebody picks another,
and `setMenuEntities` writes the shortest spelling that means the pick — nothing at all when it matches
the catalogue, so a catalogue corrected tomorrow still moves the commands nobody arranged by hand.

It replaced a checkbox, which could only take a command off every menu at once. That was the whole
vocabulary available before commands said where they belonged, and it is still the `false` this field
writes when nothing is ticked.

### Context menus draw those icons

`MenuItem` carries a `verb` — the command WITHOUT the entity and untranslated (`node bypass`, not `bypasser
gtr`) — which is exactly what the prefs are keyed by. Kept as a field rather than re-derived from
`command`, so a menu never has to un-localize a line to find out which command it is; and two entries for
one verb on two different tracks are one command wearing one icon. `contextMenu.ts` stays a pure function
of the catalogue and the thing clicked: the person's layer is applied by the RENDERER, because an
arrangement is a matter of who is looking and not of what an entry means. The icon gutter is held whether
or not there is an icon — a half-decorated menu with a ragged left edge reads as a rendering fault.

The icons are **lucide**, already this app's icon set. What this page adds is resolving one BY NAME, which
cannot be tree-shaken: everywhere else imports the icons it draws, while "whatever the person chose" is not
known at build time. `lucideIcons.ts` loads the set with `import("@frediverse/ui/icons/all")` and caches it.
A menu opened before that lands draws its labels and no icons — the honest degradation, since the label is
what an entry MEANS. A menu none of whose rows carries a picked icon does not ask for the set at all: the
first right-click of someone who never chose one costs nothing.

**The set is reached through its own module, and that is what makes the split real.** `icons/all` is lucide's
per-icon index, a module the static imports never touch, so the bundle puts all ~1850 components in a chunk
of their own, loaded the first time a name has to be resolved, while the static `@frediverse/ui/icons`
imports tree-shake down to the icons the code draws. Read through the `@frediverse/ui/icons` namespace
instead, the same lookup kept every icon in the first screen's chunk — about 190 KB gzipped to draw thirty.
Measured on a build: the icon chunk is ~150 KB gzipped, and the home page carries none of it.

## The entry is split by ADDRESS, and the home page is what that is for

`main.tsx` already branched before importing anything heavy, so a 36-pixel tab strip would not load the
whole of k7. `appMain.tsx` did not, and the home page paid for it: it statically imported `App`, so
opening the app at `/` parsed and executed the entire editor — CodeMirror, dagre, `@studio/ui-eyes`,
`@studio/ui-turntables` — before drawing a single workspace row. The symptom is a window that opens and
stays blank for seconds, which reads as the app hanging rather than as a bundle being parsed.

The screens that are not the home page are therefore `lazy()`: `App`, `EngineGate`, `ExternalIndex`,
`SharedGate`, the public rehearsal page, and the home's own other pages — the médiathèque, the libraries,
the tasks and both settings pages. One address is ever taken, so one of them is ever fetched. The home's
pages suspend INSIDE the take's holder, so a page arriving never hides a take in progress. `ProjectGate` loads
`App` the same way and starts its download as it mounts, so the engine picker and the project gate draw while
the editor arrives; an `import App` there would make every gate wait for the whole editor.

Inside the editor, what opens on demand loads on demand: the module and assembly builders, the video export
(its muxer is the largest dependency there is), the icon set (above), and the drawers of the DJ desk and of
the viewport, which only a project declaring that surface fetches (`packages/k7-plugins/docs/plugins.md`).
The médiathèque fetches CodeMirror only when a song or a playlist is opened as text
(`packages/ui-library/docs/audit.md`). Measured on a production build, in gzip, each page with every chunk it
imports statically:

| what | loads |
|---|---|
| **home page, sign-in, public rehearsal page** | **~235 KB** |
| the médiathèque | ~320 KB |
| opening a project | ~900 KB in all |
| on demand | CodeMirror ~220 KB (shared with the editor), icons ~150 KB, video export ~135 KB, builders ~45 KB, the desk ~25 KB |

What stays eager is what the home page actually draws: the gates, `Home`, and the shared vendor chunks.
`Booting` is the one thing on screen while a split-out screen arrives — the window is already painted in
the browser's own by then, so it only has to say "coming".

## The `ui` namespace

The shell's own commands are **one registry**, `src/ui/commands/`: each entry is a palette row — its name,
its sentence in each language, its arguments — and the handler that runs it, grouped by what they act on.
The palette's catalogue (`LOCAL_COMMANDS`, `LOCAL_READABLE`, `LOCAL_ARGS`) and the `ui` gate's two lists
(`localCommands.ts`) are derived from it, and `App`'s `runLocalCommand` is a lookup in it. A command
described in three places drifts in three ways — listed and not dispatched, dispatched and not listed,
classified on the wrong side of the gate — and one table makes each of those unwritable; the test that
remains (`localCommands.test.ts`) holds the table against itself. A handler reaches App only through an
explicit context (`src/ui/commands/context.ts`), rebuilt every render and read through a ref, so the
dispatcher never changes identity and no handler sees a stale value.

The view commands live under a `ui` prefix, stripped in one place rather than by renaming every entry.
The pairing is **enforced both
ways**: a `ui` command typed bare is refused, and so is a non-`ui` command typed with the prefix. `ui`
promises "touches nothing of the project, does not move the transport", and a `ui locate` that quietly
moved the playhead would be a worse lie than having no namespace at all.

**A server command is never taken for a bare `ui` one.** Stripped of its prefix, a `ui` head can share
its first word with a server verb — `ui curve` and `curve set`, `curve point add`. So the refusal of a
bare `ui` line asks the server's catalogue first (`uiVerdict`): an unprefixed line the catalogue names
goes to the server, past every `ui` handler, which would otherwise take it by that first word. A test
walks every command of `commands.yaml` and holds that none is refused bare, so a new `ui` head cannot
silently swallow a verb again.

It is not "writes no file", and the difference is deliberate: a pin, a language and the vim flag are
remembered — in `localStorage` and in the account's preferences — and remembering how you like to work is
not editing a song. What draws the line is the PROJECT.

**A better subject beats the rule.** `selection copy` and `selection paste` sit beside the catalogue's
`selection consolidate`: the head names what all three act on, the rectangle you drew. The namespace rule
alone would make the copy `ui` and the paste bare, since it writes through `events add`, which puts one
gesture's two halves on either side of the line. The rule is what a command falls back on when nothing
better names it ([clipEditors.md](clipEditors.md)). `ui copy path` is not one of them — that one puts a
*path* on the system clipboard and is a different act.

A line the shell recognises but cannot act on is reported as *handled* rather than passed down: the backend
has no such command either, and "unknown command" would say less.

The tree's verbs are an **`fs` group** — `fs file new`, `fs folder new`, `fs file rename` — sharing a head
with nothing, which is what keeps `isUiLine` two lists and no special case: `ui file <path>` opens a file,
and a bare `file <verb>` doing something *to* one would collide with it on the head alone. They are also
the one family that acts on the workspace's files rather than on the song.

`ui external <surface>` reads an address and puts it on the clipboard, touching neither the project nor the
transport nor even this shell's view. It **does not navigate** — the whole point of the address is to be
carried to a second device, and following it here would replace the editor you are standing at with the
tablet's screen. The line is echoed in the status bar as well as copied, so a browser that refuses the
clipboard still leaves it readable. The share panel draws no such address as a link: its
*Sur un autre appareil* section is **QR codes**, the whole project first so a tablet can edit it and not
only drive a surface, then one per surface ([external.md](external.md)). Scanning is the gesture the
section exists for, and an address written out is what it replaces; the cost is that a device which
cannot scan has no fallback there, and `ui external <surface>` is what remains for that case.

### The one thing a QR code here gets wrong on its own

Every address in this app is built on `window.location.origin`, and in the desktop window that origin is
**loopback**. Encoded straight into a code, it scans perfectly and the phone opens *itself* — a silent
failure that reads as a broken camera. `src/remoteUrl.ts` is the conversion, and it is a tested pure
function for that reason: a loopback origin is rebased onto a LAN address (`lanUrls`), a real
origin is already reachable and left alone, and a machine
with no network address gets **no code** and a tile that says so.

## Every action on screen is a command

There is no button, menu entry or toggle in this shell that the command bar cannot reach. That is a rule,
not a coincidence, and it is what makes the palette a real answer to "what do you want done" rather than a
shortcut list for the half of the app somebody remembered to wire. It also means a gesture is describable:
a bug report, a doc page and a key binding can all name the same thing.

### …and the log holds every one of them

The Logs panel is a **transcript of what ran**, not of what was typed. Every command reaches it as a `cmd`
line, whichever way it was triggered — the bar, a key, a button, a right-click, a cable dropped on a knob
— because `runCommand`, `quietCommand` and `bypassModule` are the only doors and all log before they dispatch. The
buffer is the shell's and fills whether the panel is open or not; only the engine machine's merged process log is
polled on demand (`useLogs`).

Two cases are worth saying out loud, because each is a command nobody typed:

- **The picker's first half.** Choosing a module from the canvas menu runs a `module new` ahead of the
  `node new` you were prompted for. Unrecorded, it would leave a transcript showing a node appearing with
  no module ever created.
- **A command aimed elsewhere.** The chains builder's verbs run against a library chain, not the open song,
  so its lines carry the chain's ref: `› [process/normalize] node new x`. Without it the transcript would
  claim an edit to the project that never happened.

What is deliberately NOT in there: anything that goes through a ROUTE rather than a verb — a file write, a
module save, a probe. Those are not commands, and a log that mixed them would stop answering the question
it exists for.

Keeping it costs one habit — **the button runs the command, it does not call the handler**:

| what draws it | the command | where the behaviour lives |
|---|---|---|
| the footer's mix / notes buttons | `ui mixer`, `ui notes` | `toggleMixer` (→ `togglePanel`) / `toggleDocs` in `App` |
| the minimap's stack button, left of zoom fit | `ui stack` | `toggleStack` in `App` |
| the footer's panel row | `ui panel <event\|graph\|mix\|logs>` | `togglePanel` |
| the log panel's *clear* | `ui logs clear` | `useLogs` |
| a pane button in the header (the desk, the timeline…) | `ui <pane>` | `fullscreen` / `setFull` in `App`, like any pane |
| the timeline header's clock / height / automation | `ui ruler`, `ui lanes`, `ui automation` | `TimelineHandle` |
| the per-track view's curve button, in its left column (`ModeStrip`, the timeline's) | `ui curves` — shows or hides its curve cards | `App` |
| the per-track view's *audio in* / *midi in*, above it — greyed while something already feeds the lane (`laneHasInput`) | `track input <track> audio\|midi` | `App` |
| the timeline corner's ＋ piste | `track new`, and `picture lane new` on a project with a viewport | `App` — the menu appears only when there are two kinds of lane, see [timeline.md](timeline.md) |
| a timeline header dragged to another row | `track order`, `picture lane order` | `App` — the drag names the lane whose place is taken, see [timeline.md](timeline.md) |
| a layer moved or resized in the VIEWPORT | `picture rect` | `App` — the selection box is `components/ViewportOverlay.tsx`, see [picture.md](picture.md) |
| a picture lane's **A** button, and `r` on its row | `ui picture arm <lane>` | `App` — browser-side like `ui midi learn`, since the camera is the browser's ([picture.md](picture.md)) |
| the cog | `ui settings` — toggles its panel | `App` |
| the header's Playlists button, on a SET | `ui playlists` — toggles its panel | `App` |
| the footer's Share button | `ui share` — toggles its panel | `App` |
| the settings panel's tabs | `ui settings editor\|io\|account` | `App` |
| the settings panel's *Commandes* | `ui settings commands` — the one that is still a page | `App` |
| the account tab's rows | `ui engine`, `ui workspace quit`, `ui logout`, `ui language` | `App` |
| the share panel's rows | `project export`, `project share k7\|link` | `@studio/commands` and `hooks/useShare.ts` |
| `ui external <surface>` | the palette's way to the same address, the panel now drawing codes rather than links | `App` |
| the editor tab's one toggle | `ui vim` | `toggleVim` in `App` |
| Ctrl+Z / Ctrl+Y | `project undo`, `project redo` | `@studio/project-shell/undo` |
| the file tree's right-click menu | `fs file new`, `fs folder new`, `fs file rename`, `fs file move`, `fs file delete`, `fs file upload`, `ui pin`, `ui copy path` | `EditorHandle`, and `FileTreeHandle` under it |
| the clip panel's *stop*, while a take rolls | `transport stop` | the engine |
| the sequencer's and the roll's *×2* | `sequence double <séquence>` | `@studio/commands`, over `doubleSequence` — see [clipEditors.md](clipEditors.md) |
| a `.dawproject` / `.als` clicked in the tree | `project import <path>` | `useProjectImport` |
| a file dropped on a timeline lane | `event add`, `picture add` — the PLACING half; the upload and the `clips/<id>.k7x` go through routes | `hooks/useTimelineDrop.ts`, see [timeline.md](timeline.md) |
| the master meter's *fix* | `project master fix` | `fixClipping` in `App`, over `MasterMeterHandle` |
| the channel strip's mono/stereo pairing | `system channel type <ch> <mono\|stereo>` | `@studio/commands` — the rig's file AND the engine |
| the Playlists panel's *＋* | `playlist new <name>` | `@studio/commands`, in `_playlists/` |
| the Playlists panel's *Séparer les stems* | `playlist stems <playlist>` — the same work, song by song | the media library's `POST /api/stems`, see [playlists.md](playlists.md) |
| the settings page's *Separation chains* | `system stems <chaîne>` — the page itself writes through `PUT /account/cold-chains/stems`, since it has no project to run a command in | `@studio/commands` — `<state>/preferences.yaml`, read by every screen that could start one |

Two of those handles exist only for this: `EditorHandle` carries the tree's own verbs, and `FileTreeHandle`
exposes the two things nothing else holds — the pins, which are that component's `localStorage`, and the OS
file pickers, which are its two hidden inputs.

Three of those rows have TWO answers. `ui select`, `transport locate` and `transport loop` reach whichever
grid is on screen: the clip pane's caret while it is open ([clipEditors.md](clipEditors.md)), the
timeline's otherwise — except that `transport loop` goes to the clip pane only when IT holds the
selection, as Shift+L's conditions already say: the ruler's "Loop selection" is about the timeline's
range, and the clip pane open below it would otherwise take the line and find nothing to loop. The commands are one thing, and which surface answers is a question about what you
are looking at, not about the verb. `ui zoom` stays the timeline's alone: it is the only one that keeps a
zoom stack. `selection copy` has two answers as well and takes them in ORDER — the clip pane, then the
timeline, first answer winning — because it is the only one that asks the pane a question instead of acting
on it, so a pane in front with nothing selected must not end the question.

Three things are deliberately NOT commands, and the line is the same one every time — a command names
something you could *ask for*, and none of these is:

- **Disclosure.** Opening a dropdown, expanding a tree folder, showing the sidebar. Asking for it and doing
  it are the same act; there is nothing left for a command to add.
- **A dialog's own buttons.** Confirm, cancel, "continue editing". They answer a question the shell asked,
  so they cannot be reached from a bar that is not the question.
- **Continuous gestures.** Dragging a clip, growing a selection, panning the graph, the waveform's onset
  sensitivity, the roll's velocity drag. The timeline's `event move` is the command and the roll's is
  `sequence note velocity`; the nudging is the view's, as `keys.ts` says.
- **Typing into the open buffer.** The video readers' *Set From* / *Set To* look like actions and are not:
  they write a number into the file the editor is showing, which autosave then saves like any keystroke.

The two transport buttons in the header are the clearest place a button does NOT dispatch its command, and
the reason is latency: `transport toggle` is a CLI verb, so it travels to the file service and back, while
the button already holds an open socket to the engine.

Two of the Playlists panel's gestures take a road of their own, both in [playlists.md](playlists.md):
adding a song from the SEARCH writes into the OPEN BUFFER rather than the file, because a command writing
the file underneath a modified buffer would race the autosave; and *Séparer les stems* drives the media library's
`POST /api/stems` once per line rather than dispatching `playlist stems`, because that verb reports its lines
when it is finished and finishing takes an hour. What must be reachable from the bar is the ACT, and it is
— the verb does the same work headless. What the button adds is a bar you can watch, which a command's
reply has no shape for.

## Two-step flows

Some gestures need a second command the user did not type, and both are held as pending state in `App`:

- **The graph's `+`.** Clicking an arrow's `+` asks *which* module before writing anything. The picker is
  fed from hints, so it offers what the project already has plus the whole plugin catalogue, and picking
  **pre-writes** a command rather than running one. The command only *creates* the module; `runCommand`
  splices it into the chain once the create comes back clean (`moduleInsert.ts`), so a rejected name never
  splices a module that was never written. Any other command in between means the user moved on, and the
  pending insert is dropped. With no hints there is nothing to show, so it falls back to pre-writing the
  command with the two ends and letting the bar's completion take over.

  Either way the chain names the *node* by its FILENAME alone, so that name is the one thing only the user
  can supply — which is why both paths stop at the bar. From a namespace it takes one command: a chain
  cannot name `@engine/…` (`use` takes a local module), so it creates the local module that inherits it
  *and* the node, with the module name pre-filled and the node name left to you.

- **`rec <track>`** (the `r` key). The lane's A button, verbatim: `onTrackToggle(id, "arm")`, which arms an
  instrument track for MIDI capture in the browser and sends `transport arm` for any other. One key, one
  button, one function, so the two cannot route a lane differently.

## Mobile

A phone shows one page, as the desktop does, and the menu drives `full` where the desktop's header row
does. The home page is the same one, the timeline being the one pane that says what the song *is*: the
editor needs a keyboard and the graph needs room.

Every row of chrome is a row the panes do not get. On a phone in landscape the whole window is about 400px
tall, so the header and footer are trimmed to what a touch target needs and no more. The one control that
could not simply move is the command bar's opener: a phone has no double-Shift, so the menu carries it.

Being a phone is a question of SIZE, not of pointer (`useIsMobile.ts`): an iPad gets the desktop
layout. What a touch screen of any size does need is the right-click, and a finger held still is one
(`longPress.ts`, [contextMenu.md](contextMenu.md)).

## Keyboard focus is always drawn

`index.css` gives every button, link, `role="button"`/`option` and `tabindex` element one focus ring
under `:focus-visible`, at zero specificity (`:where`) so a component's own ring still wins. A field
that removes the outline (`outline-none`) puts a cue of its own in its place — a border that turns the
primary colour, or a ring under `focus-visible:` — never nothing. The chains graph injects its own
sheet, so it carries the same rule (`packages/ui-chains-react/src/chainsCss.ts`).

A selection ROW — a node card, a corner button drawn as a `span` — is focusable and answers Enter as
it answers a click. Not Space: Space is the transport wherever focus is ("Space is the transport, wherever the last click
landed", above), and a row that took
it would stop the music for whoever had just clicked a card. The command bar's list is a listbox the
field drives (`aria-activedescendant`), so its rows are never in the tab order. A drag or scrub
SURFACE (the ruler, a waveform, the roll's grid, a lane's body, a clip) is not focusable either: its
keyboard is the shell's own keys, the timeline's caret among them, which reach the same commands.

## The service worker, and the scope it cannot avoid

**The worker is the SHARED preset's** — every frediverse app gets one, from `@frediverse/vite-config`, whose
`docs/pwa.md` holds the rationale for `registerType`, `clientsClaim`, `devOptions` and why no manifest is
generated. `main.tsx` registers it beside the manifest swap, because both answer the same question — what
app this document IS.

**What it buys is a second opening, not offline.** The shell and its assets are precached, so k7 starts
from disk instead of re-fetching a large bundle over the LAN. It buys nothing offline, and that is not an
omission: the editor reads its project from the file service and its sound from the engine, both on the
musician's machine, so a cached shell with no machine behind it can only draw the "aucune machine" it
already draws.

**The scope is `/`, the whole origin, and it cannot be narrower — this is the part k7 owns alone.** A
worker's scope is a prefix and k7's own routes ARE the root, `/@local/…`. So this worker also
controls `/api`, `/auth` and `/rtc`. The media library and the rehearsal pages are k7's own routes,
so the worker serving them is right. The only thing keeping k7's honest is the `pwaDenylist` it
passes to `defineAppConfig` (`OTHER_APPS` in `vite.config.ts`): without it, a navigation to one of
those paths is answered with k7's `index.html`, and the editor's router refuses an address it
cannot parse. **A path served on this origin by anything but k7's shell belongs in that list.**

**Mixed content is what makes an install fail.** A page over HTTPS that loads one resource in the clear is
flagged "includes resources that are not secure", and that alone makes it uninstallable — the certificate
can be perfect and the manifest complete. The engine probe is where it comes from here, when it lists LAN
addresses as `ws://` candidates and lets the browser refuse them. See `@studio/engine-browser`'s
`docs/access.md`.

## A new build replaces the old one

Every deploy reaches every open tab, by the shared preset's `register` entry (`docs/pwa.md` in
`@frediverse/vite-config`): an editor tab stays open for days, and one running a bundle from before
a protocol change talks to a server that no longer answers it — `http://127.0.0.1:undefined` was
one. What makes the hidden reload affordable here is that the editor autosaves.

## The PWA manifest uses RELATIVE urls, deliberately

`public/manifest.webmanifest` has `"start_url": "."` and unprefixed icon `src`s, and neither is an
oversight. A manifest's URLs resolve against **the manifest's own address**, and Vite does not rewrite the
contents of a public file the way it rebases `index.html` — so anything written `/…` there is
origin-absolute and escapes the app.

An origin-absolute `"start_url": "/"` therefore installs whichever app owns the root, which is k7 today
and need not stay so. `.` is right under any mount; `/` is right under exactly one. A manifest that has to
be revisited when the edge's path table moves is a manifest written wrong.

## Where the rest of it went

| piece | file |
|---|---|
| the pane/view/panel tables, transport clock | `src/shellMeta.tsx` |
| the palette catalogue and argument completion | `src/palette.ts` |
| the shell's own commands — row and handler, one entry each | `src/ui/commands/` |
| every popin, dialog and menu drawn over the panes | `src/shell/ShellOverlays.tsx` |
| the bar under the panes, and the transport centred over the header | `src/shell/ShellFooter.tsx`, `src/shell/ShellTransport.tsx` |
| what the graph's gestures run — the module picker, the asset browser, a tap's edit | `src/shell/useGraphActions.ts` |
| self-contained slices of state | `src/hooks/` — engine link, project doc, track controls, polls, logs, MIDI recording, dialogs |

## The one seam is the bottom panel's

A page takes the whole width and height, so there is no seam between panes to drag. The one splitter
is the bottom panel's (`event`/`graph`/`logs`): written in place, it resizes the panel that FOLLOWS it.

**The bottom panel animates its HEIGHT** (`components/BottomPanel.tsx`), for the right column's reason:
it pushes the page up rather than covering it. Two differences follow from what it holds. Its content
is pinned at the panel's final height while it travels, since a graph or a roll inside re-fits itself
on every resize and would do so on every frame. And the transition exists only during the travel:
the divider drag writes the height per pointermove, and a transition there would make it lag the
pointer. `motion-reduce` skips the travel.
