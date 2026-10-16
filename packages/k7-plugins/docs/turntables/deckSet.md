# The decks as document

`useDeckSet` owns what the two decks ARE — what is loaded, at what tempo, where the crossfader
and the six EQ knobs sit — and every gesture that changes one of them. It is called **once per
host**, above the view that draws the desk.

## Why not in the view

Because the host unmounts that view the moment you look at something else, and **a set does not
stop existing then**. State living in the view costs three things — one knot, three angles:

- the graph has no engine to ask, so its knobs show the number the file declares and nothing
  else;
- a round trip through the graph brings the crossfader back to centre and the EQs flat, while
  the sound stays where it was put;
- and the graph's tempo knob cannot be turned at all: stretching a track needs the loaded tracks
  and the compiled document, both gone with the view.

MixView **draws** the decks and owns none of them; its own are the set list, the waveform
envelopes and the track picker — things that do not survive the tab because they do not have to.

On the k7 side, `SurfaceTab` keeps the halves apart: hooks above a line, screen below, and the
component stays mounted as long as the project declares the surface. The rule in
`packages/song/docs/surfaces.md` about `view` surfaces ("drawn only while it is open") therefore
speaks about the DRAWING only.

## The two routes to the engine, always

| | crossfade, EQ | tempo |
|---|---|---|
| in the document | a real plugin | **nothing** (`offline`) |
| send | `set-plugin-param`, every pixel | the whole document, throttled to 120 ms |
| who knows the value | the **engine** (`deck.params`) | this hook (`deck.moduleParams`) |

That split explains everything else. The engine reports what a plugin is worth whatever surface
set it, so desk and graph read the same thing. For an `offline` module there is nothing to ask:
the value exists only on the surface that REALISES it, and this hook lends it to the graph.

## Turning the tempo from the graph

The graph knows a module and a parameter — all a node carries — and has no idea what a deck is.
`controlDriving` therefore reads the binding **backwards**: `views/mix.yaml` already says which
control drives `tempoA`'s `Target BPM`, and re-reading that same line the other way is what stops
the two surfaces diverging. Repoint `deckA.tempo` at `tempoB` and the graph's knob on `tempoB`
becomes deck A's, without either being told.

Only bindings **without a plugin** answer. One that has a plugin owns its own handle — the graph
sends `set-plugin-param` and never asks — and answering would give it two routes to the engine,
which is how a value ends up applied twice.

The graph does not announce the end of a gesture to its host, unlike a fader sending a
`pointerup`. The final commit is therefore **timed out** (`GRAPH_SETTLE_MS`): long enough not to
fall mid-drag, short enough that the exact value the knob was released at arrives quickly.

## What the HOST passes rather than what the hook reads

Two optional parameters, `mapping` and `playlist`, same reason for both: the DECLARATION is in
the host's file, and only the host knows which. An k7 surface carries its bindings in
`surfaces/<id>.yaml` and has no `views/mix.yaml` to find — reading it would 404 on every reload.
A host that passes neither lets the hook read `views/mix.yaml` itself.

`mapping` must have a **stable identity**: it is an effect dependency, so a fresh object per
render would redo the compile per render. Both callers hold it in state, which makes it free; a
caller building one inline must `useMemo` it.

`playlist` is a NAME, and a surface naming none passes `undefined`: nothing is read at all —
there is no path to ask for — and the picker says so, rather than showing an empty list that
looks like an empty media library.

## Putting a record on says nothing to the transport

A platter owns its record and is not somewhere on the timeline, so `putOn` has no transport
business and Play starts from zero as in any other project.

## What a STALE caller must still read correctly

The returned functions are captured by the views and called later. `measured` runs from the
closure of the render that fired the envelope request, several renders earlier.

Reading `loads` on that closure returns the document **without the track just put on** — a deck
that plays for a second then goes quiet. Same for the derivatives: the compile can land between
the click and the analysis coming back, so `measured` must resolve its bindings against the
project as it is NOW. Hence the refs (`loadsRef`, `fadersRef`, `derived`) and every send going
through `commitRef.current`: a ref is the same object at every render, so a stale caller reads
what is true at the instant it calls.
