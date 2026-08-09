# The two views

`routes.ts` names them and the address carries which one is showing, so a link to either
survives a reload. There are two, not three, and the missing one is the point of this page.

## Montage — the viewport over the timeline

The app's actual work, and the only screen that is v1's own rather than borrowed.

**The viewport on top, the timeline below, and nothing splits them.** Both halves answer
one question from opposite ends — *what is on frame*, and *where that frame is* — and
neither has a competitor for the width, so a draggable divider would be a control that
exists to be left alone.

The viewport is `@studio/ui-eyes` drawing a `VideoScene` with WebGL. The scene is rebuilt
only when the DOCUMENT changes, never on a playhead frame: it owns a GL context and a
`<video>` element per layer, and rebuilding it sixty times a second would tear both down
sixty times a second.

### The timeline is in seconds, and that is why it is not l8's

l8's timeline is ~1900 lines of musical grid: bars, beats, a caret that walks a tempo map,
clips whose positions are timecodes. None of that survives contact with a cut, where a
position is a decimal second and no setting can move it.

So `views/Timeline.tsx` is v1's own, at a tenth the size. What the two genuinely share
lives in `@studio/ui-timeline`: the wheel zoom anchored under the cursor, the middle-drag
pan, the tick chooser, and the lane geometry both draw to. Sharing the COMPONENT would
have meant a mode flag threaded through every one of those 1900 lines.

### The three drags

One pointer capture, told apart by where the press landed:

| grab | writes | why |
|---|---|---|
| the body | `start` | move the placement |
| the left edge | `source_from` **and** `start` | trim the head |
| the right edge | `length` | set the extent |

The left edge writes **two** fields, and that is the interesting one: trimming the head
must move the shot further into its source by exactly as much as it moves on the timeline,
or the frame under the new edge is not the frame that was there before the trim. A
placement with `length: 0` gets a third write — its extent has to be pinned, or the
source's own length would undo the trim on the next compile.

A length-0 placement draws dashed and amber, at a placeholder width. The browser has not
measured the source, so the honest thing is a shape that says "this is provisional"
rather than a confident rectangle of the wrong size.

### The transport

Its own clock (`TransportClock`), because there is no engine to follow — see
[plumbing.md](plumbing.md). It stops AT the end rather than looping: a cut that restarted
itself would make "did it finish" unanswerable while you are watching the last shot.

Space toggles it from anywhere but a text field. That is the app's only global key.

## Édition — the files

`@studio/ui-editor`'s CodeMirror stack, the same one l8 and m9 mount: the YAML language
mode, and completions derived from the Zod schemas so the offered fields cannot drift from
the real ones. There is no Save button — the file is written as soon as it is a document the
compiler could read, and held back with the reason while it is not
([autosave.md](../../../packages/ui-editor/docs/autosave.md)).

For an open `video_tracks/*.yaml` it grows the **readers strip**: one small `<video>` per
placement, with Set From / Set To writing that placement's `source_from` / `length`.

The strip reads its numbers from the **buffer** and its file paths from the **compiled
document**, and the split is deliberate: a trim typed a second ago has no compiled form
yet, so waiting for one would put the strip a step behind every edit — but which media
file a `ref` names is something only the compiler knows, because it read
`clips/<ref>.yaml` to find out. A ref the document has never seen simply has no reader,
which is the honest answer rather than a black rectangle.

## What v1 does not have

- **A chains view.** A cut has no signal graph. `video_effect` / `video_transition` are
  modelled in the document and compiled by nothing (see
  [v1Project.md](../../../packages/song/docs/v1Project.md)); a view over an empty model
  would be a promise.
- **A command bar.** l8's is 345 lines plus a palette plus a backend catalogue. Worth
  having, not worth having badly.
- **Export.** `@studio/ui-eyes` exports frame-by-frame through WebCodecs and v1 mounts no
  button for it. The footer says when the browser could not do it anyway.
- **Undo.** l8 and m9 walk the file service's journal (`@studio/project-shell/undo`); v1
  does not mount it yet, so a drag is undone by dragging back or by editing the file.
