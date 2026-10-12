# The command palette and the module picker

> **Two screens mount this component.** The editor's bar is what this page describes; the HOME
> page runs the same one over a catalogue of its own — six verbs about repositories and projects,
> since there is no project open there to have any others (`projects.md`). Everything below about
> matching, the form, the docked strip and double-Shift is true of both; the gesture inlets and
> the caret are the editor's alone, and the home page passes neither.

## `CommandBar.tsx` — one question, then a form

The bar asks ONE thing: **what do you want done**. You answer in your own words, it lists
SENTENCES, and the parameters that command needs are asked afterwards, on the bar's own row
(`CommandParams.tsx`). A command with no parameters runs as soon as it is picked.

### It lists what a command DOES, not what it is called

Every command carries a `readable` description — one sentence, in English and in French. The
backend's are in [`commands.yaml`](../../../../packages/commands/commands.yaml) and the shell's
own are in `LOCAL_READABLE` (`palette.ts`); `commandSpec.test.ts` fails if a command ships
without one, in either language, and `palette.test.ts` fails if a shell command does.

**Sixty characters at most**, in each language, and both test files enforce it. The row is the
sentence with the command's name at the right of it, so a longer line does not make a longer
row — it makes a truncated one, or a list that wraps into a wall over the minimap. The cap is
also what keeps the sentence from drifting back into `help`: it states the ACTION and stops
there, and every line that ran past sixty was carrying a caveat or a consequence instead.

The command's NAME is not translated and never will be: a name is an identifier, the CLI's, and
one spelling everywhere is what lets a menu pre-write a line, a key binding dispatch one, and a
person read the same thing in the docs. So nothing maps a name at all: a line is dispatched as typed,
trimmed, and no message key carries a command's name. What is translated is the explanation. So each row shows the sentence on the left and the name on the right, where a
palette you have used before puts the keybinding — and typing either finds the row.

That is the whole reason the sentence is what the row leads with. Reaching "mute a track" by
name means knowing the word `track`, and `track mute` is the third of twenty commands starting
with `track`. A person knows what they want done before they know what it is called.

### Everything is matched FUZZILY, with the shell's one matcher

`fuzzyScore` (`fuzzy.ts`) is the same subsequence rule the file picker and the module search
already use, so "type a few letters" behaves the same wherever the shell searches.

- **Commands** are scored against their sentence *and* their name, best of the two, so both
  roads lead to the same row. The name gets a small bonus on a tie: someone typing `mute`
  means the command.
- **A parameter's values** are scored the same way, in the browser. The field's whole
  vocabulary is fetched ONCE when the field opens (`makeListArg`) instead of asking the backend
  to narrow it on every keystroke. Two things come of that: `rythm` finds `ge.rythm`, which a
  prefix filter cannot; and a question costs one round trip rather than one per letter, on a
  service that is a single Node process and queues what it is asked.

Both ranking functions are pure and live in `palette.ts`, which is what makes the claim
testable in a repo that mounts no components.

### What you used lately comes first

A command you have run recently gets a bonus on its match score (`recencyBonus`), decaying down
a twelve-entry history kept in localStorage (`recentCommands.ts`) — per browser and not per
project, because it is a habit and habits travel between songs.

It is a **nudge, not an override**, and the number says so: `fuzzyScore` gives roughly four
points per matched character, and the freshest entry is worth four. Enough to lift a command you
use daily above an equally good match you have never run; nowhere near enough to put a poor
match above a good one. A palette that answered with your history instead of with your query
would be worse than one with no history at all.

The bonus is added **after** the no-match filter, and that order is the whole safety of it:
`fuzzyScore` says "no match" with `-1`, so a recent command handed four points for nothing would
surface on a query it does not match at all. History reorders what matched; it never invents a
match, and a test says so.

What is remembered is recorded in the shell's `runCommand`, where EVERY command passes — the
palette, a key binding, a context menu. What you reach for by shortcut is still what you reach
for, and the palette should offer it first when you do come looking for it.

### Nothing is listed until you type

The command list opens on the first character, not on focus. The catalogue is over a hundred rows:
opening on the whole of it puts a wall over the minimap every time the bar takes the keyboard,
and a list you did not ask for is a list you have to dismiss. One letter is the whole cost of
asking for it.

A parameter's field is the other way round, deliberately: its list is there as soon as the field
opens, because you cannot type the first letter of a track you have not been shown. The
difference is that one is a vocabulary you are being offered and the other is a catalogue you
are searching.

