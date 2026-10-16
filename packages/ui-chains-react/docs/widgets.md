# The widgets on a card — what one binds to, and what it shows

A node's panel is a grid of widgets, and every one of them answers two questions before it can be
drawn: **what does this actuate**, and **what value does it hold right now**. `widgetTarget.ts`
answers the first in `widgetTarget` and the second in `widgetValue`; this page is the reasoning
behind both.

## The bind vocabulary

A widget's `bind` is read in one order, and the order is the rule:

1. **A rack pad** (`rackBindSymbol` recognises it) comes first. It is an intrinsic too, but of a
   kind that FIRES rather than sets — reading it as a module field named `rack:BD` would send it
   looking for a value that does not exist.
2. **An `@` prefix is an INTRINSIC** — the thing's own field rather than a plugin param — and
   which thing that is depends on the node it is drawn on. A track's intrinsics are its mixer
   controls; a module's are the fields of its own file. That last one is how a live input's
   `monitor` is reachable at all: it has no plugin, so it has no params, so without the module
   branch every widget on one is inert.
3. **Everything else is a plugin param**, and needs a plugin to send it to.
4. Failing a plugin, an **offline** target — a param of a module realised outside the graph. It
   is opt-in, so a host with no surface realising them (a project that declares no
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
the render there. The graph does not know how the answer is arrived at — k7 derives it from the
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
(`apps/k7/frontend/docs/chainsGraph.md`). An override is optimistic: it outranks the incoming
frame until that frame catches up.

`dropChannel` returns the **same object** when it dropped nothing. A fresh one is never
`Object.is`-equal to the state, so `setOverride` would re-render on every incoming frame purely
to say nothing changed — which, at a plugin's ~20 frames a second per plugin, doubled the graph's
render rate.

`widgetValue`'s `live` argument is the subscribed value, passed when the caller is a rendering
widget holding its own subscription. An event handler passes none and the store is read at call
time, which for a handler is the RIGHT reading: the value as of the click rather than as of the
last paint.

## The binds that FIRE rather than set

Two families, and both are resolved **before** the general `@` case in `widgetTarget`:

| bind | target | what it does |
|---|---|---|
| `@rack:<symbol>` | `rack` | auditions that sound |
| `@rec:<verb>` | `recorder` | record, clear or save on a recorder node |

The ordering is not tidiness. A bare `@field` is what the arm below turns into a module FIELD to
write, so `@record` reaching it would resolve to a field called `record` and pressing the button
would write `node param rec @record …` into the node's file — a control that looks wired, does
something, and does the wrong thing. `recBindVerb` answers null for a verb it does not have, so
`@rec:play` draws inert instead of sending the engine a message it will not understand.

Neither carries a VALUE. `widgetValue` returns undefined for both, and what lights them comes from
elsewhere: a pad from `useRackLit`, a recorder's `record` from the state frame's `recorders` —
subscribed in the widget through `useRecorderState`, never passed as a prop, for the reason
`liveCables.md` gives about a 20 Hz frame and three thousand lines of hooks.

`clear` and `save` draw faint with no take to act on, and `save` while a take is still rolling.
Faint rather than hidden: a card that changes shape as you use it is a card you have to re-read.

Neither places an optimistic override either, and here the reason is sharper than for a dropdown:
the light must say what the ENGINE is doing. Lighting on the click would light on a refusal too —
`"has not carried audio yet"` comes back as an `error` and the button would already be red.

## Committing a module FIELD

`setModuleField` writes the option's LABEL into the module's own file, with **no optimism and no
socket**. A field is not a plugin param: there is nothing live to set, and the engine learns it by
rebuilding the track's input, so the reload the command triggers IS how it takes effect. Showing
the new value before that would be a guess about a round-trip we can simply wait for. (Under
`rehearsal` there is no round-trip at all, so the optimistic override is the only thing that can
answer — without it the dropdown would open, list its entries and snap back to what it was.)

**Which is why it has its own sender, `onModuleField`.** A chains host wires `command` to a QUIET
one — no `want: ["graph"]`, no `reloadKey` bump — because a knob drag would otherwise refetch and
re-lay-out the whole graph per tick, and a knob does not need it: its override shows the value and
the engine's frames confirm it. An intrinsic has neither. Send one down the quiet path and the
service writes the file, answers `graph=skipped`, nothing reloads, and **the select snaps back** —
correct on disk, wrong on screen, with no error anywhere. `onBypassModule` already existed for the
same reason; this is the second member of that family, and the rule is general: *a control
whose only feedback is the file needs the sender that brings the file back.*

Hosts that wire only `command` still work — the fallback is `command` — they just show the old
value until something else reloads. `packages/file-service/src/intrinsicRefresh.test.ts` pins the
half a test can reach: the graph the route hands back really does carry the new field.

The line names the field the way the WIDGET does — `@channel`, the bind verbatim — so there is one
vocabulary and no verb per field to keep in step; see the `INTRINSICS` table in `@studio/commands`.
It writes `arg` where an entry SAYS one thing and SETS another (a socket reads "Input 1 + 2" and
writes `1,2`); everywhere else the word on screen is the word in the file.

`setModuleField` is declared before its two callers because their dependency arrays name it, and
those are evaluated on the spot rather than at call time.

A PROJECT setting (`@project:<field>`) is committed the same way and for the same reason, through
`onProjectField`, and travels as the option's WORD rather than its index: `project aspect 16:9` is
what a person would type, and the row's position in the dropdown is the card's business alone.

## The right-click menu is for a PLUGIN param only

Two binds are excluded, and both because the answer would be a promise nothing can keep:

- a widget on a track node (`@output-volume`) drives a mixer control, and the MIDI map is a file in a
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
be loaded behind them. A PROJECT setting needs a host that can run a verb, and a recorder's
button one wired to the ENGINE: a preview card is looking at no project, so its dropdown reads
without writing, and it must never start a take in somebody's project.

## The knob

The pointer is a rim **tick** rather than a line from the centre, because the reading is drawn in
the middle of the dial: a line from the centre would run straight through the number. It starts
at 62 % of the radius instead — the same gesture, from outside the text. An unknown value leaves the pointer off and the travel unfilled.

The font is a fraction of the dial rather than a fixed size: a knob here is anything from 14 px to
sixty-odd depending on the cells it is given, and one size would be either unreadable on the
small ones or absurd on the large.

And the reading is **dropped** when it does not fit inside the tick — measured against the text
actually being drawn, not a guess at its width. A one-row knob is 21 px whatever its colSpan (the
height is what binds: a row less the caption), and `-100` needs 14 px of middle it has not got.
Better no reading than one over its own pointer.

A control with a whole-number `step` reads as a **whole number**, and as a **signed** one when its
range goes below zero (`widgetText`, `@studio/ui-chains`' `graph.ts`): a transpose reads `+7`, not
`7.00`. The decimals said nothing such a control can reach, and they were what pushed the reading
past the tick on a one-row knob, so the shift was not shown at all.

## The group

A `group` is painted FIRST (`groupsFirst`), in its `color` or a faint default, with its label small
up its left edge — a line of text turned 90° counter-clockwise, read from the bottom and ending at
the top, under the switch when there is one, and ellipsised when it is longer than the group is tall: a caption in the top-left corner would sit on the first control's
dial, and the edge is the one strip of a group no control uses. The name sits on a SPINE: the group's
own colour at 45 % opacity rather than its usual faint tint, from the group's left edge to 12 px —
where the edge's widgets start — so a panel's sections read as tabbed at a glance, and the strip the
name needs is visibly the name's. Turned rather than stacked letter
by letter, because a word stays a word: stacked capitals spell themselves out one at a time and
take a letter's full height each. The group is inert: `pointer-events: none`, so a click on its bare part
falls through to the card as a click on empty grid does. It draws none of the controls it frames.
They are the panel's own widgets, laid on top of it (`packages/song-schema/docs/moduleFile.md`).

A widget in a named or switched group's FIRST column is drawn 12 px in from its left edge
(`packages/ui-chains/src/groupEdge.ts`), so the name and the dot have that strip to themselves.
Its box narrows from the left; its cells do not move. The grid is shared by every section on the
panel, so the room comes out of the widget's own drawing rather than out of a column, which would
put one section's columns out of line with the next. A knob barely shrinks — its size is bound
mostly by its height, so a 2×2 loses 3 px and a 1×1 one. A field (dropdown, file picker, number)
is drawn in by 16 px: it fills its box's width and its caption is flush left, so it is what meets
the name first.

A group with a `bind` is switched by that param — read backwards when it carries `invert: true`,
as a `Mute` or `Bypass` param is on while its section is off. Its switch (`.dgx-gswitch`) is a DOT, not a toggle —
green on, red off, faint while unknown: a toggle's track would not fit the edge strip the name
uses, and a light reads at a glance across a panel of sections. It sits at the top-left,
on the same edge strip and above the name, which starts under it; it is the one part of
the group that takes a click, and it flips the param through the same `onTap` as a toggle. Off,
the group lays a veil (`.dgx-gveil`) over its own box. The veil, not a class on each framed widget,
because membership is geometry: the group does not know its widgets, but its box covers exactly
them. The veil is above the widgets and lets the pointer through, so a section can be set up while
it is silent. An UNKNOWN value greys nothing: a section drawn dead before its state has arrived
would be a lie the next frame corrects.

## The MIX knob, `@mix`

A knob bound to `@mix` is the ENGINE's dry/wet around the module, the same on every effect
(`engine/k7-runtime/docs/mix.md`). It is an `@` bind that is set LIVE: `widgetTarget` makes it a
plugin target, so a drag reaches the engine at once through `set-plugin-param` and the release
commits `node param <node> "@mix" <v>`, which writes the module's `mix:`. Every other `@` bind is
a module field, heard only at the next build. It reads as a percentage like the crossfade knob
below, it reads 100 % when the module states no mix — that is what no mix means — and it is no
automation target, a curve being a plugin param's.

## The crossfade knob

What a panel used before `@mix`, and what a module the engine offers no `@mix` on still has.

A knob with a `pair` is ONE control for a module that has a dry and a wet level and no mix: `bind`
is the wet param, `pair` the dry one. Its travel is the equal-power curve, wet = sin(m·π/2) and
dry = cos(m·π/2): the sum of the two powers stays at 1, so the loudness holds across the sweep
where a linear crossfade dips by 3 dB in the middle. Equal-power suits the reverbs and delays these
params belong to, where wet and dry are different sounds; on a nearly identical pair it bumps by
3 dB instead.

- **The knob's value is the WET level**, and its position is read back from wet alone
  (`widgetNorm`). Dry follows from wet, √(1 − wet²) (`pairValue`), so the drag, the override and
  the typed value keep their one-param shape, and every WRITE adds the dry half: the live send,
  the commit, a picked or typed value, and a MIDI CC.
- **It reads and types as a mix position in percent**, not as the wet level: 71 % wet is what
  "half" means on this curve, and nobody would type it.
- **The two commits run one after the other**, because they write the same module file.
- **It is not an automation target.** A curve drives one param, and wet alone breaks the pair.
- **One range for both**: the knob's `min`/`max` span the wet param and are applied to the dry
  one. The two levels of a built-in share 0..1.
- A panel that sets dry and wet apart is shown by its wet level only; the first turn puts dry
  back on the curve.

## A fader's drag travel is measured, not assumed

Every other control sweeps over a fixed `DRAG_TRAVEL_PX`. A fader does not: it is the one control
here whose travel is DRAWN on screen, so the cap has to track the pointer instead of running away
from it, and a fixed 150 px would be visibly wrong.

The travel is read off the `.rail`'s `clientHeight` rather than derived from the widget box: the
readout, the caption and the borders all eat into the box, and `clientHeight` is exactly the span
the cap's centre line moves over. Arithmetic would drift the moment any of that changed, and the
drift IS the bug — a cap that does not stay under the finger.

## A value can be TYPED

A double-click on a knob, a slider, a fader or a number swaps it for a text field holding its value.
Enter or leaving the field commits; Escape leaves everything as it was. Dragging reaches a value
within a pixel's worth of travel, and a musician copying a setting from somewhere else — a
frequency off a spectrum, a gain off another track — wants THAT number, not the nearest one a hand
can land on.

What is typed is clamped to the widget's range and rounded to its `step` (`widgetTyped` in
`@studio/ui-chains/graph`), the two limits a drag already obeys. The curve plays no part: a log knob
takes 440 as 440, since the curve shapes the travel and not the value. It is committed as ONE step
of a drag — the same override, the same `node param` line, the same lane `onTrackSet` — so a typed
value and a dragged one cannot land differently. Only the controls a drag reaches take a typed
value: a toggle, a pad or a dropdown already set an exact value in one click.

A drag's release now writes only when the value MOVED. The double-click's two presses each start
a drag; without that check, each would write the value the control already held.

## An automated control glows

A control whose param a curve drives wears a glow in the automation cable's mauve (`.dgx-w.auto`):
it is moving by itself, and the cable that says so may be off screen or, in a row, not drawn at all.
Which params are driven is read off the graph's automation edges, per node, and handed to the card
as ONE newline-joined string rather than a list, so the memoised card re-renders only when the set
of driven params actually changes.

The automation cable **stops at that ring** rather than at the control's centre
(`widgetBorderPoint`, `@studio/ui-chains`' `cables.ts`): run to the centre, it crossed the reading it
points at. It ends where the line from the curve's socket to the centre crosses the box
the ring is drawn on — `stripWidgetRect`, the same box the control is placed in, so a strip's
taller fader is met at its own edge.

A driven **knob also draws its curve's depth**: a mauve arc just inside the value's sand one, over
the stretch of the travel the curve sweeps (`automationDepth.ts` in `@studio/ui-chains`). The
stretch is the ENGINE's mapping, not a guess at it — a unipolar curve spans 0..amplitude, a bipolar
one rides ±amplitude/2 around the knob's AUTHORED value, which is what the engine rides around; the
live value would make the gauge chase the needle. A cut keeps one side of that: a bipolar curve
cut positive draws from the set value up, cut negative from it down. An on/off curve has no depth and draws none. The
depth reaches the memoised card inside the same newline-joined string as the glow, after a tab.

## Several nodes, one control

Shift+click adds a node to the selection, or takes it back out; a plain click is a single selection
again. A Shift+drag over EMPTY space draws a box, and every module card it touches joins the
selection on release (`nodesInBox`) — adding, as Shift+click does, never replacing. It is
checked before the fixed-camera guard: the mix panel's camera does not move, and that is exactly
where a row of strips is selected by sweeping across it. On a card, Shift keeps its other meaning,
a fine drag on a control. The set is the graph's own (`useWidgetDrag.ts`), beside the host's single `selected`, which is set
only when there was none — so a host that knows one selected node is not asked to know several.

When EVERY selected node is a use of the same ref on the same engine, a control moved on one of them
moves the same control on the others — they are uses of one module, so the control means the same
param on each. A DRAG moves each by the same travel from where it stood (`linkedValue`), each
stopping at its own end of the throw: four amps set apart stay apart, which is what makes driving
them together worth doing, where landing them all on one value would erase the balance that was
set. A typed value, a pick, a toggle and an interactive screen SET the others to the one value
instead, since a word or a switch has no "further along"; a toggle that flipped each would leave
them out of step. A selection that is mixed links nothing at all: half a fan-out would be a
control whose reach nobody can predict. A baked node is left out and the rest still move
(`@studio/ui-chains`'s `multiSelect.ts`). Each node's value is written to its own file, so a move
across four nodes is four lines in the journal.

## A dropdown's caption, on top of it

A dropdown's caption sits directly ON TOP of its select, left-aligned with the select's edge,
whatever the box's width — and so does a file picker's, over its button, and a number's, over its
value, since all three are drawn as a field. A number also takes the select's width, background and
type (`.dgx-num` mirrors `.dgx-sel`), so a number and a dropdown side by side read as one form. Every other caption is underneath its control; these two read like a form's. One place, so a panel's dropdowns line up with each other
and never rearrange as their option lists change.

The two are one column (`.dgx-selcol`) rather than a caption pinned to the top of the box: in a
box taller than the pair, `.dgx-w` centres the column, and the caption stays against the select
instead of drifting up to the box's edge. `min-width:0` on the column lets a long name ellipsise
inside the box rather than push the pair past it.

Caption and select share that column, so they keep one edge; a dropdown with no caption is drawn
in the same column, so it lines up with captioned ones. The column is inset only on a named
group's left edge (see "The group"): everywhere else it starts at its box's edge, aligned with the
widgets around it.

A caption is 6 px, smaller than anything it labels: it names a control that is already drawn, read
once and then recognised by position, so the two pixels go back to the panel. A `label` widget's own
text is 8 px and has its own class — it is a heading over a group rather than a reading, sized
against the 10 px a reading takes.

## A MIDI device's dropdown carries an LED

The `@device` dropdown of a midi-in card has a dot beside it that lights while that keyboard sends.
The renderer knows nothing of Web MIDI: the host hands it a `MidiActivityStore`, asked by the LABEL
the node names (`""` any device), and each card subscribes on its own so a note lights one dot
rather than re-rendering the graph — the reason `RackLitStore` is a store too. A host with no MIDI
passes none, and the dot stays dark.

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
already written keeps working — `packages/song/docs/filePicker.md`. Either way the param is the
widget's BIND: an older panel's `library:` names a folder (`nam`), not a param.
