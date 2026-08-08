# The shell (`App.tsx` and `main.tsx`)

## What wraps the editor (`main.tsx`)

The gates, outermost first: **AuthGate** (you must be signed in — hosted backend OIDC),
**EngineGate** (pick which registered engine to drive), and **ProjectGate** (rendered by
EngineGate: resolve the repository this editor was opened on into a folder on that engine's
machine — cloning it if it has never been there — then mount the editor). Several tabs may
open one project at once — there is no single-tab lease.

**ProjectGate picks nothing.** l8 no longer knows what a workspace list is: st0 owns the
repositories and links here with an address — `/l8/<repo>/<project>` — and arriving without a
project in it sends you back there. That prefix is the router's `basename`, so the app's own
routes are written below it and cannot rewrite it away. The gate is
`@studio/project-shell`'s — m9 mounts the same one — and `components/ProjectGate.tsx` only
supplies this app's wording. Read
[packages/project-shell/docs/launch.md](../../../../packages/project-shell/docs/launch.md)
before touching any of it, in particular why the address is a path and the repository is named
rather than spelled out.

`LocaleProvider` sits above all of them: switching language remounts its children, so
nothing that renders a message may live above it.

`BrowserRouter` sits *outside* the gates. The URL names a **screen of the editor**, and the
gates are conditions for reaching it rather than places of their own — so a deep link like
`/timeline?panel=mixer` survives them: you sign in, pick an engine, and land where the link
pointed.

### React.StrictMode is deliberately NOT used

In dev it mounts, unmounts and remounts every component, and for the imperative WebGL
renderer here (the ui-eyes video compositor) each mount creates and then tears down a WebGL
context. On Firefox that context thrash was losing the context and freezing the tab for
seconds while everything was re-uploaded to restore it — confirmed: the freezes stop with
StrictMode off.

StrictMode's double-invoke exists to surface effect-cleanup bugs, but an
async-initialised WebGL renderer cannot be made double-mount-safe cheaply, and the freeze
is a real user-facing cost. So the dev check is forgone here on purpose. (The chains graph
used to be a second such renderer; it is the DOM now, and double-mounts harmlessly.)

## The layout (`App.tsx`)

`App` is the l8 web editor itself: the global view — the file editor down the left
half, the timeline over the chains graph on the right — with the transport controls and
the pane toggles in the header. It is the wiring and the layout; almost nothing else.

See also [shellRouting.md](shellRouting.md) for how the screen state maps to the URL.

### The Mixer panel draws the graph's strips, not its own

`MixerTab` has no controls of its own. It is the row of MIXER MODULES the song actually
has — the module each track ends on (`trackMixer`, by plugin type) — drawn as the very
cards the chains view draws, side by side, in track order.

It used to hand-roll a strip per track: a VU, a fader, a pan slider, M and S. That was a
second implementation of a channel strip, and it drifted from the one the module's own
`ui.yaml` declares — a module could grow a knob and the panel would never show it. Now
whatever the mixer module's panel says IS the mixer, and the two cannot disagree because
they are the same component.

Three consequences, all of them the design rather than gaps:

- **A track with no mixer module has no strip.** It is not "at unity" — it is a track with
  nowhere to put a level, which is what the panel should say rather than draw a dead fader.
  A song where no track ends on a mixer shows a line saying so.
- **Mute and solo are not here.** They were never the strip's — they are the track's, and
  they live on the timeline (`m`/`s`) and on the graph's track nodes.
- **Two tracks sharing a strip draw one card.** In practice the compiler makes such a strip
  its own bus track, so it arrives once anyway; `mixerModules` de-duplicates regardless,
  because two cards for one value would be two controls fighting.

Two sources, because neither answers alone: the compiled project says *which* modules are
strips and in what order (the graph doc does not carry a plugin type), and the graph says
what each one looks like. `moduleRow` (in `@studio/ui-chains`) then places them — no dagre,
since there is nothing to route and the order is the song's, not a layout engine's.

