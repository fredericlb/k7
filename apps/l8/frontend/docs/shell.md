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
`@studio/project-shell`'s — m9 mounts the same one — and `components/ProjectGate.tsx` only
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

## The layout (`App.tsx`)

`App` is the l8 web editor itself: the global view — **the timeline over the chains graph,
full width** — with the transport controls and the pane toggles in the header. It is the
wiring and the layout; almost nothing else.

The editor is not in it. It had the left half, which meant every song opened with half the
screen showing a YAML file you had not asked for, while the two views of the song that are
*about the song* — where things happen in time, and how the signal flows — shared the other
half. So the default is the two that answer "what is this song", and the editor is summoned:
`ui editor` gives it the screen, and a command that sends it to a file opens it as a popin
(below). It stays mounted throughout, so summoning it costs nothing.

See also [shellRouting.md](shellRouting.md) for how the screen state maps to the URL.

### The Mixer is a view of the graph, not a panel

It used to be one of the bottom panels; it is not any more. A rank of channel strips **is**
the graph, seen a particular way, so it is drawn where the graph is — as a `graphSlot`, beside
a clicked clip's content and a sequence grid, taking the chains pane's place while it is up.
Its button still sits with the panel buttons, so the hand that knew where the Mixer was finds
it, but it toggles that slot rather than a panel.

That move is what makes it readable. The bottom panel was a resizable band a couple of hundred
pixels tall; the graph's pane is half the window, and `fitAxis="height"` fills it — so a fader
gets the vertical throw it wants and the row runs off to the right, which pans. Fitting both
axes instead would shrink every strip as the song gains tracks, and a mixer you cannot read is
worse than one you have to scroll.

`MixerTab` has no controls of its own. It is the row of MIXER MODULES the song actually
has — the module each track ends on (`trackMixer`, by plugin type) — drawn as the very
cards the chains view draws, side by side, in track order. `moduleRow` (in `@studio/ui-chains`)
gives them their even spacing, with no dagre and no cables: there is nothing to route between
channels, and the ORDER is the song's, which is not a thing a layout engine should choose.

It used to hand-roll a strip per track: a VU, a fader, a pan slider, M and S. That was a
second implementation of a channel strip, and it drifted from the one the module's own
`ui.yaml` declares — a module could grow a knob and the panel would never show it. Now
whatever the mixer module's panel says IS the mixer, and the two cannot disagree because
they are the same component.

Three consequences, all of them the design rather than gaps:

- **A track with no mixer module has no strip.** It is not "at unity" — it is a track with
  nowhere to put a level, which is what the panel should say rather than draw a dead fader.
  A song where no track ends on a mixer shows a line saying so.
- **Mute and solo are not here.** They were never the strip's — they are the track's, and
  they live on the timeline (`m`/`s`) and on the graph's track nodes.
- **Two tracks sharing a strip draw one card.** In practice the compiler makes such a strip
  its own bus track, so it arrives once anyway; `mixerModules` de-duplicates regardless,
  because two cards for one value would be two controls fighting.

Two sources, because neither answers alone: the compiled project says *which* modules are
strips and in what order (the graph doc does not carry a plugin type), and the graph says
what each one looks like. `moduleRow` (in `@studio/ui-chains`) then places them — no dagre,
since there is nothing to route and the order is the song's, not a layout engine's.

It also drops each card's **sockets**. The row has no edges by construction, so every jack on it
would plug into nothing — furniture, and on a rank of strips, furniture *between* them. The
routing that makes a socket mean something is the chains view's job; go there to see what feeds a
strip.

#### It fills the HEIGHT, and the row pans

`fitAxis="height"`, not the default fit-both. This is not a preference: fitting both axes
divides the panel between however many strips the song has, and the camera scale falls with
every track added. Below `WIDGET_MIN_SCALE` (0.6) the renderer drops the widget grid
altogether — so a busy song's mixer would show a rank of bare name cards, which is the one
thing this panel must not do. Measured on a 1200×280 panel with a 3×6 strip grid:

