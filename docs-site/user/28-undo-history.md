# Undo and the song's history

Every edit to a song — a drag on the timeline, a typed command, a knob released in the graph — goes into the song's **undo journal**. One gesture is one entry: a paste of
twelve events, a region transpose, a dropped file's placement are each a single step.

## Undo and redo

| Key | Command |
|---|---|
| Ctrl+Z (⌘Z) | `project undo` |
| Ctrl+Y, or Ctrl+Shift+Z | `project redo` |

When the text editor has the focus, Ctrl+Z first undoes your typing in that buffer; once the buffer
has nothing left to undo, the next Ctrl+Z reaches the song's journal. In the command bar or another
text field, Ctrl+Z stays with that field.

After an undo, a toast names the file that changed (`Undone : nodes/drums.yaml`, `(+2)` when more
than one did) and the editor shows it. The song reloads and the engine plays the restored version.

Undoing a step that **bounced audio** (`track process`, `clip process`, `event process`) asks first —
"Undo the process?" — because it puts the previous audio file back.

The journal holds up to 1000 steps per project. It lives outside your project folder, on the machine
that keeps your workspace. The audio a bounce replaced is kept on the engine's machine; undoing such a
step while playing on another engine is refused rather than guessed at.

## The History panel

Open it with the **History** button on the right of the header, or `ui history`. It lists the
journal's steps, newest first, each with its command line and the files it touched. Steps that have
been undone are drawn faded.

Hovering a step **lights what it touched**: the lanes it changed are tinted on the timeline, the
clips whose files it changed are outlined in amber, and the chains or single nodes are marked on the
graph. Hovering changes nothing.

Below the journal the panel shows the workspace's synced history — named points and checkpoints you
can restore. That history covers the whole workspace on every device; it is described in the editor
shell section (sync).

## See also

- [Events and clips](./22-clips.md#copy-and-paste) for the clipboard
- [Keys and commands for arranging](./29-arranging-reference.md)
