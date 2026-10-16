# What is drawn on top of the wave, and what a hand can grab

[Waveform.tsx](../src/Waveform.tsx) draws one canvas and hangs a few DOM buttons over it. This
page holds the reasoning behind the marks — the view, the markers, the stretch points, the
material's window — so the component itself can say what each prop is in one line.

## Everything stays in ABSOLUTE seconds

`view` is a span of the material to SHOW, not a zoom factor: what a host wants to say is "these
twelve bars", never "×3.7". Nothing crossing this boundary changes units because of it — a
view is a way of looking. A marker's time, a selection and every callback mean the same thing
whether or not anything is zoomed.

`sourceWindow` is named that and not `window` because a prop of that name shadows the global
one inside the component, which listens on it.

## The colour and line grammar

This pane already spends violet on a selection, blue on a warp, teal on a marker, amber and
green on regions. There is no hue left, which is why the material's own window is drawn
colourless and as GROUND, under the envelope: it is what the picture is *about* rather than a
mark on it, and it is typically most of the pane, so an overlay tint would wash out the very
waveform it frames. Its two EDGES carry it rather than the wash — the envelope's own fill is a
gradient up to 22% drawn on top, so a band relying on its tint alone reads as a smudge exactly
where there is audio.

Lines follow a second grammar, on the dash:

- **dashed = a derived rule** — the bar/beat grid, and a stretch point's source line. Solid
  verticals on this canvas mean something you can act on (the playhead, a marker, a selection
  edge), so the grid, which is every tick, must not compete with them.
- **solid = a measured moment** — `onsets`. Those are located events the detector found and not
  a regular grid, which is why they are solid despite the rule above. They are drawn ABOVE the
  envelope and below the stretch points: under it, where the grid sits, they would vanish exactly
  where the material is loud, which is where the hits are.

`onsets` carries the same times `markers` carries as pins, in the form a host wants when they
are the BACKDROP rather than the subject: placing a stretch point means dropping a beat onto a
hit, so the hits have to be visible while the warp marks are what the hand is on.

`markerPlace: "low"` exists for the same reason. The top of a waveform is where the loud
material is, so a row of tabs along the top edge covers the very transients it points at. It is
opt-in rather than a change of default because three surfaces draw markers here and only one of
them draws onsets — the DJ desk's cues and the rehearsal sessions' marks are neither.

## Committed on RELEASE, always

A marker's move, a window edge, a stretch point's target: each follows the hand from LOCAL state
while it is held and writes once, on release. Writing on every `pointermove` would be a file
write per pixel. The consequence is that the drawing must read the local state first and the
prop second, or the mark lags the hand by a save.

A drag that does not move is a click, at a 4px threshold — the same one the canvas uses to tell
a click from a selection, so a twitch while clicking a mark still removes it rather than moving
it onto itself.

Marks are handed back to the host **whole**, never by index: `warps` is rebuilt from the file on
every reload, and an index taken on `pointerdown` can name a different point by the time the hand
lets go. A stretch point's identity is its `orig` — the target is the thing moving, so it cannot
also be the name.

## The handles live on the same mapping as the lines

`timeToX` is the one authoritative mapping: it already carries the view's zoom and the measured
width. A handle placed by a second `(sec - v0) / span` computed in an overlay outside the
component is exactly how it comes to sit a pixel off the line it is supposed to be holding. So
the window's edges, the warp handles and the marker pins are all placed with that same function,
and the stretch points themselves are drawn on the canvas rather than as positioned divs.

The grab zones are DOM buttons because a pin's drag must not also start a selection underneath —
the two would race for the same pointer, hence the `stopPropagation` on each `pointerdown`.

Two placement rules differ, and the difference is what each mark is FOR:

- a **pin is read**, so one hanging outside the view would lie about where its mark is: pins
  outside `[v0, v1]` are simply not rendered. Their `left` is absolute px, so one outside would
  sit off the canvas rather than be clipped by it — a flag hanging in the panel's chrome.
- a **handle is grabbed**, and one that leaves the canvas is a control that has vanished: the
  window's edges are CLAMPED into the strip, with the true second in the title. An event playing
  its whole file has its edges at the file's, which any zoom past fit puts off screen — exactly
  the case with the most reason to reach for them.

That last case is also why the handles fall back to `{0, total}` when there is no
`sourceWindow`: an event that plays its whole file states no window, so there is no band to
light, but pulling an edge in is how a window gets made in the first place. The band stays
absent and the first drag brings one into being.

## Stretch points: what snaps and what does not

Everywhere else on this canvas a click lands on the nearest drawn tick, because what you are
naming there IS a beat ([ticks.md](../../ui-timeline/docs/ticks.md)). A warp is the exception, twice over:

- **placing** one is unsnapped. What you are naming is a moment of the SOURCE — an attack, a
  syllable — and the whole gesture is to pin it to the grid afterwards. Snapping the origin would
  put the point on the beat it is already near, which is the one place that says nothing.
- **dragging** a target is unsnapped for the mirror reason: the reason to drag one by hand is
  that it does not sit on the grid, so snapping answers a question nobody asked and takes the
  fine placement away.

Placing is on DOUBLE-click, not click: a single click already seeks and starts a selection, and
a mode cannot quietly take that away — the wave is still a wave while you warp it. The seek the
first click of the pair fires is harmless, since it moves the playhead to the very second the
point is about to be placed at.

The pair is drawn as an ARROW from the source moment to where it lands, rather than a plain
connector: the relation is directional — the source is dragged onto a beat, never the other
way — and a bare rule between two verticals says the two are related without saying which way it
reads. Under `WARP_ARROW_PX` only the shaft draws, since a head that long would be most of the
line; a stretch of a pixel or two is a point that has barely moved, which is worth seeing as such.

Dragging is offered on the TARGET and never on the origin, because the origin is what the point
IS — the moment of the source it pins — and `clip warp` addresses points by it.

## The draw effect's dependency list

`warps`, `warpDrag`, `onsets`, `sourceWindow` and `winDrag` are all in it, and one left out of it
draws correctly most of the time: changes to them usually arrive with a fresh envelope, which
invalidates the rasterised layers and redraws anyway. That is a coincidence of the fetch, not a
rule, and it goes quiet the first time one of them is set from local state — which is exactly
what every drag in flight above does.