### The parameters, on the bar's row

`CommandParams` replaces the input with ONE row: the command's name, then a field per parameter,
named by its placeholder, then what Enter does this press. The bar's whole STRIP turns orange while it waits, its edge glowing blue,
padding included, faded in and out — the host's background, from `barTint` and the bar's
`onPending`, since only the host knows its own padding: a command half-given is the shell waiting on you, and a bottom strip that looks the same
asking or idle is one nobody looks at. **Every question is on screen at once**, and an answer
given three fields ago can be changed without unwinding the ones after it. It holds no state —
the command, the answers and the gesture inlets all live in `CommandBar`, because two
components with two copies of that would be two commands.

- **Tab** goes to the next question. On a field showing suggestions it takes the highlighted
  one first, so completion is still the validation, and then steps on.
- **Enter** means "that is my line": it runs as soon as every required parameter is answered.
  When one is missing it moves there instead of refusing silently. On a field showing
  suggestions it takes the highlighted one, as Tab does — **unless the field already holds it**,
  and that clause is load-bearing: an exact match still ranks first, so the list
  stays on screen after a pick, and taking it again is a no-op. Without the clause Enter is
  eaten for ever, and a command whose LAST field has a vocabulary (`node replace <node>
  <extends-ref>`) can never be submitted at all. The three answers live in one place,
  `enterAction` in `commandFill.ts`, which is also what the row's `↵` names — so the row cannot
  promise "run" while the key would pick.
- **Escape** drops the list, and a second Escape abandons the command and gives the bar back.

On the row and not in a panel: a command being completed IS a line being typed, so it is drawn
where the line was, reading as the CLI line it builds. The row is the bottom strip, so a gesture
in the timeline or the graph can answer a field while every field stays in view. A field's
suggestions open UPWARD from the row, best value nearest it, as the command list does — so ↑ walks
forward through either.

