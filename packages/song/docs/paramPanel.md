# Generating a panel from a plugin's parameters

A module that is the face for an engine plugin has nothing on its panel until somebody draws one.
`paramPanel(params)` builds the whole thing: every parameter bound to a widget carrying its real
range, grouped into tabs.

**Every parameter, deliberately.** The alternative — a panel of the interesting ones — is a
judgement about a plugin nobody here has heard, and the parameters nobody thought interesting are
exactly the ones somebody will come looking for.

## Two signals, and which one speaks for a given param

| signal | example | what it says |
|---|---|---|
| a trailing number | `Tune 1`, `Pan 1` | WHICH ONE of a repeated thing |
| a shared leading word | `Filter Freq`, `Filter Type` | WHAT it is |

**The number wins**, among params that have one. The alternative is what proves it: reading the
word first makes a tab of `Tune` holding `Tune 1..4`, another of `Pan` holding `Pan 1..4` — a page
per *control* instead of a page per oscillator, which is the wall of knobs turned on its side.

The word then speaks for everything left, when at least `FAMILY_MIN` (3) params share it and it is
not the whole name — a tab called `Volume` holding one knob called `Volume` is a click that shows
you what its own label already said.

A panel of fewer than `TABS_MIN` (12) params comes back **flat**. Tabs exist to stop a wall; nine
knobs fit on screen, and filing them behind three clicks hides two thirds of them.

## What a numbered tab is called

Its number. `Tune 1`…`Pan 1` are plainly one oscillator and "Osc 1" is what a person would write,
but **nothing in the parameter list says `osc`** — a label invented here would be this code
claiming to know a plugin it has never seen. The tab repeats the plugin's own naming.

## What names cannot do

Measured on 4OSC, the richest thing the engine ships. Its built-in effects register with **no
prefix at all**:

| effect | its parameters |
|---|---|
| reverb | `Size`, `Damping`, `Width`, `Mix` |
| delay | `Feedback`, `Crossfeed`, `Mix #2`, `Delay` |
| chorus | `Speed`, `Depth`, `Width #2`, `Mix #3` |

Nothing in those names says which effect they belong to. The ` #n` is Tracktion **deduplicating**
three params called `Mix` — proof they are unrelated, which is why a dedup suffix is excluded from
forming a family. They land in the remainder, and that is the honest answer.

The same limit, from the other side: 4OSC's two LFOs and two mod envelopes use bare stems over the
same `1..2` its oscillators use, so page 1 holds oscillator one **and** LFO one **and** envelope
one. `Rate 1` says which one, never which kind.

The only other signal is registration ORDER, and it says where a run begins and never where it
ends. What is *not* acceptable is a table of 4OSC's layout hidden inside a generic function: right
for this plugin, a lie for the next, and nothing saying which.

## The widget

A **dropdown** when the plugin named its settings (`Wave Shape` → None, Sine, Triangle…), a
**knob** otherwise, carrying the parameter's real `min`/`max`.

Nothing infers a toggle from a `0..1` range: that would draw a switch over every mix control on
the panel. A parameter is a knob unless the plugin itself said it has named states.

## Who calls it

**st0's Modules tree**, in two places:

- *Nouveau module depuis un greffon…* — the face and its panel are written together, so a module
  that exists only to carry a `ui.yaml` arrives carrying one.
- *Redessiner le panneau depuis le greffon* — on a module that already has a face. This is the one
  that matters at the scale of the ask: two hundred plugins is not a number anyone works through
  knob by knob, and every face drawn before this was drawn by hand or not at all. It **overwrites**,
  and asks first — re-running it after a Tracktion bump is how a panel gains the knobs a new
  version added, and a hand-arranged layout is exactly what it would replace.

Both go through `writeUiFile("")`, the writer the builder's own grid saves through, so a generated
panel and a drawn one are the same file — one line per widget, in the shape these files already
have by hand.

An EXTERNAL plugin gets nothing and no error: the panel it always had, empty, and the builder opens
on it as before. "This VST has no parameter list yet" is a fact about the scan rather than a
failure of the click.

## Where the parameters come from

`BUILTIN_PLUGINS`, generated from a real instance of every built-in the engine can create — see
[engine/moteur/docs/builtinParams.md](../../../engine/moteur/docs/builtinParams.md). An external
plugin's list needs the same treatment and does not have it yet: the scan cache
(`~/.studio/exts.json`) carries a plugin's name, format and category and **no parameters**, so a
VST's panel cannot be generated until the engine dumps them the way it dumps the built-ins'.
