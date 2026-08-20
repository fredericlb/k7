# The right-click menu

Two rules, and everything else follows from them.

**Every entry IS a command line.** The menu adds no vocabulary: every row is text you could have
typed, the arguments it fills are the command's own, and a gesture you learn in the menu is a
gesture you can type next time.

**The list is DERIVED, not chosen.** The clicked thing says what TYPE it is; every command in
the catalogue whose leading arguments are exactly that is offered. Right-clicking a track
offers the sixteen commands that take a track, and the seventeenth appears the day it is
written in `commands.yaml`.

## Run it, or ask for the rest

`MenuItem.complete` says whether the click already filled every argument, and the host acts on
that: a finished line **runs**, an unfinished one goes to the **command bar** with the caret
where the next value goes.

The bar is a form for COLLECTING arguments. An entry the click answered in full has none left
to collect, so opening the bar over it asked a question with no blanks in it and waited for an
Enter that could only mean yes. It was never a confirm step — nothing in this app asks twice —
and what a command changes is undone by Ctrl+Z, because every command runs inside the same
journal (`workspace.recordChange`).

So `track mute gtr` goes; `track gain gtr ` asks for the dB. Roughly a third of the rows run.
The ones worth knowing, because they change something and go at once:
`event remove`, `project marker delete`, `graph unlink` and `module own`.

`complete` is **stated, not sniffed** off the trailing space on `command`. That space is a caret
position; whether a line is finished is a different question, and two questions must not share
one accident of formatting. A test pins that the two nevertheless always agree.

A row that will ask shows a trailing `…`, so which is which is visible before you pick.

## A range verb needs the rectangle, not the click

A placement answers *where it starts* and nothing more. That is enough for `event remove` and
`event move`, and one argument short for every verb that takes a **span** — `selection consolidate`
and `events move`. Derived from the click alone they arrived incomplete, so the
bar opened and asked for an end the selection was already holding.

So the clip context carries `sel`, the rectangle the click landed in, and the range verbs are
derived from **three** slots rather than two. They then arrive complete and run, like everything
else the click answers in full.

They are derived twice — the two-slot shape matches their leading arguments as well — so the
complete ones win and the half-filled duplicates are dropped. A verb offered twice, once ready
and once asking, is a menu that looks like it has two different commands with one name.

Without a rectangle nothing changes: the verb arrives short, shows its `…`, and the bar collects
the range. That is the same rule the palette follows, and `commandFill.ts` reads the same three
values — one selection, two readers, one meaning.

## Why the provider, and not the class

`CommandArg` carries two things about what an argument names. `kind` is its **class** — the
colour the palette draws the field in. `provider` is the **named completion provider** it
draws its values from, and that is the precise type.

Matching on the class does not work, and the failures are not subtle:

| class | what it actually covers |
|---|---|
| `file` | a clip, a sequence, an audio path, a module's assets |
| `module` | a module id, a base-module ref, AND a `<category>/<name>` |
| `choice` | a chain, an alternative, an on/off state |

A menu built on `kind` would offer `module new <category>/<name>` on every module in the
graph, and `sequence note new` on an audio clip. `provider` separates them, so the wire carries
it — `ArgProvider` in `@studio/web-protocol`, mirrored from the `PROVIDERS` keys in
`packages/commands/src/commandSpec.ts`, with a test that fails if the two drift.

### The one case where even that is not enough

`node param <node> <param>` and `module clone <module> <newName>` are the SAME shape: a
`modules` value, then free text. Nothing about the types tells them apart, so the param slot
also pins the argument's **name**. That is the catalogue's own word for the role, so it is
still derived rather than a list of chosen commands — but it is a seam, and if a third command
of that shape ever appears it will be the thing to look at.

## Three questions, three places

A row raises three: *what is this called*, *what does it do*, *what exactly will it type*. They
are asked at different moments, so they are answered in different places.

| question | where | what it is |
|---|---|---|
| what is it called | **the row** | the command's name, minus the word naming what you clicked — "consolidate" |
| what does it do | **the status bar**, while the pointer is on the row | `MenuItem.description` |
| what will it type | the row's `title` tooltip | `runs: …` / `fills the bar: …`, the whole line |

The row used to hold the *sentence* instead — the catalogue's `help`, or this person's own name
for it. That was right about one thing: `node bypass` written where you had just right-clicked a
node says nothing you did not know. It was wrong about the rest. A menu of ten sentences is
**read**, one row at a time, and a menu of ten names is **scanned**; you open a right-click menu
knowing what you came for, and the sentence is what you want about the *one* row you are not sure
of. So it moved to the place that shows one row at a time — and the name came back, minus its
redundant half.

