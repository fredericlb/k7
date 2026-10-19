# The edit path: from a gesture to a one-line k7x diff to the engine

Every arrangement edit travels the same road. Taking a clip drag on the timeline as the example:

```text
pointer up on a clip                       TimelineTab.tsx  commitMove
  → "event move drums 2:1:1 3:1:1"         App.tsx          onMoveEvent → runCommand(line)
  → runLocalCommand(line)? no              App.tsx          (shell-local verbs stop here)
  → POST /command { line, want }           apps/k7/frontend/src/api.ts
  → runWebCommand                          packages/file-service/src/engineLink.ts
      ws.recordChange(line, …)             journal: before/after of every file written
        runCommand(line, host, "cli")      packages/commands/src/commands.ts (dispatch)
          "event.move" handler             resolves track + event in the compiled doc, refuses or…
            moveTrackPlacement(…)          packages/song-edit/src/trackMix.ts
              setPlacementField / …        packages/song-schema/src/yaml/trackFile.ts
          h.reload()                       held until the run's last write
      flushPush → pushProject              compile the folder, send the ProjectDoc to the engine
  ← { output, refused?, rev, changed, graph? }
  → status line, log, reloadWith(changed)  App.tsx
```

## 1. The gesture produces a line

The pane never writes. `TimelineTab` reports a finished gesture through a callback prop
(`onMoveEvent`, `onResizeEvent`, `onFadeEvent`, `onToolLine`, `onReorder`, `onDropFiles`,
`onVideoEdit`…), and `App.tsx` turns each into a command string and calls `runCommand`. Tools go one
step further: `toolLine` in `apps/k7/frontend/src/timelineTools.ts` returns the line itself, which
is what lets a test pin a blade press to `event split <track> <start> <at>` without a DOM.

Positions are converted to timecodes at the edge, with `beatsToPosition` / `beatsToDuration` from
`packages/song-schema/src/timecode.ts`. The pane works in beats; the verbs speak
`bar:beat:eighth:sixteenth`, positions 1-based and durations 0-based. Getting the two kinds mixed up
is the classic bug here, which is why every argument that is a length says so in its `hint:` in
`packages/commands/commands.yaml`.

Keys go the same way: `apps/k7/frontend/src/keys.ts` maps a token to a command string (possibly
conditional, possibly interpolating the caret's track), and `resolveToken` hands it to
`runCommand`. A key can therefore never drift from the command bar.

## 2. Shell-local verbs stop in the browser

`runCommand` first offers the line to `runLocalCommand` in `App.tsx`. The verbs listed in
`LOCAL_COMMANDS` (`apps/k7/frontend/src/palette.ts`) are answered there: everything under `ui`
(views, tools, zoom, selection), the transport verbs that go straight down the engine socket for
latency (`localCommands.ts`'s `BARE_TRANSPORT`), and the few writes only a browser can make —
`selection copy|paste|delete|split`, `project undo|redo`, `project master fix`, `project export`,
`project import`. `selection paste|delete|split` do not write either: they compute a line
(`events add …`, `events remove …`, `event split …`) from the pane's state through the
`TimelineHandle` and run THAT, so the write still goes through the service.

These verbs exist only in the web shell; the CLI does not have them.

## 3. The file service runs the verb inside a journal entry

`POST /command` (`packages/file-service/src/routes/files.ts`) calls `runWebCommand`
(`packages/file-service/src/engineLink.ts`). The whole verb runs inside `ws.recordChange`, which
snapshots every file it writes and records one entry in the project's undo journal
(`packages/file-service/src/history.ts`): one command, one Ctrl+Z, whatever the verb touched.

This is why bulk verbs exist — `events add`, `events remove`, `events move`, `sequence notes …`,
`graph pin`. Looping the singular verb from the browser would make N journal entries for one
gesture and could fail half-way.

## 4. The verb resolves, refuses or writes

`@studio/commands` maps the line to a SID through `commands.yaml` (longest prefix wins) and runs the
handler with a `CommandHost`. Handlers follow a shape you will see everywhere in
`packages/commands/src/verbs/`:

1. Parse the arguments; on a bad shape, `h.refuse(["usage: …"])`.
2. Resolve against the **compiled** project (`h.project()`): the track, the event at that start,
   whether the destination lane can take this content type. Refuse with a sentence naming what is
   wrong, before touching disk.
3. Call one writer in `@studio/song-edit`.
4. `h.log([...])` a line saying what changed, then `await h.reload()`.

A refusal is its own outcome (`refused: true` on the reply), neither success nor error, and the
browser shows it on its own channel.

## 5. The writer changes the value and nothing else

`@studio/song-edit` writes k7x surgically, through a `K7Document` scope: the comments, key order,
layout and every other event stay byte for byte. A placement is addressed by its **start in beats**, since one clip can
be placed several times. The test that pins this, from `packages/song-edit/src/moveEvent.test.ts`:

```k7x
// before
events([
  ref("kick").start("1:1:1").fadeIn("0:1"),
  ref("snare").start("2:1:1").fadeIn("0:1").loop(2).disabled(true),
])
// after `event move drums 2:1:1 3:1:1` — exactly one line differs
events([
  ref("kick").start("1:1:1").fadeIn("0:1"),
  ref("snare").start("3:1:1").fadeIn("0:1").loop(2).disabled(true),
])
```

The one-line diff is what keeps edits mergeable by the live-sync relay and readable in history. A
writer that re-serialised the file would be a bug even if the result parsed.

## 6. The engine hears the new document

`h.reload()` does not push at once: it marks the project dirty (`HeldPush`), and the run flushes it
after its last write, so a verb that writes three files compiles once. `pushProject` compiles the
folder to a `ProjectDoc` and sends it over the engine socket. The engine never reads a workspace file.

Verbs that only touch a running parameter (a fader release through `node param`) also patch the
live engine without a full reload.

## 7. The browser reconciles

The reply carries the lines, `refused`, the new revision token (`rev`), the list of files written
(`changed`) and, when a graph is on screen, the new graph. `App.tsx` adopts the revision before the
reload it pairs with, so the `/revision` poll does not repeat it, and `reloadWith(changed)` refetches
only what those files affect.

Between the send and the reload, two mechanisms keep the lanes from flickering:

- **Drags hold their result.** A committed move, resize, fade or picture drag is kept in the
  component as `pending: true` and drawn where it was dropped until the next document arrives, which
  replaces it whether the command succeeded or not.
- **One-shot lines are predicted.** `pendingOf` in `apps/k7/frontend/src/pendingEdits.ts` reads a
  sent line (`event remove`, `events remove`, `event status mute|warp`, `event split`,
  `event crossfade`, `events move`) and returns what it will do; the lanes draw it at once
  (`pendingClips`, `pendingSplitAt`). A refusal drops the prediction; the next document makes it
  true.

Mute, solo and highlight use a third, smaller version of the same idea: an optimistic override in
`apps/k7/frontend/src/hooks/useTrackControls.ts`, cleared when a fresh document agrees.

## 8. Undo goes back down the same road

`project undo` / `project redo` call `/undo` and `/redo`, which rewrite the recorded before/after
over the project and push it to the engine. A step that carried binary blobs (a bounce) answers
`needsConfirm` first; `packages/project-shell/src/undo.ts` asks, then retries with `confirm`. The
blobs are kept on the engine machine that rendered them (`packages/file-service/src/historyKeeper.ts`),
so undoing such a step on another engine refuses instead of guessing.

## See also

- [The timeline component](./22-timeline-component.md)
- [Extending: a new gesture or verb](./29-extending-arrangement.md)
