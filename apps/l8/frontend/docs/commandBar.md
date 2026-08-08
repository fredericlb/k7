# The command palette and the module picker

## `CommandBar.tsx` — a step-by-step form

It fills a command one field at a time. First it asks for the COMMAND: type to filter,
↑/↓ to move, Enter/Tab (or click) to validate. Then it asks for each PARAM in turn, with
completion for that param; Enter/Tab validates the field and moves to the next, and
validating the LAST param runs the command. A command with no params runs as soon as
it's picked.

### Completion IS the validation

Whenever the field has suggestions, Enter and Tab both take the HIGHLIGHTED one — they
are the only way to validate a field or move to the next argument. Typing narrows the
list, it doesn't commit; so a half-typed command can never dispatch as a bogus line, and
a param that has a vocabulary can only be filled from it.

Only a field with NO suggestions (a dB number, a marker name — args with no completion
provider) takes the typed text verbatim.

### Enter runs, Tab keeps going

Enter and Tab are otherwise the same key, and they part company on one point.

A command may declare trailing params it runs without (`optional: true` in `commands.yaml` —
see [that package's page](../../../../packages/commands/docs/optionalArgs.md)). `requiredCount`
counts the params up to the last mandatory one, and **Enter dispatches as soon as those are
answered**: it means "that is my line". **Tab** means "there is more", and steps onto the
trailing optional param instead. Enter on an empty optional field runs the line as it stands
rather than passing `""` as that param's value.

Without this the bar could not run `event move` at all. Its fourth param moves the clip to
another track and is usually not wanted, but `args.length` said four, so the form waited
forever for an answer the command did not need. The old catalogue said "optional" in the
hint's prose, which a person could read and the form could not.

## It is not a popin — it is the last row of the shell

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

Both forms are the same component, mounted once either way, and neither ever autofocuses: a
shell that opened with the keyboard captured could not be typed into.

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

`applyOffer` puts the highest param the gesture knows in the INPUT and fills everything before
it, so a live drag rewrites one field while the line in front of it stays still. A param the
offer skips keeps what is already there rather than being blanked, or a second gesture that
knew less would quietly erase an answer the first one gave.

**Answering is not committing.** While the bar is asking, the clip drag writes nothing to
disk: it fills the line and leaves it for you to run. That is what makes the gesture safe to
try — and it is why the drop shows `event move — enter runs it, esc drops the line` rather
than the usual "moved" status.

Both halves are pure and tested (`commandFill.ts`, `commandFill.test.ts`); the wiring is not,
because nothing in this app mounts a component.

### Presentation

The validated command and the params filled so far are shown as a prefix before the
input, so the growing line stays visible. Backspace on an empty field steps back to the
previous one (its value returns to the input for editing).

Each param KIND has its own colour (`ARG_COLOR`) — worn by the field being typed, by its
suggestions, and by the value once filled — so the growing line tells you what it is
asking for before you read the prompt.

The bar sits at the bottom of the window, so the suggestion list opens UPWARD and is
rendered bottom-first: the highlighted entry sits right above the input (where the eye
already is) and ↑ walks away from it, the way a shell completion list reads.

The list is shown only while the input has **focus**, and that condition is load-bearing now
that the bar is docked. `sugs` is non-empty from the moment the catalogue loads — the command
phase filters the whole vocabulary — so "are there suggestions" left thirty rows hanging over
the minimap for ever. It went unnoticed for exactly as long as the bar was something you
opened. Taking a suggestion is safe under this rule because the list commits on `mousedown`
and preventDefaults to keep the focus, so the blur that closes the list can never be the one
that was about to pick from it.

## `ModulePicker.tsx` — "which module?"

Opened by the `+` on a graph arrow, before the command bar sees anything. Like
`ContextMenu`, it only PRE-WRITES: the command bar stays the single place where things
actually happen.

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

Only BASE modules appear, never instances — `loadModuleRefs` keys by module folder, so an
instance is never a ref of its own. That is the right set here, because picking one leads
to instantiating it.

The nesting is a good way to BROWSE and a bad way to find one module you can already name
— a 250-plugin catalogue is four hovers deep. So the root level also carries a search
field: type, and the tree is replaced by a flat ranked list of every module in every
namespace, whatever its type or category. ↑/↓ walk it, Enter picks.
