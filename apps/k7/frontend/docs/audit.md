# Audit — stability and speed of k7

A standing audit of `apps/k7`: the backend that mints the origin's session, and the SPA. The audio
axis as a whole — the engine, the file service and the costed web routes — is `docs/constat.md`'s
and `docs/audit-perf-web.md`'s, and this page does not repeat them. Findings are either an
invariant this app holds, written down so it is not broken again, or a numbered lot still open, and
why. Every entry was read in the code, not reported second hand.

## A read of the file service has a budget

`fget` (`@studio/project-shell/fileApi`) joins a GET already in flight, so a request that never
answers is never answered for ANY caller waiting on it — and the revision poller, which never
stacks a second ask, would stop noticing changes for the rest of the session. Nothing on the way
bounds it: the images carry no nginx, and a half-open connection after a laptop sleeps can hang
for minutes. A read is dropped after two minutes with a sentence, freeing the route for the
next caller; a write is not, since a write that timed out may have landed (`fileApi.md`).

## The editor does not ask for the project per keystroke

`EditorTab`'s effect that docks a clip's or a slice rack's waveform runs on every change of `file`,
and every keystroke replaces `file`. A `/project-doc` per run would be a round trip, a main-thread
parse of the whole compiled project, and a fresh object for the clip panel to re-render on. The
document moves when a file is WRITTEN, which moves the change token, so it is fetched once per
token (`hooks/useDocPerRevision.ts`), and the effect re-runs once when a save lands.

## A keystroke parses the buffer at most once, and late

