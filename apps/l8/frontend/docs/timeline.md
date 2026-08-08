# The timeline (`components/TimelineTab.tsx`)

A keyboard-driven arrangement: one lane per track, clips positioned by beat, a live
playhead, and a caret moved with `hjkl`/arrows. Only *continuous* interaction lives in the
component — the caret, growing the `v` rectangle, dragging a clip. Every discrete action is
a key bound to a command in `keys.ts` and run by the shell through this component's
imperative handle, so a key and a typed command do exactly the same thing. The two gutter gestures ("Clicking a
header", below) are the exception that proves it: neither writes anything — one moves the
caret, the other aims the shell's other panes — so there is no command for them to disagree
with.

## The caret

The caret walks the same rows that are drawn, group headers and live pattern lanes
included. Two positions exist:

- **in the lane** — a real beat. Only rows that can carry a clip (`isCellRow`) accept one.
- **on the label** (`beat: LABEL`) — the row itself is selected. Left from the view's first
  beat goes there; right comes back.

The label position is what makes a group or a generated lane reachable at all. Neither
holds clips, so selecting the row is the whole of what they have to offer — and mute/solo
are the only operations they take. Until the caret could land on them there was no way to
aim one.

`clampCaret` keeps the caret somewhere it can actually be: rows come and go (a reload, a
pattern lane starting or stopping), so a vanished row falls back to the first row that can
hold a *beat* — not `visRows[0]`, which would open the timeline with a group header
selected whenever the song starts with one.

## The caret and the playhead are independent

They answer different questions — *where the transport is* and *where you are working* — and
nothing joins them. **The caret moves only because you moved it.** Playing, rewinding,
clicking the ruler, scrubbing the minimap: none of them touch it.

The caret used to ride the playhead's beat, on the theory that it kept you looking at where
you were. What it actually did was take the caret away from you: start playback and the
thing every key aims at — `e` to edit the clip under it, `m` to pick one up, `v` to start a
rectangle — was somewhere else a moment later, dragged across the arrangement at 20 Hz. It
also swept everything downstream of the caret along with it, so the Editor panel re-targeted
a new clip several times a second while the transport ran.

The coupling was never symmetric, and the direction that survives is the useful one: `t`
(`transport locate`) sends the **playhead to the caret**. You aim, then you send the
transport there — not the other way about.

## Live state is drawn by LEAVES, never by the body

**The timeline body must not subscribe to the engine's state.** `EngineStore.set()` hands out
a fresh snapshot object ~20 times a second, so *any* subscription held by `TimelineTab` itself
re-renders the whole arrangement at frame rate — and a selector of `s => s` does it whether or
not a single number in that frame has changed.

That is not a theoretical cost. A Firefox profile of 17.7 s, taken while the app sat there:

| | |
|---|---|
| React synchronous passes | **406 — 22.9/s**, mean 11.2 ms, 62 over 16 ms |
| …containing `TimelineTab` | 236 of them, mean 12.4 ms |
| React total | **4.9 s = 28 %** of the capture |
| of which `updateProperties` (DOM writes) | **2.18 s = 12 %** |
| Graphics — display list + paint | **6.4 s = 36 %**, ~154 paints/s |
| Idle | **18 %** |

The tab was 82 % busy drawing a playhead and two meter bars. Receiving the frames cost 55 ms —
0.3 %. The cost was never the wire or the JSX; it was re-rendering an arrangement's worth of
DOM to move one line.

So the rule, and the three things that follow it:

- **`Playhead`** subscribes to `s.playhead` and holds the one absolutely-positioned div it
  moves. Its geometry arrives as numbers, so it re-renders on a frame and on nothing else.
- **`LaneMeter`** subscribes per lane to `s.levels[i]` / `s.inputLevels[i]`, rounded to whole
  dB — a bar 0.4 dB different is the same bar, and rounding turns "changed" into "changed
  visibly". A silent lane costs nothing while a loud one plays.
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
nothing until those are stabilised too — and with the frame-rate driver gone, what is left
re-renders a few times a second on a poll or a keystroke, not 23. Measure before paying for it.

### Dropping a marker

Right-clicking the ruler offers `marker new <tc>`, and `<tc>` is **where you right-clicked,
snapped to the nearest drawn tick** — the same `nearestTick` against the same `bars` that a
left-click seek uses. Both buttons therefore agree about where a point on the ruler is, and a
marker can only land on a line you can see. The zoom is the resolution control here too.

It aimed at the caret first, falling back to the playhead, on the theory that those are
positions you chose deliberately. That was wrong for a reason worth recording: **the caret is
always defined.** It sits at beat 0 until you move it, so "the caret if it holds a beat" is
not a test for *has the user aimed at something* — and once the playhead stopped dragging the
caret along (above), every right-click read that untouched beat 0 and proposed `1:1`.

Snapping also removes the problem the caret was there to solve. The playhead is continuous,
and `beatsToPosition` subdivides a leftover fraction by four until it runs out, so a raw
transport position spelled as `4:2:2:2:4:4:2:4`; a drawn tick is always a whole multiple of
the ruler's unit, so it spells as `4:2` or `4:2:3`.

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

One cost to know: this is one DOM node per tick, on top of the one the ruler already draws,
and the component re-renders on every playhead frame. At the deepest zoom on a long song
that is ~1000 nodes becoming ~2000. Memoizing would mean hoisting the whole ruler geometry
above two early returns; it was not worth that for a 2× on a cost the ruler already paid.

## Clicking a header

The gutter — the name column, on all three kinds of row — is the row's handle:

- **click** selects the row. That is not a new kind of selection: it parks the caret on the
  label, exactly where `h` off the view's first beat already puts it, so everything that reads
  the caret (mute/solo, the Graph and Docs panels, the minimap) follows without being told.
  A live `v` rectangle is dropped, because its head is somewhere else and leaving one standing
  would draw two selections at once.
- **double-click** points the *other* panes at the row: the editor opens its file and the
  chains canvas frames the chains it feeds. Nothing is written, and the timeline keeps the
  keyboard — your hands are still on the arrangement.

The timeline decides *what* a row addresses and the shell decides what to do about it, which is
why the double-click is a callback (`onFocusRow`) and not a command. What it addresses is
`rowTarget` in `rows.ts`, and it is the redirect the mute/solo table below already describes: a
generated lane has no file and no chain of its own, so it names its **group**.

A header selection survives playback, as every caret position now does — see "The caret and
the playhead are independent" above.

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

## Fit to pane, not scroll

The view's beat range fills the pane **exactly**: the beat width is derived from the pane
width, so the song's beginning and end are always on screen and the lane never scrolls
horizontally by itself. Detail work is what the zoom is for. `PX_PER_BEAT` only draws the
first, unmeasured frame (`paneW` 0), so nothing renders zero-width before the
`ResizeObserver` reports.

Two layout traps that cost real time:

- The ResizeObserver effect is keyed on `proj`, because the pane does not exist until the
  project loads. Without the re-run, `paneW` stayed 0 for the tab's whole life and the lanes
  never widened past the song's own extent.
- `min-w-0` on the scroll pane: without it the fixed-width lane wrapper sets the flex
  child's min-content width, so the pane could grow with the window but never shrink back,
  and the fit-to-pane scale ratcheted.

The scroll offset is restored across a pane switch by hand. The zoom lives in React state
and survives on its own, but *where the view is scrolled to* is the DOM's, and a
`display:none` box has no layout to hold it — so going to the chains view and back returned
the arrangement to bar 1. It restores only when the scroller has just regained size **and**
sits at the origin, the signature of that drop; a deliberate scroll to 0 saves 0 and
restores nothing.

The song's own extent (minimum 4 bars, rounded up to whole bars) is what the caret moves
within; the drawing may be wider. Live pattern lanes deliberately do **not** extend it:
their clips are the scheduler's look-ahead, so following them would grow the timeline a bar
at a time as playback runs.

## Moving a clip

One `Move` state serves both flows, so they cannot disagree about what is in hand, and both
commit through `commitMove`:

- **keyboard** — `m` picks up the placement under the caret, arrows (or `j`/`m`) nudge it,
  Enter drops it, Escape puts it back.
- **pointer** — a **right**-drag slides it, and release drops it.

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

### Why the right button

Moving a clip rewrites the project, and it used to happen on the same button that does
every harmless thing in the timeline — one stray drag while clicking around and a placement
had silently moved. The right button makes it deliberate, and leaves the left to the caret
and selection.

That costs one workaround: Windows fires `contextmenu` on button-up, *after* our
`pointerup`, so a drag that actually moved sets a flag the menu handler consumes. It is
cleared unconditionally at the start of a drag — a drag cancelled by the OS fires
`pointercancel` with no `contextmenu` to follow, and a stale flag would swallow the next
right-click on any clip.

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

## What a track key aims at

Resolved here, because this is where the rows and groups are known; the keymap just
interpolates the answer.

| the caret is on | `m`/`s` act on |
|---|---|
| a track lane | that track |
| a group header | the group (the brain's mute/solo fold onto its members) |
| a live pattern lane | its **group**, not the lane |
| a video lane | nothing — it is not an engine track |

A generated lane is synthesized per tick and has no file to carry a flag, so muting the
group is the only thing that can silence it (see `project.ts` `withGroupMix`). Aiming at
the lane would be a key that cannot work, so the status line names the group instead and
the redirect shows.

How a lane *reads* is not the same as the flag on it: a track is dimmed if it is muted, if
its group is, or if something else is soloed and it is not — mirroring `withGroupMix` plus
the engine's mixer-wide solo rule, so what you see dimmed is what you do not hear. Solo
takes the live pattern lanes into account too: they are real lanes on the engine, and a
soloed one silences the authored tracks. A group header dims on its own flag only, having
no lane of its own.

## Video lanes are read-only here

A video placement is cut in **seconds** against the wall clock while this grid is in beats.
Dragging one would have to convert back through the tempo and would drift the moment the
tempo moved. It is drawn so the arrangement shows the whole song — picture included — not
so it can be edited from here.
