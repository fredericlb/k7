# The right-click menu

Two rules, and everything else follows from them.

**Every entry IS a command line.** The menu adds no vocabulary: every row is text you could have
typed, the arguments it fills are the command's own, and a gesture you learn in the menu is a
gesture you can type next time.

**The list is DERIVED, not chosen.** The clicked thing says what TYPE it is; every command in
the catalogue whose leading arguments are exactly that is offered, and the one written tomorrow
appears the day it is written in `commands.yaml`.

## `menu:` — the one thing that narrows it

Deriving on the arguments alone offers a command wherever its FIRST argument fits, and that is
sometimes a lie about what you clicked. A track answers `<track>`, so a track's menu drew eleven
`event …` rows: every verb that addresses a placement takes the lane it sits on, and none of them
is about the lane. The click had answered one argument of a command that was not about the thing
under it.

So a command may say where it belongs: `menu:` in `commands.yaml`, a list of the entities in
`MENU_ENTITIES` (`packages/commands/src/commandSpec.ts`, mirrored on the wire). It names **what
is under the pointer, not what the verb acts on** — `event add` takes a track and belongs on a
TRACK's menu, `event remove` takes the same track and belongs on the event's.

It only ever **narrows**. Absent, nothing changes: the derivation stands, which is why the
hundred commands that reach no menu need no line. It cannot ADD a row either — an entity named
by a command whose arguments the click does not answer is still not offered, because `menu:` is a
filter over `fromCatalogue` and never a second source of entries. So the two rules above survive
it: every entry is still a line you could type, and no row was chosen by hand.

`contextMenu.ts`'s `CTX_ENTITY` is the other half — which entity each `MenuCtx` kind IS. Two
contexts fold onto one word (`marker-add` is the **ruler**, a place with nothing in it yet;
`marker` is a marker), and `chain`/`sink` have none, opening no menu at all.

### And the person's own list

`commandPrefs.ts` holds it: `menu` on a command's entry is `false` for nowhere, or the list of
entities that person wants it on, replacing the catalogue's. The Commandes settings page draws it
as a multi-select per row (`components/CommandMenuPicker.tsx`), which is also where a command the
catalogue narrowed is put back somewhere else. The document says the least it can — nothing at all
when the pick matches the catalogue, `true` for the whole vocabulary, `false` for none — so a
catalogue that changes tomorrow still moves the commands nobody has arranged by hand.

## Run it, or ask for the rest

`MenuItem.complete` says whether the click already filled every argument, and the host acts on
that: a finished line **runs**, an unfinished one goes to the **command bar** with the caret
where the next value goes.

The bar is a form for COLLECTING arguments. An entry the click answered in full has none left
to collect, so opening the bar over it would ask a question with no blanks in it and wait for an
Enter that could only mean yes. That is not a confirm step: what a command changes is undone by
Ctrl+Z, because every command runs inside the same journal (`workspace.recordChange`).

**The exception is `confirm:` in `commands.yaml`**, for the few entries that destroy more than one
Ctrl+Z is trusted to bring back in the musician's mind — `track delete` takes a lane AND its whole
chain. The menu asks first (`menuConfirm.ts`): the title is the command's own sentence, the body the
exact line it will run, so the question is still the command and adds no vocabulary. Only the menu
asks — a line TYPED in the bar was already a deliberate act — and a host with no dialog mounted
answers no.

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
and `events move`. Derived from the click alone they arrive incomplete, so the
bar opens and asks for an end the selection is already holding.

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

The row holds the NAME and not the sentence. A menu of ten sentences is **read**, one row at a
time, and a menu of ten names is **scanned**; you open a right-click menu knowing what you came
for, and the sentence is what you want about the *one* row you are not sure of — so it belongs
in the place that shows one row at a time. The name is the shortened one, because `node bypass`
written where you have just right-clicked a node says nothing you did not know.

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

Six things the catalogue genuinely cannot say. Each is a row the derivation does not produce, and
`menu:` is no help with any of them: it can only take rows AWAY. They are worth listing, because each is a
question about a HANDLER, and the catalogue only describes arguments.

- **The shell's own commands.** `ui file`, `ui midi learn` and the `module cc … none` unbind
  are not in the catalogue at all, so each carries its own description here.
