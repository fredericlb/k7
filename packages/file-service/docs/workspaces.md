# workspaces.ts — the live set of workspaces, and the two listings over it

One `Workspace` instance per workspace, memoized so its caches (compiled doc, waveforms) persist
across requests, plus the listings k7's home page and `/external` draw.

## Opening does NOT create

`getWorkspace` does not mkdir on first touch: that would make any request which merely NAMED a
workspace conjure one, and a browser tab still retrying with a remembered name would silently
recreate a workspace you had just deleted, empty. Creation happens only in `createWorkspace`
(from `POST /workspaces`, k7's home page's **Nouveau**) and `Examples`, so what is on disk
changes because someone asked for it.

`Examples` is stocked when the service STARTS (`syncExamples` in `demos.ts`), not by a listing.
The hub starts an account's service on that account's first request, so startup is the first use,
and the demos are on the home page the first time it draws. The root's absence cannot be the cue:
the service creates the root as it boots, so a check made later never sees a new account.

The existence check runs before the memo, on every call: a folder deleted from Finder would
otherwise be served from cache and 500 deep in `fs`. `UnknownWorkspaceError` is carried as a type
so the HTTP layer can answer 404 rather than lumping it in with a malformed name, which is a 400
— `workspaceRoot()` throws on a traversing or empty name.

## A workspace is a folder, and nothing more

`createWorkspace` makes an empty folder and nothing in it. That is the ordinary first workspace:
someone opens studio, makes one, and the editor asks what the first project should be. There is no
host to name, no key to paste, no account to have — `@local/<espace>/<projet>` addresses it. What
reaches another replica is live sync's job, which watches every open workspace
([liveCapture.md](liveCapture.md)); no version control runs here, so nothing a workspace holds has
to be written for one.

## Copying a project from one workspace to another

`copyProject.ts` is its own module because it is the one act naming TWO workspaces: neither
`Workspace` instance owns it, and each end still answers for its own guards — the source resolves
and validates what is read (`projectFolder`), the destination resolves and validates where it
lands (`copyProject`, over `copyProjectInto` in `projectLifecycle.ts`).

**The copy keeps the source's suffix.** The suffix is what decides which application opens a
folder, so a `.k7` copied as `.z0` would be a song z0 is asked to read: refused by name here
rather than discovered by whoever opens it.

**A workspace that IS a single project is refused as a destination.** Such a workspace lists `.`
and nothing under it, so the copy would be on disk and in no listing — an act that appears to have
done nothing.

**What is not content is left out**, through the same `skip` the tree, the watcher and the diff
use: caches (`*.cache`), `node_modules`, the undo journal, the recycle bin. A dotfile inside a
project is invisible to every one of those already, so the copy loses nothing anything can see,
and gains none of the machine-local weight.

**The playlists the copy NAMES come with it.** A `turntables` surface names a set list by name and
the file lives at the WORKSPACE root, one level above everything the copy carries — so the project
alone lands beside no `_playlists/` and opens on "the playlist this surface names cannot be found".
`carryPlaylists` copies each one the surfaces name, and skips any the destination already has: a
workspace's own set list is the one its other projects are already reading, and a copy is no reason
to overwrite it. Nothing else is chased across — a module named from `_modules` resolves against the
destination's library by design, which is what a shared library IS.

## Renaming one in place

`renameProject` guards what every writer here guards — the root, the shared library, the recycle
bin, the no-clobber, the Windows handle retry — plus the one thing a PROJECT folder has that an
ordinary one has not: **a suffix that names the application**. It is checked with `projectApp` on
both names rather than by string surgery, so `winter.k7` → `spring.z0` and `winter.k7` →
`spring` are both refused by name, and the caller cannot hand a project to another editor by
typing.

**It is deliberately not `renameEntry`**, whose `guardMutable` refuses the ACTIVE project outright.
A rename takes `beforeMove` instead, exactly as `deleteProject` does, and the route hands it
`unloadEngineIfServing`: the engine is asked to let the folder go, and the rename proceeds. The
alternative — "stop it first" — is a refusal that asks somebody to go and find the transport in
another tab before they may rename a folder, and the handles are released the same way either way.

**The marker FOLLOWS it**, which is where the two acts part. A delete clears the active-project marker,
having ended the project; a rename re-points it at the new folder, the project being the same one.
The compiled-doc cache is invalidated with it, and the project CACHE dropped
(`forgetProjects`) as a delete and an import do — the listing is memoised, and a renamed project
would otherwise be listed under a folder that is gone.

## `listMachineWorkspaces` — what k7's home page draws