A command may declare trailing params it runs without (`optional: true` in `commands.yaml` —
see [that package's page](../../../../packages/commands/docs/optionalArgs.md)). `requiredCount`
counts up to the last mandatory one and `canRun` asks whether those are answered; a trailing
optional left blank is not an omission, it is the answer "not that". Without this the bar could
not run `event move` at all: its fourth param moves the clip to another track and is usually
not wanted, while `args.length` says four.

A blank in the MIDDLE is kept as an empty token by `lineArgs`, because dropping it would shift
every param after it one place left and the command would read a track name as a timecode.
`canRun` is what stops such a line being dispatched at all.

### The command list only shows while the bar has the keys

A completion list is part of the field you are typing in, so it goes when the focus does.

That follows from the bar not being modal: answering a param by reaching into a pane takes the
focus away, and the list would otherwise sit parked over the timeline you just clicked —
covering the thing the gesture was about. It is load-bearing with the bar docked: the
catalogue is non-empty from the moment it loads, so "are there matches" would leave thirty rows
hanging over the minimap for ever. A row commits on `mousedown` and preventDefaults to keep the
focus, so the blur that closes the list can never be the one that was about to pick from it.

## It is NOT modal

On a wide screen the bar is **always there**: under the minimap, full width, the last row of
the window. Nothing opens it and nothing closes it. Double-tapping Shift focuses it, Escape
blurs it, and in between it sits where a terminal's prompt sits.

It has no backdrop, because a backdrop blocks the very gestures that fill it (see below) and
dimming hides the clip you are being asked to point at. And with no backdrop, fed by the editor
behind it, "opened" would do no work: summoning it would only be a permanent tool with a curtain
in front of it.

What being docked actually buys, beyond one less keystroke:

- **It says what it accepts before you commit to it.** The prompt, the field's colour and its
  hint are on screen while you work, so the vocabulary is visible rather than recalled.
- **A gesture has somewhere to land.** The bar reports what it is waiting for and the shell
  routes drags to it; that contract has no state in which the receiver does not exist.
- **The layout stops moving.** A strip that appears over the window covers the bottom of the
  panes exactly when you are pointing at them. A row that is always there is a row the panes
  were never given.

The phone keeps the popin, opened from the hamburger. It has no minimap to sit under, and a
permanent prompt would cost the band a phone has least of — the same trade that keeps the
minimap off it.

That opener is the one thing in the menu that is not a place to go, and it has to be there: a
phone has no double-Shift, so without it the bar could not be summoned at all.

Both forms are the same component. The phone's opens focused, because you opened it on purpose;
the docked one never takes the keyboard by itself, since a shell that started with it captured
could not be typed into.

### On a phone it goes away when it loses the keyboard

A popin over a phone screen is most of the screen: leaving it up after you have tapped past it
costs the pane you tapped *into*. The docked bar has no reason to do this and does not.

**Unless a command is being completed.** While the bar is asking a command's questions it is not
idle, whatever the command field's focus says — so the dismissal reads `barPending`, the same
signal the shell already uses to route a gesture to the field that is waiting.

The bar REPORTS the focus (`onFocusChange`) and the shell decides, because what losing it means
is the shell's business: a popin on a phone, a permanent strip on a wide screen. And it waits a
moment rather than acting on the blur itself — picking a command takes the keyboard from the
command field and hands it to the parameter form one render later, so closing in between would
dismiss the bar at the exact moment it was about to ask you something. The timer re-reads
`barPending` when it fires, for the same reason.

## A gesture can answer a field

A param can be filled by pointing at the thing rather than naming it. Trigger `event move`,
drag the clip, and the bar shows the timecode under the pointer as it moves; Enter runs the
line, Escape drops it.

The contract is two halves and deliberately small:

- The bar reports **what it is waiting for** (`onPending` → `{ canonical, wants, kind }`), and
  the shell reads that to decide whether a gesture should ACT or answer.
- A gesture offers values **keyed by param NAME** (`CommandBarHandle.offer`), because a
  gesture knows what it is holding, not where the command happens to ask for it. A clip drag
  knows a track and two timecodes whatever order `event move` lists them in.

### It fills FORWARD, and never rewrites your answer

An offer starts at the field currently open. Type `event move ge.rythm`, drag a clip, and the
gesture answers the two timecodes *after* your track — it does not replace `ge.rythm` with
whatever clip the pointer happened to touch. A gesture that overwrote a param you chose would
be the opposite of answering a question.

So the same drag reads differently depending on how far you have got, and that is the point:
from a bare `event move` it answers three params at once, and from `event move ge.rythm` it
answers the two that are left.

### The caret answers before you are asked

A gesture answers a field you have already opened. The **caret** answers before the form exists:
when you pick a command, whatever the timeline caret is looking at is offered first, and if that
completes the line the bar dispatches it instead of opening a form at all.

`event split` is what this is for. It takes a track, the event's start and the cut — and
parking on a clip states all three, so asking them back is asking you to retype what you are
looking at. `commands.yaml` says so: *"the cut is its own argument,
which is what the caret gives."*

The caret speaks the same currency a gesture does, **param names** (`caretAnswers`, `commandFill.ts`):

| param | what the caret supplies |
|---|---|
| `track` | the lane it is on — null on a video lane or a group header |
| `timecode` | where the event under it **starts**, which is how every `event` verb addresses one |
| `at` | where the caret itself is |

Two of those are different timecodes and it matters: feeding the caret's own position as the
event's address would split whatever begins under the cut, or nothing at all.

`selection consolidate` is answered by the **rectangle** instead, because what to consolidate
is a range and a range is what you drew: `tracks`, `from`, `to`, the same three values
`feedEventsMove` sends. Its head says so before its arguments do — it is the catalogue's one
`selection …` verb, beside the shell's `selection copy` and `selection paste`, and what those
three have in common is not a material but the region a gesture aimed at. The rectangle's lane list is passed on **whole**, several lanes included,
even though a join only works on one. The refusal is the handler's, and it can only make it if what
it receives is what was selected — quietly keeping the first lane here would run a join on it that
nobody asked for.

**It is opt-in per command, and that is not caution for its own sake.** A caret is always
somewhere, so a rule that filled anything called `track` would silently pre-answer `event remove`
and `track delete` — leaving a destructive line one Enter away from a cursor that had merely
moved. `CARET_ANSWERS` names the commands where acting on what you are looking at *is* the intent;
everything else opens its form empty exactly as before.

A fact the caret cannot supply is left blank rather than guessed, so the form still opens on the
hole: on bare lane, `event split` arrives knowing the track and the cut and asks only which event.

### A value that knows its kind but not the command

A click on the ruler produces a timecode and has no idea which param wanted one. That is the
second inlet, `offerValue(kind, value)`: it fills the OPEN field **if that field declares this
kind**, and is ignored otherwise, so a stray click cannot land in a field that meant something
else. `wantsKind` is the whole check.

It is deliberately narrower than `offer` — one value, one field, no knowledge of the command —
which is what lets a general-purpose picker feed any command that asks for its kind. The ruler
is wired for `timecode`; a track header feeding a `track` field is the same three lines and is
not written yet.

`live` says the pointer is still down: the value is shown, nothing is validated, and the drag
re-offers on every frame. The closing offer takes the focus back — the click that began the
gesture took it away, and Enter has to land in the bar.

`applyOffer` writes every field the gesture knows from the active one forward, and the keyboard
follows to the last of them — so a live drag rewrites one field while the answers in front of
it stay still, and the next Enter is about the value the gesture just put down. A param the
offer skips keeps what is already there rather than being blanked, or a second gesture that
knew less would quietly erase an answer the first one gave.

**Answering is not committing.** While the bar is asking, the clip drag writes nothing to
disk: it fills the line and leaves it for you to run. That is what makes the gesture safe to
try — and it is why the drop shows `event move — enter runs it, esc drops the line` rather
than the usual "moved" status.

Both halves are pure and tested (`commandFill.ts`, `commandFill.test.ts`); the wiring is not,
because nothing in this app mounts a component.

### Presentation

While the form is open the bar shows WHAT is being filled — the sentence, with the canonical
name beside it — and takes no typing: the questions have their own fields, and a second input
in the bar would compete for the keys. Clicking it abandons the command and gives the bar back.

Each param KIND has its own colour (`ARG_COLOR`) — worn by the active field, its label and its
suggestions — so a question tells you what it is asking for before you read the prompt.

The bar sits at the bottom of the window, so the command list opens UPWARD and is rendered
bottom-first: the best match sits right above the input (where the eye already is) and ↑ walks
away from it, the way a shell completion list reads.

Both lists, the commands and a field's values, are positioned ABOVE the row rather than in it:
the bar is a flex row in the shell's bottom strip, and a list in its flow would push the fields
around under the caret.

## `ModulePicker.tsx` — "which module?"

Opened by the `+` on a graph arrow, before the command bar sees anything. The pick RUNS, like
`ContextMenu`'s entries and unlike everything else here: a node names itself
(`<lane>_<module>_<n>`, see `packages/song/docs/nodes.md`), so nothing is left for a person to
supply and stopping at the bar would be asking them to press Enter on a line they did not write.

Two picks pre-write instead, and for the mirror reason — there is a name left to supply. A **new
curve** is not an instance of anything: there is no module to be named after, and it drives
nothing until a param binds it. And any pick made while the module catalogue has not arrived
falls back to the bar, since there is no module to derive a name from either.

The first level is where a module COMES FROM:

- `current` — base modules this project already defines
- `@…` — any level a module is inherited from (`@st0`, `@workspace`)

**`@engine` is not among them.** That namespace is the machine's plugin scan, so its size is a
fact about the rig rather than about the song, and a built-in is what a module `extends:` — not
a node to drop on a graph. It is browsed in the file tree's Libraries tab and offered by the
module builder, which is the screen that authors an `extends:`. The command bar draws the same
line for the same reason, and states it once:
`packages/commands/docs/completions.md`. A chain step naming one stays legal; it is simply not
suggested here.

`offered()` is where that line is drawn, and BOTH halves of the picker go through it — the tree
and the search — because a search reaching what the tree refuses is the same leak. The shape to
test it against is `@engine/<slug>`, flat, with a category carried beside it: a three-segment
`@engine/audio/delay/adt` never arrives, `moduleCatalogue` dropping a namespaced ref that has no
library root, while `@engine/serum` and `@meta/OUT` come through it every time the rig has been
scanned.

Below that it is the catalogue's own shape: type → category → module. That nesting is not
a taxonomy invented here — `scanModules` files each plugin at `<type>/<category>/<slug>`
under a namespaced folder, so a ref parses straight into it. The category level is
genuinely optional (a plugin that declares nothing usable files flat), and a module with
no category sits directly under its type rather than being given an "Other" bucket it
never asked for.

Only BASE modules appear, never nodes — `loadModuleRefs` keys by module folder, so a
node is never a ref of its own. That is the right set here, because picking one leads
to instantiating it.

**A row is named by the module's file name** — the ref's last segment. The whole ref stays on the
row as its hint, because the ref is what a pick WRITES and the file name alone does not say which
library or folder it comes from.

The nesting is a good way to BROWSE and a bad way to find one module you can already name
— a 250-plugin catalogue is four hovers deep. So the root level also carries a search
field: type, and the tree is replaced by a flat ranked list of every module in every
namespace, whatever its type or category. ↑/↓ walk it, Enter picks.
