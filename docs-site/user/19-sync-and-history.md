# Sync, history and conflicts

Your workspaces live on the k7 server. Every device that opens one — a browser, the desktop app, the phone app — works on the same files, and every edit made on one reaches the others. This page explains what you see of that, what happens when two edits collide, and how to go back in time.

## How edits travel

- Every change — a command, a knob, a line typed in the editor — is sent to the server, which puts all edits in **one order** and passes them on to every other copy of the workspace.
- Views refresh by themselves when something changed. Several tabs and devices can be open on the same workspace at once.
- A desktop or phone app that syncs your account keeps its own copy of your workspaces and keeps editing while offline; its edits are sent when it reconnects. The home page shows, for each workspace on such a machine, whether it is synced with a server, on this machine only, or on the server only (with a **Download** button). Pairing a machine for sync and the servers it syncs with are covered in the Getting started and Engines sections; the Settings page's **Sync** section lists them (see [Settings](./16-settings.md)).

### Opening a project that is still arriving

A project opens only once all its files are on the machine that plays it. Until then, k7 shows **Syncing *workspace***, with "Reaching the server…", "Bringing the latest edits…" or the number of files still downloading. If the server is out of reach and some files never arrived, it says so and opens as soon as they do.

## When two edits collide

### In the text editor

If a file you are editing changes underneath you, the editor asks whether to keep your text or take the new one. See [The text editor](./15-text-editor.md).

### Sync conflicts

Two devices sometimes change the same value before hearing of each other. The server keeps one, and **sets the other aside — it is never lost**.

When a workspace has open conflicts:

- a button appears in the footer with their count ("3 open sync conflicts");
- a file that has one shows a banner above the editor ("Sync conflict in this file: *paths*") with a **Review** button.

The **Sync conflicts** panel lists each one: the file, the values concerned (by their key path, e.g. `tracks.gtr.volume`), who made the set-aside edit and when, and the two sides:

- **Kept** — what is in the file now (or "absent"),
- **Set aside** — the other edit: a value, "a whole version of the file", "a binary version of the file", or "the file removed".

For each, choose **Keep current** or **Use this one** (which writes the set-aside version in place). Either way the conflict closes on every device. "No open conflict: every edit landed" means there is nothing left to settle.

## History

Open the **History** panel with `ui history` or its button at the right of the footer. It has two parts.

### The song's undo steps

The top of the panel lists the project's undo steps, newest first: each command or edit that changed files. Hovering a step lights up what it touched on the graph and the timeline. `Ctrl+Z` / `Ctrl+Y` (or `project undo` / `project redo`) walk this list. Undoing a step that bounced audio asks before restoring the earlier file.

### The workspace's history

Below, the **Workspace history**: every edit made to the workspace, on any device, in the order the server applied them, with automatic checkpoints. For each entry you can:

- open it to see what changed, file by file, **Before** and **After** (a binary file only says it changed),
- **Restore to here**: every file of the workspace goes back to what it was at that point, on every device. A restore is an edit like any other, so what it replaces stays in the history and can be restored in turn.

**Name this point** adds a named checkpoint (for example "before the mix") so you can find it again.

## Many tabs, one engine

You can open the same workspace in any number of tabs. The engine plays one project at a time for your account: if you open another project on the same engine, or someone opens this project elsewhere, the tab that lost it says so ("Another project took this engine" / "This project was opened elsewhere") and stops driving it. Nothing you saved is lost; open it again from Projects to take it back.
