# The widgets on a card — what one binds to, and what it shows

A node's panel is a grid of widgets, and every one of them answers two questions before it can be
drawn: **what does this actuate**, and **what value does it hold right now**. `DomChains.tsx`
answers the first in `widgetTarget` and the second in `widgetValue`; this page is the reasoning
behind both, which used to sit in the file as forty lines of prose.

## The bind vocabulary

A widget's `bind` is read in one order, and the order is the rule:

1. **A rack pad** (`rackBindSymbol` recognises it) comes first. It is an intrinsic too, but of a
   kind that FIRES rather than sets — reading it as a module field named `rack:BD` would send it
   looking for a value that does not exist.
2. **An `@` prefix is an INTRINSIC** — the thing's own field rather than a plugin param — and
   which thing that is depends on the node it is drawn on. A track's intrinsics are its mixer
   controls; a module's are the fields of its own file. That last one is how a live input's
   `monitor` is reachable at all: it has no plugin, so it has no params, so before this every
   widget on one was inert.
3. **Everything else is a plugin param**, and needs a plugin to send it to.
4. Failing a plugin, an **offline** target — a param of a module realised outside the graph. It
   is opt-in, so a host with no surface realising them (pl8, or st0 on a project that declares no
   desk) keeps drawing nothing rather than a knob that turns against an address the engine never
   had.

The rack pad is the one target that SETS nothing: it fires a sound and returns, so it has no
value to read back and no address to write to. That is why it is a kind of its own rather than a
module field that happens to be momentary. It carries no optimistic override either — its key
exists only so the union is covered, and nothing ever writes under it. Whether a pad is LIT is a
separate question, asked of a separate channel and per pad; see `useRackLit`, which each widget
subscribes to on its own.

That lit channel is a STORE and not a prop, for the reason the plugin params feed is one: it
changes as fast as the playhead moves, and a prop would re-render every node in the graph on each
frame. The pad holds its own subscription and reads a BOOLEAN, so React's own `Object.is` ends
the render there. The graph does not know how the answer is arrived at — st0 derives it from the
arrangement and the playhead, which is why it lights for a SEQUENCE and not for live MIDI or a
strudel lane, whose notes the browser never sees (`packages/song/docs/racks.md`).

A pad also draws BARE. The grid is the picture, and sixteen three-letter symbols in a card this
size is a wall of text where a drum machine's face should be. The symbol is still the widget's
label — it names the pad in the tooltip below and in a right-click — so nothing is lost, only
unprinted. Every other button keeps its word, and `?` remains the tell for a hand-authored one that
forgot to write one.

## A module field is a word; a widget speaks numbers

`monitor: auto` is a word in a file, and a widget shows a number. The widget's own `options`
already carry the mapping, so the panel that draws the choices is the one that names them and
nothing in the renderer has to know what `monitor` means.

A socket is matched on `arg` rather than on the label, because that is the half that says what
the field holds: the entry is CALLED "Input 1 + 2" and the file says `1,2`. Two widgets may bind
`@channel` — the socket and its width — and each finds itself in its OWN options, which is what
lets width be a control without being a field: mono and stereo are not two settings, they are how
wide this one is.

A **base** is matched on the label instead, because there the label IS the name written in the
file. An unset base shows `none` rather than nothing: the entry exists so the choice can be
undone, and a blank dropdown would leave the one module state you cannot get back to unnamed. A
**shader** is the same answer over a different folder, and its `none` is a real state rather than
an escape hatch — a shader node with nothing picked passes its picture through.

## The value chain, and the identity trick under it

The value a widget shows is **override, else engine, else authored, else nothing**
(`apps/st0/frontend/docs/chainsGraph.md`). An override is optimistic: it outranks the incoming
frame until that frame catches up.

`dropChannel` returns the **same object** when it dropped nothing. A fresh one is never
`Object.is`-equal to the state, so `setOverride` would re-render on every incoming frame purely
to say nothing changed — which, at a plugin's ~20 frames a second per plugin, doubled the graph's
render rate.

`widgetValue`'s `live` argument is the subscribed value, passed when the caller is a rendering
widget holding its own subscription. An event handler passes none and the store is read at call
time, which for a handler is the RIGHT reading: the value as of the click rather than as of the
last paint.

## Committing a module FIELD

`setModuleField` writes the option's LABEL into the module's own file, with **no optimism and no
socket**. A field is not a plugin param: there is nothing live to set, and the engine learns it by
rebuilding the track's input, so the reload the command triggers IS how it takes effect. Showing
the new value before that would be a guess about a round-trip we can simply wait for. (Under
`rehearsal` there is no round-trip at all, so the optimistic override is the only thing that can
answer — without it the dropdown would open, list its entries and snap back to what it was.)

The line names the field the way the WIDGET does — `@channel`, the bind verbatim — so there is one
vocabulary and no verb per field to keep in step; see the `INTRINSICS` table in `@studio/commands`.
It writes `arg` where an entry SAYS one thing and SETS another (a socket reads "Input 1 + 2" and
writes `1,2`); everywhere else the word on screen is the word in the file.

`setModuleField` is declared before its two callers because their dependency arrays name it, and
those are evaluated on the spot rather than at call time.

## The right-click menu is for a PLUGIN param only

Two binds are excluded, and both because the answer would be a promise nothing can keep:

- a widget on a track node (`@volume`) drives a mixer control, and the MIDI map is a file in a
  MODULE's folder — there is nowhere to record it;
- an `@` bind is a module FIELD (`monitor`), a word rather than a number, so a control change has
  nothing to sweep.

Both fall through to the node's own menu, which is what they had before.