Beyond its text, the editor reads three things off the open buffer: whether it is a slice rack
(the docked slicer's drags write into it), whether it is an input, and on which channels. Read
one by one, each is a `parseDocument` of its own on every keystroke of every file.
`src/bufferReads.ts` answers the three from ONE parse, and parses nothing when the text cannot hold
the keys a read looks for (`rack_type`, the word `io`, `extends`) — gates that are exact, since a
key the parser would find is spelled in the text. The reads run on a `useDeferredValue` of the open
file, so they trail the keystroke rather than delay it; the picture lane's placements read the same
deferred file, and only on a `video_tracks/` path. The slice colouring that runs inside CodeMirror
on every project file takes the same `rack_type` gate (`sliceSymbols.ts`).

A poll that answers what it answered before keeps the old object (`keepIfSame`,
`src/shellEquality.ts`): the editor's `hints`, from which every CodeMirror extension is rebuilt, its
tree, and the project's diagnostics, which the gutter re-lints on. The structural compare is cheaper
than the rebuild it saves by orders of magnitude.

## Nothing renders at the engine's frame rate that does not have to

The rule is `docs/playhead.md`'s: a reader of the transport writes a DOM node per animation frame
and renders nothing. What holds it here:

- **The clip waveforms** steer `@studio/ui-waveform` through its `setTime` handle, which moves a CSS
  clip over the played canvas and a line, and redraws no canvas
  (`packages/ui-waveform/docs/layers.md`).
- **The takes view** draws its line in a leaf per row, and its rows are memoised with their
  envelope paths, so a drag across the takes rebuilds no path.
- **A take being recorded** grows in a ring buffer outside React (`src/ringBuffer.ts`,
  `hooks/useLiveEnvelope.ts`): an O(1) push per frame where `shift()` was O(n), published to the two
  leaves that draw it at 10 Hz, so the clip panel around them does not render for it.
- **The header meter** is scaled rather than resized (`masterMeter.md`).
- **A hidden pane does no per-frame work**: the playhead loops and the lane meters read
  `PaneVisible` (`src/paneVisible.ts`) and stand down while CSS hides their pane, which stays
  mounted. The editor's pane is visible as a popin too.

## The shell keeps still while you type or drag

`App` is one 5 000-line component, so each of its renders reconciles every mounted pane. Three
things a pane says at the rate of input are kept out of its state, or bail when unchanged:

- **The editor names an open sequence by path.** Its text is re-sent on every keystroke, and the
  shell reads only the path (the `hover_midi_sequence` condition); carrying the text made each
  keystroke a new target. `EditFocus` (`src/shellEquality.ts`) has no text field, so it cannot come back.
- **The status line is a store, not state** (`src/statusLine.ts`, read by `StatusText.tsx`): a move,
  a resize or a selection re-states it per snapped cell, and only the line's span re-renders.
- **The timeline's view and the waveform prewarm bail when unchanged** (`keepIfEqual`): the first
  is re-sent as a fresh object on every caret move, the second polled every 350 ms. The prewarm's
  loop also stops when the shell unmounts, rather than setting state on a dead hook.

The tooltips' shortcuts read one inverted map per change of the person's keys (`commandKeyMap`),
and the minimap is memoised, since none of the shell's other reasons to render moves its props.

## A camera take is never thrown away

A video take lives only in the tab until `fileClip` stores it, and a camera cannot play the same
take twice. When the store fails, the take is saved to the person's downloads under its own name
and the status line says so — dropping that file on the lane files and places it as any dropped
video is. A MIDI take needs no such door: its whole `sequence note add` line is written to the log
before it is sent.

## The first screen carries no editor

The home page, the sign-in and the public rehearsal page share one entry chunk, and every static import
from it is paid before the first row is drawn. What lives behind a click is therefore behind a dynamic
import: the home's other pages (`appMain.tsx`), CodeMirror in the médiathèque
(`packages/ui-library/docs/audit.md`), the desk and the viewport in the editor
(`packages/k7-plugins/docs/plugins.md`), and the icon set, which the context menu asks for only when one of
its rows carries a picked icon (`docs/shell.md`). A module reached through a package's barrel is pulled
into the entry whenever the bundler cannot prove it inert — a top-level `lazy()` call is enough — so
`@studio/ui-library` declares itself free of side effects. The chunks to read after such a change are
`appMain-*` and `App-*`; `vite build --sourcemap` lists what is in each.

## The backend

- **The process** logs a stray rejection and survives; an uncaught exception is logged and exits,
  the container restarting it. The AI organize route catches its own failures and stops the Claude
  call when the tab closes.
- **The session is a signed cookie** (`cookie-session`), held by no server memory: a restart
  signs nobody out, and there is no store to grow.
- **A preference file is written beside and renamed** (`@studio/user-prefs`): a crash mid-write
  would read back as "no preferences", costing a person their command layout and their Claude key.

## AI organize keeps a kit's pads

A `tap` binds a rack sound, not a parameter. The answer check accepts the sounds the module's own
`rack:` declares, on taps and only there, and the prompt lists them — a kit's panel comes back with
its pads (`packages/ui-module-builder/docs/aiOrganize.md`). Both ends check the same list: the
builder and this app's backend call the same `bindableNames`.

## Already sound — do not re-suspect

- **The polls do not stack.** One refcounted `/revision` poller answers every consumer and skips a
  tick while its last ask is in the air.
- **A hidden tab polls nothing it would show.** The timers go through `pollWhileVisible`
  (`src/visiblePoll.ts`), the home page's workspace-sync check included.
- **The playhead does not render the shell.** Engine state lives in an external store read by
  slice, the arrangement's playhead is drawn per animation frame without a render
  (`usePlayheadFrames`), and no selector builds a fresh object per frame.
- **Everything started is stopped**: every `ResizeObserver` disconnects, every object URL is
  revoked, the camera relay's socket backs off and closes when the tab steps back, and the few
  listeners never removed are installed once per page on purpose.
- **Unsaved text asks before the tab closes** (`@studio/ui-editor/unsaved`).

## Left as lots

1. **`ui-waveform`'s `Waveform.tsx` is past 1 000 lines.** The layer split added to it rather than
   splitting it; the draw effect and the pointer handling are the two halves a split would take.
2. **`App.tsx` is 5 300 lines and re-renders its hidden panels.** Their per-frame work stands down
   while hidden (above), but a render of the shell still reconciles them. The input-rate renders are gone
   (above); what remains is a render per real change of shell state, which still reconciles every
   pane. `docs/constat.md` asks for a profile before memoising the panes themselves, and none has
   been taken since lots C and D. `TimelineTab.tsx`
   (4 000), `EditorTab.tsx` (1 600), `PianoRoll.tsx` (1 160) and six more are over this repo's
   500-line bar too; splitting them is the same work as memoising them, and wants that profile.
3. **Writes to the file service have no budget.** Deliberately, for the reason above; a hung write
   still holds its caller until the connection dies.

## What a change here should be verified with

```
cd apps/k7/frontend && npx tsc --noEmit -p . && npx vitest run
cd apps/k7/backend && npx tsc --noEmit -p .
cd packages/ui-waveform && npx vitest run
cd packages/project-shell && npx vitest run
cd packages/user-prefs && npx vitest run
```
