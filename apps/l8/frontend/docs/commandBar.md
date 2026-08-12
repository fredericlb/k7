# The command palette and the module picker

## `CommandBar.tsx` — one question, then a form

The bar asks ONE thing: **what do you want done**. You answer in your own words, it lists
SENTENCES, and the parameters that command needs are asked afterwards, in their own small panel
(`CommandParams.tsx`) in the bottom-right corner. A command with no parameters runs as soon as
it is picked.

### It lists what a command DOES, not what it is called

Every command carries a `readable` description — one sentence, in English and in French. The
backend's are in [`commands.yaml`](../../../../packages/commands/commands.yaml) and the shell's
own are in `LOCAL_READABLE` (`palette.ts`); `commandSpec.test.ts` fails if a command ships
without one, in either language, and `palette.test.ts` fails if a shell command does.

The command's NAME is not translated and never will be: a name is an identifier, the CLI's, and
one spelling everywhere is what lets a menu pre-write a line, a key binding dispatch one, and a
person read the same thing in the docs (see `commandI18n.ts`). What is translated is the
explanation. So each row shows the sentence on the left and the name on the right, where a
palette you have used before puts the keybinding — and typing either finds the row.

That is the whole reason for the change. "Mute a track" was reachable only by knowing the word
`track`, and `track mute` is the third of twenty commands starting with `track`. A person
knows what they want done before they know what it is called.

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
match. (That was a real bug, caught by the test that says so.)

What is remembered is recorded in the shell's `runCommand`, where EVERY command passes — the
palette, a key binding, a context menu. What you reach for by shortcut is still what you reach
for, and the palette should offer it first when you do come looking for it.

### Nothing is listed until you type

The command list opens on the first character, not on focus. The catalogue is ninety rows:
opening on the whole of it puts a wall over the minimap every time the bar takes the keyboard,
and a list you did not ask for is a list you have to dismiss. One letter is the whole cost of
asking for it.

A parameter's field is the other way round, deliberately: its list is there as soon as the field
opens, because you cannot type the first letter of a track you have not been shown. The
difference is that one is a vocabulary you are being offered and the other is a catalogue you
are searching.

### The parameters, in the corner

`CommandParams` is a panel, not a step: **every question is on screen at once**, and an answer
given three fields ago can be changed without unwinding the ones after it. It holds no state —
the command, the answers and the gesture inlets all live in `CommandBar`, because two
components with two copies of that would be two commands.

- **Tab** goes to the next question. On a field showing suggestions it takes the highlighted
  one first, so completion is still the validation, and then steps on.
- **Enter** means "that is my line": it runs as soon as every required parameter is answered.
  When one is missing it moves there instead of refusing silently. On a field showing
  suggestions it takes the highlighted one, as Tab does.
- **Escape** drops the list, and a second Escape abandons the command and gives the bar back.

Bottom-right, small, and over nothing you would be pointing at: the bar is the bottom strip,
the timeline and the graph fill the middle, and the corner is the one place a panel can sit
while a gesture elsewhere answers one of its fields.

A command may declare trailing params it runs without (`optional: true` in `commands.yaml` —
see [that package's page](../../../../packages/commands/docs/optionalArgs.md)). `requiredCount`
counts up to the last mandatory one and `canRun` asks whether those are answered; a trailing
optional left blank is not an omission, it is the answer "not that". Without this the bar could
not run `event move` at all: its fourth param moves the clip to another track and is usually
not wanted, but `args.length` said four.

A blank in the MIDDLE is kept as an empty token by `lineArgs`, because dropping it would shift
every param after it one place left and the command would read a track name as a timecode.
`canRun` is what stops such a line being dispatched at all.

### The command list only shows while the bar has the keys

A completion list is part of the field you are typing in, so it goes when the focus does.

That follows from the bar not being modal: answering a param by reaching into a pane takes the
focus away, and the list would otherwise sit parked over the timeline you just clicked —
covering the thing the gesture was about. It is load-bearing now that the bar is docked: the
catalogue is non-empty from the moment it loads, so "are there matches" would leave thirty rows
hanging over the minimap for ever. A row commits on `mousedown` and preventDefaults to keep the
focus, so the blur that closes the list can never be the one that was about to pick from it.

## It is NOT modal

On a wide screen the bar is **always there**: under the minimap, full width, the last row of
the window. Nothing opens it and nothing closes it. Double-tapping Shift focuses it, Escape
blurs it, and in between it sits where a terminal's prompt sits.

It got there by degrees, and each step removed a reason for the previous one. It was a modal
palette; then it stopped being modal, because a backdrop blocks the very gestures that fill it
(see below) and dimming hides the clip you are being asked to point at. Once it had no
backdrop, was fed by the editor behind it, and had to be summoned before any of that could
start, "opened" was doing no work — it was a permanent tool with a curtain in front of it.

What being docked actually buys, beyond one less keystroke:

- **It says what it accepts before you commit to it.** The prompt, the field's colour and its
  hint are on screen while you work, so the vocabulary is visible rather than recalled.
- **A gesture has somewhere to land.** The bar reports what it is waiting for and the shell
  routes drags to it; that contract now has no state in which the receiver does not exist.
- **The layout stops moving.** A strip that appears over the window used to cover the bottom
  of the panes exactly when you were pointing at them. A row that is always there is a row the
  panes were never given.

The phone keeps the popin, opened from the tab bar. It has no minimap to sit under, and a
permanent prompt would cost the band a phone has least of — the same trade that keeps the
minimap off it.

Both forms are the same component. The phone's opens focused, because you opened it on purpose
from the tab bar; the docked one never takes the keyboard by itself, since a shell that started
with it captured could not be typed into.

### On a phone it goes away when it loses the keyboard

A popin over a phone screen is most of the screen: leaving it up after you have tapped past it
costs the pane you tapped *into*. The docked bar has no reason to do this and does not.

**Unless the parameter panel is open.** While the bar is asking a command's questions it is not
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

Both the list and the parameter panel are PORTALLED to the body. The bar is a flex row in the
shell's bottom strip; a panel that size inside it would be clipped or would push the input
around, which is the same lesson the timeline's lane menu learned from its gutter.

## `ModulePicker.tsx` — "which module?"

Opened by the `+` on a graph arrow, before the command bar sees anything. It only PRE-WRITES,
and unlike `ContextMenu` — which runs a line the click already filled — that is not a rule but
the shape of the thing: picking a module answers ONE of `module insert`'s arguments, and the
rest still has to be typed.

The first level is where a module COMES FROM:

- `current` — base modules this project already defines
- `@engine` — the plugin catalogue, brought in by default
- `@…` — any other level a module is inherited from (`@mediatek`, `@workspace`)

Below that it is the catalogue's own shape: type → category → module. That nesting is not
a taxonomy invented here — `scanModules` files each plugin at `<type>/<category>/<slug>`
under a namespaced folder, so a ref parses straight into it. The category level is
genuinely optional (a plugin that declares nothing usable files flat), and a module with
no category sits directly under its type rather than being given an "Other" bucket it
never asked for.

Only BASE modules appear, never nodes — `loadModuleRefs` keys by module folder, so a
node is never a ref of its own. That is the right set here, because picking one leads
to instantiating it.

The nesting is a good way to BROWSE and a bad way to find one module you can already name
— a 250-plugin catalogue is four hovers deep. So the root level also carries a search
field: type, and the tree is replaced by a flat ranked list of every module in every
namespace, whatever its type or category. ↑/↓ walk it, Enter picks.
