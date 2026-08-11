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
The ones worth knowing, because they change something and go at once: `module delete`,
`event remove`, `marker delete`, `module instance unlink`, `track freeze` and `module own`.

`complete` is **stated, not sniffed** off the trailing space on `command`. That space is a caret
position; whether a line is finished is a different question, and two questions must not share
one accident of formatting. A test pins that the two nevertheless always agree.

A row that will ask shows a trailing `…` beside its line, so which is which is visible before
you pick.

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

`module param <module> <param>` and `module clone <module> <newName>` are the SAME shape: a
`modules` value, then free text. Nothing about the types tells them apart, so the param slot
also pins the argument's **name**. That is the catalogue's own word for the role, so it is
still derived rather than a list of chosen commands — but it is a seam, and if a third command
of that shape ever appears it will be the thing to look at.

## The rows say what the command DOES

The label is the catalogue's `help` — what it does — and the line sits beside it, muted. The line
stays because a pick either runs it or writes it into the bar, and hiding which line that is
would make the gesture opaque. Command names used to be the label, and `module bypass` twice over
said nothing you did not already know from having right-clicked it.

The `(e.g. …)` tail is stripped, and only that. It answers "how do I type this", which the
pre-written line answers better by being the line. Every other parenthetical — a value list,
an aside — says what the command does and is kept.

A trailing space is left on the line exactly when an argument is still owed. That space is
where the caret lands, and it is also what tells the bar to complete the next ARGUMENT rather
than the command name.

## What is still written by hand, and why

Four things the catalogue genuinely cannot say. They are worth listing, because each is a
question about a HANDLER, and the catalogue only describes arguments.

- **The shell's own commands.** `ui file`, `ui midi learn` and the `module cc … none` unbind
  are not in the catalogue at all, so each carries its own description here.
- **A group.** It answers `track mute` and `track solo` — their help even says "or group's" —
  but it is not a value the `tracks` provider lists. Deriving would hand a group a freeze, a
  gain and four `event` verbs, none of which reach it.
- **A dangling module.** A step naming a module that does not exist keeps exactly the verbs
  that touch `chains.yaml` alone: `module bypass`, `module instance unlink` and
  `module replace` — the last being the actual repair, since it writes the new module and
  rewrites the reference without ever opening the old one. That is about what those handlers
  write, which no argument declares.
- **A chain.** No command takes a chain as its FIRST argument — `track process` and
  `clip process` take one second, and a line cannot be pre-written with a hole in the middle.
  So the only offer is about the track the chain carries, which is a different entity.

Two more restrictions are derived rather than written, and worth knowing they are not
exceptions: an **engine module** gets `module own` because its `@engine/…` id genuinely IS a
base-module ref, and a **MIDI clip** is refused `clip process` because `clipTargets` lists no
MIDI — never offer what the command would reject.

## The menu can now be long

Sixteen rows for a track. It is capped at 70% of the viewport and scrolls, because a menu that
runs off the bottom of the screen hides its own tail.
