# Freezing at a module

A freeze replaces part of the signal path with a **render** of what it was doing. The part is not
chosen by hand: you name one module, and what is frozen is **everything upstream of it, that module
included**.

That last clause is the whole definition. The render is taken at the module's OUTPUT, so freezing
the amp gives you the amped sound, not the sound going into the amp. Everything downstream stays
live — which is the difference between freezing and bouncing-and-replacing. You keep working on the
reverb after it; you stop paying for the twelve plugins before it.

## The shape on disk

One field, on the module the freeze was taken at:

```yaml
# nodes/amp.yaml
extends: "@workspace/audio/amp"
params: { Gain: 3 }
frozen: renders/amp.wav
```

`frozen:` is in `MODULE_FIELDS`, so an **alternative may carry its own** ([alternatives.md](alternatives.md)).
That is not incidental: two sets of settings are two sounds, and a render of one is not a render of
the other. Switching alternatives switches renders, or switches back to playing live.

The renders themselves live in `renders/` at the project root — one folder for the lot, not beside
the module's file. A node's folder is `nodes/`, shared by every node in the song, and a
catalogue module's folder is shared by every song that uses it; a render belongs to **this** project.

Freezing a module from a shared catalogue is refused outright for the same reason: writing `frozen:`
into `_modules` would freeze a reverb in songs nobody has ever rendered. Freeze the node instead.

## What is upstream

`freeze.ts` walks the derived chains as a graph of NODES — a lane or a chain step, indifferently,
because a freeze cuts *inside* a run: `[ lane, amp, cab ]` frozen at `amp` keeps `cab` live, and a
chain-level walk cannot say that.

The edges are: the lane (or feeding chain) into the first step, each step into the next, the run's
last node into each of its destinations, and every step's `in:` sources — a **side input** is signal
arriving, and signal arriving is exactly what a render bakes.

`upstreamOf` is the reverse-reachable set from the module, seeded with the module itself. It stops at
a cycle rather than looping on one: a graph that loops is `validate`'s business to report, and a
freeze should not be the thing that hangs on it.

## The one refusal

**Everything upstream must feed nothing outside the set.**

```
gtr ──► amp ──► OUT
  └───────────► OUT      # gtr also goes out dry
```

Freeze `amp` here and `gtr` is in two places at once: inside the render, and still playing on its
own path. You would hear it twice, at a level nothing on screen explains, and unfreezing would be
the only way to hear it once.

This is refused rather than guessed at. Silencing the other path takes away audio nobody asked to
lose; leaving it doubles a signal. The way out is in the message: **freeze at the point the two
paths meet** — there, both copies are inside the render and one file says everything.

A split that rejoins is fine, and the same rule says so: neither branch leaves the set.

The module's own destinations are exempt. Leaving is what a freeze point is FOR.

## What the compiler does

`activeFreezePlans` is the one door both readers go through — the compiler and the graph doc — so
what falls silent and what wears a badge cannot disagree. It also decides that a `frozen:` whose
render is **not on disk** is not a freeze at all: the song plays live.

That is deliberate. A render is a generated artifact, big and regenerable, and a project is very
often cloned without one. Failing the compile would lock you out of the very command that clears the
attribute.

For each plan (`nodeProject.ts`):

- lanes inside it lose their **clips** — their material is in the render, and playing it again would
  be the take twice;
- modules inside it lose their **plugins** — their processing is in the render too. Skipped at the
  top of the step loop, before the automations: a curve driving a plugin the document does not
  contain would bake breakpoints for an id nothing answers to;
- the render becomes the **one clip** of the track the frozen module compiles onto — the lane, for a
  point inside a lane's run; the bus's own return track, for a bus. One rule, both shapes.

The clip starts at bar 1 with `length: 0`, which is how the engine is told "the file's natural
length" — the right answer, since the render was bounced from this very song and already ends where
it ends.

## Making the render

`freezeUpstreamRender` (`@studio/commands`) cuts the compiled `ProjectDoc` down to exactly the plan —
those lanes, those plugins, the sends between them — and renders that whole, as a **mixdown**. Not a
per-track bounce: a freeze point may be a bus several lanes meet at, and the engine's `--freeze
--track` renders one track.

Nothing is neutralised by hand. Gain and pan are a `Mixer` **module**: upstream of the point it
belongs in the render, downstream it is not in the cut doc at all. What a per-track freeze would
have to flatten, the plan already answers.

The one exception is the **master**: the cut (`freezeCut`, `freeze.ts`) sends it neutral — no
master plugins, unity volume — because the render plays back THROUGH the master live, and baking
it in too applied it twice. The automatic VST freeze renders the same cut
([autoFreeze.md](autoFreeze.md)).

A **strudel** lane inside the set is refused: its pattern is endless, and the engine makes its
notes as the transport rolls, so there is no length a render of it could stop at.

## On screen

`WebGraph.frozen` is a map from node name to `"at"` or `"inside"`. Two words rather than a boolean,
because they mean opposite things about what a click does: the point can be thawed, and everything
inside it can only be reached by thawing that point. `"at"` wins where a node is both — it is what
the file says can be undone.

A frozen node wears a snowflake right of its module's name and a cold wash, and loses its on/off
block and its plugin-UI bubble:
there is no live plugin behind a baked module, so there is nothing to bypass and no window to open.
Its knobs are refused for the same reason — a param set sent to a plugin the engine never built
moves, changes nothing, and is discarded on the next reload.

The timeline's lane menu offers **Freeze** / **Unfreeze** on the point, and nothing at all on a node
inside somebody else's render: thawing that one means naming the module downstream of it, and an entry
there would name the wrong one.

## One verb for a lane and a reverb

A lane is a module ([trackModules.md](trackModules.md)), so one verb reaches a lane and a reverb
by the same name — and the thing you actually want to stop paying for, "everything before here",
is sayable. A freeze that only ever took one lane and its own modules cannot say it.

## Freezing without asking

A VST module is frozen automatically, the same way, while the engine is stopped — the module chosen
for you, the render named for its inputs so that any change plays live again. See
[autoFreeze.md](autoFreeze.md).

## The limit worth knowing

The compiled model is flat: a lane routed to a bus is compiled as a send, and its dry signal still
reaches the master. Live and frozen behave the same way, because the render is a mixdown of the same
compiled tracks — but if you freeze *mid-bus*, the modules after the point process a render that
contains that dry path too, where live they did not. It is the flat model's seam, not the freeze's;
the chains you author say nothing of the kind.