It also drops each card's **sockets**. The row has no edges by construction, so every jack on it
would plug into nothing — furniture, and on a rank of strips, furniture *between* them. The
routing that makes a socket mean something is the chains view's job; go there to see what feeds a
strip.

#### It fills the HEIGHT, and the row pans

`fitAxis="height"`, not the default fit-both. This is not a preference: fitting both axes
divides the panel between however many strips the song has, and the camera scale falls with
every track added. Below `WIDGET_MIN_SCALE` (0.6) the renderer drops the widget grid
altogether — so a busy song's mixer would show a rank of bare name cards, which is the one
thing this panel must not do. Measured on a 1200×280 panel with a 3×6 strip grid:

| strips | fit-both | fit-height |
|---|---|---|
| 4 | k 0.85, card 152×225 | k 0.85, card 152×225 |
| 8 | k 0.66, card 119×175 | k 0.85, card 152×225 |
| 12 | **k 0.44 — widgets dropped** | k 0.85, card 152×225 |

Filling the height instead keeps every strip the same readable size whatever the track
count, and lets the row run off the right, where it pans. A mixer you have to scroll beats
one you cannot read.

The cards are drawn at **1.5× the width their grid asks for** (`STRIP_WIDTH_SCALE`). That is
elbow room, not bigger controls: the grid inside a card is a fixed cell size (`widgetRect`),
so the extra width is space beside the controls, and the height is deliberately left alone —
scaling it too would only add dead space under them.

## A view is a LAYOUT, not a mode

All three panes are mounted always, and always the *same instances*. Three pieces of
state decide what you see, and none of them mounts or unmounts anything:

- `full` — which pane gets the whole screen (`null` = the global view)
- `focus` — which pane gets the keys; Tab walks the focus ring
- `panel` — the side panel, independent of both

`f` expands what you are on, Escape backs out. Because nothing is torn down by any of
that, the state that would be expensive to rebuild — the open file and its undo history,
the timeline caret, the zoom stack, the graph canvas — simply never moves. This is the
one invariant to preserve when adding a pane: mount it once, unconditionally, and let the
tables decide its size.

### The editor POPIN

A command that sends the editor to a file (`ui file`, `edit clip`, `edit sequence`) has to do
something when the editor pane is off screen. It used to **fullscreen** it, which answered a
question nobody asked: you wanted the file, and it threw away the timeline or the graph you
were about to read it against.

It opens as a popin instead — over the layout, on a dimmed backdrop, **without the file tree**,
because a command already named the one file it is showing.

It is the SAME EditorTab, in the same place in the tree, wearing different classes. That is
forced by the invariant above and is also what makes it good: the open file, its undo history
and the CodeMirror instance survive being popped out and put back, because nothing unmounted.
A second editor would have been a second undo stack.

Three details it needs to be usable:

- **The popin is the active pane** while it is up (`activePane`), or the pane underneath would
  keep answering the keys.
- **It closes on a click outside, or the ×** — not on Escape. Escape belongs to the editor: in
  vim mode it leaves insert mode, and a key that both leaves insert mode and closes the window
  you are typing in is a trap.
- **Any change of layout puts it away.** It is a detour to one file, not a place to be, so it is
  deliberately NOT URL state — a reload lands you in the view, not in the popin.

## The command palette

A double-tap of Shift opens the palette (IntelliJ style). It runs the brain's shared
commands — the same ones `l8 cmd` runs on the CLI — so the UI adds no command
vocabulary of its own: pick a command, fill its parameters, Enter runs it. The catalogue
and the argument completers live in [`../src/palette.ts`](../src/palette.ts).

## Live state does not re-render the tree

