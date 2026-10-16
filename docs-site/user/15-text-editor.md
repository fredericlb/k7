# The text editor

A k7 song is a folder of text files. The **Editor** page (`1`, or `ui editor`) is where you read and write them directly. Everything the other views do ends up in these files, so the editor always shows the truth.

## Layout

- **File tree** on the left: the whole workspace. Click a file to open it. A ▶ on a project row hands that project to the engine. Right-click a row for its actions (new file, new folder, rename, move, delete, upload, clone module, new node, pin, copy path). Dragging a row onto a folder moves it; dropping files from your computer onto a folder uploads them. A second tab, **Libraries**, lists the modules of the workspace and of the origin's libraries (see the Chains section).
- **Breadcrumb**: the path of the open file, each segment a menu of its folder, so any file is reachable from any other.
- **Toolbar**: buttons that depend on the open file (open a module in the builder, run a library chain over a clip, switch a sequence between its text and its note grids…) and the save status.
- **The text** itself.

On a phone, the tree is a drawer closed by default; picking a file closes it.

When a command opens a file while another page is on screen, the editor appears as a popin over that page.

## What the editor helps with

For project files (`.yaml` and `.k7x`):

- **Syntax colouring** for the song's file format.
- **Completion** of field names and values. The list of fields comes from the file format itself, so it is always the fields that file kind accepts at the cursor's position. Values that come from your project are completed too: a module's `extends` offers the modules it can inherit from, a chain step's `track` offers your tracks, and so on. Names that YAML would misread are quoted for you.
- **Links**: a name that refers to another file (a clip, a sequence, a module…) has a dotted underline. `Ctrl`-click (`⌘`-click on a Mac) opens that file.
- **Audition**: a ▶ in the left gutter on every line naming something playable (a source, a clip, a slice). Click it to hear it; its waveform docks at the bottom of the editor until you dismiss it.
- **Errors**: problems found when the project loads are underlined in the open file, with a marker in the gutter. Red is an error, amber a warning.
- An audio clip's file shows the clip's **waveform** docked at the bottom of the text.

`.strudel` files get JavaScript colouring. Binary files cannot be edited and say so.

## Saving: there is no Save button

The editor saves for you. About one second after you stop typing, the file is written — **as long as it is a file k7 can read**. While it is not (a half-typed line, a field the format refuses), k7 **holds it back** rather than write a file that would break the song, and says why.

The toolbar shows the state in place of a Save button:

| Shown | Meaning |
|---|---|
| nothing | The file on disk is what you see |
| `edited` | Waiting for you to stop typing |
| `saving…` | Being written |
| `not saved — <reason>` (amber) | Held back: it would not load. Fix the reason and it saves by itself |
| `save failed — <reason>` (amber) | The write itself failed |

A held-back text is kept even if you open another file, and comes back when you return to it. If the file you are editing was already broken on disk, k7 still writes your changes, since holding them back would protect nothing.

`Ctrl+S` (`⌘S`) and `:w` in vim mode mean **save now**: they skip the one-second wait. They cannot force a file k7 is holding back.

Saving never reformats your file.

If you try to leave or reload the page while something is not saved, the browser asks you first.

## When the file changes on disk while you edit

Another device, another tab or a command can change the file you have open.

- If you have no unsaved changes, the editor simply shows the new version.
- If you do, an amber bar says "This file changed on disk while you were editing it" and offers **Continue editing** (keep your text; a later change asks again) or **Update** (take the version on disk). Nothing is written while the question is open.

## Vim mode

The editor has vim key bindings, **on by default**. Turn them on or off with `ui vim`, or in the settings panel's **Editor** tab. The choice is remembered on the machine that holds your files.

## Undo

- In the editor, `Ctrl+Z` first undoes your typing in the open file.
- Once the file's own history is used up, `Ctrl+Z` continues into the **project's** undo history: the commands and edits made anywhere in the song. `Ctrl+Y` or `Ctrl+Shift+Z` redo.
- Undoing a step that bounced audio through a chain restores the earlier audio file, and asks for confirmation first.
- After an undo or a redo, k7 opens the file it changed and names it in a notification.

The history panel (`ui history`) lists the steps. See [Sync, history and conflicts](./19-sync-and-history.md).

## Opening files by command

| Command | Opens |
|---|---|
| `ui file <name>` | Any text file of the project, by path or fuzzy name |
| `ui edit sequence <name>` or `e` on a MIDI clip | The sequence's file |
| `ui edit clip <name>` or `e` on an audio clip | The clip's file |
| `ui builder <module>` | The module in the module builder, beside the tree |
| `sequence edit roll <seq>` / `sequence edit tracker <seq>` | The sequence's notes as a piano roll / tracker in the bottom panel |

The module builder is the one editing screen with a real **Save** button: a module is several files that only make sense together, so they are saved together, and `Ctrl+S` / `:w` press that button. It is described in the Chains section.
