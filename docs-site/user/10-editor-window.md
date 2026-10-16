# The editor window

When you open a project, k7 shows its editor window. This page describes how that window is laid out, how you move between its views, and how its panels open and close.

## The window at a glance

From top to bottom, the window has:

| Area | What it holds |
|---|---|
| **Header** | A back arrow and the project's name (both go back to the home page), the engine menu and the engine's link light, the **transport** in the centre (play/pause, stop, the clock, record), and on the right the **master meter** with its fader and *Fix* button, then one button per **page** |
| **The page** | One view, filling the window: the editor, the timeline, the DJ desk, the master strip or the chains graph |
| **Bottom panel** (optional) | A second view under the page: the event you opened, the graph, the mix, or the logs |
| **Right column** (optional) | One side panel at a time: settings, playlists, references, tasks, history, sync conflicts, share |
| **Footer** | The status line on the left; on the right the tempo and time signature, the metronome, the notes toggle, the bottom-panel buttons and the side-panel buttons |
| **Minimap** | A small overview of the arrangement, shown when the timeline itself is not on screen |
| **Command bar** | Always docked at the very bottom on a computer: type what you want done |

The **viewport** (the picture of a video project) is not a page: it is a floating window over whatever page is on screen. You move it by its title bar and resize it from any edge. Its position and size are remembered in this browser.

## Pages (panes)

k7 shows **one page at a time, full window**. It never splits two pages side by side. A page is one of five *panes*:

| Pane | Key | Shown when |
|---|---|---|
| Editor | `1` | Always (except on a shared, read-only project) |
| Timeline | `2` | The project declares a timeline surface |
| Turntables (DJ desk) | `4` | The project declares a turntables surface |
| Mastering | none | The project declares a mastering surface |
| Chains | `3` | Always |

A project only shows the panes it declares. A project with no timeline surface has no timeline page, no transport clock and no minimap. Asking for a pane the project does not have (with its key or `ui <pane>`) only puts a message on the status line.

**The home page of a project** is its timeline when it has one, otherwise the first pane it declares (a DJ set opens on its desk). The editor is never the home page: you open it on purpose, or it comes to you as a popin when a command opens a file.

To change page:

- click one of the page buttons at the right of the header (the lit one is the page on screen),
- press the page's number key,
- type `ui editor`, `ui timeline`, `ui chains`, `ui turntables` or `ui mastering` in the command bar,
- press `Tab` to walk to the next page of the project (the editor is not part of that walk),
- press `f` to put the focused pane full window,
- press `Esc` (when nothing else is open) or type `ui global` to go back to the project's home page.

Changing page closes the bottom panel, because it was about what the previous page showed.

Every page stays loaded while you look at another one. Your undo history in the editor, the decks' state and the viewport's picture survive a page change.

### The editor as a popin

When a command opens a file (for example `ui file mix`, or `e` on a clip) and the editor is not the page on screen, the editor opens as a **popin** over the current page instead of replacing it. Click outside it to close it. It is the same editor, with the same open file and the same undo history.

### On a phone

A phone has no row of page buttons. A single menu button (the hamburger) holds every page, the viewport toggle, the side panels and a **Commands** entry that opens the command bar, since a phone cannot double-press Shift.

## The bottom panel

The bottom panel shows a second view under the page. Its height starts at half the window; drag the divider to resize it. The footer has one button per panel:

| Panel | What it shows | Command |
|---|---|---|
| **Event** | What you double-clicked: a clip's content (waveform or notes), a lane's modules side by side, a take being recorded or reviewed | `ui panel event` |
| **Graph** | The chains graph of the track under the timeline caret | `ui panel graph` |
| **Mix** | The graph with every mixer strip lined up. Disabled when the song has no strip (a strip is a Mixer module at the end of a track) | `ui mixer` or `ui panel mix` |
| **Logs** | A transcript of what happened: every command run and its answer, refusals, errors, engine events, and the engine machine's own log | `ui panel logs` |

Clicking the button of the panel already open closes it. `ui close` closes the panel, and so does `Esc` once nothing else is open. `ui logs clear` empties the logs.

While a panel is open, the timeline's lanes are folded.

## The right column

The right column holds one side panel at a time; opening one closes the one that was there. Each button toggles its panel.

| Panel | Opens with | What it is |
|---|---|---|
| Playlists | `ui playlists` (button shown on a DJ set only) | The workspace's set lists |
| References | `ui references` | Tracks you listen against |
| Tasks | `ui tasks` | The workspace's task list and the project's tags |
| History | `ui history` | The song's undo steps and the workspace's sync history |
| Sync conflicts | its footer button, shown only while there are conflicts | Edits the sync set aside |
| Share | `ui share` | Export, publish, links, QR codes for other devices |
| Settings | `ui settings` | Editor, I/O, project and account settings |

`Esc` closes the settings panel. See [Settings](./16-settings.md), [Sync, history and conflicts](./19-sync-and-history.md) and [Driving k7 from another device](./18-second-device.md).

## The status line

The left of the footer is the **status line**. Every command says there what it did. It is the one place k7 reports:

- what a command did (in the normal colour),
- what a command **refused** to do and why (in amber) — a refusal is not an error, nothing was changed,
- errors, which are also kept in the Logs panel because the status line is overwritten by the next message,
- what k7 is waiting for: "waiting for engine…", a copy of the project to the engine's machine, "caching waveforms",
- a red badge with the number of errors in the project's files, when there are some: the timeline and the graph do not load until they are fixed.

To the left of the status line, a badge shows the timeline's current mode or tool, or the clip editor's mode, when it is not the default one. `Esc` or `a` backs out of it.

While the right-click menu is open, the status line shows what the entry under the pointer does.

## Overlays and the Escape key

`Esc` always backs out **one layer**, the outermost first:

1. an overlay (a popin, a dialog, the help page, the curve editor…),
2. the event in the bottom panel,
3. the piano roll's create or remove mode,
4. the waveform's onsets or warp view,
5. the tool in hand on the timeline (back to the pointer),
6. a page other than the project's home page (back to the home page),
7. the bottom panel.

## When something goes wrong in one view

If one view fails, it draws an error card in its own place and the rest of the window keeps working and playing. The error is also written to the Logs panel. Reloading data (any edit) gives the view a new try.

If the page loads after k7 was updated on the server, the first piece of code that cannot be found makes the page reload once by itself.

## The session goes to sleep

After **twenty minutes** without any input (pointer, keyboard, wheel, touch) and with nothing playing, k7 unloads the project from the engine and shows a "Session asleep" screen. Your files are already saved. Click **Resume session** to reopen the project where you left it. Other tabs of your account that are still in use keep the engine session alive.

A tab put behind another tab also stops driving the engine, and takes it back by itself when it comes to the front again.