### The word that gets dropped

`CLICKED_HEAD` in `contextMenu.ts`: one word per context, dropped off the front of every row
that starts with it. On an event, `event remove` reads "remove".

A head that names **something else** stays, and that is the whole value of dropping the one that
does not. On an event's menu, `ui file` is about the material's file, `events move` about a
whole range of them, and `selection consolidate` about the rectangle the click landed in — none
of them is this placement, and their head is the word saying so.

It is one word chosen per context, not "the head most rows share": a track's menu is nine
`event …` rows against six `track …` ones, and the commonest head there is the wrong one.

Shortening is **all or nothing**. The list is derived, so the command written tomorrow lands on
some menu without anyone looking at it; if shortening would make two rows read alike, every row
on that menu keeps its full name. Two identical rows are worse than one word repeated ten times.

One entry names itself: the `module cc … none` unbind, which shares its verb with the bind on
the same menu. `none` is a literal the entry writes rather than a value you are being asked for,
so it belongs in the name rather than being asked for.

### The sentence

`MenuItem.description` is the catalogue's `readable` in the language being read — the 60-character
line written for a person scanning a list — falling back to `help` with its `(e.g. …)` tail
stripped, since that answers "how do I type this", which the pre-written line answers better by
being the line. An entry carrying its own `help` (the shell's own commands, the unbind) wins
outright over the catalogue's: for `module cc none`, the catalogue's sentence says the opposite of
what that row does.

The host draws it: `onHint` reports the row under the pointer — or under the keyboard focus, since
these are buttons and tabbing through the menu is a way of reading it — and `App.tsx` puts it in
the footer, ahead of the status text, for as long as the menu is open. It **borrows** that line
rather than writing it: closing the menu gives back whatever the app last said, so a sentence read
on the way past never survives as something the app appears to have done.

The trailing **`…`** survives all of this unchanged: it says a pick will ASK rather than act,
which is the difference between an action and a question, and is worth a character on every row.

A trailing space is left on the line exactly when an argument is still owed. That space is
where the caret lands, and it is also what tells the bar to complete the next ARGUMENT rather
than the command name.

## What is still written by hand, and why

Five things the catalogue genuinely cannot say. They are worth listing, because each is a
question about a HANDLER, and the catalogue only describes arguments.

- **The shell's own commands.** `ui file`, `ui midi learn` and the `module cc … none` unbind
  are not in the catalogue at all, so each carries its own description here.
- **A group.** It answers `track mute` and `track solo` — their help even says "or group's" —
  but it is not a value the `tracks` provider lists. Deriving would hand a group a freeze, a
  gain and four `event` verbs, none of which reach it.
- **A dangling module.** A step naming a module that does not exist keeps exactly the verbs
  that touch `graph.yaml` alone: `node bypass` and `graph unlink`. That is about what those
  handlers write, which no argument declares. `node replace` used to be the third — it wrote
  a new module and rewired the reference — but it repoints an `extends:` now, and a dangling
  name has no file to repoint: offering it would be offering a certain failure. What is left
  for one is to take it out, or to write the file it names.
- **A take.** Its two verbs take a track and a number — and so do `track gain`, `track pan` and
  the three tone bands. Nothing in the argument types tells those apart, so deriving would offer
  to set a take's level. This is the same seam `node param` / `module clone` sit on, and the
  sharpest instance of it. See `packages/song/docs/takes.md`.
- **A chain.** No command takes a chain as its FIRST argument — `track process` and
  `clip process` take one second, and a line cannot be pre-written with a hole in the middle.
  So the only offer is about the track the chain carries, which is a different entity.

One more derivation worth knowing is not an exception: an **engine module** gets `module own`
because its `@engine/…` id genuinely IS a base-module ref.

A right-clicked **event** deliberately gets no `clip …` entry at all (the `clipTargets`
family). What was clicked is a PLACEMENT on a lane, and the material it references may sit on
other lanes too — `clip process` in that menu read as "process this event" while acting on
every placement of the file. The event menu offers the `event …` family plus `ui file`; the
material's own verbs stay reachable from the bar and from the clip's editor, where the clip
itself is what you are looking at. (This also removed the one MIDI/audio split the menu had:
`clipTargets` lists no MIDI, and with the family gone the ctx no longer needs to say which
kind the clip is.)

## The menu can now be long

Sixteen rows for a track. It is capped at 70% of the viewport and scrolls, because a menu that
runs off the bottom of the screen hides its own tail.
