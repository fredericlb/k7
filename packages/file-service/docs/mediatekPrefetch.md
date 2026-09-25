# mediatekPrefetch — a set list onto the engine's disk before the gig

The médiathèque lives on the server, beside the workspaces. The engine opens file paths and the
venue may have no network, so every song an open project names has to be on the **engine's
machine** before it is played, not fetched at the first bar. `mediatekPrefetch.ts` is what puts
it there, unattended.

## What it sends: what the open projects name

Not the catalogue. `mediatekSongRefs(project, root)` reads the project and the workspace around it
for the songs a set list names; each ref becomes its folder (`songPathPrefix`), and a song IS its
folder — the masters and the sidecars travel together. The workspace ROOT goes down with the project
because a playlist lives at the top of the repository, not inside the project
(`packages/song/docs/playlists.md`).

The projects in question are the ones **open**: `liveWorkspaces()`, each one's active project. No
registry of them to keep, and nothing walks the account's folder looking for projects.

Songs only. Modules and chains are in the account's library repository, a submodule of the
workspace (`packages/song/docs/sharedFolders.md`), and reach the machine the way every workspace
file does — through the tunnel, when the engine opens them.

## The machine does the copying, the tunnel decides what moves

The server sends one `prefetch` job naming the files by their server paths. The paths are under the
médiathèque root the binding shares, so the tunnel's `PathMap` brings each one down **before** the
handler runs, and skips one whose size and mtime already match. The handler on the machine only
counts what landed (`engine/st0-supervisor/src/MachineJobs.cpp`). No second copy mechanism: the rule
that decides "is this file current" is the one every other file obeys.

## When it asks

On a timer, against whatever machine is bound at that tick. A list is sent again only when the list
or the machine changed — the same twelve songs to the same machine cost nothing after the first
time. The price: a song whose files change on the server while the list does not is brought down
when the engine opens it, not ahead of time.

No bound machine, nothing named, or a machine that does not answer: nothing happens and the next
tick tries again. A failure is logged **once per distinct message**, since a machine that is off
would otherwise write a line a minute for as long as it is off.
