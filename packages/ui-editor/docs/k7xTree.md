# The buffer's k7x tree, and edits that land as splices

## One tree, held in the state

The links, the ▶ gutter and the slice colours all answer about a whole k7x buffer, and all of
them need the same thing: every value with its span, every key with `keyStart`/`keyEnd`. The k7x
language mode is a `StreamLanguage` with no syntax tree, so the tree is `parseTree(doc)` from
`@studio/k7x/parse`, held in a CodeMirror `StateField` (`src/k7x/tree.ts`) and recomputed on each
change. Every extension that reads it installs the field itself; CodeMirror keeps one instance.

Outside a view — a test's bare `EditorState` — `treeOf` parses the text on the spot, so the
readers are testable without mounting anything.

## The last good tree, while the text does not parse

A buffer stops parsing on nearly every keystroke: an open bracket, a half-typed string. Dropping
the tree then would make every link and every colour blink off and back on as you type. So the
field keeps the last tree that parsed, with the text it came from and the changes made since.

Its offsets are those of the old text, so a reader maps each span through the changes before using
it (`mapSpan`), and drops a span whose text is no longer what it was. Mapping alone is not
enough: an edit inside a value moves its end without deleting it, and a link would then underline
half a name. Comparing the mapped slice with the old one is what makes a stale span vanish rather
than lie.

## An edit made on the text lands as its own splices

A dock gesture — a slice handle, a clip window edge, an input's channels, a video reader's in-point
— edits the OPEN buffer, as a keystroke does, so autosave writes it the same way. The host holds
the text in React state, and `@uiw/react-codemirror` answers a new `value` by replacing the whole
document: the cursor jumps and the undo history records one opaque replace.

So the edit goes through `editK7xText` (`src/k7x/bufferEdit.ts`), which runs a k7x writer on a
`K7Document` and remembers the document's own `changes` beside the text it produced. The view
side, `useBufferSync`, runs in a layout effect — before the wrapper's value effect — and, when
the view still shows the text the edit started from and the host now holds the text it produced,
dispatches those splices as one transaction. The wrapper then finds nothing to replace.

It syncs only that pair, deliberately. Typing, a reload from disk and a grid's rewrite still go
through the wrapper, which already knows not to fight a hand on the keyboard; a sync that diffed
every difference would revert a keystroke the state had not caught up with yet.
