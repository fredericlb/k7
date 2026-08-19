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

## Preset and MIDI lead, and that is the point

A modern instrument publishes dozens of parameters that are not sound. Piano V3 alone has
sixteen `VST_ProgramChange_*`, sixteen `MPE_PitchBend_*`, sixteen `MPE_Aftertouch_*` and a whole
KeyLab remote — `Select Preset`, `Browse Back`, `HardwareDisplayControl1..8`, `Undo the last
action`. Left among the knobs, each is a knob nobody will ever turn sitting where a real one
could have been.

They are **not dropped**. They go to a page called what they are, which you delete in one
gesture if you do not want it. A guess that silently discards is a guess you cannot check.

## Matching order and reading order are different questions

`Track` — the `@` namespace, `@volume` `@pan` `@mute` `@solo` `@arm` `@gain` `@monitor` — has
to ask **before** `Mix`, because `@volume` reads as a level to every word test there is. It
also has to be drawn **after** it: those are the lane's controls and the input's, offered on
every module because a panel may want them, and a plugin's panel that OPENED on them would be
the other mistake.

One list cannot answer both. So the table is the matching order and a `tail` flag is the
reading order, with `Other` after even that.

## What it draws, and where

The proposal is **one tabs widget** on row 0, spanning the panel, with the pages under it from
row 1 down — six to a row, `AUTO_COLS`. Row 0 is left to the bar because a page's `col`/`row`
are the **panel's** grid rather than an offset inside the tabs widget's box (`pages.md`), so a
widget placed on row 0 would be drawn over the bar.

Every page shares that grid, so `rows` is sized to the **biggest** page: a panel tall enough for
the reverb page is what makes the oscillator page fit too.

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