- **A group.** It answers `track mute` and `track solo` — their help even says "or group's" —
  but it is not a value the `tracks` provider lists. Deriving would hand a group a freeze, a
  gain and four `event` verbs, none of which reach it.
- **A dangling module.** A step naming a module that does not exist keeps exactly the verbs
  that touch `graph.k7x` alone: `node bypass` and `graph unlink`. That is about what those
  handlers write, which no argument declares. `node replace` is not a third: it repoints an
  `extends:`, and a dangling name has no file to repoint, so offering it would be offering a
  certain failure. What is left for one is to take it out, or to write the file it names.
- **A chain.** No command takes a chain as its FIRST argument — `track process` and
  `clip process` take one second, and a line cannot be pre-written with a hole in the middle.
  So the only offer is about the track the chain carries, which is a different entity.

- **A rack pad.** Its seven rows — change note, change sample, rename, remove, add one before, add
  one after, and **Edit chain…**, the popin on its own chain (`docs/shell.md`) — are lines named by hand: derived, they would read `note`, `sample`,
  `insert` twice, and the two inserts would be indistinguishable. They still pass through `menu:`
  (the `tap` entity), so a person can hide one.
- **The ruler's loop.** `transport loop` takes no argument: it acts on the selection the ruler
  swept, which the line cannot carry. So the ruler's context says what it would do — `set` with a
  selection, `clear` with only a loop, absent with neither — and the row is named for that
  ("Loop selection" / "Clear loop") rather than offered as a toggle that might do nothing. The
  ruler's own press ignores a macOS Ctrl+click: that is the menu's gesture, and answered as a
  click it would clear the very selection the menu is about to loop.

One more derivation worth knowing is not an exception: an **engine module** gets `module own`
because its `@engine/…` id genuinely IS a base-module ref.

A right-clicked **event** deliberately gets no `clip …` entry at all (the `clipTargets`
family). What was clicked is a PLACEMENT on a lane, and the material it references may sit on
other lanes too — `clip process` in that menu reads as "process this event" while acting on
every placement of the file. The event menu offers the `event …` family plus `ui file`; the
material's own verbs stay reachable from the bar and from the clip's editor, where the clip
itself is what you are looking at. Processing is still in that menu, as `event process`, which
treats the clicked placement alone (`packages/audio-passes/docs/processChain.md`). (It is also why the menu has no MIDI/audio split:
`clipTargets` lists no MIDI, and without that family the ctx has no need to say which kind
the clip is.)

## The menu can be long

Ten rows for a track, sixteen for a node. It is capped at 70% of the viewport and scrolls, because
a menu that runs off the bottom of the screen hides its own tail.

## Tabs, one per kind of thing

A right-click offers rows about more than one thing at once: an event's own verbs, the range verbs
of the rectangle it sits in, its lane's, and the shell's `ui file`. Listed together they read as one
long column of verbs with nothing saying which is about what. So the rows are split into TABS by
their command's first word — `event`, `track`, `node`, `ui`… (`src/menuTabs.ts`) — and a tab exists
only when at least one row falls in it. The plural `events` (the range verbs) shares the event's.

The tabs are ICONS, not words: the menu is narrow and opened on the spot, and a strip of
`event track node ui` costs the width the rows need. The word is the tooltip and the accessible
name. The menu opens on the first tab, which is the thing clicked; `ui` always goes last, being
about the editor rather than the song. With only one kind of row there is no strip at all — a lone
tab says nothing. Left and right arrows walk the tabs.

## On a touch screen, a held finger is the right-click

A tablet has no right button, and the menu is the only door to most of these verbs. So a finger or
a pen held still for half a second, moving less than ten pixels, dispatches a `contextmenu` where it
is held (`src/longPress.ts`). It is installed ONCE, on the window, rather than beside each of the
app's seventy-odd `onContextMenu` handlers: every surface that answers a right-click answers a long
press the day it is written, and none of them knows the difference.

Movement past the slop cancels it, because a held finger that travels is a pan or a drag; so does a
second finger, which is a pinch. A text field keeps its native long press, which selects text. The
click the release produces is swallowed only when a handler TOOK the menu — called
`preventDefault`, as every one here does to hide the browser's own — so a slow tap on a plain
button still clicks, and a release over the menu just opened does not pick its first row. Android
fires a native `contextmenu` of its own during a long press: one that arrives before ours wins and
cancels ours, one that arrives after is dropped, so a press never opens two menus.