| strips | fit-both | fit-height |
|---|---|---|
| 4 | k 0.85, card 152×225 | k 0.85, card 152×225 |
| 8 | k 0.66, card 119×175 | k 0.85, card 152×225 |
| 12 | **k 0.44 — widgets dropped** | k 0.85, card 152×225 |

Filling the height instead keeps every strip the same readable size whatever the track
count, and lets the row run off the right, where it pans. A mixer you have to scroll beats
one you cannot read.

The cards are drawn at **1.5× the width their grid asks for** (`STRIP_WIDTH_SCALE`). That is
elbow room, not bigger controls: the grid inside a card is a fixed cell size (`widgetRect`),
so the extra width is space beside the controls, and the height is deliberately left alone —
scaling it too would only add dead space under them.

### Recording is a BAND, not a cover

`RecordingBand` is up whenever a take is actually rolling — record enabled **and** the
transport playing. It sits in the column between the panes and the status bar, 200px of
canvas plus its own header, and the panes lose exactly that much.

It used to be `absolute inset-0`, a fullscreen surface with the waveform stretched to
whatever was left. That answered the wrong question. A rolling take is the moment you most
want the arrangement in front of you — where the playhead is, which bar is coming, what the
clip you are punching into looks like — and the one thing that surface showed instead was a
level envelope, at whatever height the window happened to have. The band gives that envelope
a size someone chose and gives the rest back.

### …and when it stops, the take takes its place

`TakeReview` occupies the same slot at the same height, so stopping does not resize the shell:
the waveform of what was just recorded, under the project's bars and beats, with the onsets over
it. Three things are done from there — the threshold that finds the onsets, the onsets themselves,
and normalising the file — and all three are the same three you could type into the bar.

**Every edit is a command.** The screen holds no state the file does not: it runs `clip onset
add|remove|move` or `clip normalize`, re-reads `/waveform`, and draws the answer. That is what
makes each one a single Ctrl+Z (the web host journals commands), and it is why the corrections
survive the sensitivity slider — the resolving happens in the file service, over what the clip
stores, not in this component's memory. See `packages/song/src/onsets.ts`.

**The ruler is free.** `WebWaveformGrid` and `@studio/ui-waveform`'s `WaveformGrid` are the same
three fields, so `gridLines={wf.grid}` is the whole of it — the endpoint already computed the
bar/beat lines for the clip editor.

**Which clip it is comes from the file service, not the engine.** The engine broadcasts a finished
take as a FILE and a track; the id is chosen by whatever writes the clip, which is
`onRecorded` in `engineLink.ts`. So it rides the `/workspace` poll as `lastTake`, and the server
never clears it — "the last take" stays true until there is another. Whether it has been *looked
at* is this tab's business, which is why dismissing is local state.

**A click on the canvas adds an onset**, a click on a mark takes it away. That is a deliberate
overload of `onSeek`, which normally means "you pointed at this second": there is nothing to seek
on a take that is not playing, and this screen exists to place those marks. What it does not do is
DRAG one — `@studio/ui-waveform` draws markers but does not move them, and teaching it to would be
a change to a component k7 also draws. Moving an onset is a remove and an add, which is what the
model says it is anyway; `clip onset move` does it in one line from the bar.

Two consequences fall out of the shell staying live behind it:

- the minimap the band used to carry as a child is gone. The shell's own is right below it
  now that the band is in the column, and two of them was one too many. On a phone that
  means no minimap while recording, since the shell's is desktop-only — a phone that has
  just given 200px to a canvas has none to spare for a second view of the same thing;
- **Escape** still stops the take, but no longer when it is answering a field. It is a
  capture-phase listener, so without that check it would eat the Escape that closes the
  command bar — which you can now reach while recording.

#### The waveform's x axis is musical time

`recordingWindow.ts` owns it, and it is what makes the bar/beat rules mean anything. The
band keeps one **beat position per engine frame** beside the levels, so x is beats, not
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

## A view is a LAYOUT, not a mode

Every pane is mounted always, and always the *same instance* — including the editor, which
the default layout does not show. Three pieces of state decide what you see, and none of them
mounts or unmounts anything:

- `full` — which pane gets the whole screen (`null` = the global view)
- `focus` — which pane gets the keys; Tab walks the focus ring (`ringPanes`: the two the layout
  actually shows, so the editor is not on it — and focus left on a pane the layout dropped is
  snapped back, or the keys would go to something off screen)
- `panel` — the side panel, independent of both

`f` expands what you are on, Escape backs out. Because nothing is torn down by any of
that, the state that would be expensive to rebuild — the open file and its undo history,
the timeline caret, the zoom stack, the graph canvas — simply never moves. This is the
one invariant to preserve when adding a pane: mount it once, unconditionally, and let the
tables decide its size.

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
- **It closes on a click outside, or the ×** — not on Escape. Escape belongs to the editor: in
  vim mode it leaves insert mode, and a key that both leaves insert mode and closes the window
  you are typing in is a trap.
- **Any change of layout puts it away.** It is a detour to one file, not a place to be, so it is
  deliberately NOT URL state — a reload lands you in the view, not in the popin.

#### A sequence in the popin has TABS

Text / Roll / Tracker, and only here. A popin was opened by a command that named this
sequence, so "now show me its notes" is the likely next thing; a fullscreen editor pane is the
text editor, and a grid wants more room than a popin has to give.

All three write to the same buffer. A note drawn in the roll makes the file dirty exactly as a
keystroke does, so switching to Text shows the line you just drew and one Save writes it
whichever way you made the change.

### The GRAPH SLOT — what takes the graph's place

The chains slot holds the graph, or one of two other things, until the × puts the graph back.
That is where they have room: the timeline stays above, which is what you read either of them
against.

| what | opened by |
|---|---|
| a sequence's note grid | `sequence edit roll <sequence>` / `sequence edit tracker <sequence>` |
| a clip's content — the waveform for audio, the piano roll for a sequence | clicking the clip in the timeline |

**One state (`graphSlot`), not two flags.** They cannot both be there, so a union says so: two
booleans would have had to agree about which wins, and the × would have had to work out which
one it was closing.

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

What it draws is `ClipView`, the same component the Editor bottom panel shows — so audio and
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
  Editor bottom panel; the slot is the one thing the caret cannot say, so it is told outright.
- **the bare lane** — the caret moves to where you clicked, nothing is under it any more, and
  the slot goes back to the graph. What a click opened, a click on nothing closes; otherwise a
  clip sits parked there until you find its ✕.

The **Mixer button** moves the same slot, from outside the timeline — see above. A sequence
grid (`sequence edit roll|tracker`) is the fourth thing that can hold it. One slot and not four
flags, so nothing has to agree about which wins and the ✕ always knows what it is closing.

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

The bar takes focus on a **double-tap of Shift**: two lone Shift presses within
`DOUBLE_SHIFT_MS` with no other key between them. `e.repeat` filters out the auto-repeat
stream from a held Shift. The gesture cannot toggle back out, because the shell's key
listener ignores anything typed into an input — Escape is the way out, and has to be.

### The `ui` namespace

The shell's own view commands (`LOCAL_COMMANDS` in `palette.ts`) live under a `ui` prefix,
stripped in one place rather than by renaming every branch. The pairing is then **enforced
both ways**: a `ui` command typed bare is refused, and so is a non-`ui` command typed with
the prefix. `ui` promises "writes nothing, does not move the transport", and a `ui locate`
that quietly moved the playhead would be a worse lie than having no namespace at all.

A line the shell recognises but cannot act on is reported as *handled* rather than passed
down: the backend has no such command either, and "unknown command" would say less.

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

  Either way the chain will name the *instance*, so an instance is what is really being
  created — and since a chain now names it by its FILENAME alone, that name is the one thing
  only the user can supply, which is why both paths stop at the bar. From a namespace it
  takes one command: a chain cannot name `@engine/…` (`use` takes a local module), so it
  creates the local module that inherits it *and* the instance, with the module name
  pre-filled and the instance name left to you.

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