Every workspace on this machine, with the projects it holds. The machine is the only thing that
can answer it: the projects are folders on this disk. The walk is the same one `workspaceInfo`
runs, without its cache — measured at 5.3 ms on a real workspace, and this asks it of a handful.

Inside a row, `.` names the workspace folder itself and every other path ends in the folder that
claims the app. Either way the NAME decides, which is the one rule both ends use.

## The 5-second listing window

The same window `Workspace.workspaceInfo` puts under its own project scan, for the same reason. A
page polls this every few seconds and the answer changes when somebody creates a project. Without
a floor, every tab on the home page walks every workspace's directory tree on every tick — a
`readdir` per folder, and a real workspace has hundreds. A list five seconds behind is a row that
has not appeared yet, which is a wait; the compiled-document cache refuses this trade and has to,
because a stale COMPILE is confidently wrong about a song.

It is dropped whole when a workspace is made, copied into or removed, which are the changes this
service makes that the window would otherwise hide for the length of it. Both listings are dropped
together, since the second is built on the first: one window dropped without the other would show
the projects and not their screens.

## `listSurfacedProjects` — what `/external` draws

Every project on this machine that DECLARES a surface, flat, with those surfaces: the list of
screens this account could put on a second device. Built ON the listing above rather than beside
it, so "which projects are there" is asked once and answered the same way for both pages, and
only the surface scan is new.

That scan is a `readdir` of `surfaces/` plus a small YAML parse per file, and it is asked of every
project rather than of one — hence a window of its own, the same length and for the same reason.
It is deliberately NOT folded into `listMachineWorkspaces`: the home page is the front door and
does not draw surfaces, and making it pay for them would be a cost with no reader.

Its diagnostics are dropped on purpose: a surface file that will not parse is not a row this page
can offer, and the place that says WHY is the editor, which shows them beside the project's other
faults.

No policy here about which surfaces are worth a second device. The service reports what the
project declares; whether a `timeline` can be driven from a phone is the APP's question, and k7
answers it in one place — see `apps/k7/frontend/docs/external.md`.

`activeOf` reads the marker file straight off disk rather than opening a `Workspace`, which would
build its caches to read one line.

## Which project a bare workspace address opens

`Workspace.defaultProject()` answers it, and `POST /open` calls it whenever the address said `.`
without the workspace's own folder being a project. Three tiers, most deliberate first:

1. the active-project marker — the project last open here, which is what someone coming back
   expects;
2. the first `projectDirsUnder(root)`, which is alphabetical because the walk is;
3. `null` — and that is the ORDINARY state of a workspace just made, since `createWorkspace`
   writes no project. The gate turns it into k7's first-project wizard rather than mounting an
   editor over nothing (`packages/project-shell/docs/launch.md`).

`setActiveProject` is untouched by all of this and keeps its exact rule: it checks existence
before the name rule and refuses anything that is not a project folder. A fallback belongs where
the ambiguity is, which is the address, not the check.

## Removing one is FINAL, and that is why the button asks

`removeWorkspace` deletes the folder and everything under it. There is no recycle bin for this:
the bin is `_recycle_bin` **inside** a workspace, so a project falls into it and a workspace has
nowhere of its own to fall. Nothing on this machine brings it back, which is why the confirmation
asks.

**It ends the workspace for sync too, before the folder goes** (`endWorkspace` in `../src/liveSync.ts`).
Its room is emptied by one batch that says the workspace ENDS, the server's confirmation is awaited
(bounded), and its sync history is deleted. Without that the room keeps its files, a server rejoins
every room that holds files, and the folder comes back — EMPTY, since the history it resumed from
had nothing new to write and the disk it diffed against had nothing left. Every other replica synced
with that room hears the end and lets its copy go (`dropEndedWorkspace`), unless the copy holds a
file sync never knew — a backup, a local-only file — which is kept, no longer synced. A move to another
server ends the room it leaves the same way (`liveCapture.md`, "Several servers").

**On a server, a workspace a device creates is joined without waiting for a reconnect.** The server's
own replica joins every room holding files when its link opens — and a room a device seeds later, or a
move lands, announces itself to no reconnect. So it joins them again before answering the home page's
lists, and every minute (`joinServerRooms`): a moved workspace is listed on the server it moved to.

**The engine is unloaded first, and that is not politeness.** A project of this workspace still
loaded holds files open, and Windows answers EPERM half-way through a delete — the same wall a
person hits removing the folder by hand, where Explorer reports it as a request for admin rights
and elevating does not help. `deleteProject` has carried that rule since it was written
(*"Release every handle inside the folder before renaming"*); this route follows it.
