# One vim change, one undo

`src/vimUndo.ts` (`vimUndoSteps()`) sits beside `vim()` in every pane that has vim mode — k7's
EditorPane and `YamlPane`. With it, a vim change — the operator's edit and everything typed until
insert mode is left — is ONE undo event, for Ctrl+Z, Ctrl+Y and vim's own `u` and `<C-r>`.

## Why the history needs telling

CodeMirror's history groups by time and place: an edit joins the event before it only within
500 ms, touching it, with no cursor move recorded between. A vim change breaks all three — `ciw`
deletes, vim places the cursor for insert, and the person types when they type. So `ciw 132 <Esc>`
is two events, and the first Ctrl+Z leaves `tempo: ,`: half a change, which the autosave then
writes to disk (`autosave.md`) as a file that no longer parses. The undo step has to be the unit
the person thinks in, and in vim that unit is the change.

## How it is done, and what it does not do

It never edits the history. It LABELS the transactions of a change, and the history joins them
itself: the history merges an edit labelled `input.type.compose` into the event before it
unconditionally — the rule vim's adapter already relies on to make one command one event. The first
edit of a change carries `isolateHistory: "before"` instead, so it never joins the change before it.
Ctrl+Z, Ctrl+Y, `u`, the shell's local undo (`localUndo` in k7's EditorTab) and the redo branch all
stay CodeMirror's own commands, and need no wrapper.

A change ends on vim's own signals: `vim-command-done` in normal mode (each new command) and
leaving insert or replace mode. An undo or redo also ends one, since what is on top of the history
after it is an older change. Only the person's edits are labelled — typing, deletions, vim's
operators (`input…` / `delete…` user events); a write that reaches the buffer from elsewhere
(`bufferSync.ts`, a disk adoption outside the history) is left as it was.
