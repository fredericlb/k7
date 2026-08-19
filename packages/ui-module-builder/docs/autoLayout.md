# Auto organize — a panel proposed from the names

**Auto organize** replaces the panel with one drawn from the parameter list alone: every
parameter gets a widget, the widgets are sorted into the pages of a single tabs widget, and
which page a parameter lands on is guessed from **its name and nothing else**.

It exists because of a real shape. Arturia's Piano V3 publishes 151 parameters. There is no
arrangement of dragging 151 rows onto a grid that is a reasonable afternoon, and there is no
panel worth having that omits them silently. So the builder proposes one and you edit it —
which is the only honest contract a guess can offer.

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

So they are **matched in order to be skipped** — the two families carry a `drop` flag, and
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

## `General` is the front page

The `@` namespace — `@volume` `@pan` `@mute` `@solo` `@arm` `@gain` `@monitor` `@base` — is
matched **first**, because `@volume` reads as a level to every word test there is and `Mix`
would take it. It is also **drawn** first, and the panel opens on it.

Those are the module's own controls rather than the plugin's: the lane's, the input's, and
`@base`, which decides what the plugin sounds like at all. A proposal that opened on the eighth
reverb parameter would have put the one page you always want behind eleven you sometimes do.

So one order answers both questions and the table IS the tab bar, with `Other` last: it is where
the guess gave up, and a page of leftovers ahead of a page of reverb controls would say the
opposite of what the layout is for. (`General` used to be drawn last, under a `tail` flag, on the
argument that a plugin's panel should open on the plugin. The flag is gone with it.)

The pages are named in English like the rest of the table — one language per tab bar, and the
other eleven are `Reverb`, `Filter`, `Envelope`…

## `@base` takes the first row alone

On whichever page holds it, which is `General`. It is not a control like the others: it names
the `.vstpreset` the plugin is **built from** (`@studio/song`'s `docs/userPresets.md`), so every
knob underneath is describing that base. Sixth in a row of dials it reads as one more setting;
alone on the top line it reads as the choice the rest hangs off.

`placeGroup` is the whole of it, and a page without a base is laid out exactly as before, from
the first row down — the gap is spent only where it says something. The panel's height comes from
that placement rather than from a parameter count, since the page holding the base is one row
taller than its parameters alone would make it.

## …and the module's own blend takes the opposite corner

A bare `Mix`, `Dry/Wet`, `Dry` or `Wet` joins `General` too, and lands **bottom right**.

It says how much of this module you hear at all, as against how much of what went into it — a
question about the module, like `@base`, not about the shape of its sound. So the two hold
opposite corners of the front page: the base at the top left, the blend at the bottom right,
where an output stage sits on a real panel.

What makes one "the module's own" is the **family, not the word**. `Reverb Dry/Wet`, `Delay Mix`
and `Chorus Wet` all carry a blend word, and the effect families ask before `Mix` does — so a
blend word still sitting in `Mix` at the end is one no effect claimed. `isBlend` is that test in
one line, and there is no second list of effect names to keep in step with the first.

Several are right-**aligned** together, ending at the panel's edge: a `dry` and a `wet` are two
halves of one control (one crossfade versus two independent gains — the difference is whether the
sum is locked), and splitting them across the row would say they were unrelated. If the bottom
row's right-hand end is already occupied, the panel grows a row rather than stacking the blend on
a knob.

## It always ends on an empty row

One slot row of air under the tallest page, whatever that page holds. Two reasons, and the second
is the one that made it a rule rather than a nicety:

- a panel whose bottom control sits flush against its edge reads as **cropped** — as though the
  next row were there and simply not being drawn;
- the grid editor needs somewhere to **drop** a parameter that is not already on top of a widget.
  Without the empty row, adding the first control past the proposal means resizing the panel
  before you can aim at anything, which is a strange first thing to have to do to a layout that
  was just made for you.

A **slot** row (`KNOB_SPAN` cells), not a cell row: what has to fit there is a control, and half
a knob of clearance is a margin rather than a place to put one.

It is counted after the blend is placed, so the air is under the bottom row rather than instead
of it — `rowsNeeded` stays the height of the content and only the panel's `rows` reads the extra.
The empty parameter list is the one case with no air, and needs none: it returns a bare grid
before any of this runs.

## What it draws, and where

The proposal is **one tabs widget** on row 0, spanning the panel, with the pages under it from
row 1 down — six parameters to a row, `AUTO_PER_ROW`. Row 0 is left to the bar because a page's
`col`/`row` are the **panel's** grid rather than an offset inside the tabs widget's box
(`pages.md`), so a widget placed on row 0 would be drawn over the bar.

A parameter gets a **slot** rather than a cell: `KNOB_SPAN` × `KNOB_SPAN`, which is 2×2. So the
panel is twelve cells wide (`AUTO_COLS` = six slots) and a row of parameters is two cells tall. A
dropdown takes the slot's width and not its height — it is one row of text with nothing to put
under it, where a knob is a dial with its label beneath.

**Only here.** A knob added from the palette, or made by dropping a parameter on bare grid, is
still one cell: those are single deliberate gestures onto a grid whose shape the author already
has in mind, and making one bigger is a drag. This function places a hundred and fifty at once
onto a grid it sizes itself, which is the case that needs an opinion about how big a knob is.

Every page shares that grid, so `rows` is sized to the **biggest** page, plus the empty row
above: a panel tall enough for the reverb page is what makes the oscillator page fit too, and a
shorter page simply has more air under it than the one that set the height.

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
