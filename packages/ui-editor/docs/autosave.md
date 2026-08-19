# Autosave — the editors have no Save button (with one exception)

Every text pane in this repo used to end in the same button: `Enregistrer *`, `Save *`. It is
gone. The buffer is written **as soon as it is a document the compiler could read**, and held
back — visibly, with the reason — for as long as it is not.

The rule is one sentence: **a file is written when it is valid.** Everything below is what that
sentence has to mean for it to be safe.

## Why validity, and not a timer

A plain debounced autosave writes whatever is in the buffer, which for YAML means writing a
half-typed line several times a minute. Every one of those writes is seen: the file service
bumps `/revision`, l8 re-vets the project, the graph rebuilds, other tabs adopt the new text,
and the engine is handed a document that does not compile. The editor would spend most of its
life publishing broken states.

So the buffer is judged before it is written. `@studio/song/yaml/validate` answers the
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
build does not know, a project written by a newer one, something a human typed into git — and
if the schema gated every write, nothing you typed could make it valid, and there is no longer a
button to overrule the check with. That file would be uneditable, forever.

So the check that gates the write is not "is this valid" but **"does this make it worse"**:

- text that does not **parse** is refused always, no matter what is on disk. YAML that cannot be
  read back is not a state anything can recover from.
- text that fails its **schema** is refused only when the file on disk passes it. If disk is
  already refused, the write goes through — with the reason still said out loud.

`decideAutosave` is that rule, and it is a pure function so it can be exercised without a
browser (`autosave.test.ts`).

## What is held survives the pane

Held text lives in a `Map` outside React, keyed by path. That is the point: an unwritable buffer
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

`flush()` resolves to **whether the buffer is on disk afterwards** — false when it was held back
or the write failed. That is not decoration: a screen saving several files at once needs the
answer before doing anything that assumes they all landed. The module builder commits and pushes
a repository on that answer, and committing a module whose `module.yaml` is still yesterday's
would put a half-edit in front of everybody.

**One caller: the module builder** (`@studio/ui-module-builder`). A module is four files
describing one thing, and on a shared one a save is a *publish* — see
`apps/l8/frontend/docs/sharedModules.md` for why that earns a button.

## Ctrl+S still exists

`Mod-s` and vim's `:w` mean **now** rather than **at all**. They flush the timer; they do not
overrule the rule. Whoever asked does not change whether the document compiles.

## Who uses it

| pane | file(s) |
|---|---|
| l8 `EditorTab` | the open project file — plus its findings drawn in the gutter beside the server's |
| m9 `EditView` | the open project file |
| pl8 `SongEditor`, `ChainEditor` | the médiathèque's `song.yaml`, a chain template's `graph.yaml` |
| l8 `PlaylistEditor` | a playlist in `_playlists/` — not a project file, so it hands the hook its own `validate` |
| `@studio/ui-module-builder` | **four** at once: `module.yaml`, `ui.yaml`, `presets.yaml`, `jsdsp.ts` |

The builder is the one worth reading twice. Four files, four autosaves, deliberately not one
save that walks them in order: they are four documents with four schemas, and a half-typed
widget in the panel must not stop the module file reaching disk. Its header shows the
`loudest()` of the four; which file it is about is on its tab, where the name already is.

## What changed for the files that had no file yet

pl8's song sidecar and l8's playlists open on a **stub** when nothing is on disk. With a button,
the stub was written by clicking it. With autosave, the stub is loaded as `saved` as well as as
the buffer — so opening a song files nothing, and the first thing you actually type creates it.
Looking at something must not write it.

## What a write drags behind it

In l8 a write is not only a write: it re-reads the tree and the hints, and tells the shell the
project changed, so the arrangement and the graph recompile. That is why the delay is a whole
second rather than the 300 ms a text editor would use — the cost of a write here is the cost of
a compile.

It also means the undo journal now records an entry per PAUSE rather than per Save. Finer, and
larger; nothing coalesces them yet.

## What it costs

An edit that used to be undone by *not saving* now needs an undo. The module builder's preset
shelf was the one place that leaned on it: trying four presets in a row wrote nothing until you
committed. It writes four times now, and the way back is Ctrl+Z in the code pane — plus, in l8,
the journal every write is recorded in.
