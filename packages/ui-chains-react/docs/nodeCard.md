# The card a node draws — its header, its corner, its flags, its LODs

`DomChains.tsx`'s `NodeInner` is one component drawing every kind of node, and the branches it
takes are all decisions someone made once. This page holds the reasons; the file holds one line
each.

## Two names, stacked

A node and its module are two different things — `sy_jun-chorus` is one use of
`@st0/audio/modulation/chorus-ense` — and the header used to say only the first. Seventeen uses of
one mixer then read as seventeen unrelated cards, and what a node IS could only be learnt by
opening it.

So the header wears the MODULE this node uses, or its own name when there is no second one, and
the node's own name goes underneath, small, where it answers the second question: WHICH use is
this. The far LOD says the module too, for the same reason — at that zoom the card IS one word,
and the useful one is what the node is rather than which copy of it. Two LODs answering
differently would be two cards.

The stack lives inside `UI_HEADER` (38 px), which the layout and the hit areas share, so `.dgx-nms`
states both line-heights rather than inheriting them: 7 px of padding either side leaves 24, and a
header that grew would put every widget grid under its own card's chrome. `min-width:0` on the
column is what makes an ellipsis inside a flex row work at all — the same reason it appears on the
track's input label, where a long channel name would otherwise push the node's own name out.

## The header's arithmetic is repeated, not measured

The name is SIZED to fit rather than ellipsed, because a card is only as wide as its panel's grid
and at a fixed 12.5 px seventeen identically-shaped mixers all read `vo_j…`. What is left for it is
the card less the header's padding, the leading glyph or dot, and the room a corner button takes out
of the right. The `title` stays anyway: the fit is floored, so a long enough name is still cut.

`headerNameW` is `.dgx-hd`'s own numbers written out again: 10 px of padding each side, a 7 px
gap, a 13 px glyph or an 8 px dot leading the name, and the padding-right a corner button adds.
The layout is flex, so the real figure only exists after a reflow — which is exactly what a
per-card measurement would cost. If the CSS moves, this moves with it.

The corner reservation is `corners * 12 + 2`: 12 px per bubble plus the 2 px the first one hangs
past them. It read `hasNativePluginUI ? 26 : 0` before, which was wrong twice over — a module with
a bypass bubble and no native UI reserved nothing, and a node with one bubble reserved room for
two.

## One corner list, read by three things

`cornerButtons` exists because the buttons, the header's padding and the width `headerNameW`
leaves the name all need the same answer, and disagreed before it did: a module with a bypass
bubble but no native plugin UI got no padding at all, so a long name ran under it.

The ⋮ `menu` appears on any node that COULD use one — any module node, a lane included — not only
on one that already has alternatives or a freeze, since creating either has to start somewhere and
that somewhere is the node. A note is left out: it is drawn as prose with no header to hang a
bubble off. A BAKED module gets neither `plugin` nor `bypass`, there being no live plugin behind
it for the engine to open a window on or to bypass; the ⋮ stays, because that is how the freeze is
undone.

### Where a bubble sits

A bubble STRADDLES the node's corner — half on the card, half off it — so it reads as attached to
the module without belonging to its title strip. The 8 px overhang is safe: dagre keeps nodes 40 px
apart (`nodesep`) and ranks 100 px, and nothing between the card and `.dgx` (the pane) clips, so it
can neither collide with a neighbour nor get cut. `z-index` lifts it over the card's own shadow.

Every bubble is the same disc; what differs is the SLOT it takes, counted from the corner leftwards
(`--slot`, 17 px wide plus 3 px of air, so 20 px apart). One rule rather than a `.paired` variant
per pair: there are three of them now — alternatives, bypass, plugin UI — and a variant per
combination is where a fourth would have gone wrong. The header's `padding-right` is driven by the
same `--corners` count, so the name and the cluster cannot disagree about how many there are: 14 px
for the first bubble, 12 px more for each one further left, because their lower-left quarters still
overlap the header's corner.

## A flagged node has TWO colours, not one

A plugin the engine could load but WON'T (`not_supported`) is **amber**; everything it cannot find
at all is **red**. That is what `graphFlags.md` has always said and what this file did not draw:
`notSupported` folded into `red` and the class was only ever `stub`, so the `.k-unsupported`,
`.dgx-nm.unsupported`, `.dgx-sub.unsupported` and `.dgx-far.unsupported` rules were all
unreachable — a not-supported plugin drew a red card, contradicting its own flag line and this
package's own promise of "an unsupported plugin amber" (`docs/hosting.md`).

