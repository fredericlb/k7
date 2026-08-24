# The chains graph (`@studio/ui-chains-react`)

The routing graph, drawn as HTML nodes plus an SVG cable layer. dagre owns the layout and only
the *drawing* is React, which buys real type, CSS effects and a DOM a test can read. It hosts
both the Chains tab and the Graph panel, so mount it only where it has a real size: `fit()`
frames to the host.

**The renderer does not live in this app.** It is `packages/ui-chains-react`
(`DomChains.tsx`) and the geometry is `packages/ui-chains`, because the médiathèque and the
decks draw the same view. This page stays here because st0 is the demanding host —
the command bar, the context menu and the edge inserts are all st0's — but the rules below
describe the package. See `packages/ui-chains-react/docs/hosting.md` for what a host has to
supply, and `packages/ui-chains/docs/graphBuild.md` for the layout half.

## The camera

Framing is the fiddliest part of this component, and every rule below is a bug already paid
for once. How the camera *moves* — that it is not React state, the frame loop, why a pan is
instant and a zoom glides — is the package's own
[camera.md](../../../../packages/ui-chains-react/docs/camera.md).

- **`fitKey`, not the graph object.** The graph is a fresh object on every refetch, so
  keying the fit on it throws away the user's pan and zoom whenever they bypass a module or
  edit a chain. `fitKey` identifies *which* graph is on screen: a change re-frames, a
  redraw of the same one leaves the camera alone. A surface that always shows the same graph
  omits it and frames once, on first paint.
- **`fitted` vs `userMoved`.** These are deliberately separate. The host keeps changing size
  for a while after the first successful fit — the sidebar appears once `useIsMobile`
  settles, panels mount, the splitter moves — and framing to a viewport that no longer
  exists leaves the graph parked outside the visible area, typically below the fold. So the
  resize path keeps re-framing while the camera is still *ours*; re-framing is only rude
  once the user has panned or zoomed. Gating on `fitted` alone stops at the first fit and
  leaves the graph mis-framed.
- **`fit()` returns whether it framed anything.** Before the host has a size, or the graph
  has extents, there is nothing to fit and the caller must try again rather than count it as
  done. The extents check is `isFinite`, not truthy: an empty dagre layout reports
  `-Infinity`, which passes a `!graph.width` check, produces an Infinity translation and
  *still* returns true — so the view marks itself framed over nothing and never frames the
  real graph when it arrives. `buildGraph` normalises that to 0; this check is the belt.
- **The camera persists between mounts.** The graph is unmounted whenever its pane is
  hidden (a `display:none` host has no size), which would otherwise discard pan and zoom on
  every switch between the layout and a fullscreened pane. The owner holds the ref;
  this component reads it once on mount and writes it back whenever the camera is placed or a
  gesture settles — but **only once a fit has actually happened**. The pre-fit value is the
  identity camera `{0,0,1}`, and saving
  that is indistinguishable from a camera the user chose: the next mount would read it, skip
  the fit, and draw at 1:1 from the origin.
- Framing a chain the user picked in the sidebar counts as their choice too, so a later
  resize must not throw it away.

### Framing a track from outside

`ChainsTab`'s `focus` prop is how another pane says "show me this track" — today the timeline,
when a header is double-clicked (see `timeline.md`). The set framed is the one the Graph panel
draws, `subgraphForTrack`, so a send that leaves the track's own chain is inside the frame too.

Two rules make it behave, and both are the camera rules above seen from the other side:

- **Once per focus, counted by a nonce.** Not by depending on the layout: the graph is re-laid
  out after every command, and re-framing on each would take the camera off wherever it had
  been panned since. The nonce is also what lets the *same* track be picked twice and re-frame,
  which a bare id could not.
- **It waits for the pane.** A hidden canvas is unmounted and has no size, so the fit is held
  until the pane is visible rather than framed to zero. Following a track therefore still holds
  when you arrive at the chains view a minute later.

The count of chains found goes back to the host (`onFocused`), because a track wired to nothing
has to say so: a graph that merely looks unchanged reads as the gesture having missed.

## Values, overrides and reconciliation

A widget shows, in order: the hand's **optimistic override**, else what the **engine**
reports (which already folds in any authored override), else what the **project** authored,
else nothing. Undefined means "unknown" and paints as an empty control.

When a plugin frame lands, the overrides it now speaks for are dropped — except the one
under the hand: the commit reconciles, then the frame owns the value.

**The two halves live at different heights, and that is the point.** The override map is the
graph's, held at the root: it is the hand's, and the hand is one. The engine's value is each
**widget's own** — every control subscribes to its plugin and re-renders when *its* number
moves. A root holding the whole param map would re-render every node on one plugin's frame;
with N strips each carrying a plugin, and the engine sending one message per plugin ~20×/s,
that is quadratic in the number of strips, which is what makes the mixer heavy on a song with
many tracks. See `@studio/engine-browser`'s `docs/params.md`.

