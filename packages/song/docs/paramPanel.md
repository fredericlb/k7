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
| a trailing token ending in a digit | `Tune 1`, `Width Osc1` | WHICH ONE of a repeated thing |
| a shared leading word | `Filter Freq`, `Filter Type` | WHAT it is |

**The number wins**, among params that have one. The alternative is what proves it: reading the
word first makes a tab of `Tune` holding `Tune 1..4`, another of `Pan` holding `Pan 1..4` — a page
per *control* instead of a page per oscillator, which is the wall of knobs turned on its side.

The word then speaks for everything left, when at least `FAMILY_MIN` (3) params share it and it is
not the whole name — a tab called `Volume` holding one knob called `Volume` is a click that shows
you what its own label already said.

A panel of fewer than `TABS_MIN` (12) params comes back **flat**. Tabs exist to stop a wall; nine
knobs fit on screen, and filing them behind three clicks hides two thirds of them.

### Two spellings of one index, and the second is the one that matters

Tracktion separates the index — `Tune 1` — and every built-in reads that way. Real VSTs mostly do
not: Arturia writes `Width Osc1`, `Fine Tune Osc1`, `Amount FM1 Osc1`, gluing the index to a word.
Reading only the digits found **no families at all** in a 312-parameter plugin.

`familyToken` reads both, on one tell: **the last token ends in a digit**. A trailing `Osc1` is not
a control called Osc1, it is the first oscillator; `1` is the same statement with the noun left out.
Grouping on the whole token rather than on the digits keeps the tab named the way the plugin names
it — `Osc1` where it said Osc1, `1` where it said 1, which is the same rule as [what a numbered tab
is called](#what-a-numbered-tab-is-called) applied to a plugin that was more helpful.

### One knob is not a tab, and there is no ceiling on how many are

A tab holding a single knob is the click `FAMILY_MIN` refuses, arriving from the other end, so
anything under `TAB_MIN_PARAMS` (2) is folded into the remainder. ARP 2600 earns this by itself: it
names eight parameters `HardwareDisplayControl1`…`8` — a perfect family signal and eight tabs of one.

A **ceiling** on the tab count looked just as obviously right, and the measurement killed it. On the
same plugin (312 params):

| | tabs | `Général` |
|---|---|---|
| no folding | 49 | 68 |
| fold singles, cap at 12 | 13 | **193** |
| fold singles, no cap | 35 | 82 |

The cap does not remove knobs. It moves *named* ones — `Tracking1`…`4`, `Envelope1`, `Chorus`,
`Mix`, `Lag`, `Select` — into the one pile that has no name, and rebuilds three quarters of the wall
behind a single click. Thirty-five tabs on a plugin with three hundred parameters is what that
plugin **is**.

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

The redraw **says it is working before it waits**: an external plugin takes seconds to load, and an
action that goes quiet for that long reads as a lost click. A built-in answers in the same tick and
the message is never seen.

## Where the parameters come from — two places, and only one is free

| | built-in | external (VST, AU…) |
|---|---|---|
| source | `BUILTIN_PLUGINS`, generated and committed | one live instance, asked |
| cost | none — it is a table | **seconds**, per plugin |
| needs an engine | no | yes, and a reachable one |

A **built-in** is part of the binary, so what it has is the same on every machine and can be
written down once: `builtinParams.generated.ts`, 212 plugins and 957 parameters, dumped from a real
instance of each — see
[engine/moteur/docs/builtinParams.md](../../../engine/moteur/docs/builtinParams.md).

An **external** plugin cannot be, because *which VSTs exist* is a fact about one machine. Nor can
it be read off the scan: `~/.studio/exts.json` carries a name, a format, a category and the
binary's path, and **no parameters**, because a plugin registers its own in its constructor.
Nothing short of loading one and asking it will do.

So that is what happens, along this chain:

```
st0 (hosted)  →  that machine's file service  →  its engine, over the socket
   paramsForRef      GET /plugin-params            list-plugin-params
                     (engineLink.pluginParams)     → plugin-param-list
```

Three things about it are load-bearing:

- **The engine answers on an offline engine of its own**, opening no audio device, on a detached
  thread. Asking must not disturb what is playing — an ASIO driver is single-client.
- **The reply carries the format and the id back**, and the wait matches on them. It is broadcast
  to every socket, and the ask is slow enough that two overlap routinely; resolving on the first
  frame to arrive would write one plugin's knobs into another plugin's `ui.yaml`, silently.
- **`id` is the binary's path, never the display name.** Two plugins can be called the same thing;
  only the path resolves to one.

An empty list is a **real answer** — a plugin that publishes nothing — and is kept distinct from
"nothing answered" all the way up. The caller writes a file from it, so the two must not arrive
spelt alike.
