# Auto organize — a panel proposed from the names

**Auto organize** replaces the panel with one drawn from the parameter list alone: every
parameter gets a widget, the widgets are sorted into the panel's tabs, one per family, and
which tab a parameter lands on is guessed from **its name and nothing else**.

It exists because of a real shape. Arturia's Piano V3 publishes 151 parameters. There is no
arrangement of dragging 151 rows onto a grid that is a reasonable afternoon, and there is no
panel worth having that omits them silently. So the builder proposes one and you edit it —
which is the only honest contract a guess can offer.

Its sibling, **AI organize**, asks Claude to *design* a panel instead of sorting one, and is the
host's to offer (`aiOrganize.md`). This one stays: it is instant, free and needs no key.

`autoLayout.ts` is pure and `autoLayout.test.ts` is where the guess is pinned. The grid does
not know how the guessing works, and the guessing does not know there is a grid.

## The families are an ORDERED table

One table, `FAMILIES`, of a page name and a pattern. The first pattern that matches a
parameter's name takes it; anything nothing claims goes to **Other**.

The order is the algorithm. Almost every hard case is one word two families want, and the
specific family has to ask first:

| name | goes to | because the other reading is |
|---|---|---|
| `Comp Make Up gain` | Dynamics | a level |
| `Low Shelf Gain` | EQ | a level |
| `Bell Freq` | EQ | a filter |
| `Comp Attack` | Dynamics | an envelope |
| `Reverb Decay Start` | Reverb | an envelope |
| `Reverb Dry/Wet` | Reverb | the panel's mix |
| `Navigate through filters` | Preset | an audio filter |
| `Pitch Transpose` | Tuning | MIDI — only `pitch bend` is MIDI, never a bare `pitch` |

Each of those pairs is a test. Reordering the table to fix one silently rehomes the others,
and nothing on screen would say so.

Names are matched **lowercased with `_` and `-` read as spaces**, so `MPE_PitchBend_3` and
`Pitch Bend` are the same string to look at.

## Preset and MIDI lead, and are then left out

A modern instrument publishes dozens of parameters that are not sound. Piano V3 alone has
sixteen `VST_ProgramChange_*`, sixteen `MPE_PitchBend_*`, sixteen `MPE_Aftertouch_*` and a whole
KeyLab remote — `Select Preset`, `Browse Back`, `HardwareDisplayControl1..8`, `Undo the last
action`. Left among the knobs, each is a knob nobody will ever turn sitting where a real one
could have been.

So they are **matched in order to be skipped** — those families carry a `drop` flag, and
`groupParams` never opens a page for them. Two of the proposal's dozen pages spent on program
changes and browser navigation is the wrong answer to "a hundred and fifty parameters and
nowhere to put them".

Matched rather than simply unmatched, because the two are not the same: an unmatched name falls
into **Other**, where it is plumbing nobody recognised sitting beside `String Tension`.
`familyOf` still names them `Preset` and `MIDI`, `isPlumbing` is the predicate, and the pinned
collisions above (`Navigate through filters`, `Pitch Transpose`) still mean what they meant.

Nothing is lost by it. The params list offers every parameter the module has, plumbing included,
and a panel that really does want a preset button is one drag away from one. A plugin that
publishes **nothing but** plumbing gets an empty grid rather than a page of it — which is what
that plugin honestly has to show.

## The `@` namespace is matched first — and all but one of it is dropped

The intrinsics — `@pan` `@mute` `@solo` `@arm` `@gain` `@monitor` `@base` — are matched
**first**, because `@pan` reads as a mixer word to every word test there is and `Mix` would take
it. The engine's stage — `@input-volume`, `@mix`, `@output-volume` — is the exception: it IS the
module's mix corner, and takes it. The params list offers them on every module, whatever plugin it holds.

They are the module's own controls rather than the plugin's, and that is exactly why they are
**left out** (`TRACK_PAGE`, a third `drop` family beside `Preset` and `MIDI`). The reason differs
from those two, though, and the difference is the whole argument: `Preset` and `MIDI` are
plumbing nobody turns, while these are controls somebody turns constantly — and every one of them
is **already drawn**, by the strip the mixer shows for that lane. A proposal that repeats them
puts a second fader on screen wired to the first, and nothing on the panel can say which of the
two is the real one.

Nothing is lost: the params list still offers all of them, so a panel that really does want its
own mute button is one drag away from one.

