# The timeline (`components/TimelineTab.tsx`)

A keyboard-driven arrangement: one lane per track, clips positioned by beat, a live
playhead, and a caret moved with `hjkl`/arrows. Only *continuous* interaction lives in the
component — the caret, growing the `v` rectangle, dragging a clip. Every discrete action is
a key bound to a command in `keys.ts` and run by the shell through this component's
imperative handle, so a key and a typed command do exactly the same thing. The two gutter gestures ("Clicking a
header", below) are the exception that proves it: neither writes anything — one moves the
caret, the other aims the shell's other panes — so there is no command for them to disagree
with.

## Modes and tools — two axes, one derived and one chosen

**A mode says where the KEYBOARD is; a tool says what a PRESS means.** They are orthogonal: you
cut just as well with a rectangle drawn as without.

### The mode was already there, unnamed

Three states existed and already excluded one another — a clip in hand, a rectangle drawn,
neither — and each already made `hjkl` mean something different. `timelineMode.ts` gives them one
name, and **derives it rather than storing it**: naming a state must not add a fourth source of
truth that can come to disagree with the three it reads. That is the rule
`packages/song/docs/surfaces.md` states for `surfaces/` against a `project_type`, applied here.

| mode | what the keys do |
|---|---|
| `normal` | `hjkl` walk the caret; every other key is a command |
| `select` | `hjkl` walk the rectangle's HEAD instead |
| `move` | h/l and the arrows nudge the clip a beat, enter drops it, esc cancels; it swallows every other key HARD — a nudge must not also scroll the pane |

A move that is **pending** — released, written, waiting for the reload — is not being carried, so
it is not the mode: the pane must not go deaf for a round trip.

The mode is published through `onView`, which is already the one channel the shell learns this
pane's state through, and lands in `App`'s `ConditionCtx` as one condition per name. Nothing new
was needed to dispatch on it: `keys.ts` bindings are already `{ if: "…", command }` tried in
order, so `{ if: "tl_select" }` is a condition like any other. **That is why there is no vim
grammar here** — no operators, no counts, no `d2j`. A grammar would be a second keyboard path
beside `useCommandKeys`, and the rule this app keeps is that a key NAMES a command and takes the
path typing it would take. Modes-as-conditions buy a whole second keymap without giving that up.

`+` adds a lane — `track new`, the corner button's line — on the timeline only. It is bound as the
CHARACTER, not as a key plus Shift, since `+` is shifted on one layout and bare on another.

### A tool is chosen, and belongs to the surface

`timelineTools.ts`, four of them: `pointer` (today's grab, marquee and caret), `cut`, `erase`,
`mute`. `a` is the arrow and `b` the blade — **DaVinci Resolve's**, so a hand arriving from an
edit suite is already right; `d` is the eraser, which no suite agrees on. All three are
conditional on the timeline owning the keys: changing a tool on a surface you are not looking at
is a change you cannot see. Escape puts it down, on the ladder above the fullscreen rung.

Each tool stands on **one verb**, so a press stays one command and one Ctrl+Z:

| tool | press on a clip | press on a shot |
|---|---|---|
| `cut` | `event split`, at the grid position under the pointer | `picture split`, likewise |
| `erase` | `event remove` | `picture delete` |
| `mute` | `event status mute`, sent BARE so the toggling is the verb's | refused: a shot has no mute, and `m` hides its lane |

**The tools are the same on both kinds of lane**, so the blade means the same thing wherever it
lands. Only the verb underneath differs, because the two splits are different acts: audio renders
two files and picture writes two placements (`packages/commands/docs/picture.md`). The picture
column is `pictureToolLine`, beside `toolLine`, and a press on a shot goes through the same guard
at the top of its own drag.

**A cut lands on the grid, as a drag does**, and Shift frees it (`snap.ts`). A cut at the raw
pointer would fall between the lines you can see, and on a picture between two frames.

**There is no pencil**, and the reason is worth writing down: `event add` places a clip that
already exists, so drawing one would be `sequence new` and then `event add` — two journal entries
for one gesture, and an undo that goes half way back. There is no fade tool either: every clip
already carries its two corner handles, and a tool would only restate them.

The whole tool axis touches the pointer path in **one place**, a guard at the top of
`beginClipDrag`: the tool answers with a line and the grab never starts, or it answers `null` and
today's gesture runs. The other twelve pointer gestures — the ruler, the marquee, the resize and
fade handles, the middle-drag, the wheel, every right-click — are out of these three tools' reach,
which is the reason for that set rather than a bigger one. The grab's three guards
(`readOnly`, `generated`, `frozen`) come first: a frozen song has no tools for the reason it has
no pickup.

A tool produces a command LINE rather than a named act, alone among this pane's writes
(`onToolLine`). Naming them would be one prop per tool and would move the verb out of the pure
module that is tested for it.

### The strip, and the cursor that is the same picture

Down the pane's left edge, a **32px column of icons** — one per tool, the current one lit. It is
the third way to a tool beside the keys and the bar, and the only one a finger has: a tablet has no
`b` to press. Each button DISPATCHES `ui tool <name>` rather than setting the state, which is the
rule that keeps a control and its verb from drifting apart.

**The cursor is built from the button's own drawing.** `modeIcons.tsx` holds one SVG body per mode
and both readers take it from there — two pictures for one tool is a pointer that can come to lie
about what a click will do. Three things that fall out of doing it that way:

- the glyphs paint with `fill="currentColor"`, which is what lets the cursor pass recolour them;
- the cursor draws the body **twice**, a heavy dark outline under a white fill, because it has to
  read on a lit waveform and on a dark lane alike and neither background is ours to choose;
- each glyph carries its own **hotspot**, since that is the pixel a click actually lands on — the
  blade's is its tip, where the split goes, not the centre of the icon.

The pointer tool has a drawing for the strip and deliberately no cursor: the system already draws
that one, and replacing an arrow with a picture of an arrow only makes it worse.

### The two view toggles, at the FOOT of the strip

The pane has **no header of its own**: the surface starts at the ruler. A song's name, tempo and
time signature are the shell's to say and the transport already says them, and a printed list of
keys is the one thing on screen that cannot be trusted — it is stale the moment a key is rebound,
and `/help` answers the same question from the keymap itself.

What the header did carry that nothing else does is the **view** toggles, and they now hang
under the tool column, below a rule: the ruler's unit (bars ↔ seconds), Expand, and the automation
rows shown or hidden — that last one drawn only when some lane has automation, so it is never a
toggle that changes nothing. Expand is ON by default, and its lanes travel to their new height
rather than jump, along with every line spanning them — the playhead, the markers — so nothing
overhangs the lanes mid-move (`GROW` in `TimelineTab.tsx`). While a bottom panel is open the lanes draw
folded and Expand is dead, because the panel takes half the height and tall lanes would leave a
handful of rows. The user's choice is kept, so closing the panel unfolds the lanes again
(`lanesLocked`). They sit there
because a control that changes what this surface SHOWS and writes nothing to disk is exactly what
the strip already holds — the tools are the same kind of thing — and `ModeStrip`'s `footer` is the
slot, `mt-auto` putting it at the bottom rather than at the end of the modes. `stripButton` is the
look, shared so a footer control is the same object as a mode rather than a copy of it.

The column is drawn **even where there are no tools**: a second device dispatches no tool line
(`ExternalTimeline`), and these toggles are the pane's own either way.

A hovered marker names itself in its own tooltip and glows its line; that is the whole of it now.

### Saying which state you are in

**The status line** is a hand-rolled mode line — a priority chain that renders the state as prose
and names the way out of it every time. It takes the tool, then the mode, as its first branches.

And the footer carries a **badge**: the line beside it is a message and passes, a state does not.
A state nobody can see is a state you leave by surprise.

## The caret

The caret walks the same rows that are drawn, group headers and live pattern lanes
included. Two positions exist:

- **in the lane** — a real beat. Only rows that can carry a clip (`isCellRow`) accept one.
- **on the label** (`beat: LABEL`) — the row itself is selected. Left from the view's first
  beat goes there; right comes back.

The label position is what makes a group or a generated lane reachable at all. Neither
holds clips, so selecting the row is the whole of what they have to offer — and mute/solo
are the only operations they take. Without a position the caret can land on, there is no way
to aim one.

`clampCaret` keeps the caret somewhere it can actually be: rows come and go (a reload, a
pattern lane starting or stopping), so a vanished row falls back to the first row that can
hold a *beat* — not `visRows[0]`, which would open the timeline with a group header
selected whenever the song starts with one.

## The caret and the playhead are independent

They answer different questions — *where the transport is* and *where you are working* — and
nothing joins them. **The caret moves only because you moved it.** Playing, rewinding,
clicking the ruler, scrubbing the minimap: none of them touch it.

Riding the playhead's beat would take the caret away from you: start playback and the thing
every key aims at — `e` to edit the clip under it, `m` to pick one up, `v` to start a
rectangle — is somewhere else a moment later, dragged across the arrangement at 20 Hz. It
would sweep everything downstream of the caret along with it, so the Editor panel would
re-target a new clip several times a second while the transport ran.

The one coupling there is runs the useful way: `t` (`transport locate`) sends the **playhead
to the caret**. You aim, then you send the transport there — not the other way about.

### Stepping and splitting act on the PLAYHEAD

`,` and `.` (`transport step prev | next`) move the playhead to the drawn tick before or after
it: the same grid every drag and every cut lands on, in whichever unit the ruler is reading.
Zoomed in on a song with a picture that is ONE FRAME (`packages/ui-timeline/docs/ticks.md`), and
it is the same step on an audio lane as on a picture lane. The step is not a second grid with a
setting of its own: a step that landed between the lines you can see would be a position no drag
can reach.

`Ctrl+B` (`selection split`) is the blade at the playhead, on the caret's lane. It makes the
same line the cut tool would make there, through the same `toolLine`/`pictureToolLine`, so the
two ways of cutting cannot disagree about what a cut is. The lane comes from the CARET and the
time from the PLAYHEAD: you scrub to the frame by eye, and you choose the lane by hand.

## Live state is drawn by LEAVES, never by the body

**The timeline body must not subscribe to the engine's state.** `EngineStore.set()` hands out
a fresh snapshot object ~20 times a second, so *any* subscription held by `TimelineTab` itself
re-renders the whole arrangement at frame rate — and a selector of `s => s` does it whether or
not a single number in that frame has changed.

The cost is measured rather than theoretical. With the body subscribed, a 17.7 s Firefox profile
of a tab sitting there spends **28 % of the capture in React** — 406 synchronous passes, 22.9/s,
236 of them containing `TimelineTab`, half of that time in DOM writes — and **36 % in graphics**,
at ~154 paints/s, for 18 % idle. That is a tab 82 % busy drawing a playhead and two meter bars,
while receiving the frames costs 55 ms of it, 0.3 %. The expense is never the wire or the JSX; it
is re-rendering an arrangement's worth of DOM to move one line.

So the rule, and the three things that follow it:

- **`Playhead`** subscribes to `s.playhead` and holds the one absolutely-positioned div it
  moves. Its geometry arrives as numbers, so it re-renders on a frame and on nothing else. It
  is parked at the lane's left edge and **translated** from there rather than re-`left`-ed,
  with `will-change: transform`: a position is layout, a transform is not, and one node moving
  for a whole song is what promotion exists for. The `Minimap`'s playhead does the same, and
  its box spans the full width so a percentage translate means a percentage of the minimap.
- **`LaneMeter`** subscribes per lane to `s.levels[i]` / `s.inputLevels[i]`, rounded to whole
  dB — a bar 0.4 dB different is the same bar, and rounding turns "changed" into "changed
  visibly". A silent lane costs nothing while a loud one plays. Its two bars are **scaled**,
  not resized, for the reason the playhead is translated; see `@studio/engine-browser`'s
  `docs/meters.md`, which also records what a `height` transition on a 20 Hz signal cost.
- **`RecordingClip`** subscribes to `s.playhead` and draws the take being played on the lane it
  is being recorded onto, from where the take started to wherever the transport has got to. Not
  a clip: there is no file yet and nothing on disk names it — it is drawn from the transport
  rather than from the document, and `addTakeToTrack` writes the real placement under it on Stop.
  It is the one live element here that genuinely changes SIZE rather than position, so it sets
  `width` where the playhead translates; being absolutely positioned, the layout that costs is
  its own and reaches no sibling. Whether a take is rolling, and from which beat, arrive as
  ordinary props — they change once per take, so the body pays nothing for them.
- **`armed`** is the one live value the body reads, through `arrayEq`, because it changes on a
  keystroke rather than on a frame.

`Grid` and `RulerTicks` are memoised for the other half of the same problem: they are the most
numerous elements here, they are a pure function of the view window, and every prop is a
number — so a re-render for any other reason leaves both untouched. Both build their tick list
from `tickBeats`, rather than taking one as a prop, because an array would be a new identity
each render and would defeat exactly the memo they exist for. `ClipContent` is memoised for
the same reason, one level down.

What is deliberately **not** memoised: the lane rows themselves. They close over some
twenty-five values, several of them closures rebuilt every render, so a `memo()` there buys
nothing until those are stabilised too — and with no frame-rate driver, what is left re-renders a
few times a second on a poll or a keystroke, not 23. Measure before paying for it.

### Dropping a marker

Right-clicking the ruler offers `project marker new <tc>`, and `<tc>` is **where you right-clicked,
snapped to the nearest drawn tick** — the same `nearestTick` against the same `bars` that a
left-click seek uses. Both buttons therefore agree about where a point on the ruler is, and a
marker can only land on a line you can see. The zoom is the resolution control here too.

Deliberately not the caret, and not the playhead behind it: **the caret is always defined.** It
sits at beat 0 until you move it, so "the caret if it holds a beat" is not a test for *has the
user aimed at something* — aiming there, every right-click on an untouched timeline reads that
beat 0 and proposes `1:1`.

Snapping also removes the problem aiming at a deliberately chosen position would solve. The
playhead is continuous, and `beatsToPosition` subdivides a leftover fraction by four until it
runs out, so a raw transport position spells as `4:2:2:2:4:4:2:4`; a drawn tick is always a whole
multiple of the ruler's unit, so it spells as `4:2` or `4:2:3`.

## The grid, and what a ruler click lands on

The ruler's unit follows the zoom (`subdivideBeats`) and every tick it picks is drawn twice:
as the ruler's own short solid tick, and as a **dashed rule continuing down every lane**, so
where a clip falls against the beat is readable where the clip is rather than only in the
header. One `bars` array and one `x()` feed both, so they cannot drift apart.

Dashed, and one alpha step fainter than the ruler's, for a reason: the solid vertical lines
in this view already mean something — the playhead, a marker — and the grid is *every* tick.
A third solid line would compete with the two that carry information.

The grid divs sit **first** in the scroll wrapper. Positioned siblings paint in tree order,
so everything a lane holds draws over the grid instead of being crossed out by it. It stops
below the ruler (the ruler draws its own tick there) and skips a tick landing exactly on the
lane's right edge, whose 1px border would otherwise be one pixel of horizontal scroll in a
view that is supposed to fit its pane exactly.

**A click on the ruler snaps the playhead to the nearest drawn tick** (`nearestTick`) — you
aimed at a line, not at a pixel. It is the drawn list that decides, not a round-to-the-unit,
so the guarantee is exact: the playhead can only land somewhere the grid marks. Opening the
zoom is how you reach a finer position, and the furthest a click can move from the pointer
is half a column. A *drag* on the ruler is unchanged: it still sweeps a selection over whole
beat cells.

### …and so does a clip DRAG

Dragging an event snaps to **the ruler's current unit**, not to whole beats. Snapping to beats at
every zoom makes the gesture and the grid disagree in both directions: zoomed past the beat, the
lines offer eighths the drag cannot land on; zoomed out to bars, it still moves in beats you
cannot see. The zoom is the resolution control everywhere else here
(`packages/ui-waveform/docs/ticks.md`), and the drag obeys it.

Three details, each of which could have gone the other way:

- **The step is read at the GRAB** (`unitRef`, assigned during render beside `ppbRef`), not live.
  A wheel notch mid-drag must not change what the gesture means under your hand.
- **Three ways to land, by the key held** (`snapMode`): with nothing, the edge or the start lands ON
  the project's grid; with Ctrl, the drag moves by whole steps of it, so a take placed by hand at
  `4:2:2.43` keeps that phase when you move it a bar; with Shift, it follows the pointer exactly.
- **In SECONDS mode the step is the seconds one**, converted through the tempo. `rulerScale`
  returns both and the mode picks; a drag snapping to beats under a ruler ticking every five
  seconds would land between every pair of lines.

### …and the keys say how it lands

**Nothing held, the grid; Ctrl, the event's own grid; Shift, none.** It applies to all three of this
view's gestures that move or resize — an event, either of its edges, a picture placement and its
edges — so there is one rule to hold rather than three exceptions to remember. `src/snap.ts` states
it once (`snapMode`, `snapPosition`, `moveOffset`) and is where its arithmetic is tested. A fade has
no position of its own to keep: Shift or Ctrl frees it. The piano roll's note drags take the same keys; drawing a note there keeps
Ctrl as its free key (`freeSnap`, `clipEditors.md`).

The keys are read **live**, off each pointer event, and that is deliberately the opposite of the step
above. The step is what the gesture MEANS and must not move under your hand; the keys are the hand.
Press one halfway through a drag and the rest of the drag follows it; let go and it snaps again from
wherever it is. Shift at the PRESS is still a selection press — the modifier counts once a drag runs.

`⌘` counts as Ctrl, and only for macOS, where Ctrl+click *is* the right button and the gesture would
otherwise be unreachable.

One consequence, on the resize only: the shortest an event may be left is normally the grid's own
step, the ruler's unit. Freed, that floor would refuse exactly the lengths you turned the grid off to
reach, so it drops to a 64th (`MIN_FREE_BEATS`) — short enough to be a real choice, long enough
that an edge dragged past the other does not leave a placement that plays nothing.

It is one DOM node per tick, on top of the one the ruler already draws — a cost paid on a
re-render, **not** on a playhead frame: `Grid` and `RulerTicks` are memoised and the body does
not subscribe to the transport at all (see "Live state is drawn by LEAVES" above).

### …and only the ticks you can SEE are built

Both layers window themselves to the scroller they are given (`useVisibleBeats` in `Ruler.tsx`),
with a 400px margin either side so a scroll reveals lines rather than a bare strip.

The count is why. The ladder floors at a 64th of a beat, so a whole-song list SATURATES at 64
nodes per beat: about 19 000 for a three-minute song and 192 000 for a long set — the real
ceiling on the zoom, met long before the browser's. Windowed, the count follows the PANE: about
forty, at any zoom, on any length of song.

A windowed tick is the SAME tick, by construction: `index` is computed from the ORIGIN
(`b / unit`) and never from the first one built, so the label stride and the three weights do not
shift as the window moves. `rulerTicks.test.ts` pins exactly that — every tick in a window is
identical, field for field, to the one the whole-range list holds.

The scroll position is held INSIDE the memoised layers rather than by the surface, and that is
the same rule as everything else on this page: a scroll is a stream, and a host holding it would
re-render the whole arrangement to move forty lines. Held there, a scroll re-renders the lines
and nothing else.

### The zoom has no ceiling you can reach

`useHZoom`'s clamp is derived (`zoomCeiling`) from the only limit that is really there, rather
than being a written-down number: a flat number is a ceiling with no reason behind it, and the one
people MEET — the wheel simply stops, with nothing on screen to say why. The limit that is really
there: a browser refuses to lay out an element past about 33.5 million pixels, and a lane wider
than that is silently clipped —
`scrollWidth` stops agreeing with the width we computed, and the anchored zoom drifts a little
further off with every notch. On a laptop pane the ceiling is some 13 000×, which is one 64th of
a beat filling the screen on a five-minute song.

`min` stays 1, and that is a different kind of bound: 1 IS fit. Below it the pane would draw the
whole thing plus empty space, and there is nothing further out to see.

The ruler's own vertical-drag zoom reads the same `zoomCeiling` rather than a number of its own:
a number written twice is two answers waiting to disagree, which is the same trap its
neighbouring comment records about `scrollLeft`.

## Clicking a header

The gutter — the name column, on all three kinds of row — is the row's handle:

- **click** selects the row. That is not a new kind of selection: it parks the caret on the
  label, exactly where `h` off the view's first beat already puts it, so everything that reads
  the caret (mute/solo, the Graph panel, the minimap) follows without being told.
  A live `v` rectangle is dropped, because its head is somewhere else and leaving one standing
  would draw two selections at once.
- **shift-click** on a track's name PICKS it. Picked lanes are a set of their own, drawn like a
  selected label, and the first shift-click brings the lane selected before it in as the anchor.
  Shift-clicking a picked lane drops it, and a plain click clears the set. The set is not the `v`
  rectangle: the rectangle is a span of time over adjacent rows, and grouping is about lanes
  whether or not they are adjacent. Right-click one of the picked lanes and its menu opens on
  **Group the N tracks** (`track group`, `src/contextMenu.ts`).
- **double-click** points the *other* panes at the row: the editor opens its file and the
  chains canvas frames the chains it feeds. Nothing is written, and the timeline keeps the
  keyboard — your hands are still on the arrangement.

The timeline decides *what* a row addresses and the shell decides what to do about it, which is
why the double-click is a callback (`onFocusRow`) and not a command. What it addresses is
`rowTarget` in `rows.ts`, and it is the redirect the mute/solo table below already describes: a
generated lane has no file and no chain of its own, so it names its **group**.

A header selection survives playback, as every caret position does — see "The caret and the
playhead are independent" above.

## A frozen lane's render

A frozen lane plays one clip, its render, and the block cannot be moved — but it still stands for
the notes it was made from. Expanded, the block draws them over its waveform, each authored clip at
its own place and in a colour the waveform does not use. A double-click on the block opens the piano
roll on the authored clip under the pointer, or the first one when the press falls between two: the
render has no notes of its own to open, and the waveform panel would show nothing the lane does not.
`packages/song/docs/freeze.md` says where those clips come from.

## A lane's alternatives

A lane can hold several sets of attributes and play one, and its gutter says **which**:
`LaneAlternative`, a small badge carrying the set's name, immediately **right of the track icon**
and before the name. It sits with the icon because it is part of what the lane IS rather than
something about its sound, and `shrink-0` beside a truncating label means a narrow gutter eats
the name and never the badge.

Alternatives belong to the MODULE a lane is, so the pair comes from
`packages/song/docs/alternatives.md` and not from a field of the lane's own.

Two things about it:

- it costs **nothing** on a lane with no choice. The graph carries the pair only past a list of
  one, so those lanes have no entry and grow no badge — the gutter width every other lane has is
  untouched;
- it is **amber** only when the lane is away from the first set. A lane whose clips appear to
  have vanished with nothing on screen explaining it is the failure that avoids, and the colour
  is what makes it readable at a glance down a column of fifteen.

It shows the name **even on the first set**. Costing nothing on lanes that have no choice, a badge
that appeared only away from the first set would hide the one fact a reader wants — that this lane
has variants at all. The first set's name is `"1"`, the module's own fields having
nowhere to carry one, so a single label reads as a number for an unnamed set and as a name for a
named one without the gutter having to choose.

### Clicking it opens the lane's menu

The shell's `nodeMenu` (`contextMenu.ts`), through `onNodeMenu`. The chains graph shows the same
sets as badges on the lane's node and runs the same verbs, so the switch, the two `create` entries
and the freeze are one behaviour with one set of commands, and each row is literally the command line it runs —
`node alternative select|create|copy`, `node freeze`. Switching goes on the click; the two
that need a name arrive in the command bar half-typed, which is what `complete` already means in
`contextMenu.ts`.

Three things fall out of reusing it, and they are the reason to:

- **nothing has to be portalled to the body.** This gutter is `overflow-hidden` (a zoom parks
  out-of-view clips at negative offsets), so a menu of its own drawn inside it would be clipped to
  the height of one lane; the shell's `ContextMenu` is rendered by `App` and is `fixed`, so there
  is nothing to escape from;
- **no `usePopin` rung.** The shell's menu answers Escape in the capture phase and stops it, so
  Escape cannot also close the graph slot behind it — which is why "a lane's alternatives" is not
  in the list of self-closing overlays in [shell.md](shell.md);
- the badge is handed the **button's rectangle**, not the pointer, so the menu hangs off the badge
  whether it was reached by mouse or by keyboard.

It passes `frozen` along with the pair for one reason: that menu's freeze row is a **toggle**, and
its label says which way it will go. Without the freeze state a frozen lane would be offered
"Freeze", and the row would lie.

**Where the two maps come from.** The chains pane fetches the graph; this pane reads the compiled
project. So `{alternatives, frozen}` travels up to the shell and back down here, the way
`docCount` does. One pair of maps feeds both the badge and the graph's own nodes, which is what
stops them naming different sets — and it means the badge appears once the chains pane has a
graph, not before.

## The `v` rectangle

An anchor (where `v` was pressed) and a head (what the arrows move), exactly like a vim
visual selection: the rectangle is the span between them, so moving the head towards the
anchor shrinks it and away grows it. Both ends hold a real beat — a rectangle is a region
of the lane, and `LABEL` is not a position in one.

Unlike the caret, the head walks *every* row, so a group header or a pattern lane can sit
inside a rectangle even though the caret could only ever select its label.

`z` turns the rectangle into the view and consumes it: what you framed is now the whole
timeline, so there is nothing left to have selected. `shift+L` does the same for the loop
region, spanning `[lo, hi+1)` so the last selected beat cell is inside it.

The loop band is the ENGINE's loop, not only the one this page set. The engine holds the loop and
reports it on every state frame; the timeline adopts it whenever it CHANGES — so a page reloaded
while a loop plays draws that loop at once, and a frame older than a loop just set here, being no
change, cannot undo it.

## The zoom stack

A zoom is the beat range plus the run of rows the view is narrowed to, held as a **stack** —
nesting is a push, `shift+z` a pop, `0` a reset.

- Rows are named by **identity, not index**, because live pattern lanes renumber them.
- The range is stored against the **full** row list rather than relative to the enclosing
  zoom. Each rectangle is drawn inside its parent, so the ranges nest and the innermost one
  alone describes the view — which is what lets the render path read only the top of the
  stack, and the visible rows be a plain slice of the full list.
- A zoom whose rows are gone (a reload, a lane stopping) describes a view that no longer
  exists. Those entries are popped one at a time rather than drawn wrong; the zoom below is
  still meaningful.

A zoom is a mode you can forget you are in — the lanes look normal, they just start
somewhere other than beat 1 — so the status line says so on every line and names the way
out.

## The wheel zooms, the trackpad slide pans, the middle button drags

A **mouse wheel zooms** the timeline, anchored under the cursor; **two fingers sliding** on a
trackpad still pan; a **pinch** zooms; and **holding the middle button** pans, on both axes
(`usePanScroll`).

The hard part is that a wheel and a trackpad send *the same event*. A pinch is the one gesture the
browser marks — it synthesises `ctrlKey`, on a Mac trackpad and on a Windows precision touchpad
alike — and `isZoomWheel` reads that. Everything else arrives as a plain wheel whatever produced
it, so without a way to tell the two apart one gesture has to mean one thing for both devices:
either a trackpad slide zooms the timeline, or a mouse wheel cannot zoom at all.

There is a way — three signals, most reliable first, read here by `isMouseWheel`
(`@studio/ui-timeline/panZoom`):

1. a `deltaMode` of lines or pages: only a real wheel is ever reported that way (Firefox does it);
2. `wheelDeltaY`, which Chrome and Safari still carry — a detent is a multiple of **120**, the
   number the Windows API gave it, where a trackpad reports three times its pixel delta and lands
   there only by accident. This is what separates a Mac mouse from a Mac trackpad;
3. failing both, the delta's SHAPE: a notch is integral, vertical only and large; a finger's is
   small and often fractional.

It is **wrong in one direction only**, deliberately: an unrecognised device is read as a surface
and keeps panning. A trackpad that zooms when you meant to pan is a broken trackpad; a mouse that
pans is merely a mouse that does not zoom yet.

**What a mouse gives up is the vertical wheel.** The lanes do not walk past under it — that
gesture is the zoom — so scrolling a tall project means the middle-button drag, which
pans both axes, or the keyboard (`j`/`k` move the caret and the pane follows). **Shift+wheel** is
left to the browser, which already reads it as "scroll sideways", so a mouse keeps one scroll
gesture; the pinch is tested first, so Ctrl+Shift+wheel is still a pinch with a finger resting on
Shift. A trackpad keeps
the native scroll, and everything it brings: momentum, axis locking, rubber-banding, both axes at
once. None of that is re-implemented on `scrollLeft`; the pane is already an `overflow-auto`
scroller and a plain slide is simply handed back to the browser.

`overscroll-behavior: none` sits on the root (`index.css`) because of this: a pane that has hit
its end no longer preventDefaults, and without it the leftover scroll bounces the whole shell.

The piano roll and the waveform take the same hook, so they behave the same — one gesture
vocabulary across the panes that draw time, which matters more than any one of them. The chains
graph draws the same line in its own camera and holds its own copy of the three signals: it
translates rather than scrolls, and neither package may depend on the other
(`packages/ui-chains-react/docs/camera.md`, and `docs/inventaire.md` records the duplication —
both sides are tested, so it cannot drift in silence).

## Fit to pane, not scroll

The view's beat range fills the pane **exactly**: the beat width is derived from the pane
width, so the song's beginning and end are always on screen and the lane never scrolls
horizontally by itself. Detail work is what the zoom is for. `PX_PER_BEAT` only draws the
first, unmeasured frame (`paneW` 0), so nothing renders zero-width before the
`ResizeObserver` reports.

Two layout traps that cost real time:

- The ResizeObserver effect is keyed on `proj`, because the pane does not exist until the
  project loads. Without the re-run, `paneW` stays 0 for the tab's whole life and the lanes
  never widen past the song's own extent.
- `min-w-0` on the scroll pane: without it the fixed-width lane wrapper sets the flex
  child's min-content width, so the pane grows with the window but never shrinks back,
  and the fit-to-pane scale ratchets.

The scroll offset is restored across a pane switch by hand. The zoom lives in React state
and survives on its own, but *where the view is scrolled to* is the DOM's, and a
`display:none` box has no layout to hold it — so going to the chains view and back would
otherwise return the arrangement to bar 1. It restores only when the scroller has just
regained size **and**
sits at the origin, the signature of that drop; a deliberate scroll to 0 saves 0 and
restores nothing.

The song's own extent (minimum 4 bars, rounded up to whole bars) is what the caret moves
within; the drawing may be wider. Live pattern lanes deliberately do **not** extend it:
their clips are the scheduler's look-ahead, so following them would grow the timeline a bar
at a time as playback runs.

## Only the clips near the screen are drawn

A clip is a heavy element — its activity layer, loop rules, fades and handles — and a zoomed-in
song or a long list of lanes puts most of them off screen. So a clip is rendered only when it
falls inside the viewport **plus one screen of margin on every side**; the lane, its gutter and
everything else on the row are always drawn, so the scroll extent and the row geometry never
depend on the window.

- The window is **snapped to half-screens**. Scrolling re-renders the timeline when it crosses
  one, not on every scroll event, and the margin is what keeps a clip drawn before it arrives.
- It is re-read **before paint** on a zoom, after `useHZoom` has moved `scrollLeft`: a window
  measured on the old scale would leave a frame with clips missing at the edges.
- A clip being **moved or resized** is always drawn, wherever it is — the drag owns it.
- A hidden pane measures 0 and keeps the window it had, which is the one it comes back to.
- At zoom 1 horizontally nothing is cut — the lane is the pane — so what the window saves there
  is the rows scrolled out of view.

## The same material, placed twice

A material placed more than once wears a **ghost** on every occurrence but the first, and the
first is the **earliest in time** — not the first in the file, and not the first on the lane.
`src/clipInstances.ts` answers both questions and is pure and tested; the timeline only draws it.

The badge sits beside the kind icon (a note, a speaker) rather than in a corner, because what a
block *is* and how many times you have already seen it are the same question asked at the same
moment. Only the returns wear it: an icon on every copy would say "these are copies" without
saying of what, and the eye would have nowhere to look for the take itself.

Selecting one of them **lights the others** — a one-pixel primary outline and a touch of
brightness, no more. It answers "where else does this play" while the eye is on the block you
picked, so anything louder would compete with the thing being pointed at. Selecting here is the
caret: parking on a block is what selects it, so a click already does it.

Two things are deliberately NOT counted, and the exclusions are the judgement:

- **Generated lanes.** Their clips are the scheduler's look-ahead rather than placements anybody
  wrote — a pattern streaming one bar sixteen times would ghost the real placement above it.
- **Video lanes.** A material space of their own, with their own renderer.

Two rules fall out of "the earliest wins" and both are pinned in `clipInstances.test.ts`:

- **Across lanes, not down one.** A verse played by the bass and then by the guitar is one
  material twice; counting per lane would call both of them a first.
- **An exact tie goes to the higher lane.** Two copies on one beat still have to have a first,
  and "the one nearer the top" is the only answer a person can check by looking.

The count is a fact about the **song**, not about the view: it reads every track rather than the
drawn rows, so zooming into three lanes cannot un-ghost an event because the copy it repeats is
on the fourth, and a repeat scrolled off the left edge is still a repeat.

## Activity runs through the blocks

An event's block is not a flat fill: its opacity runs from **50% where the content is quiet to
100% where it is loud**, changing along the block, so a lane reads as what it will do before it
plays. The mapping is pure and tested (`src/activity.ts`); `ClipActivity` is the layer that
wears it, and the block's own background moved in there (masked by a CSS alpha gradient, so the
fill stays whatever it was — a type class or the track's authored colour — and the string stays
colour-blind).

What "loud" means is the event's own: an **audio** clip reads its envelope's peaks — the same
`/waveform` fetch the expanded lane draws, one shared cache entry per clip, already windowed to
the event's from/to — normalised to *that window's* loudest point, so a quiet take still shows
its shape. A **sequence** sums the velocities of every note *sounding* at each position (a
chord is louder than its loudest note; a missing `vel` is the schema's default, 1), tiling a
loop window exactly as the mini-roll tiles its notes. Peaks are max-pooled into buckets, never
averaged — a hit inside a quiet bucket is the activity the block should show. Until an audio
envelope arrives (or when none ever will), the block wears a flat 70%, so nothing flashes.

### That cache is keyed by the WINDOW, not by the clip id

`src/clipEnvelope.ts` builds the key, and it exists because the id is not enough. `event trim`
rewrites the event's `from`/`to` and *nothing else* — same id, same start, same length — so a
cache filed under the id answers the trimmed block with the untrimmed envelope, and goes on doing
so for the rest of the session, since nothing evicts an entry: the block keeps the colour pattern
of material it no longer plays.

The key folds everything `regionWaveform` reads: the window (`offset`, `sourceFrom`,
`sourceTo`), the placement (`start`, `length`), the fact of a warp, the project's tempo and
time signature, and the bucket count. It is deliberately a **mirror of the file service's own
`wfSig`** (`packages/file-service/src/waveformOps.ts`) — the two answer the same question one
layer apart, and the service's version carries a comment about this exact failure: a cache in
front of a correctly-keyed one puts the bug back on its own.

The entry has the same shape for the same reason: `{key, data}` filed under the clip id, so a
changed key MISSES and the replacement keeps the map bounded by the clip count however many
times a clip is trimmed or moved.

Three fields ride the wire for this and no other purpose — `offset`, `sourceFrom`/`sourceTo`,
and `sourceName`, the last covering the other way material changes without the placement moving
(a bounce repoints the clip at a new file). All are optional on `WebClip`, `offset` included:
the shell synthesises stand-in clips to open an editor over, and those know an id and a name and
nothing about a placement.

Two things are still stale until a reload, both named in the source rather than left to be
discovered: a **warp marker moved inside an already-warped clip** (only the *fact* of a warp
reaches the browser — the markers stay engine-side), and a **file rewritten in place under the
same name** (the service folds a content fingerprint into its signature; a browser cannot see
one).

## Clicking an event

A click on a clip parks the caret **over it**: the `v` rectangle, anchored at the event's first
beat and headed at its last, on that event's lane. The caret is one cell, so covering something
eight beats long is the rectangle or nothing.

That makes a click a starting point rather than a dead end. Everything the caret and the
selection already drive applies to the thing you pointed at: `z` frames it, Shift+L loops it,
`m` picks it up, `m`/`s` act on its lane, and the Editor panel follows the caret onto its file.
None of it needs writing — it is what the caret is for.

A length-0 placement is covered as it is DRAWN, over its natural four beats, not over the zero
its file states. A caret stopping short of the block it is meant to be on would read as a
rounding bug.

Two things it deliberately does not do. It fires on the pointer coming back UP without having
moved — a drag is a move and ends as one. And it is skipped entirely while the command bar is
filling `event move`: there, a click on a clip is how you say *which* clip, and answering the
question you asked for beats a selection you did not.

## Shift: growing the rectangle with the pointer

**Shift+click** on a lane grows the caret into the `v` rectangle — anchored where the caret is
(or where the rectangle's anchor already was, so successive shifted clicks keep extending one
selection), headed at the cell under the pointer. Keeping the button down and **dragging**
moves the head live, across beats and across rows, exactly as `hjkl` would move it — it is the
same `Selection`, so `z`, Shift+L and `v` then act on it, and the status line counts it.

A shifted press is a selection press even when it lands on a clip: `beginClipDrag` bails on
`shiftKey` *before* stopping propagation, so the press bubbles to the lane instead of picking
the clip up. And the head's row is read off the rows' own DOM (`data-sel-row`, on every row
wrapper — groups and video lanes too), for the reason `laneAtPoint` hit-tests
`data-lane-track`: rows come in three heights, and a second copy of that geometry would drift.
Starting the gesture still needs a track lane, the only row a caret cell lives on; the drag can
then sweep over any row, as the keyboard's head already could.

### The rectangle answers `events move`

Acting on the rectangle is a COMMAND, not a gesture: `events move <tracks> <from> <to> <by>`
(in `@studio/commands`) moves every event starting in the range by a signed duration, in one
line — so it is one undo step and one reload however many placements it touches, and the CLI
can type the same range with no mouse anywhere near. While the bar is filling it, the
selection feeds its region through `feedEventsMove`, the same road `feedMove` gives the
single-event drag: tracks, from and to fill themselves (track lanes only — groups hold no
placements, picture has no verbs, a generated lane's file has no `events:`), re-offered on
every change so growing the rectangle keeps the fields true, and only the delta is left to
type. The range's ends are both inclusive on event STARTS, the same cells the rectangle
covers — where the loop's `[lo, hi+1)` covers time, a start either falls in a cell or not.

## Moving a clip

One `Move` state serves both flows, so they cannot disagree about what is in hand, and both
commit through `commitMove`:

- **keyboard** — `m` picks up the placement under the caret, arrows (or `j`/`m`) nudge it,
  Enter drops it, Escape puts it back.
- **pointer** — a **left**-drag slides it, and release drops it.

The placement is pinned by its track *and its original start*, because a track can hold the
same clip id at several beats. The ghost draws where it came from; the block draws `offset`
beats away. Nothing touches the file until the commit runs
`event move <track> <from> <to>` through the shell, with 1-based bar:beat:sub timecodes
built from the same beats the brain's `parsePosition` read the clip's start from (it finds
the event by start, within 1e-6).

### …unless the command bar is asking for one

If the bar is filling `event move` when the drag starts, the drag **answers it** instead of
committing (`feedMove`, present only then). Every frame offers the track and both timecodes,
the release offers them once more, and the drop writes nothing: the line sits in the bar and
Enter runs it. Drop on another lane and the fourth param is answered too.

The shell decides that — it is the one that knows which command is being filled — and this
component only reports numbers it already had. `moveArgs` builds them in one place so a live
frame and its release cannot disagree about which timecode is the `from`. Read
[commandBar.md](commandBar.md) for the contract; what it buys is being able to *point* at the
destination instead of typing a timecode.

Because an offer fills forward, the same drag answers whatever is still open: from a bare
`event move` it gives the track and both timecodes, and from `event move ge.rythm` it gives
the two timecodes and leaves the track you typed alone.

### The ruler answers a timecode field too

When the bar's open field asks for a **timecode**, a click on the ruler fills it (`feedTimecode`,
present only then) — snapped to the same drawn tick a seek would land on, so the value you get
is the line you aimed at. The transport does **not** move: answering is not acting, the same
rule the clip drag follows.

Only a click. A drag on the ruler is still a selection or a zoom, because those gestures are
how you get around and taking them away while a command is half-typed would strand you.

Move mode is **modal**: every key is swallowed while it is live, and swallowed hard
(`stopImmediatePropagation` on a capture-phase listener) so Enter and Escape do not also
reach the shell's rewind/close bindings. Leaving the tab drops the pickup rather than
stranding a half-finished move whose keys no longer reach it.

### A dropped clip STAYS dropped

A committed move is **held**, not cleared (`Move.pending`), and the clip keeps drawing where it
was dropped until the project containing that move arrives. Clearing the state and then sending
the command draws the clip at its old start for the length of the write-and-reload round trip: it
springs home on release and jumps forward a moment later, which reads as "the move didn't take".

Holding it is also the right answer when the command FAILS: the clip returns to where the file
still says it is, rather than sitting at a position nothing on disk agrees with.

A pending move is deliberately **not modal** — it is already written and only still drawn, so it
must not swallow the keys, and `m` may pick up the next clip immediately. The edge resize is held
the same way, for the same reason.

### The LEFT button

Moving a clip rewrites the project, which argues for a button that does not do every harmless
thing — but dragging a block is what a left button is *for*, and a gesture nobody reaches for
protects nothing. What guards against the stray drag is the 4px slop (below it the gesture is a
click, and a click on a clip writes nothing) and Ctrl+Z, which puts it back. There is no `u`
binding: undo is deliberately outside `keys.ts` entirely, on the capture-phase listener in
`App.tsx`.

Two things fall out. The right button is only the context menu, so nothing here needs the Windows
`contextmenu`-after-`pointerup` workaround one button doing two jobs would call for. And nothing
else wants the left button on a clip: the caret is keyboard-driven, so `stopPropagation` there
costs no gesture.

The resize handles are left-button too and stop propagation, which is what keeps an edge grab
from also starting a move.

While an edge is in hand the block's fill goes GREY (`ClipActivity`'s `pending`): the activity it
draws is the old extent's, stretched to the new width, and a coloured fill would read as what the
event will sound like. The colour comes back with the release, from the event the command wrote.

### Which lane it lands on

The lane under the cursor is found by hit-testing the DOM (`laneAtPoint`) rather than
re-deriving row geometry: rows have three different heights (group, plain, expanded) and a
second copy of that arithmetic would drift from the one that draws them. The dragged block
sets `pointer-events: none` while in hand so it does not shadow the lane underneath.

A clip only lands on another lane when that lane holds the same **kind** of material — a
MIDI placement on an audio track compiles to a clip the engine cannot play. The brain
refuses the pairing again on its side, so a stale view cannot sneak one through. The
keyboard nudge never changes lane at all.

Generated lanes are excluded from all of this: their clips are the scheduler's look-ahead,
rewritten every tick and backed by no file, so there is no `start:` to rewrite.

## A picture row's ARM

A picture lane's gutter carries one button, **A**, where an audio lane carries M/S/A. It arms the
lane for its own camera, and record + play then captures onto it
([picture.md](picture.md)). The lane goes red while armed and the button pulses while the camera is
actually rolling — armed and recording are two states, and only one of them is holding a device.

`r` reaches it from the keyboard, the same key that arms an audio lane. The binding is TWO entries
tried in order, on `caret_track` and on `caret_picture`, because the arms live in two verbs:
a sound lane's is `rec`, the A button's own toggle (MIDI in this browser, audio in the engine), a
picture lane's is `ui picture arm`. A picture row reports no `caret_track` — it never has — so the first condition
simply does not match, which is what an ordered keymap is for.

A **shape** lane gets no button: it has no input to record.

## Reordering: drag a header to another row

A lane's **gutter** is its handle. Press it and drag vertically and the row under the pointer is
outlined: that is the slot the lane in hand would take. Release and the lane takes it —
`track order` on a song's lanes, `picture lane order` on its picture, both commands, so both are
one journal entry and one Ctrl+Z. Below the 4px slop the press is still the click it always was,
and `rowMoved` is what keeps one gesture from also selecting the row.

**A picture row above another means IN FRONT of it.** `layers:` is bottom-first and the rows are
drawn reversed, so dragging a lane to the top row puts it in front — see
[picture.md](picture.md), which records what happened when the two read the same way round.

**The drop names a LANE, never a slot.** `onReorder` sends the id of the lane whose place is being
taken, and the verb counts. It has to be that way round: this view CLUSTERS its rows — a group's
members follow its header, wherever they sit in the compiled list — so a position counted here
could name a different lane in the file. Naming the lane is the one spelling both sides read the
same. `packages/song/docs/trackKind.md` has the file's side.

Three rows are deliberately not draggable and not droppable:

- a **group header** — moving it would move every member, which is a different act;
- a **live pattern lane**, because the row cannot tell one apart from a lane the project declares:
  the live ones are appended from their own endpoint (`rows.ts`), and no list on disk holds them;
- **across the two families**. A song's lanes and its picture's are two lists in two files, so a
  drop from one onto the other resolves to nothing rather than to a guess.

An automation row DOES answer, with the lane it belongs to: it is drawn as part of it, and a drop
that landed on it plainly meant it.

**Groups are the honest limit.** The order written is the compiled list's; the view re-clusters it
by group afterwards. So dragging within a group does what it looks like, and dragging a lane into
the middle of another group moves it in the file and then draws it back outside — its `group:` is
a different fact, and a drag does not change it.

## The corner button makes a lane — of which KIND, when there are two

The `＋ piste` button over the name column dispatches `track new`, like every other button here.
On a project that declares a **viewport** surface it opens a two-item menu instead — *piste audio*
(`track new`) and *piste vidéo* (`picture lane new`) — because such a project has two kinds of lane
and the button cannot guess which one you meant.

**A song with no frame keeps the bare button.** A menu of one item is a click that asks a question
with a single answer, so the shape follows what the project declares: `onNewVideoTrack` is passed
only when `hasViewport`, and the component branches on the handler's own presence — the idiom the
picture drag already uses.

Making a picture lane is **two writes**, and that is the interesting part: the lane file, and
`project.layers`, which is what says a lane exists and in which order it draws. A lane missing from
that list compiles perfectly and never appears, so the verb owns both
([packages/song-video/docs/picture.md](../../../../packages/song-video/docs/picture.md)).

### The camcorder is the picture lane's mark

One glyph — `TrackIcon`'s `video-16` — wherever a picture lane is named: its gutter row here, its
clips on it, its node on the chains graph, its `video_tracks/*.yaml` row in the file tree, and the
menu entry that makes one. A second drawing for the same thing is how a reader learns that two
pictures mean two things.

The minimap is the deliberate exception: at a few pixels per row it draws a violet band and no
glyph, because a 14px icon in a 4px row is not a smaller icon, it is a different picture.

## Dropping files from the desktop

Dragging audio or video off the OS onto a lane does three things, in the one order that works:
the bytes go into the project's `clips/`, a `clips/<id>.yaml` declares each one, and only then is
each **placed** — `event add` on an audio lane, `picture add` on a picture one. The plan is
`timelineDrop.ts`, pure; the three round trips are `hooks/useTimelineDrop.ts`.

A drop onto a picture lane then runs **`picture sound <lane>`**, once per lane, so the footage
arrives with its sound on an audio lane the engine plays (`packages/song/docs/videoSound.md`). It
is a fourth round trip rather than part of the placement because it can take a while, extracting
a long file's sound, and because it is safe to repeat: the lane is made the first time and reused
after.

**Where it lands is where you dropped it**, snapped to the ticks the ruler is actually drawing —
the same rule the clip drag and the ruler's click follow, so the lines you can see are the
positions you can land on. The lane comes off the DOM (`data-lane-track`, `data-lane-video`) for
the reason `laneAtPoint` does: rows have three heights and a second copy of that arithmetic would
drift.

**`dragover` must call `preventDefault`, or the drop does not happen** — the browser refuses it
silently and then navigates to the file, which is the worst of both. `fileDrop.ts` is the module
that answers "is this a file drag", shared with the file tree, and its test exists for exactly
that silence.

### The FILENAME is the id

A dropped `Prise été n°3.wav` lands as `clips/Prise-ete-n-3.wav` and declares itself in
`clips/Prise-ete-n-3.yaml`, holding `source:` and nothing else — no window, so the clip is the
whole file, which is what an untrimmed recording is (`apps/k7/docs/22-syntax-material.md`).
Accents are folded and everything else a path would argue about becomes one dash.

**An existing declaration is never overwritten.** `clips/kick.yaml` may already carry a trim, a
warp or corrected onsets, and a drop knows none of them; dropping a `kick.wav` next to one places
*that* clip and says so. The bytes are the same story: the upload refuses to clobber (409), and
the drop carries on with the file that was already there.

### Several files walk down the lanes

The first lands on the lane you dropped on, the second on the next lane **of the same kind**, and
so on. What runs out of lanes is left rather than folded onto the last one — the rule a paste
already follows (`clipboard.ts`) — and a file of the *other* kind is declared without being
placed, since it is in the project wanting a lane rather than being a mistake. Only a file that
is neither audio nor video is refused outright, by name.

Nothing here measures a duration, and that is why the files spread across lanes rather than in
time: the browser would have to decode each one to know how long it is, and a `.mkv` it cannot
decode would make the arrangement depend on the codec the machine happens to ship.

## Fading a clip

Each end of a block carries a **corner handle** at the top. Dragging it inwards opens a fade,
which draws as a wedge over the material — dark at the clip's edge, clear where the fade ends.
Dragging it back out closes it, and a fade of nothing removes the field rather than writing a
zero, so open-and-closed leaves the file exactly as it was.

**The top corners, not the ends.** The full-height strips at `left-0` and `right-0` are the resize
edges; putting a fade on the same pixel would make which gesture you got a coin toss. The handle
is invisible on a clip with no fade until the block is hovered — an always-lit corner on every
event is noise — and stays lit once there is one to grab.

Shift or Ctrl suspends the grid here, read live, so a fade can reach a length the ruler's step
cannot express.

**A fade is a LENGTH.** The gesture sends `beatsToDuration`, and `event fadein` reads it back with
`parseDuration`. The same number spelled as a POSITION is several bars, both spellings are legal
timecodes, and nothing between here and the engine can tell them apart — which is why the wedge
and the command are tested against each other end to end rather than each on its own
(`packages/song-edit/src/eventFade.test.ts`).

The wedge follows the cursor while a drag is in hand rather than waiting for the round trip, the
same courtesy a moved clip gets — the gesture in hand is read before the clip's own value.

`fadeIn`/`fadeOut` live on the placement, on the engine's wire, in the C++ engine and on
`WebClip`: the wedge is the only part of the feature this pane owns.

## A one-shot edit answers at once

A drag holds its own result until the reload (`pending` on a move, a resize, a fade). A one-shot
command has no drag to hold it, so its LINE is read instead (`pendingEdits.ts`) and the lanes show it
the moment it is sent: `event remove` / `events remove` hide their events, `event status mute` dims,
`event status warp` crosses the stretch icon, `event split` draws its seam, `events move` shifts its
range, `event crossfade` draws its two fades. Every gesture of these kinds ends in one of those lines,
so reading the line covers the tool, the key, the menu and the bar alike.

A refused line takes its edit back; one that lands keeps it until the next document, which has it done,
so nothing flickers between the two. The round trip was the lag: the edit, the reply, then a second
request for the project before a block moved. Not covered: a PASTE (`events add`), whose line does
not say how long the pasted events are, so they would be drawn wrong until the answer came. The takes
view does the same for its own picks, crossfades and removed takes (`TakesView.tsx`).

## Crossfading two events

The fifth tool, `crossfade` (`x`), fades one event into its neighbour: a press on a clip's right
half is about the event after it, on its left half the one before (`crossfadePair`). A click makes
the default half beat, a drag sizes it, Alt takes it away — one `event crossfade` either way.

**A crossfade is an overlap, not a key.** The verb makes the two events overlap by its length out of
material neither plays yet — B's start pulled earlier first, then A's end later — and gives A a
fade-out and B a fade-in exactly that long. The compiler tells the pair by that shape and gives both
halves the equal-power curve (`markCrossfades`); everything else — the wedges, the handles, moving
either event — is the ordinary fade's. A crossfade never changes what either plays outside it, which
is why it refuses when neither has material to give.

Only AUDIO events crossfade, and not a comped one: its seams are crossfaded in its takes view.

## A comped event is one block

The engine plays a comped event as several clips; every surface sees ONE (`foldComps`, in the file
service): the event's id and start, spanning its pieces, carrying them for drawing. The block wears a
layers icon, draws each piece's activity and waveform where it plays, and opens in its clip panel
with the comp drawn piece by piece (`docs/clipEditors.md`). Move, copy, mute and fade address the EVENT; resize, window, trim and split refuse it,
since they would rewrite one take's window (`packages/song/docs/takes.md`).

## Zooming with two fingers

Three gestures reach the same anchored zoom (`useHZoom` in `@studio/ui-timeline`), and they do
not scale alike:

- a **wheel notch** is one event and a discrete decision, so it takes a whole step (15%),
  whatever delta the browser puts on it. Bare on a mouse, since `isMouseWheel` recognises the
  device; with Cmd or Ctrl it is the same step, which is how a trackpad asks for one;
- a **trackpad pinch** arrives as Ctrl+wheel — a stream of small continuous deltas, dozens a
  second — so it scales BY the delta, clamped so a browser reporting a pinch in hundreds cannot
  jump a decade in one event. Given the notch's whole step it would multiply 1.15 per event and
  hit the zoom limit before the fingers had finished moving, which is how "pinch does not work"
  is really spelled;
- **two fingers on a touchscreen** produce no wheel at all. They are read from touch events, and
  measured against the spread the gesture STARTED at rather than frame to frame — a ratio of
  ratios accumulates rounding, and pinching out and back in would not return where it began.

Touch events rather than pointer events, deliberately: this container scrolls, and the browser
claims a pointer the moment it decides a drag is a scroll, so a pinch woven into the pointer flow
dies to a `pointercancel` half-way through. A non-passive `touchmove` that preventDefaults for
the length of the gesture is what holds the browser off.

The hook also sets `touch-action: pan-x pan-y` on the container itself. Panning stays the
browser's — it scrolls this far better than we would — and that value says exactly that while
taking the pinch back. Set by the hook rather than left to each caller's stylesheet, because a
surface that mounts it and forgets the rule gets a gesture the browser silently swallows, with
nothing on screen to explain it.

`wheelFactor` is exported and tested. The graph keeps its own (`@studio/ui-chains/zoomGesture`)
because its notch branch differs — it scales by the delta where this one steps — and an
arrangement package importing the graph's would be the wrong way round.

## The name column is wider here than the shared default

`GUTTER_DESKTOP` in `@studio/ui-timeline` is sized for the least a gutter can carry: a name.
This app's carries two meters, an instrument icon, the name and three toggles, which at that width
would leave the name a few characters wide — so it takes 30% more (`GUTTER_WIDE`).

Local rather than pushed into the shared package, because the width is a property of what a
surface PUTS in the column, and a surface that drew names alone would be paying viewport for
controls it does not have. What must
not drift is this app's own idea of it — the caret's "left of the first beat" test and
`useHZoom`'s anchor maths both subtract the same `GUTTER` variable, and two numbers there is a
click landing one column off, which reads as a rounding bug and is not one.

### …and it STAYS, while the lanes pan under it

`sticky left-0` on every gutter cell (`GUTTER_STICKY`), as the piano roll's key column does —
without it, panning right takes the names off screen and leaves a wall of anonymous clips.

Sticky cells inside the ONE scroller, not a second pane beside it. Two scroll containers means two
scroll positions to keep in step, and a pixel of drift there shows up as a lane wearing its
neighbour's name — which is the failure mode of every split-pane arrangement, and the reason it is
worth stating rather than trying.

Two details carry it:

- **An opaque ground**, as a `before:` layer. Every tint this column wears is semi-transparent — a
  group's `bg-muted/60`, the caret's `bg-primary/25`, a selection's `/20` — so a sticky cell with
  nothing behind it has the clips sliding visibly through the names. `-z-10` puts the ground under
  the cell's own content and above whatever scrolls past.
- **A z-index that says what is in front of what.** The gutters are `z-30`: over the lane's own
  layers (a selected clip is `z-10`; an edge handle, a marker and the playhead are `z-20`) and
  under the ruler, which sticks the other way at `z-40`. So the playhead disappears behind the
  names rather than drawing across them, and where the two stickies cross, the corner belongs to
  the ruler.

…and the scroller carries **`isolate`**, which is what keeps those four numbers a private
conversation. Without it they compete with the SHELL's: the ruler's 40 beats the header's 20 and
draws straight over the **cog menu**, which is a plain absolute dropdown inside the header rather
than a portalled one, so it cannot escape the header's stacking context to get away from it.
Isolated, the whole pane takes part outside at `auto` and the header sits above it — while the
full-screen overlays (the settings screens at `z-40`, the module builder at `z-30`, every popin at
`z-50`) still sit above the header, which is the order the shell needs. The rule to keep: a pane's
layers are the pane's own, and the moment one of them is tuned against something outside the pane,
the number is in the wrong place.

## What a track key aims at

Resolved here, because this is where the rows and groups are known; the keymap just
interpolates the answer.

| the caret is on | `m`/`s` act on |
|---|---|
| a track lane | that track |
| a group header | the group (the brain's mute/solo fold onto its members) |
| a live pattern lane | its **group**, not the lane |
| a video lane | nothing — it is not an engine track |

A generated lane is synthesized per tick, so muting the group is the only thing that can
silence it (see `project.ts` `withGroupMix`). Aiming at the lane would be a key that cannot
work, so the status line names the group instead and the redirect shows.

Neither `m` nor `s` writes a flag on the lane itself. `m` is the lane's module BYPASS, one
name in `graph.yaml`'s `bypassed:`; `s` bypasses every OTHER lane, and nothing on disk says
"soloed" (`packages/song/docs/trackModules.md`).

How a lane *reads* is not the same as the flag on it: a track is dimmed if it is muted, if
its group is, or if something else is soloed and it is not — mirroring `withGroupMix` plus
the engine's mixer-wide solo rule, so what you see dimmed is what you do not hear. Solo
takes the live pattern lanes into account too: they are real lanes on the engine, and a
soloed one silences the authored tracks. A group header dims on its own flag only, having
no lane of its own.

## Video lanes, and the ruler's second unit

A video placement is cut in **seconds** against the wall clock while a song's lanes are placed
in bars. Both are drawn here, on one grid, and both are editable: there is one `tempo:` and no
tempo map, so seconds ↔ beats is exact and reversible.

The ruler reads either unit — the clock button in the header — and a drag snaps to whichever
ticks are on screen. A grid readable only in bars would make picture unreadable however
accurately it was drawn, which is what that button is for. The full account, including the
three drags and why a placement is not a command, is in [picture.md](picture.md).

`rulerTicks` is the one function behind both modes. It returns ticks positioned in BEATS, the
surface's only coordinate, each carrying its own label and weight, so `Grid` and `RulerTicks`
stay unit-blind — and `bars`, the snap list every ruler gesture reads, is simply its output.

## Both layers live in `Ruler.tsx`, and the roll draws them too

`Grid` sits beside `RulerTicks` in `Ruler.tsx` rather than in this file, and the roll calls both,
off the same `rulerScale`. Declared here it would be the timeline's alone, and the roll would be
back to a ruler of its own — two hand-rolled loops, bars every `barBeats` and beats every 1
whatever the zoom, with **bar lines only** under the notes: zooming a clip in subdivides nothing
and zooming it out smears the numbers, while the same zoom on the timeline behaves.

The pair is one statement and that is why they are together: a line under a ruler has to be a
line the ruler drew, at the weight the ruler gave it. Anything with a ruler gets both —
[clipEditors.md](clipEditors.md) has the roll's side, and the waveform canvas answers the same
question a different way (`subdivideGrid`, in `packages/ui-waveform/docs/ticks.md`) because its
ticks arrive as a list off the wire rather than as a unit it can compute.
