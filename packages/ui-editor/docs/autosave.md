# Autosave — the editors have no Save button (with one exception)

No text pane in this repo ends in a `Enregistrer *` / `Save *` button. The buffer is written
**as soon as it is a document the compiler could read**, and held back — visibly, with the
reason — for as long as it is not.

The rule is one sentence: **a file is written when it is valid.** Everything below is what that
sentence has to mean for it to be safe.

## Why validity, and not a timer

A plain debounced autosave writes whatever is in the buffer, which for a k7x file means writing a
half-typed line several times a minute. Every one of those writes is seen: the file service
bumps `/revision`, k7 re-vets the project, the graph rebuilds, other tabs adopt the new text,
and the engine is handed a document that does not compile. The editor would spend most of its
life publishing broken states.

So the buffer is judged before it is written. `@studio/song-schema/yaml/validate` answers the
question — see [that package's page](../../song/docs/validate.md) — and the answer is the same
one the loader gives, because it is the same parsers and the same Zod schemas.

## The three answers

| the buffer | what happens |
|---|---|
| valid | written after the typing stops (`AUTOSAVE_DELAY_MS`, one second) |
| parses, but the schema refuses it | **held**, and the toolbar says what is wrong and where |
| does not parse at all | **held** — always, no exception |

A held buffer is not lost. It stays where it is, the editor goes on showing it, and the gutter
underlines the line the complaint is about.

## The escape hatch, and why it exists

A rule that only ever refuses is a trap. A file can already be invalid **on disk** — a key this
build does not know, a project written by a newer one, something a human typed by hand — and
if the schema gated every write, nothing you typed could make it valid, and there is no button to
overrule the check with. That file would be uneditable, forever.

So the check that gates the write is not "is this valid" but **"does this make it worse"**:

- text that does not **parse** is refused always, no matter what is on disk. Text that cannot be
  read back is not a state anything can recover from.
- text that fails its **schema** is refused only when the file on disk passes it. If disk is
  already refused, the write goes through — with the reason still said out loud.

`decideAutosave` is that rule, and it is a pure function so it can be exercised without a
browser (`autosave.test.ts`).

The disk's verdict is asked only when the buffer parses and its schema refuses it, and it is kept
(`baselineMemo`) for as long as the saved text is the same string. On a large file each answer is a
full parse and a schema walk, and the timer fires after every pause in the typing while the disk
has not moved. The memo keys on the path and the text, not on the `validate` function: a pane's
judge is its file kind's fixed rule, and a host may hand a fresh closure on every render.

## What is held survives the pane

Held text lives in a `Map` outside React, keyed by path (`src/autosaveBuffers.ts`, apart from the
hook so a host that only flushes or forgets loads no validator). That is the point: an unwritable buffer
is at its most fragile exactly when the pane showing it goes away — you switch file, close the
popin, leave the view — and dropping it on the floor there would be the data loss this whole
mechanism exists to avoid.

So every editor's load does:

```ts
setText(recallBuffer(path) ?? fileOnDisk.content)
```

Reopen a file you left half-typed and you get your text back, still dirty, still held, still
saying why. It is forgotten when it lands — and only if what landed is what is held, so an edit
made *while a write was in flight* is not thrown away by that write's completion. Closing a pane
mid-write hits exactly that case, which is why `settleBuffer` compares rather than deleting.

The key carries a SCOPE too — the project, for a host that moves between projects without a page
load (k7 names it with `setBufferScope`). A path names a file in every project, and a pane of the
project left closes in a passive cleanup, after the host has already forgotten everything at the
crossing: keyed by path alone, its text would come back in the next project's file of the same
name, and be saved there. Each `useAutosave` captures the scope it was mounted in and keeps under
that one, so the order of React's cleanups decides nothing; `recallBuffer` reads the scope now.

### …but it does not survive the PAGE

That `Map` is module state, so a reload, an F5 or a closed tab takes it with them, and for a long
time that happened without a word — the one road out of this mechanism that lost text silently.
`unsaved.ts` is the answer: `useAutosave` claims a `beforeunload` guard for as long as its status
is anything but `clean`, so the browser asks before the page goes. One listener however many
panes are open, released when the pane goes clean or unmounts.

The claim is keyed by the claiming hook's own `useId`, deliberately **not** by path. Two panes
can show one file — the editor and its popin are the obvious pair — and a Set keyed by path would
hold one entry for the two of them, so the first to go clean would unbind the guard while the
second still had unwritten text.

It guards `pending` and `saving` too, not just `held`. A reload 200 ms after a keystroke is
exactly as lossy as one over an unparseable buffer, and the timer being about to fire is not the
same as the write having landed.

The two screens with a real Save button — the module builder and k7's commands settings — claim
the same guard by hand, since their draft is React state rather than a held buffer.

## Two pairings that must never be confused

The hook takes `path`, `text` and `saved` as separate props, and for one commit after a file
changes they do not agree: the host has the new path but has not finished reading it, so `text`
is still the previous file's. Writing from that pairing would put one file's text at another
file's path.

`useAutosave` therefore skips the commit in which the path changed, and records that commit as
if nothing were pending — so neither the timer nor the closing flush can act on it. One commit
later the buffer has caught up and everything proceeds. The same care is why a write's status is
only painted when the pane is still showing the file the write was for.

## `manual` — the same machine with the timer off

`useAutosave({ manual: true })` never writes on a timer; `flush()` is the only thing that
writes. Everything else is untouched — the same validation, the same held-back reason, the same
kept buffer — because *when does it write* and *may it be written* are different questions and
only the first one moves. A screen in this mode has a Save button, and `flush()` is what the
button calls.

One real difference, and it is the one worth thinking about: **what happens when the pane closes
with an unsaved buffer.** On a timer that is the last chance and it is taken. Here the whole
point is that nothing writes unasked, so the buffer is KEPT instead and comes back with the file
through `recallBuffer`. Nothing is lost either way; what differs is who decided.

`flush()` resolves to **whether the buffer is on disk afterwards** — false when it is held back
or the write fails. That is not decoration: a screen saving several files at once needs the
answer before doing anything that assumes they all landed. The module builder publishes on that
answer, and publishing a module whose `module.k7x` is still yesterday's would put a half-edit in
front of everybody.

**One caller: the module builder** (`@studio/ui-module-builder`). A module is four files
describing one thing, and on a shared one a save is a *publish* — see
`apps/k7/frontend/docs/sharedModules.md` for why that earns a button.

## Paused, and flushed for someone else

`enabled: false` pauses the timer without dropping anything: a pane asking the person which of two
versions to keep turns it off, since a write at that moment would answer the question for them.
Text that is closed while paused is KEPT, like held text, rather than written.

`flushAutosaves()` is for a host about to replace or record the files under every pane, which must
include the last second of typing. It writes each pane's pending text now
and answers false when one could not be written: held, paused, or a `manual` draft, which is never
saved on somebody else's behalf. The host refuses its operation on false rather than run it over
text that is not on disk.

## A failed write is tried again, further apart each time

A write that fails keeps its text and shows `error`; the text is tried again on its own, 2 s
later, then 4, 8, 16, capped at 30 s (`retryDelayMs`), and the count starts over once one lands.
Not every second: a service that is down would be asked once a second by every open pane. Not
after a refusal (a 4xx, `retriable`): the same text would be refused again, and a stale base
(409) is a question for the person, asked by the pane's conflict banner. The next keystroke
re-arms the ordinary timer either way.

## Ctrl+S still exists

`Mod-s` and vim's `:w` mean **now** rather than **at all**. They flush the timer; they do not
overrule the rule. Whoever asked does not change whether the document compiles.

## Who uses it

| pane | file(s) |
|---|---|
| k7 `EditorTab` | the open project file — plus its findings drawn in the gutter beside the server's |
| k7 `ChainsBuilder`, `ModuleSidePane` | a library chain's file, and a module's own file from the side pane |
| `@studio/ui-library` `SongTagsForm` | a song's tags, as a form serialised to JSON — not a file, so it hands the hook its own `validate` |
| k7 `PlaylistEditor` | a playlist in `_playlists/` — not a project file, so it hands the hook its own `validate` |
| `@studio/ui-module-builder` | **four** at once: `module.k7x`, `ui.k7x`, a jsdsp or Faust source, `widgets.js` |

The builder is the one worth reading twice. Four files, four autosaves, deliberately not one
save that walks them in order: they are four documents with four schemas, and a half-typed
widget in the panel must not stop the module file reaching disk. Its header shows the
`loudest()` of the four; which file it is about is on its tab, where the name already is.

## The files that have no file yet

k7's playlists open on a **stub** when nothing is on disk. The stub is
loaded as `saved` as well as as the buffer — so opening a playlist files nothing, and the first thing
you actually type creates it. Looking at something must not write it.

## What a write drags behind it

In k7 a write is not only a write: it re-reads the tree and the hints, and tells the shell the
project changed, so the arrangement and the graph recompile. That is why the delay is a whole
second rather than the 300 ms a text editor would use — the cost of a write here is the cost of
a compile.

It also means the undo journal records an entry per PAUSE rather than per save. Finer, and
larger; nothing coalesces them yet.

## What it costs

An edit has to be UNDONE, since not saving is not a way to discard it. The module builder's preset
shelf is where that shows: trying four presets in a row writes four times, and the way back is
Ctrl+Z in the code pane — plus, in k7, the journal every write is recorded in.