## `@base` is the exception, and `General` holds it alone

`@base` names no strip control, and nothing else on screen draws it. It names the `.vstpreset`
the plugin is **built from** (`@studio/song`'s `docs/userPresets.md`), so every parameter on every
other page is describing that choice.

So it takes the front page, by itself. The panel opens on it for the reason it is drawn first —
a proposal that opened on the eighth reverb parameter would have put the one thing you always
want behind eleven you sometimes do — and it is alone there because a page is a place to look for
a control, and a page holding the one thing the rest hangs off says what it is at a glance.

`^@base$` is anchored rather than a prefix: a plugin parameter called `@base_mix` would be the
plugin's, not the intrinsic.

**A module with no bases has no `General` page at all.** A page holds only what got something,
and this one has one candidate — so a plain effect opens on its own first family. That is
also what keeps `@base` first wherever it is: it leads its page in both shapes.

`General` is drawn FIRST, like every other page, so there is no `tail` flag anywhere. The pages
are named in English like the rest of the table — one language per tab bar, and the other eleven
are `Reverb`, `Filter`, `Envelope`…

## The module's own blend closes `Mix`

Where the engine offers `@mix` — on every effect — `@mix` IS the blend, and the plugin's own dry,
wet or mix is left out altogether: the engine holds those at full wet
(`engine/k7-runtime/docs/mix.md`), so a knob on one would do nothing. What follows is the rule for a
module the engine offers no `@mix` on.

A bare `Mix`, `Dry/Wet`, `Dry` or `Wet` is placed **last on its own page**, after everything
else, the way an output stage ends a hardware strip. It is not pulled onto `General`, which is
`@base` alone: `isBlend` decides a position, never a page.

What makes one "the module's own" is the **family, not the word**. `Reverb Dry/Wet`, `Delay Mix`
and `Chorus Wet` all carry a blend word, and the effect families ask before `Mix` does — so a
blend word still sitting in `Mix` at the end is one no effect claimed. `isBlend` is that test in
one line, and there is no second list of effect names to keep in step with the first. Several
stay together, a `dry` and a `wet` being two halves of one control.

## What it draws, and where — both shapes at once

The proposal is a panel in its **two shapes** (`layouts.md`), laid out from the same pages:

- **horizontal**, the panel itself: two **slot** rows a page, so four cells tall, as wide as the
  biggest page needs and at most `AUTO_PER_ROW` (six) slots across. A family with more than twelve
  parameters is **wrapped** onto `Filter 2`, `Filter 3`… rather than made taller;
- **vertical**, when the panel is wider than four cells: two slots a row, four cells wide, as tall
  as the page needs, the same pages in the same order.

The pages are the panel's **tabs**, one per family (or per wrapped part), each laid out from row
0; a proposal with a single page writes no `tabs:` at all, since one tab is no tab. The proposal
has no empty row under it: a spare row does not fit in four, and the grid editor resizes as it
drops.

A parameter gets a **slot** rather than a cell: `KNOB_SPAN` × `KNOB_SPAN`, which is 2×2. A
dropdown takes the slot's width and not its height — it is one row of text with nothing to put
under it, where a knob is a dial with its label beneath.

**Only here.** A knob added from the palette, or made by dropping a parameter on bare grid, is
still one cell: those are single deliberate gestures onto a grid whose shape the author already
has in mind, and making one bigger is a drag. This function places a hundred and fifty at once
onto a grid it sizes itself, which is the case that needs an opinion about how big a knob is.

Widget kinds are the same three a **dropped** parameter gets in `WidgetGridEditor.createBound` —
a parameter with named settings becomes a dropdown, everything else a knob — so a panel you
auto-organise and a panel you drag by hand are made of the same widgets. A two-setting parameter
is a case for a toggle and is still a dropdown: the dropdown sends the value the plugin named,
and a toggle would have to guess which of the two 0 and 1 mean.

Each widget carries the parameter's own range, so the panel opens the same with no engine
running.

## It replaces, and asks first only when there is something to lose

A module whose panel is still empty is the case this exists for — a plugin just scanned, a
hundred and fifty parameters and nowhere to put them — and a confirmation there is a question
with one answer. Over drawn work it is a different act: the grid has no undo of its own, so
that one asks.

The result lands in the buffer like every other builder edit. Nothing is on disk until **Save**.
