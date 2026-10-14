# Tasks — the workspace's TODOS.md

The footer's ☑ opens a panel listing what is left to do: a line to type a task into, a box that
pins it to where the playhead is, and the list, each task with a tick and a bin
(`components/TasksPanel.tsx`).

## One file at the workspace root, in Markdown

The tasks are `TODOS.md` at the ROOT of the workspace, beside the projects, and not a file inside one
song: what is left to do is mostly about the record — a mix to redo, a part to record again — and a
workspace is the record. A task about one place in one song says so instead, and the panel's
**Attach timecode** writes that into the task (below).

The file is a plain Markdown checklist, because it is read on a forge and edited by hand as often as
in the app:

```markdown
# Tasks

- [ ] bounce the bass
- [x] fix the snare `05.paradoxe.k7 @ 49:1`
```

A task is a `- [ ]` line (`* [ ]` too), done when `[x]`. The backticked tail is its anchor: the
project as the workspace names it, and a timecode in it. The project is part of the anchor because one
file serves every song; a timecode alone would not say which. The parser and every edit are
`@studio/song-schema`'s `tasks.ts`, browser-safe, so the panel reads the file with the rules the
commands write it with.

**An edit rewrites one line and nothing else.** A heading, prose and blank lines a person wrote around
the tasks survive the app, and the app adds a heading only to a file it creates.

## The panel writes through commands

Every action on it is a `task` command — `task add <text>`, `task mark <timecode> <text>` (the same,
pinned to the open project), `task done <n>` (ticks or unticks), `task remove <n>` —
(`packages/commands/src/verbs/tasks.ts`), as every action in this shell is. A task is addressed by its
NUMBER, its place in the list as the panel shows it, which is also what a person reading the panel
would type. After each one the panel reads the file again rather than patching its own list: the file
is the truth, and it re-reads on the workspace's revision too, so an edit made elsewhere shows up.

A task pinned to the OPEN project shows its timecode as a link that puts the playhead there; one pinned
to another song shows where, and does nothing. **Attach timecode** is greyed with no song open.

**The timeline flags them too.** Each task pinned to the open project is a small flag at the foot of
the ruler, on its timecode — amber while open, faded once done — and hovering one (or tabbing to it)
hangs its text under the ruler, outside the ruler's own clipping. The flags are read by
`hooks/useProjectTasks.ts`, the same file re-read on the same revision, so a task ticked or added in the
panel moves the ruler with it. A click falls through to the ruler, which seeks there, as on any tick: a
flag says where something is to be done, and the place is what a click on the ruler is for.

## The open project's tags sit above the tasks

The panel's top row holds the OPEN project's tags, `project.tags` in its project.yaml, which the home
page shows beside the project. They are written by `project tag <tag>` and `project untag <tag>`
(`packages/commands/src/verbs/projectTags.ts`), never by the panel, for the same reason as the tasks.
They sit here because this panel is where a project gets organised, and a tag sorts projects much as a
task list sorts work. The project's own file holds them, not TODOS.md, because a tag belongs to one song
and travels with it when the song is copied. With no project open the row is not drawn.

## Every workspace at once: `/tasks`

The home page has a **Tasks** entry: one list of every workspace's `TODOS.md`, grouped by workspace,
open tasks only unless **Show done** is ticked (`projects/TasksPage.tsx`). A task's anchor links to the
project it names; one naming a project the workspace no longer holds is shown and not linked.

**It is read-only.** Ticking, adding and removing are `task` commands, and a command runs against an
open workspace; the home page has none open, and a second way to write the file would be a second
set of rules for it. The page links into the workspace instead, where the panel does all four.

**It is read on arrival and on Refresh, not polled.** It costs one read per workspace, and the page is
visited rather than watched. A workspace with no `TODOS.md` has no tasks; one whose file cannot be
read says so in its own section, and the others still show.
