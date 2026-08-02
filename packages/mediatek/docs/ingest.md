# ingest.ts — extended notes

## It pushes UP now, and it had to

This used to copy a workspace's `_modules` / `_library` / `_ui` **into** the local folder,
additively, never replacing anything.

That stopped being correct the moment the library moved to a server. The local folder is a
**cache** of the hosted library: anything sitting in it that the owner's manifest does not
mention is, by definition, something to delete — so the next sync would quietly remove
exactly what the import had just copied. The same button had to become an upload or stop
existing.

## Why it is no longer additive

The old rule was "never replace what is already there", because clobbering a shared module
would change what every project inheriting it plays, with no author and no way back.

That rule cannot survive the move, and pretending otherwise would cost more than it buys:
asking the library "do you already have this one?" per file doubles the round trips to
answer a question the owner is better placed to decide. A PUT replaces.

What protects a shared module now is different, and honest about being different:

- pushing a workspace up is a **deliberate act aimed at a named workspace**, not a
  side-effect of opening a screen;
- the library is one place, so "who changed this" has one answer to look for;
- history, if the library wants any, belongs to the library — not to this function
  refusing to write.

## A partial push is a real outcome

One file that fails does not roll the rest back, and does not stop the walk. `failed`
carries what did not go and why, beside `uploaded`. There is nothing to undo: every file
that landed is a file the library now has, and the caller can retry the rest.

## The three folders

| workspace | library |
|---|---|
| `_modules/` | `modules/` |
| `_library/` | `library/` |
| `_ui/` | `ui/` |

A workspace missing one is normal — most have some and not others — so those are reported
in `absent` rather than thrown.

## What this still does NOT do

**It does not decide the library's namespace.** A workspace's `_modules/config.yaml` is
pushed like any other file, so the last workspace uploaded now wins — where before, the
first one did. Either way it is the wrong thing: the namespace is what refs are keyed by
(`@mine/audio/reverb`), so it should be the library's own choice, declared once in
`mediatek.yaml`, not inherited from whichever workspace happened to go through. Still the
next thing this needs, and still called out rather than papered over.
