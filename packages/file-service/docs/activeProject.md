# The active project — what l8 and m9 are actually looking at

A workspace is **one git clone**. The project is one folder inside it. Those used to be
almost the same thing, because l8 owned the level above a project and let you pick one; now
st0 owns the repositories and opens an app **on** a project
(`packages/project-shell/docs/launch.md`). That change moved two questions here.

## The tree is the project's, not the clone's

`tree()` walks the **active project**, not the workspace root.

A real repository holds far more than the song you opened: other projects, a `_modules`
library shared between them, mixdowns, an `orig/` full of `.dawproject` and `.als` sessions
the songs were imported from. Rooting the tree at the clone shows all of it, which reads as
"l8 is showing me the repository" — and it invites you to open a file belonging to a project
that is not the one playing.

**Paths stay workspace-relative.** Only the root of the walk moves; `/file`, `/rename`,
`/move`, `/folder` are untouched and still take the same strings they always did. That is
what makes this a one-line change rather than a re-rooting of the whole API.

Two consequences worth knowing:

- With **no** active project the tree is the workspace, which is also what a lone-project
  workspace answers (its root *is* the project). Nothing regressed for either.
- The shared `_modules` library is no longer browsable as text from l8. It never was
  editable — `guardShared` refuses every write, and a UI edit forks a project-local copy —
  and the médiathèque is where the catalogue is authored. What a project needs of it still
  arrives through `/module-catalogue`, `/module-ui` and `/hints`, which are unaffected.
- A `.dawproject` sitting **outside** the project folder is likewise off the tree, so it can
  no longer be clicked to import. Importing lands a *new* project at the workspace root,
  which l8 cannot open by itself anyway — you go back to st0 for that either way.

## Opening a project that is not there

`isProjectDir` is a rule about a **name** — `mysong.l8`, `myset.m9` — because st0 must
answer the same question from a bare blobless mirror where no file can be opened
(`packages/web-protocol/projects.ts`). The trap is that a name rule says "yes" about a folder
that does not exist.

That is not hypothetical. st0 reads a **mirror**, the file service reads a **clone**, and the
two are fetched at different moments. Rename a project folder, push, and st0 will keep
offering the old name until its mirror is refreshed — st0's own fix for that is in
`apps/st0/backend/src/routes/projects.ts`, whose repository listing now refreshes the mirrors
it lists, not just the tree view. But a race is still a race, and the mirror can be a fetch
behind at exactly the wrong second.

Without an existence check, that produced this sequence:

1. `POST /open {path: "01_danse.l8"}` — accepted, because the *name* claims l8;
2. `activeProject` set to a path with nothing at it, and the `.studio-active` marker written,
   so a reload arrived broken too;
3. the first thing to compile it — `/project-doc` — reached `@studio/song`'s `loadProject`,
   which found no directory, fell through to "not a folder project", found no `.yaml` either,
   and reported **`unsupported song '01_danse.l8' — use a .yaml file or a folder project`**.

Every word of that is true and none of it is the problem. So `setActiveProject` now checks
existence **before** the name rule and says what actually happened, and `isProjectDir` itself
requires a directory — which also stops a stale `.studio-active` marker (a project deleted
outside the service) from being restored at construction.
