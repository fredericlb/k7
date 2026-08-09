# The chains graph (`@studio/ui-chains-react`)

The routing graph, drawn as HTML nodes plus an SVG cable layer. It consumes the same
laid-out graph the old Pixi renderer did — dagre still owns the layout — and only the
*drawing* is React, which buys real type, CSS effects and a DOM a test can read. It hosts
both the Chains tab and the Graph panel, so mount it only where it has a real size: `fit()`
frames to the host.

**The renderer no longer lives in this app.** It moved to `packages/ui-chains-react`
(`DomChains.tsx`) once the médiathèque and the decks wanted the same view; the geometry moved
with it, to `packages/ui-chains`. This page stays here because l8 is the demanding host —
the command bar, the context menu and the edge inserts are all l8' — but the rules below
describe the package. See `packages/ui-chains-react/docs/hosting.md` for what a host has to
supply, and `packages/ui-chains/docs/graphBuild.md` for the layout half.

## The camera

Framing is the fiddliest part of this component, and every rule below is a bug already paid
for once. How the camera *moves* — that it is not React state, the frame loop, why a pan is
instant and a zoom glides — is the package's own
[camera.md](../../../../packages/ui-chains-react/docs/camera.md).

- **`fitKey`, not the graph object.** The graph is a fresh object on every refetch, so
  keying the fit on it threw away the user's pan and zoom whenever they bypassed a module or
  edited a chain. `fitKey` identifies *which* graph is on screen: a change re-frames, a
  redraw of the same one leaves the camera alone. A surface that always shows the same graph
  omits it and frames once, on first paint.
- **`fitted` vs `userMoved`.** These are deliberately separate. The host keeps changing size
  for a while after the first successful fit — the sidebar appears once `useIsMobile`
  settles, panels mount, the splitter moves — and framing to a viewport that no longer
  exists leaves the graph parked outside the visible area, typically below the fold. So the
  resize path keeps re-framing while the camera is still *ours*; re-framing is only rude
  once the user has panned or zoomed. Gating on `fitted` alone (the old guard) stopped at
  the first fit and left the graph mis-framed.
- **`fit()` returns whether it framed anything.** Before the host has a size, or the graph
  has extents, there is nothing to fit and the caller must try again rather than count it as
  done. The extents check is `isFinite`, not truthy: an empty dagre layout used to report
  `-Infinity`, which passed a `!graph.width` check, produced an Infinity translation and
  *still* returned true — so the view marked itself framed over nothing and never framed the
  real graph when it arrived. `buildGraph` normalises that to 0 now; this is the belt.
- **The camera persists between mounts.** The graph is unmounted whenever its pane is
  hidden (a `display:none` host has no size), which would otherwise discard pan and zoom on
  every switch between the studio layout and the dedicated view. The owner holds the ref;
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
under the hand. Same idea the old `render.ts` used: the commit reconciles, then the frame
owns the value.

**The two halves live at different heights, and that is the point.** The override map is the
graph's, held at the root: it is the hand's, and the hand is one. The engine's value is each
**widget's own** — every control subscribes to its plugin and re-renders when *its* number
moves. Before, the root held the whole param map, so one plugin's frame re-rendered every
node; with N strips each carrying a plugin, and the engine sending one message per plugin
~20×/s, that was quadratic in the number of strips, and it is what made the mixer heavy on a
song with many tracks. See `@studio/engine-browser`'s `docs/params.md`.

Two consequences worth knowing. The reconciliation above is now driven by a store
subscription rather than a render, and it returns the override map **unchanged** when it drops
nothing — a fresh object was re-rendering the graph on every frame purely to say nothing had
changed, which doubled the rate for no work. And an event handler (a drag starting, a toggle
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
a bare `module bypass` toggle, so the button need not know the current state and two fast
clicks cannot race the file.

Live parameter sends are coalesced to one per frame, and only a plugin param feeds live — a
track knob persists on release only, matching the old renderer.

## Drawing

**Cables are coloured by what they carry** — blue midi, orange audio, green video — live or
not, so the signal path reads at a glance and you can see where midi becomes audio. An
earlier version tinted a *live* cable orange, which made every signal look like audio the
moment it started moving, exactly when knowing what it carries matters most. The wobble (a
travelling sine wave, amplitude in world units so it scales with zoom) already says "live".
Colours are muted rather than saturated: cables run behind the nodes and there are a lot of
them.

The signal cables are drawn on a **canvas**, not in the DOM: a rippling `<path>` re-parsed its
`d` and re-recorded a whole WebRender blob every frame, which was most of the cost of playback
in l8. The canvas sits outside the panned element and takes the camera on its context instead,
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

## Adding a module: what the wait is, and what covers it

Dropping a module on an arrow writes two files and then waits on a recompile. Measured on a
real song — 14 tracks, 58 clips, 30 plugins — the recompiles are the wait:

| | median |
|---|---|
| `loadProject`, behind `GET /project-doc` | 367 ms |
| `buildGraphDoc`, behind `GET /graph` | 401 ms |

Of those two, the client used to pay the **graph** one after `POST /command` had already
returned: the canvas sat on the old picture for a round trip plus 401 ms, with nothing to
explain it. Not both — an earlier version of this page said both, and that was wrong. The
command's own `h.reload()` calls `cachedProjectDoc`, so the project doc is re-parsed and
re-cached *inside* the command, and the client's `/project-doc` fetch is a cache hit. The
367 ms is real, but it is paid before the reply, not after it.

`POST /command` now builds the graph itself when the command moved the revision, and returns
it. The same 401 ms is spent, but inside a request the client is already waiting on, and the
canvas redraws when the reply lands instead of a fetch and a parse later. Two things fall out
of it: `graphDoc()` fills the service's `graphCache`, so a host that ignores the new field —
m9, v1 — finds a warm cache on its next `GET /graph`; and keying it on the revision keeps
non-writing commands (`transport play`) exactly as cheap as they were.

### The placeholder is a one-shot, and so is the seed

Two rules, both of which were broken and each of which reads as "the spinner is wrong":

- **The pending marker is consumed.** `App.tsx` arms `pendingInsert` when the module is
  picked and `runCommand` clears it as it takes it. Left armed — which it was — every later
  command drew a placeholder on that same stale arrow, so the spinner you saw belonged to the
  transport key you pressed afterwards, not to the module you added.
- **The seed is taken once.** The graph from a command carries an id, and the canvas records
  the highest it has drawn. A reload from anywhere else — a poll, another tab, the undo
  journal — must re-fetch rather than redraw a graph already on screen. Pairing it with the
  reload key instead would mean keeping a counter in step with the half-dozen places that
  bump it.

The engine's own apply still follows, so audio catches up a moment after the picture. That is
the right order: the click was about the graph.
