# The shell (`App.tsx` and `main.tsx`)

## What wraps the editor (`main.tsx`)

The gates, outermost first: **AuthGate** (you must be signed in — hosted backend OIDC),
**EngineGate** (pick which registered engine to drive), and **WorkspaceGate** (rendered by
EngineGate: pick a workspace on that engine, then mount the editor). Several tabs may open
one workspace at once — there is no single-tab lease.

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

  Either way the chain will name `module:instance`, so an *instance* is what is really being
  created — and its name is the one thing only the user can supply, which is why both paths
  stop at the bar. From a namespace it takes one command: a chain cannot name `@engine/…`
  (`use` takes a local module), so it creates the local module that inherits it *and* the
  instance, with the module name pre-filled and the instance name left to you.

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
