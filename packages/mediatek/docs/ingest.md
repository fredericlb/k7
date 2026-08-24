# ingest.ts — extended notes

## It pushes UP

It sends a workspace's shared folder to the hosted library, and never the other way. The local
folder is a **cache** of that library: anything sitting in it that the owner's manifest does not
mention is, by definition, something to delete — so the next sync would quietly remove exactly
what an import INTO it had just copied. Up is the only direction this button can have.

## Why it is not additive

"Never replace what is already there" is the tempting rule, because clobbering shared material
changes what every project naming it plays, with no author and no way back.

It cannot survive the direction above, and pretending otherwise would cost more than it buys:
asking the library "do you already have this one?" per file doubles the round trips to
answer a question the owner is better placed to decide. A PUT replaces.

What protects shared material is different, and honest about being different:

- pushing a workspace up is a **deliberate act aimed at a named workspace**, not a
  side-effect of opening a screen;
- the library is one place, so "who changed this" has one answer to look for;
- history, if the library wants any, belongs to the library — not to this function
  refusing to write.

## A partial push is a real outcome

One file that fails does not roll the rest back, and does not stop the walk. `failed`
carries what did not go and why, beside `uploaded`. There is nothing to undo: every file
that landed is a file the library now has, and the caller can retry the rest.

## The one folder

| workspace | library |
|---|---|
| `_library/` | `library/` |

`_modules/` has **no row**. A module is authored in st0 and committed to the account's library
repository — a git repository somebody owns, not a folder on this volume
(`packages/song/docs/sharedFolders.md`). What travels here is the material a module NAMES:
impulse responses, amp profiles. A module's face is the `ui.yaml` **inside** the module's own
folder (see `@studio/song`'s `docs/uiLibrary.md`), so nothing here has to know it exists either.

A workspace missing the folder is normal, so that is reported in `absent` rather than thrown.
