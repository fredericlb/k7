# ingest.ts — extended notes

## It pushes UP now, and it had to

This used to copy a workspace's `_modules` / `_library` **into** the local folder,
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

## The two folders

| workspace | library |
|---|---|
| `_modules/` | `modules/` |
| `_library/` | `library/` |

There is no third row for the panels. A module's face is the `ui.yaml` **inside** the
module's own folder (see `@studio/song`'s `docs/uiLibrary.md`), so it travels up with
`_modules/` and there is nothing here that has to know it exists.

A workspace missing one is normal — most have some and not others — so those are reported
in `absent` rather than thrown.

## The namespace is the library's, and no longer a contributor's

This used to push `_modules/config.yaml` like any other file, so the **last workspace
uploaded renamed the whole library** — silently, for every project inheriting from it,
because that file declares the namespace refs are keyed by (`@st0/audio/reverb`).

It is now skipped, and reported in `skipped` rather than dropped quietly: "it uploaded" and
"it uploaded everything" are different claims and only one of them is true.

The declaration itself stays in `modules/config.yaml` rather than moving into
`mediatek.yaml`, which was the earlier idea here. Two reasons it is better where it is:
that path is where `@studio/song`'s loader already looks — a shared module root without a
namespace is a hard error — and duplicating it into the marker would create a second source
of truth for one string. `ensureLayout` writes it once, at creation, with `mediatek` as the
default; nothing overwrites it afterwards.

Changing it later is a **rename of every module in every project that inherits them**. The
file says so in its own comment, which is the only place someone about to edit it will look.