Two consequences worth knowing. The reconciliation above is driven by a store subscription
rather than a render, and it returns the override map **unchanged** when it drops nothing — a
fresh object re-renders the graph on every frame purely to say nothing has changed, which
doubles the rate for no work. And an event handler (a drag starting, a toggle
tapped) reads the engine's value from the store at call time rather than from the last paint,
which is the more correct reading of the two.

Three things deliberately opt out of optimism:

| what | why |
|---|---|
| **mute/solo/arm** | the track file (and, for arm, the engine) is the source of truth, so it waits for the real value on the track-controls channel. This is what stops a rapid double-click leaving the button inverted against the file. |
| **bypass** | it changes the graph's *shape*, so it must reload — see below |
| **a library pick** | a convolver loads its IR when the plugin is *built*, so there is nothing to patch in a running engine and the picture has to come back from a reload |

### The quiet path is not for everything

Knob drags go through `App.quietCommand`, which runs the backend command but deliberately
never bumps `reloadKey`. Bypass and library picks must **not** use it: without a reload the
click lands on disk and in the engine while the picture stays frozen. Bypass is also sent as
a bare `node bypass` toggle, so the button need not know the current state and two fast
clicks cannot race the file.

Live parameter sends are coalesced to one per frame, and only a plugin param feeds live — a
track knob persists on release only.

## Drawing

**Cables are coloured by what they carry** — blue midi, orange audio, green video — live or
not, so the signal path reads at a glance and you can see where midi becomes audio. Tinting a
*live* cable instead would make every signal look like audio the moment it started moving,
exactly when knowing what it carries matters most. The wobble (a
travelling sine wave, amplitude in world units so it scales with zoom) already says "live".
Colours are muted rather than saturated: cables run behind the nodes and there are a lot of
them.

The signal cables are drawn on a **canvas**, not in the DOM: a rippling `<path>` re-parses its
`d` and re-records a whole WebRender blob every frame, which is most of the cost of playback
in st0. The canvas sits outside the panned element and takes the camera on its context instead,
so it never goes blurry. What stays in SVG is what does not move — the labels, the automation
arrows, the hit paths. The ripple runs only while a cable is live, and well below the screen's
refresh rate; a camera move redraws at once, in step with the pan. See
`@studio/ui-chains`' `docs/wobble.md`.

Stroke width grows as the camera pulls back, so on-screen thickness stays roughly constant
instead of thinning to nothing.

**Text is sized in world units**, so it scales with the camera: a node that is tiny on
screen still shows a name as large as it can hold. `fitText` is width-bound by glyph count
with a margin, then capped by height, and floored so it never vanishes.

**Far LOD**: past a zoom threshold the widgets are hidden — unreadable at that size — and
the whole card becomes the node's name, sized to fill it, since the header's 12.5px name
would be sub-pixel. Selection, dimming and the tap/context handlers all still apply.

**The armed-track input meter** is a thin red bar pinned to a track node's bottom edge. It
owns its own subscription to the engine store (`useInputLevel`), so a moving input
re-renders only that ~4px bar and never the node or the graph around it — the node passes a
stable `trackId`/order and never touches the meter. It renders null unless the track is
record-armed, and it is present at every LOD so an armed track reads as "recording this" at
any zoom. The faint track behind the fill keeps the bar visible at silence.

A node with no widget grid still draws the same header+content shape as every other node and
says what is not there, rather than collapsing to a header-only stub. A flagged module says
*why* — `missing`, `stub`, `unknownPlugin`, `notSupported` — in the space the "No Options"
non-answer occupied, in red, because it is a fault rather than a property of the module.

## Interaction

A control never selects the node: draggable widgets swallow the trailing click and tap
widgets handle it, while an inert widget (a label, a meter, a knob nothing can drive) lets
the click fall through to node selection.

A press on a button must be kept off the pane the same way a widget's is. Otherwise it arms
a pan, the slightest drift slides the world out from under the cursor, and the `pointerup`
lands somewhere else — the click then resolves to the common ancestor (the node, or the
canvas under the overhanging half) instead of the button.

Window-level pointer listeners are bound once and read the latest callbacks through refs, so
they never re-subscribe. A movement threshold is what keeps a pan from also selecting.

### Moving a card, and where dagre still rules