## Read-only is honest; draggable-and-ignored is not

`actuable` is what decides whether a widget answers the hand, and a widget that fails it is drawn
**read-only rather than dead**. That is what an offline module looks like on a surface that only
borrows its number, and now what ANY widget looks like when its host gave no way back (the
writability flags, `docs/hosting.md`).

The order of the test matters. A rack pad is asked first, because it needs a host that can make a
SOUND and a rehearsal cannot invent one. Everything else asks `rehearsal` next: a rehearsal has
nowhere to send a value and needs nowhere, so its widgets move whether or not a plugin happens to
be loaded behind them.

## The knob

The pointer is a rim **tick** rather than a line from the centre, because the reading is drawn in
the middle of the dial: the line used to run from the centre to the rim, straight through where
the number now sits. It starts at 62 % of the radius instead — the same gesture, from outside the
text. An unknown value leaves the pointer off and the travel unfilled.

The font is a fraction of the dial rather than a fixed size: a knob here is anything from 14 px to
sixty-odd depending on the cells it was given, and one size would be either unreadable on the
small ones or absurd on the large.

And the reading is **dropped** when it does not fit inside the tick — measured against the text
actually being drawn, not a guess at its width. A one-row knob is 21 px whatever its colSpan (the
height is what binds: a row less the caption), and `-100` needs 14 px of middle it has not got.
Better no reading than one over its own pointer.

## The tabs bar

Three rules, each of them a bug that was there:

- **`justifyContent: flex-start` inline**, against `.dgx-w`'s own `center`. The bar has to sit at
  the TOP of its box because that is what the sub-widget offset assumes (`+ TAB_H`). Centred, the
  two disagreed by half the leftover height — a page's first row overlapped the bar on a one-row
  box and hung 26 px under it on the next, with no row an author could pick that was flush. Inline
  rather than a class so it beats the stylesheet whatever the order.
- **`w-full` on the bar**, because `.dgx-w` is a centring flex column: without it the bar is sized
  to its NAMES and parked in the middle of the widget, which is what left "General" reading
  "Gene…" with empty box on either side of it.
- **`flex-auto`, not `flex-1`, on a tab.** The basis is the NAME's width, so spare space is shared
  out rather than cut into equal slices that clip a long page name next to a short one. `truncate`
  stays as the last resort, for a name wider than the box.

## A fader's drag travel is measured, not assumed

Every other control sweeps over a fixed `DRAG_TRAVEL_PX`. A fader does not: it is the one control
here whose travel is DRAWN on screen, so the cap has to track the pointer instead of running away
from it, and a fixed 150 px would be visibly wrong.

The travel is read off the `.rail`'s `clientHeight` rather than derived from the widget box: the
readout, the caption and the borders all eat into the box, and `clientHeight` is exactly the span
the cap's centre line moves over. Arithmetic would drift the moment any of that changed, and the
drift IS the bug — a cap that does not stay under the finger.

## A dropdown's caption, beside or above

`captionFitsBeside` measures from the **glyph counts**, never from the DOM: the real widths only
exist after a reflow, and this runs for every widget of every node on every frame that touches
one. The constants are `.dgx-wlab` (6 px, uppercase) and `.dgx-sel` (9 px monospace) — if either
size moves, they move with it.

The select is priced at its WIDEST option, because that is what it must be able to show: a
dropdown that fits while reading "Sine" and clips on "Saw down" would rearrange itself as you used
it.

The two layouts are two different CSS problems. ABOVE, the caption is pinned out of the flow, so
the select itself is what `.dgx-w`'s `justify-content` centres rather than the pair of them; it
takes `left`/`right` rather than a width so a long name ellipsises in place, and `text-align:center`
because a span out of the flow is no longer a child the flex box can centre. BESIDE, the pair stays
in the flow at full width so the select can spend what the caption does not: the caption is
`flex:none` (it is a word, and shrinking it only ellipsises a name) and the select takes the rest.
`min-width:0` on BOTH is what lets that happen at all — a flex item's default `min-width:auto`
floors it at its content, and a long option list would then push the pair past the box instead of
the select fitting inside it.

A caption is 6 px, smaller than anything it labels: it names a control that is already drawn, read
once and then recognised by position, so the two pixels go back to the panel. A `label` widget's own
text is 8 px and has its own class — it is a heading over a group rather than a reading, and it
borrowed `.dgx-wval`, so shrinking captions alone would have left it 4 px larger than everything it
heads.

## A widget as a landing target

While a curve's cable is in hand, a widget that can TAKE it becomes a target whole, and
`onLandAutomation` is passed only then — so the ordinary press (a knob's drag, a toggle's tap) is
untouched the rest of the time, rather than every widget growing a mode it has to check on every
press. The landing takes over the press, so a knob does not start turning under a cable that was
about to land on it, which is the one thing that would make the gesture feel broken.

Only a PLUGIN param qualifies, and for the reason the right-click menu gives: an `@` bind is a
module field (a word, not a number) and a track widget drives a mixer control, neither of which a
curve has anything to say to. A label or a waveform binds nothing at all.

## The file picker

A `filepicker` picks a FILE the module carries, for the file-valued param it binds. It is a
button, not a `<select>`: these folders are nested and long (a NAM pack is a folder per amp), and
a native select is one flat alphabetical scroll with no search. Clicking asks the shell to open
the same browsing popup the `+` on an arrow uses.

`dropdown` + `library` is the older spelling of the same widget, from when the files came from a
shared library instead of the module's own `assets/`. It is read as a filepicker so every panel
already written keeps working — `packages/song/docs/filePicker.md`.