The transport and the engine's live state arrive over the WebSocket at roughly 20 Hz.
Held as React state on `App`, each frame re-rendered the whole editor even when nothing
visible changed. They live in an external store (`engineStore.ts`, and `pluginParamsStore.ts`
for plugin parameters) instead, and components subscribe to just the slice they draw — so
a state frame re-renders the meters, not the tree. Keep it that way: pulling a live value
into `App` state costs a full render per frame.

The palette opens on a **double-tap of Shift**: two lone Shift presses within
`DOUBLE_SHIFT_MS` with no other key between them. `e.repeat` filters out the auto-repeat
stream from a held Shift.

### The `ui` namespace

The shell's own view commands (`LOCAL_COMMANDS` in `palette.ts`) live under a `ui` prefix,
stripped in one place rather than by renaming every branch. The pairing is then **enforced
both ways**: a `ui` command typed bare is refused, and so is a non-`ui` command typed with
the prefix. `ui` promises "writes nothing, does not move the transport", and a `ui locate`
that quietly moved the playhead would be a worse lie than having no namespace at all.

A line the shell recognises but cannot act on is reported as *handled* rather than passed
down: the backend has no such command either, and "unknown command" would say less.

## Two-step flows

Some gestures need a second command the user did not type, and both are held as pending
state in `App`:

- **The graph's `+`.** Clicking an arrow's `+` asks *which* module before writing anything.
  The picker is fed from hints, so it offers what the project already has plus the whole
  plugin catalogue, and picking **pre-writes** a command rather than running one. The
  command only *creates* the module; `runCommand` splices it into the chain once the create
  comes back clean (see `moduleInsert.ts`), so a rejected name never splices a module that
  was never written. Any other command in between means the user moved on, and the pending
  insert is dropped. With no hints there is nothing to show, so it falls back to pre-writing
  the command with the two ends and letting the bar's completion take over.

  Either way the chain will name the *instance*, so an instance is what is really being
  created — and since a chain now names it by its FILENAME alone, that name is the one thing
  only the user can supply, which is why both paths stop at the bar. From a namespace it
  takes one command: a chain cannot name `@engine/…` (`use` takes a local module), so it
  creates the local module that inherits it *and* the instance, with the module name
  pre-filled and the instance name left to you.

- **`rec <track>`** (the `r` key). An instrument track arms for MIDI capture in the browser;
  an audio track falls through to the backend, which arms it in the engine. Same key, routed
  by whether the track carries a sequence.

## Mobile

A phone gets tabs, not the studio layout: the panes are too small side by side and there is
no pointer to drag a splitter with. `full` already means "one pane, whole screen", so the
tab bar just drives it and the global view is never entered — which is why entering mobile
has to land on a tab. Timeline is the default, being the one pane that says what the song
*is*: the editor needs a keyboard and the graph needs room.

Every row of chrome is a row the panes do not get. On a phone in landscape the whole window
is about 400px tall, so the header and footer are trimmed to what a touch target needs and
no more.

## The PWA manifest uses RELATIVE urls, deliberately

`public/manifest.webmanifest` has `"start_url": "."` and unprefixed icon `src`s, and neither
is an oversight. A manifest's URLs resolve against **the manifest's own address**, and Vite does
not rewrite the contents of a public file the way it rebases `index.html` — so anything written
`/…` there is origin-absolute and escapes the app.

That was live for a while: the manifest still said `"start_url": "/"` after l8 moved under
`/l8/`, and the origin root is **st0**. Installing l8 as an app opened the médiathèque.

Relative is also the only form that survives both mounts, which is what settles it — `base` is
conditional (`/l8/` when hosted, the root under `STUDIO_WEB_PORT` in the native run), so a
hardcoded `/l8/` would simply break the other one.

## Where the rest of it went

| piece | file |
|---|---|
| the pane/view/panel tables, transport clock | `src/shellMeta.tsx` |
| the palette catalogue and argument completion | `src/palette.ts` |
| self-contained slices of state | `src/hooks/` — engine link, project doc, track controls, polls, logs, MIDI recording, dialogs |
