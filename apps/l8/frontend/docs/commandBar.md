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
