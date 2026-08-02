# ingest.ts — extended notes

## Additive, never replacing

An import copies what is missing and leaves what is there, reporting both.

The library is **shared**: every project that names `@mediatek` inherits from it. Replacing
a module because someone imported a workspace that happened to contain one of the same
name would change what all those projects play, from an action whose subject was a
different workspace entirely — and there would be no author, no diff and no way back,
since the mediatek is not a git repo.

Overwriting is a decision someone has to make per module, looking at both. An import has
no per-module answer to make it with, so it declines to guess and says what it skipped.

## Why file-by-file rather than `cpSync`

`cpSync(src, dest, { recursive: true, force: false })` does the same copying. It reports
nothing.

"What did this actually change" is the whole answer an import owes its caller: it is what
makes the operation reversible by hand — delete exactly the paths in `copied` and the
library is as it was — and it is what lets a surface say "9 added, 3 already there"
instead of "done".

## The three folders

| workspace | library | why |
|---|---|---|
| `_modules/` | `modules/` | the module library, the thing this is mostly for |
| `_library/` | `library/` | `ir/` and `nam/` assets a module names |
| `_ui/` | `ui/` | the panels, which travel with the modules they draw |

A workspace missing one of them is normal, not an error — most have some and not others —
so those are reported in `absent` rather than thrown.

`_ui` is filed as part of the `modules` family for revision purposes: a panel is the face
of a module, and a surface listing modules wants to know when one changed its face.

## What this deliberately does NOT do

- **It does not decide the library's namespace.** A workspace's `_modules/config.yaml`
  declares one, and it is copied like any other file — so **the first workspace imported
  into an empty library sets the library's namespace**, and every later one has its config
  skipped as "already there".

  That is the additive rule applied consistently, and it is very probably not what anyone
  wants: the namespace is what refs are keyed by (`@mine/audio/reverb`), so it should be
  the library's own choice, declared once in `mediatek.yaml`, not inherited from whichever
  workspace happened to go first. Deciding it is the next thing this needs; it is called
  out here rather than papered over because the current behaviour is silent.
- **It does not remove anything from the workspace.** An import is a copy, so the
  workspace keeps working exactly as it did. Pointing that workspace's projects at
  `@mediatek` and deleting their `_modules` is a separate, deliberate act.