## A note is drawn before the LOD branch

Every other card drops to its name when the camera pulls back, because widgets stop being readable
and the name is what is left. A note has no widgets and its text IS the card, so shrinking it to
the node's filename would replace the only thing worth reading with the one thing that is not.

No jacks are drawn on it either: a note takes one input and gives nothing back, and a socket on a
comment invites a wire out of it. The cable INTO it is the ordinary one — that is what says which
part of the chain the note is about. See `@studio/song`'s `docs/docModules.md`.

## The sockets on a card's edge

A PORT is a socket in a little plate stepped off the card's edge, the way a mini-jack is panel
mounted. The plate is what makes it read as hardware: a bare dot on a border reads as a bullet, and
a node with three of them reads as a list. It sits OUTSIDE the card so it never competes with the
widget grid, and its flat side is the one against the card. Inside it is the barrel seen end on — a
dark bore with a bright ring, coloured by what the port carries, so a socket matches the cable that
belongs in it.

An EVENT socket sits on a SIDE edge, where signal never goes: inputs and outputs run down the card,
so the left and right are free and the two can never be confused for one another. It is also the
only socket that says its name — an event is announced, and "note-on" is the whole of what the
announcement means.

Three states, and they say three different things:

- **FREE** — nothing wired to it. An invitation rather than a connection, so the plate recedes and
  the bore loses its ring: the eye finds the sockets that carry signal first, and the spare one only
  when it is looking for somewhere to plug in.
- **PLUG** — a free socket the patch gesture can use right now: an out to draw a cable from, a
  matching in to land it in. Only a host that passes `onConnect` arms this, so a read-only graph
  keeps its inert sockets.
- **The cable in hand** is dashed and coloured by its signal, its far end pinned to the cursor — a
  promise of a cable, not yet one, which is what the dashes say.

## A lane's clips

`ClipList` is its own component because the hover link between its two halves needs STATE, and the
node around it is memoised so that a pan or a meter frame re-renders no card at all — putting a
`useState` up there would have handed every track node a reason to re-render that has nothing to
do with the graph.

The list is drawn only on a track, only when it holds something, and only once the widgets are
legible: at far zoom the card is its name, and a list of clip refs would be a grey smear. The count
line replaces the tail rather than extending it.

The mini timeline draws EVERY clip; the list below shows `CLIP_LIST_MAX` of them. Hovering a
marker bolds its name below when that name is on screen, which is what ties the two halves
together: the timeline says WHERE, the list says WHAT, and the pointer says which is which.

The strip is WHITE, and stays white in both themes deliberately: it stands for the song itself
rather than for more of the card's chrome, so the blocks on it read as material on tape. It is a
surface, not a panel that should follow the skin, and the thin border is what keeps the white from
bleeding into a light theme's card. A block's colour is the TRACK's, which is what tells two lanes
apart at a glance; a lane that authors none falls back to the node's accent, and a missing clip
overrides both and is red — absent material is never painted in the reassuring colour of the lane
it is missing from, which is the one state this whole list exists to catch.

## The fader's VU

`FaderMeter` shows the same signal, range and colours as a Mix-panel strip, because it IS the same
strip: a mixer module sits on a track's chain, and the fader on it is that track's level.

It is its own component with its own subscription, exactly like `InputMeterBar` — the level
arrives every frame and it has to move a 9 px bar rather than re-render the graph. A chain that is
not a track draws nothing at all (a bus is fed by several, so there is no one level to show), so
the fader keeps its full width instead of reserving space for a dead bar.

`flex:1` plus `min-height:0` on `.dgx-fader` is the whole feature of the throw: it eats whatever
vertical space the widget's `rowSpan` gives it, so a `rowSpan` of 6 is a real 6-cell throw rather
than a slider stood on its end.

The VU's RAMP is on the box and a shade masks it from the top, so the colour is decided by the
level; painting it on the fill instead would squeeze the whole ramp into whatever height the bar
happened to have, and a quiet track would read red. The shade carries **no transition**: levels
arrive every 50 ms and this was a 60 ms ease, so it was restarted before it ever finished — the bar
never reached its own value and trailed a frame behind for ever. A height cannot run on the
compositor either, so each restart cost a restyle, a reflow and a display-list entry. See
`@studio/engine-browser`'s docs/meters.md.