Drag any node's header and it goes where you put it: written to graph.yaml's `positions:` by
`graph move` (the drop runs the verb outright, like the cable's landing). Everything that
can be added to the graph IS a node — a module, a track, a curve, the sink — and every node is
addressed by one name: its chains name, a curve by its curve id, the sink by `OUT`. A curve draws
one card per BINDING, not one per curve — the node id is `crv:<curve>@<module>:<param>` — because
an envelope's event input is per-binding, and one card could not say "fired by the drums here and
by the synth there". The layout
places only what has no pin: dagre owns every NEW module and everything nobody moved,
which keeps its "never hand-roll layout" rule intact — a pin is not routing, it is somebody's
answer overriding the ranker's for one card. The mixer row ignores pins entirely (a strip
dragged out of the line would put a console's channel wherever it last was), and the graph
panel honours them, so a module sits in one place whichever pane is looking.

**Zoomed out, the whole card is the handle.** Past the widget threshold a node draws as its
name alone and has no header to grab (`Node`'s far branch) — so the card itself takes the
press, and the pin gesture is the same one. It has to be: the zoom you move a card at is the
zoom you can see where it is going, and a graph you must zoom INTO to rearrange is one that
stops answering exactly when the arrangement is the question. A drag that travelled swallows
its trailing click at either zoom, so nudging a card does not toggle the selection under
the hand.

**Above the first track is a place like any other.** A pin may be negative on either axis:
you drag a card up past the top row and it stays there. Nothing clamps to `0,0` — not the drop,
not `graph move`, not a node's birthplace — because a clamp sticks a card dragged upward to the
edge and slides it sideways under the hand: a camera fit framing `width × height` from the
origin puts everything above it outside every frame the camera can be asked for. The layout
reports where the drawing BEGINS as well as how far it reaches (`LaidOutGraph`'s `left`/`top`,
both ≤ 0 and both 0 for a graph nobody dragged), and the fit frames that box.

**A new node is born under the cursor.** The graph's create flows carry the click's world
point into the verb itself — an optional trailing `x,y` on `node new` and `node insert` — and the
handler pins the node there in the same undo step. On the bare canvas that is the whole of it:
`node new` both creates and places, so the shell has nothing to run after it unless the pick
carried a point, in which case it sends one `graph move`. The comma spelling is what makes the
token unmistakable for a ref or a node name, and the point is passed through UNCLAMPED — the
paragraph above is the reason, and a `Math.max(0, …)` on the way out of the shell was quietly
undoing it for every click above the first lane.

**A typed line has no cursor, and the verb answers for it** rather than handing the node to
dagre: spliced, it is born halfway along the cable it was spliced into; wired to nothing, at
`0,-30`, just above the origin. Both are in [verbs.md](../../../../packages/commands/docs/verbs.md),
and the reason is that a fresh layout has least to say about exactly these two cases — an
unconnected node has no run to be ranked within, so it lands wherever the pass happens to put it
and the person who typed the line has to go looking. dagre is still the fallback for anything
neither the cursor nor the arrow can answer, never the boss of a node somebody placed.

**An edit never reorganizes the picture.** Re-ranking the whole graph on the reload after a
cable is pulled makes every card jump, which reads as the delete scrambling the view. Both hosts
keep a session memory of where every node was DRAWN (`prevLaid`, handed to `layout()` as
`prev`): dagre still runs on each layout, but its answer lands only on nodes it has never
placed. Precedence is pin > held > dagre — the file outranks the session, since another tab
may have written a pin. `graph organize` is the ONE reorganizing operation: it clears
`positions:` in the file, the shell bumps `organizeKey` so the hosts drop their held
positions in the same breath (or the command would visibly do nothing), and dagre lays out
everything once, deliberately.

### The patch cable

**Drag out of a free output jack and release over a free input** of the same signal, and the
shell runs `graph chain connect <from> <to>` outright — both ends were named by the gesture, so
there is nothing for the bar to ask. **Or click the two jacks in turn**, which is the same
gesture with the button released in the middle: the cable stays in hand between them.

Both, and without a mode or a distance threshold to guess at, because the press ARMS and the
release LANDS — a release over the socket the press came from is what a click looks like to a
pointer, and lands nothing (`@studio/ui-chains/patchGesture`, and `packages/ui-chains/docs/cable.md`
for why a cable drawn on `click` makes the drag impossible).

Pressing an OCCUPIED jack lifts that cable's end
instead: land it on another jack and the shell runs `graph chain replug` (one end moved, one undo
step); drop it on the bare canvas and the arrow is deleted (`graph chain disconnect`) — a NEW
cable dropped there simply ceases. Esc or right-click puts everything back, writing nothing.
The gestures live in the renderer (`packages/ui-chains-react/docs/hosting.md` — `onConnect`,
`onReplug`, `onDisconnect`), armed here in `App.tsx` beside `onEdgeInsert`; the verbs and
their refusals — unknown node, arrow already there or not there, the sink as a source — are
`@studio/commands`', because the graph on screen can be a compile older than the file.

## Adding a module: what the wait is, and what covers it

Dropping a module on an arrow writes two files and then waits on a recompile. Measured on a
real song — 14 tracks, 58 clips, 30 plugins — the recompiles are the wait:

| | median |
|---|---|
| `loadProject`, behind `GET /project-doc` | 367 ms |
| `buildGraphDoc`, behind `GET /graph` | 401 ms |

Neither of those is paid by the client after the reply. The command's own `h.reload()` calls
`cachedProjectDoc`, so the project doc is re-parsed and re-cached *inside* the command and the
client's `/project-doc` fetch is a cache hit: the 367 ms is real, but it is paid before the
reply.

`POST /command` builds the graph itself when the command moved the revision, and returns it.
The 401 ms is spent inside a request the client is already waiting on, and the canvas redraws
when the reply lands rather than a fetch and a parse later — a client left to fetch `/graph`
afterwards sits on the old picture for a round trip plus 401 ms with nothing to explain it.
Two things fall out of it: `graphDoc()` fills the service's `graphCache`, so a host that
ignores that field — pl8 — finds a warm cache on its next `GET /graph`; and keying it on the
revision keeps non-writing commands (`transport play`) as cheap as they are.

### The placeholder is a one-shot, and so is the seed

Two rules, each of which reads as "the spinner is wrong" when it is broken:

- **The pending marker is consumed.** `App.tsx` arms `pendingInsert` when the module is
  picked and `runCommand` clears it as it takes it. Left armed, every later
  command draws a placeholder on that same stale arrow, so the spinner belongs to the
  transport key you pressed afterwards, not to the module you added.
- **The seed is taken once.** The graph from a command carries an id, and the canvas records
  the highest it has drawn. A reload from anywhere else — a poll, another tab, the undo
  journal — must re-fetch rather than redraw a graph already on screen. Pairing it with the
  reload key instead would mean keeping a counter in step with the half-dozen places that
  bump it.

The engine's own apply still follows, so audio catches up a moment after the picture. That is
the right order: the click was about the graph.

## Zooming: wheel, trackpad pinch, two fingers

The camera scales about a point in host coordinates, and three gestures reach that one piece of
arithmetic (`zoomAround`) — the anchor is what reads as a bug when it drifts, the graph sliding
out from under the cursor instead of growing around it.

A wheel notch reports a delta in the hundreds, and `0.001` turns that into ~10% a notch. A
trackpad pinch arrives as Ctrl+wheel with small continuous deltas, where that same coefficient
gives a fraction of a percent each — the "very slow" of two fingers on a trackpad. It gets ten
times the coefficient (`wheelZoomFactor` in `@studio/ui-chains/zoomGesture`, tested there), which
leaves the wheel untouched.

### A wheel and a trackpad send the same event and mean opposite things

A plain wheel **zooms**; two fingers sliding on a surface **pan**. They arrive as the same
`wheel` event, so the two are told apart rather than legislated over — `isMouseWheel` in
`camera.ts`, tested there. Three signals, most reliable first: a `deltaMode` of lines or pages
(only a real wheel is reported that way); the legacy `wheelDeltaY`, which a mouse reports in
multiples of 120 and a trackpad does not — this is what separates a Mac trackpad from a Mac
mouse, and nothing standard does; failing both, the delta's shape, a notch being integral,
vertical only and large where a finger's is small and often fractional.

It is wrong in one direction only, on purpose. An unrecognised device is read as a **surface**:
a trackpad that zooms when you meant to pan is a broken trackpad, while a mouse that pans is
merely a mouse that does not zoom yet. Mobile
never reaches any of this — a touchscreen sends touch events, handled below.

### The mixer row navigates differently, because it IS a row

While the graph is arranged as a row (`row`, from the mixer view), the wheel walks **along** it
instead of zooming, and nothing pans vertically — dragging included. There is one line of cards
and everything above or below it is empty, so a gesture that could slide the line off the top
has one useful direction out of two. A mouse has no horizontal delta to offer, so its notch
drives x here; the cards, the cables and the zoom itself are untouched.

Two fingers on a touchscreen are read from touch events rather than through the pointer flow:
that flow drives node drags, widget drags and cable draws, and a second finger arriving mid-drag
would be read as a second drag. Here the rule is simply "two fingers means zoom" — the pan in
progress is dropped, and the gesture is measured from the camera it STARTED on.

`.dgx` carries `touch-action: none`. This surface pans and zooms itself and scrolls nothing, so
there is nothing to hand back to the browser; without it a one-finger drag scrolls the page and
cancels the pan mid-gesture, and two fingers zoom the page instead of the graph.
