# The home page — k7 opens a project, and this is where you choose it

`/` with nothing after it is a screen, not an address to correct: the account's workspaces, the
projects inside them, the libraries and the published shares. It is where you
start, and where you come back to on leaving a song.

## Who draws, who holds

**k7's pages draw; the file service and the media library hold.** The workspaces are the
account's file service's, on the server; the libraries are the file hub's, one list
and one folder each for the whole origin; the shares are the media library's (`/api/shares`),
because a share's bytes and its comments live on its volume. All of them answer on this origin,
from k7's own backend. The media library keeps no register of workspaces —
[apps/k7/backend/docs/media/projects.md](../../backend/docs/media/projects.md) says why.

**The SOURCE of the list is the file service.** What lists the projects is the account's file
service on the server, over its workspaces (`packages/file-hub/docs/fileHub.md`). A separate index
would be a second copy of what that service already holds, and a worse one: always one change
behind the folders it describes.

Two underlying reasons, in the order they weigh:

1. **The level above a project belongs to what opens a project.** "Which workspaces does this
   person own, and what is in them" is not a catalogue question; it is the editor's first
   question, the one that has to be answered before there is anything to edit. Modules and chains
   follow the same rule: they are WRITTEN, and writing happens here.
2. **The file service is on this side.** Creating, deleting and LISTING a project all go through
   the account's file service, because a project is a folder in it. k7 is wired to that service
   for every project it opens; the médiathèque does nothing else with it.

The corollary is that the médiathèque opens on its **songs**: exactly what you do not write in a
text editor. Projects are here, modules and chains too, playlists next
(`playlists.md`) — the last by a different argument, worth distinguishing: a playlist carries no
bytes, only names of songs that stay in the catalogue, so the file belongs to the workspace it
was written for.

## The address follows

This screen is **the front door itself**. k7 answers at the origin root
(`app.priv.k7.rocks`, `app.k7.rocks`), the médiathèque below it under `/media`, and the rehearsal recorder
under `/rehearsal`.
If the first thing you want at a front door is your own work, then the page listing that work IS
the front door, and putting it behind a prefix you have to know how to type would rank it second.

**The user menu — the account, the settings, the logout — is in THIS page's
sidebar**, never in the editor's header. Inside a project the project bar's hamburger opens the same
sidebar as a drawer (`HomeDrawer`), so everything this page links to is one click away from any
project without the project bar carrying it. The router's basename is the project there, so the drawer's
entries are full addresses resolved against `projectsUrl` — drawn in place, no page load
(`shell.md`) — and none is lit. It is the menu every app of the origin carries —
`@studio/ui-user-menu`, rather than links this app spells its own way — so an app row opens a NEW tab (`packages/ui-user-menu/docs/userMenu.md`).

**One left sidebar for this page and the ones that hang off it**, `/tasks`, `/libraries`,
`/settings`, the médiathèque's `/media/…` and the rehearsal recorder's `/rehearsal/…`
(`HomeSidebar.tsx`), and no header: the page's whole height goes to the list. Its entries are two
groups. **Projects**, **Tasks**, **Libraries**, **Frozen chains**, **Publications** and **Exercises**
— what you WRITE, and what you PLAY and keep (`packages/ui-rehearsal/docs/sections.md`) — then, under
a title of its own, the médiathèque's sections — **Songs**, **Samples**, **Recordings**,
**Playlists**, each with its count, and **Find** — what you DRAW ON. The one for the
page you are on is lit in the accent, and the user menu is last; where the `wide` step is not reached
it is an ICON RAIL, where a rule stands in for a group's title. `wide` is a landscape screen from
640 px, or any screen wider than a tablet held upright (`src/index.css`): a tablet in portrait is
768–1024 px wide, so a width rule alone would hand it the full sidebar and take a fifth of the page
from what you were reading. The same entries in the same place on every page say which of them you
are on, so none of the others carries a back button of its own.

Its foot carries the take's red dot before the user menu, on EVERY home page: a session starts from
whichever page one is reading, and the drawer the sidebar becomes inside a project carries none, a
take being the home's.

## The home bar

**Every home page has the same bar at its foot, always** (`HomeFrame.tsx`), under the sidebar and the
page alike, so it spans the window. It is the mini player's DOCK (`packages/ui-mini-player/docs/miniPlayer.md`):
whichever bar a page mounts is drawn there — the médiathèque's player — and
while none is, a standby bar saying nothing is playing. The row never comes and goes, so the way back
to a folded sidebar at its left edge is always there.

**The engine selector is the sidebar's**, right above the user menu (`shell.md`): the player's row
is crowded on a phone, and the engine is a setting of the home pages rather than part of what plays.
While the sidebar is folded away it moves to the bar's engine slot, since the médiathèque's
**The engine** destination plays on the engine it shows, and that has to stay chosen and in sight.

**The sidebar folds** from a button beside its brand, and the bar's left edge then holds the button
that brings it back; the fold is kept per browser, being a habit of the screen. The rail has no room
for the button and does not fold.

**The page column holds its own fixed boxes** (`contain: layout`), so a page's docks and pop-ins
stop at the sidebar and at the bar without knowing either's size. The one thing fixed outside it is
the rehearsal take, held above the routes so it outlives them; for it the column publishes where it
is, as `--host-column-left` and `--host-column-bottom` (`packages/ui-rehearsal/docs/audio.md`).

The media sections are the library's own (`LIBRARY_SECTIONS` in `@studio/ui-library`,
`packages/ui-library/docs/host.md`), drawn here rather than in a header of the library's: one
origin, one nav. "Libraries" is already the module libraries' page, which is why the media group
is titled after the médiathèque and not after a library. Their counts are known only on the media
pages, which load the volume's summary; elsewhere the entries carry none rather than a stale
number. Only `/media/…` mounts the library's playback (`MediaPage.tsx`): it probes and leases an
engine, which the other home pages deliberately do not, and it puts the queue button in the
sidebar's actions, above the engine selector. They are
routes, so going between them reloads nothing — and a rehearsal take outlives all of them:
`RehearsalRecording` wraps their `<Routes>` (`apps/k7/frontend/src/appMain.tsx`), holding nothing
until a take starts, so a take begun on a song page keeps recording while you open the media
library or a project list (`packages/ui-rehearsal/docs/audio.md`). A rehearsal public page,
`/rehearsal/@<nametag>`, is drawn before the sign-in gate, outside this frame. `/external` is not among them: it is the page a
SECOND device opens, independent of this one, with a header of its own (`external.md`).

`/auth/*` follows the root: the IdP knows only one `redirect_uri`, on k7's origin, so those
routes can only be served by k7 (`packages/web-protocol/docs/addresses.md`).

## What the address says, and what it does not

```
/                     the home page — k7 answers the origin's root
/?ws=<workspace>      …with one workspace's tree unfolded
/@local/demos/x.k7   a project, by its workspace and its folder — see below
/@banc/vocals/warm/live.k7  a bench: a live rig seeded with a library chain
/external             the menu of surfaces a second device drives
/libraries            the origin's libraries — read by anyone, edited by an admin
/libraries/chains     the account's frozen chains, and the libraries' cold ones — frozenChains.md
/tasks                every workspace's TODOS.md in one list — tasks.md
/settings             what a browser may change — settings.md
```

**The path belongs to the launch.** `parseLaunch` reads it before anything is mounted, and the
FIRST segment is a sentinel — `@local`, `@banc`, `@shares` — so a plain word like `external` is
free for the app's own pages. The unfolded workspace travels in the **query**,
which is exactly what a SPA router owns — the argument of
[packages/project-shell/docs/launch.md](../../../../packages/project-shell/docs/launch.md) taken
the other way — and it bookmarks, copies, and answers the back button.

`?ws=` is set with `replace`: browsing three workspaces to see what is in them is not a navigation
you want three history entries for. What is unfolded is a folder on the machine, and its NAME
designates it: readable in the address bar, and true on the machine that
answers.

`main.tsx` reads the address once and picks a stack, rather than mounting one with pieces
switched off:

| the address | what is mounted |
|---|---|
| `/@shares/<token>.k7` | `SharedGate` — no account, no engine, no working copy |
| `/` | `AuthGate` → `Home` — the account, and nothing else |
| `/external` | `AuthGate` → `ExternalIndex` — probes for a machine without claiming one |
| `/libraries` | `AuthGate` → `LibrariesPage` — the account's file service, no engine |
| `/libraries/chains` | `AuthGate` → `FrozenChainsPage` — the account's file service, no engine |
| `/settings` | `AuthGate` → `SettingsPage` — no engine |
| `/@local/…`, `/@banc/…` | `AuthGate` → `EngineGate` → `ProjectGate` → the editor |

The `Profiler` stays on the editor's stack only: it bills every commit of the subtree to keep the rare long
ones, and this page has no bursts of commits to measure.

### The list needs the server's files, and no engine

The list of projects needs the account's file service on the server and nothing else: the workspaces are there whether or not an engine is running, so
the page does not wait on an engine probe to draw them (`settings/accountFiles.ts`'s `findAccountFiles`,
asked with `bindEngine` off). If that service does not answer, the list is replaced by the
sentence that says so, rather than by an empty screen that would look like a new account; the
header says nothing about the server, the list being where its absence shows.

What can be read and set **without an engine** is what saves installation day: the libraries here
are asked of the server. A page an engine picker would strike out entirely would be a page where
nothing can be set until there is an engine.

Shares are behind a button on a project's row, so behind a list that needs the file service (§ Shares).
That does not touch the installation argument — a new account has published nothing — but it is
the price noted there.

### The engine's plugin scan is a bar, never a wait

The engine scans its plugins at every start, and a project naming an external plugin waits for
that scan before it goes to the engine (`packages/file-service/docs/engineLoad.md`). The home page
says it is running — "Scanning plugins… N / M", a thin bar above the command bar
(`projects/PluginScanBar.tsx`) — so that a project opened just then does not seem slow for no
reason. Which engine: the one the policy would play the account's projects on, else the one the
account remembers, else the only one that answered; under the tray that is the machine's own. With
none, or one that reports no scan, there is no bar. It is asked after the list, beside it, and
never in front of it, for the reason above: the list needs no engine. The page listens on a
socket that claims nothing (`packages/engine-browser/docs/access.md`), since it plays nothing.

## The rule that holds everything

**The folder's suffix makes it a project.** `mysong.k7` opens in k7, and
`packages/web-protocol/projects.ts` is the whole rule. A folder with no suffix is not a project,
even if it contains a `project.k7x`.

This page keeps `launchUrl` on each row rather than building its own addresses: the address is a
contract with the gate that reads it back, and one builder is one encoding.

Everything an k7 project can BE is in the **surfaces** it declares inside the `.k7`, rather than
in some kind of folder: a `viewport` and video lanes for picture
(`packages/song-video/docs/picture.md`), a `turntables` surface and the playlist it names for a set
(`packages/song/docs/setProject.md`). That is why the three archetypes in the creation menu are
named after their surface.

## This screen's command bar

At the bottom, full width, exactly as in the editor and for the same reason: it is where you type,
so it is always there, never summoned. `frontend/docs/commandBar.md` describes the component; what
follows is what sets it apart here.

**Its vocabulary is its own** (`src/projects/homeCommands.ts`), and not `LOCAL_COMMANDS`. This
screen has no open project, no engine session and no file: the editor's catalogue here would be a
list of things you cannot do, and the half that comes from the file service would not even answer
— `/complete` and `/command` want an active project. The verbs are the page's buttons, and one screen of its own:

| the line | what it does, and through what |
|---|---|
| `project new <type> <name>` | the archetypes, then `projectFolderName` adds the `.k7` — scaffold on the server |
| `project copy <name> <workspace> [new name]` | copies it into that workspace — the name is optional, and is the source's without it |
| `project rename <name> <new name>` | renames the folder in place, suffix kept |
| `project delete init <name>` | **names** the project and says what confirming will do. Writes nothing |
| `project delete confirm <name>` | deletes that one, if it is the one that was named |
| `system workspace new <name>` | an empty workspace on the server |
| `camera mode [name]` | this device becomes a camera of the account, full screen — `src/camera/CameraMode.tsx` |

**`camera mode` is here because it needs nothing else.** A device acting as a camera has no project
open and no engine, only the account, which is exactly what this page has; a phone on a stand opens
k7 and is one line from being a camera. What it is and how the picture travels:
`packages/web-protocol/docs/cameras.md`.

**Deleting is two verbs, and that is the confirmation.** A palette can fire a destructive line on
an Enter landing on a fuzzy match; the bar has no dialog to ask a second question with, so it asks
a second verb. Naming the project twice is what makes the second keystroke a decision, and `init`
is the only place you READ what deletion does — the folder moved to the workspace's recycle bin.
The confirm demands the same name, or the second line would be
a formality. The arming is **consumed by any command**, not only by its confirm — the rule the
graph's pending insertion already follows (`docs/shell.md`) — so a destructive verb cannot stay
armed behind three unrelated lines.

**Which workspace a line lands in.** The `project …` verbs name no workspace: it is the one the
address unfolded (`?ws=`), or failing that the only one there is. Between several, the line is
**refused by naming them** rather than choosing one — creating a project in the wrong workspace
is a change made where nobody was looking.

**Buttons and bar go through the same functions** — `createProject`, `copyProject`,
`renameProject`, `deleteProject`, `createWorkspace` in `workspaceOps.ts`: one implementation, two doors, as the
file tree's menu and the `fs …` verbs already have (`docs/shell.md`). What the bar adds is doing
it without the mouse, and saying so in a status line above it: refusals in amber, because a silent "that did nothing" is
avoided everywhere else. A line this
screen does not know is refused **here**: there is no service behind to pass it to, unlike the
editor's bar, whose lines end at `/command`.

## The LIBRARIES, a page of their own and the admins'

The libraries are named folders of the modules and chains every project inherits, and there is
**one list for the whole origin**, not one per account. It is a PAGE, `/libraries`
(`LibrariesPage.tsx`, drawing `LibrariesCard.tsx`), which the header's **Libraries** entry links
to — reserved like `/external`, and read before `parseLaunch`. Not a panel beside the projects: the
list changes rarely, only an admin changes it, and an admin goes there on purpose. Without a
library k7 refuses to open anything — not on principle, but because no `@k7-core/…` reference would
resolve, and a song opened with all its shared modules missing reads as a broken song rather than
as a server somebody has not finished setting up.

**Only an admin edits it.** An admin is a member of one of the backend's `AUTH_ADMIN_GROUPS` (the OIDC
`groups` claim), and the file hub says so in its hello, in the ticket and on every request it
forwards. The hub answers the libraries routes itself and refuses a change without that
([packages/file-hub/docs/fileHub.md](../../../../packages/file-hub/docs/fileHub.md)). Anyone else
sees the same page read-only: no add and no remove. Hiding them is courtesy; the 403 is the gate.

**A list of NAMES, and one folder each on the server.** The name is the level its refs use —
`@drums/audio/kick` — and the first library is called `k7`, which is what every `@k7-core/…` means.
The list holds nothing but the names; each library is ONE folder on the server, which every account
reads ([packages/song/docs/sharedFolders.md](../../../../packages/song/docs/sharedFolders.md)). An
admin adds a library by typing its name; the hub gives it a folder at once, copied from the
server's seed when the seed holds that name, else EMPTY. A row whose folder the server does not
hold says *not on the server yet*. A row's ✕ unlists the library and keeps its folder: that folder
is the only copy, and a name typed again finds it where it was.

> **Nothing but the seed fills a library, deliberately.** The library folder is the reference, so
> a new library is **empty** and a scaffolded set's `@k7-core/…` refs resolve to nothing until
> something is put there (`packages/song/docs/sharedFolders.md`). Copying a catalogue in from
> elsewhere — the media library's volume, the build — would make that elsewhere a second source of
> truth about somebody else's modules. The seed is the one exception, and it is the server's own
> configuration, not a gesture of this page.

**The page itself says something only when something is wrong** (`LibrariesNotice.tsx`): no library
yet, or a listed one the server holds no folder for. In that case it shows one amber line at the
top, with a link to the Libraries page. A healthy list costs the page nothing.

**An admin edits a library from any project; nobody else edits it.** An admin's save writes
into the library's `draft/` on the server, never a published version
([sharedModules.md](sharedModules.md)): the place to change a module is the project you hear it in.
Publishing is this page's: under an admin's row, the draft is frozen as the next version
(`LibraryVersions.tsx`). An admin's visit is enough to make that draft, so the publish is offered
before any project was opened.

### The debt is said at creation, not discovered at opening

The card checks the DECLARATION of the library, never its contents, so a `mix` scaffolded on a
new account would otherwise open with **all** its shared modules missing — exactly the "broken
song rather than unfinished account" reading the card exists to prevent.

`createProjectIn` therefore answers a `missing[]` beside the `project`: the `@k7-core/…` refs the
scaffold has just written and the workspace does not resolve
(`packages/song/src/scaffoldNeeds.ts`). Three things worth noting:

- **The list is read out of the text the scaffold writes**, not kept beside it. An archetype whose
  nodes change module cannot make the list lie.
- **Only `@k7-core/` counts.** `@workspace/` is the workspace's `_modules`, `@engine/` the plugin scan
  and `@meta/` the built-in modules: none of those three waits on a library. That is why
  `arrangement` and `video` owe nothing and `mix` is the only one of the three that opens broken
  on a new account. The asymmetry is pinned by a test.
- **The sentence promises no catalogue.** It names the modules owed and says you write them
  yourself, so as not to suggest something is going to fetch them.

**Changing the list changes every workspace of every account at once**, since none holds a copy:
that is the point.

### No workspace is made before a library is there

**New workspace** is greyed until the origin lists a library — and the page's **New project** with
it, there being nowhere yet to put one — saying so on the button rather than on the
click, and the file service refuses the same call on its own side. A workspace made before the
library exists is a folder whose every `@k7-core/…` resolves to nothing — the same half-set-up account
the libraries notice exists to prevent, one level down and harder to read, since by then there is a
workspace and a project in it to blame instead.

## Dropping a foreign project on a workspace

A `.dawproject` dragged onto a workspace's row is imported into it. The row lights up while the
drag is over it — one row at a time, so what is about to happen is never ambiguous — and the drop
opens a popin that asks **what to call it** before anything is uploaded. It defaults to the file's
own name, shows the folder that will be created under it (the same `projectFolderName` rule
`Nouveau projet` uses, suffix included), and refuses the names that dialog refuses.

The bytes are POSTed to `/import-upload`, which translates them and writes the project. **The
dropped file is not kept**: a `.dawproject` is a zip carrying its own audio, and keeping it beside
the project it produced would put every sample in the workspace twice.

What comes back is the **import log** — what was read, and every warning the mapper raised — shown
in the popin before anything opens, because a translation is lossy and finding that out inside the
song is finding it out too late (`packages/translator/docs/import.md`). Then a button opens the
project, in this tab like every other project link here.

Only `.dawproject` is taken, and the file service refuses anything else on its own side. A `.als`
resolves its samples against its own folder, so one dropped alone would import a silent project;
it is imported from the file tree of an open workspace instead.

The row lights up for **any** file drag, because a `dragover` carries each item's kind and MIME
type and never its name — and a `.dawproject` has no MIME type. So the judgement happens on the
DROP, where the name is finally readable, and a file this cannot take is refused in a sentence
rather than by a highlight that never appeared.

## The BENCH, a rig for one chain

A chain is something you HEAR: what it does cannot be read in its file, and its parameters only
exist inside a project with the plugin loaded. The bench is that project — a live rig written again
on every open and saved nowhere ([apps/k7/backend/docs/media/banc.md](../../backend/docs/media/banc.md)).

**This page has no bench card.** The bench is reached from the Frozen chains page
(`frozenChains.md`), where it builds and edits the account's chains, and from the rehearsal
recorder, which records through it. `/@banc/<chain>/live.k7` seeds the rig with a copy of a library
chain, and the bare `/@banc/live.k7` is the rig alone. It edits no origin library — an admin does
that from any project — so a bench that names a bare library is refused.

**The bench is in no list of workspaces.** Its `Banc` folder is a workspace on disk, but it is
reached by an address and rebuilt on every open; a row for it on this page would offer to open
or delete a rig that is thrown away anyway. `workspaceNames` drops it with the hidden ones.

## A project opens in THIS tab, and the sidebar returns

Every departure — the indented row under the workspace, the tree's button, the empty workspace's
link, the import's **Open** — opens in the same tab. Opening a project is the main reason to be on
this page, and a new tab for each one stacks tabs nobody closes, each one an editor holding a
session. The way back is the **hamburger** at the left of the editor's project bar, which opens this
page's sidebar over the project, and the project's name, which links here too (`projectsUrl`, the same address both gates use when they send
you back). The browser's own Back works as well: each crossing is a history entry. On a
**share** there is neither: the visitor has no account, so no home page to go to (`shared.md`).
Leaving with an edit the autosave is still holding back asks first (`hasUnsavedWork`,
`packages/ui-editor/src/unsaved.ts`), whichever way you leave.

None of it is a page load, and none of it is a `<Link>` either: the project is the router's
`basename`, so a router cannot route outside it — the crossing is `appNav`'s, which swaps the router
for the next scope's (`shell.md`, `packages/project-shell/docs/launch.md`).

`RepoList` and `RepoTree` receive a `projectHref`, not an `onOpenProject`. **An address and not an
action** — the page computes where the row leads, the view makes it a link. That is what keeps
ctrl-click (a new tab, for whoever wants one), shift-click and "copy link address" working: the
browser decides where a click lands, and a plain click lands here. A navigation in an `onClick`
would answer the same thing to all of them.

## The tree is not the normal path

What you come here for is a project, not a workspace. `GET /workspaces/projects` returns, per
workspace, the list of its projects, and the screen draws them **indented under their own**, each
leading straight to its application. There is no `projectCount` field beside it: it is
`projects.length`, and two sources for one number always diverge.

There is no `null` in that response, and that is the clearest gain: "not known yet" would be a
third state to tell apart from "no projects", and a workspace shown without projects when it has
not been read yet is a lie that corrects itself ten seconds later, so one nobody reports.

Projects are found **at any depth**, `songs/hiver.k7` included, and a project inside a project is
descended into and reported — a `.k7` filed inside a `.k7` folder is a real arrangement. That is
`projectDirsUnder` in the file service, the same walker as the list the editor already polls. The
tree keeps its button: it is for looking at what is inside, including folders that are not
projects.

### One row per WORKSPACE

The list shows the account's folders under its `workspace/` on the server, every one addressed the
same way, `@local`. `Examples`, seeded with the demos on first contact, is what a new account has
on the day it has nothing else.

## `@local` — every project's address

```
/@local/Examples/synth-demo.k7     a project in the Examples workspace
/@local/hiver.k7                   a workspace that IS the project
```

`@` cannot start a workspace's folder name, so the sentinel can never collide with a workspace,
and the gate opens the folder that is already there: nothing to look up, nothing to download.

**`parseLaunch` has nothing special to do.** `/@local/Examples/synth-demo.k7` reads as repository
slot `@local`, project `Examples/synth-demo.k7` — the project part stops at the last segment claiming
the app's suffix, the ordinary rule. `localTarget` detaches the workspace from the front, and that
is the only rule specific to `@local`. A workspace that IS a project has nothing after its name
and the project is `"."`, so nothing downstream changes.

**It is the ONLY address.** No register maps a short name to anything else, so `projectHref`,
`workspaceHref` and `externalHref` take no set of registered names and choose nothing: a project
is a folder in the account's workspaces, and its folder name is what addresses it.

What that gives up is portability between accounts: a link pasted to somebody names a folder in
yours. What it buys is one answer instead of two, and no service to ask. It also makes the
second-device case free rather than delicate — `projectClaimKey` is computed from the address, and
where there is one address both ends compute it alike, which is the failure
[external.md](external.md) spends a section warning about.

**It is also the starting point.** A workspace is created HERE, as a plain folder on the server,
and the live-sync relay carries it to the account's other replicas
(`packages/file-service/docs/workspaces.md`, `docs/live-sync-plan.md`); its address does not
change.

**`@local` does NOT require a library.** The bench raises `no-libraries` first,
because an unresolved `@k7-core/…` reference makes a rig read as broken rather than as an unfinished
account. But a demo on this machine needs none, and no library is what a NEW account has: demanding
one would put the demos behind the one thing they exist to precede. A reference that does not
resolve already reports itself, on its node.

### How the tree opens

The **first level is unfolded** as soon as the machine answers, and nothing below: a workspace that
opens fully folded hides behind a click the only thing you came for, and unfolding everything would
drown a project in the neighbour's `node_modules`. That is done **once per workspace**, not on
every tree received: after that the folds belong to the person.

Rows are sorted **alphabetically, at every level**, folders and files mixed. The comparator is
`@studio/web-protocol/tree` — `Intl.Collator`: case and accents do not count, and `prise 2`
precedes `prise 10`. It is in a package and not in an app because the médiathèque sorts its
families with the same one, and two orders for two trees of the same studio read as a bug in one.

The tree comes from `GET /workspace-tree` — the home page's own route, asking it of a workspace it
has not opened. It is `FileNode`, the same type as everywhere else, with the same
`project?: boolean` flag on folders and `app` saying which application opens it. The drawing knows
only that type, never the service that answered.

### A workspace's files

A file in the tree opens **read-only** beside it (`src/projects/FileViewer.tsx`). This screen
writes nothing: what changes a project is the editor, where autosave and the compiler's checks
hold, and a second place to type into would be a second set of rules.

The viewer draws the file's content as it is on the server, with line numbers, and a binary file
as a sentence. The tree is read once per open: it is a look inside, not a monitor.

## Getting a workspace: one gesture

**New workspace** asks the file service for `POST /workspaces`, which creates the folder. Nothing to
configure — no key, no remote, no host — and the live-sync relay is what carries it to the
account's other devices (`docs/live-sync-plan.md`). There is no import and no publish: a workspace
exists on every replica the relay reaches, so there is nothing to bring in or send out by hand.

**On a machine paired with a server, each row says where its workspace lives** (`WorkspaceSyncIcon.tsx`,
`useWorkspaceSync.ts`): synced with the server, on this machine only, or on the server only — the
last listed below the others with a Download, since bringing gigabytes of takes down is the
person's choice. An unpaired machine, and a server with no other server beside it, draw no icon:
there, every workspace is simply here. A server paired with others draws them as a machine does, with
itself as the main one.

**A computer paired with several servers** lists the workspaces of all of them: each row names its
server's host beside the icon, a workspace only on a server downloads from that one, and the row's ⋮
offers **Copy to** and **Move to** every other server (`WorkspaceMenu.tsx`), each confirmed with what
it does. Both send it whole to the target; a move then empties it from the one it left, whose history
keeps it, while a copy leaves it synced where it was and the target holding a workspace of its own
(`packages/file-service/docs/liveCapture.md`, "Several servers"). Either runs on its own and the row
says so until it ends, or says why it failed. Which servers, and which is the main one, are the home
page's account bar (`SyncServers.tsx`, `packages/file-hub/docs/syncRelay.md`). On a server that bar
holds the servers alone — the account's control is the user menu's — the server first and main for
good, so the others have no Make main; Add a server pairs as a machine does.

**And it is EMPTY.** No default project: the archetype decides what the screen shows — a timeline,
two decks, a rig with no surface — and that is a question badly answered from a popin on a list,
before having seen anything. The row of an empty workspace has one link, "Créer le premier
projet", which opens the workspace; the editor puts the assistant there (`FirstProject.tsx`). It
is also the only way in while the workspace is empty, since rows link PROJECTS and there are none:
`workspaceHref` builds the workspace's own address — `/@local/hiver` — and the project there is
`.`, which the machine resolves
(`packages/file-service/docs/workspaces.md`).

**A workspace's row carries a ⋮** (`WorkspaceMenu.tsx`) holding the one act on the whole
workspace: **Delete**, in red. It sits behind a button for the reason a project's acts do: it is
rare, and a button beside the row's own link would compete with it. It goes through `askConfirm`,
which says what is lost: the folder and everything in it, for good — there is no bin a whole
workspace fits in.

Clicking a project goes straight into its application, in this tab, at
`/@local/<workspace>/<dossier>` — an ADDRESS, naming the folder on the machine, which the gate
opens without asking anybody ([launch.md](../../../../packages/project-shell/docs/launch.md)). That
gate is `@studio/project-shell`, and an app outside this repository that mounts it comes back
here too on leaving a project: a second picker on its side would be the second thing to keep in
step that this package exists to avoid.

## Creating, copying and deleting a project — on the machine, not here

The page's primary button is **New project** (the archetype, a name, and which workspace when
there are several), each workspace's block carries one of its own that already knows where, and
each project a **⋮** holding the three acts on one: copy, rename, delete. Neither is done by the media library: what this page
calls is the file service the whole app uses as soon as a project is open, not a seam that would
serve only here.

**The three sit behind one button** (`ProjectMenu.tsx`) because the row is first of all a LINK —
clicking it opens the project, which is what somebody came for — and three text buttons beside
that link compete with it while being wanted far less often. Shares keeps a button of its own: it
carries a COUNT, which is a thing to read rather than an act to pick, and reading what you
published comes before the act that takes it away.

The dialogs are mounted **outside** the menu, by the menu's own component, with the menu holding
only which of the three is asking. A Radix menu unmounts its content on select, and a dialog
inside one goes down with it the instant it is chosen.

They are **explicit calls**, with `fileBase` and the token on each one (`projects/api.ts`), and not
the editor's global `configureFileApi`. That one is set ONCE, on the workspace of the single
project a tab has opened; this page touches a different workspace on every row.

| piece | where |
|---|---|
| scaffold at default settings | `POST <fileBase>/project/create` → `createProjectIn` |
| deletion (the folder goes to the recycle bin) | `POST <fileBase>/project/delete` |
| a copy into another workspace | `POST <fileBase>/workspaces/copy-project` |
| a rename in place | `POST <fileBase>/project/rename` |

Each is ONE call and nothing after it: the write lands in the workspace on the server, and the
live-sync relay is what carries it to the other replicas (`docs/live-sync-plan.md`). There is no
second step to fail after the first has succeeded, so the dialogs report one outcome.

### What a row says, and what it leaves out

A project row is a link, and what it shows is what somebody scans a list of songs BY: the
archetype's glyph in place of a bullet, the name, a violet dot on the workspace's active project,
its `project.tags` (set in the Tasks panel, `tasks.md`), and on the right how long ago it changed.
The archetype is read back from the surfaces the project declares (`projectKind.ts`), the same
question the editor answers to choose its panes, so a project whose surfaces were edited by hand is
drawn as what it now is. All of it comes from the listing the page already polls
(`packages/file-service/docs/workspaces.md`), whose 5-second window is also why a tag added in the
editor can take up to five seconds to appear here.

There is **no app badge**: every project this page lists is opened by k7, and a label that is the
same on every row says nothing five times. A workspace's project count is plain muted text and not a
violet pill, for the reason the next section gives.

### Every entry has a glyph of its own

On the icon rail the glyph is all an entry has, so no two entries share one, across the top list and the
media group alike: the médiathèque's recordings are a waveform, the rehearsal publications a
broadcast. The rehearsal takes have no entry of their own: they are listed in the médiathèque's
Recordings (`packages/ui-rehearsal/docs/sections.md`), where a microphone marks your own.

## An empty page offers the act that fills it

Every list on this side that can be empty draws the same block when it is (`EmptyState.tsx`): a
glyph, one sentence saying what would be here in the reader's words, and the button that makes the
first one — New workspace on Projects, Find and Add on the médiathèque's songs, Record a session and Add
recordings on its recordings. The button is there even when the same one exists elsewhere on the screen: an
empty page is read from its middle, and a sentence telling the reader where a control is (*the red
button at the foot of the sidebar*) is a map where an act was wanted. A page with nothing to do from
here, Tasks, draws the block without one. The médiathèque and the rehearsal pages cannot import
k7's component, so they spell the same block in their own packages.

## The page's hierarchy: one heading, one primary, violet for state

The page opens on a heading, **Projects**, with the counts under it, and two buttons beside it:
**New project**, the primary, and **New workspace**, secondary. That order is how often each is
wanted — a project every session, a workspace a few times a year — and an unlabelled "New" that
made the rarer of the two was the only solid button on the page. The list is capped at `max-w-5xl`
so a row's actions stay near its name on a wide screen.

**Every page of the home side shares that frame** (`PageFrame.tsx`): Projects, Tasks, Libraries,
Settings and About sit in the same column under the same heading row, a page's own controls in that
row rather than in the sidebar's foot, and rehearsal's `.main-inner` is the same width. A page of
narrow rows (settings, the libraries card) keeps them narrow inside the frame instead of re-centring
a narrower column, so moving between pages never moves where the title starts. The médiathèque is
the exception: a tree beside a list is a tool that uses the whole width, not a page to read.

**The chrome is neutral; violet is a state.** The sidebar, the editor's header and footer, and the
médiathèque's tree panel are the card surface, and the accent is kept for what is lit, selected or
the main action — the sidebar's current entry, the archetype picked, the primary button, a
selection on the timeline. A violet wash on every bar left that accent nothing to say once the thing
it marked was on screen.

### The suffix decides, and the name is shown first

`projectName.ts` is pure and tested: it adds the suffix, removes an already-typed suffix —
"hiver.k7" stays "hiver.k7" rather than becoming "hiver.k7.k7" — and refuses
separators rather than replacing them silently. A suffix is read **only at the end**: "prise v1"
is an ordinary folder name and nothing touches it. That is already `projectApp`'s rule, and
`projectName.test.ts` pins it on both sides. The resulting folder is shown under the field
**before** confirming: here the name decides everything.

### The three archetypes, named after their surface

| archetype | surfaces | what it writes |
|---|---|---|
| `arrangement` | `timeline` | one track, one synth, one pattern |
| `mix` | `turntables` | two decks, a crossfade, and a `playlist:` to fill in |
| `video` | `timeline` + `viewport` | the arrangement, plus a picture lane |

**On screen they are named for what someone wants to make**, not for the surface: Song, DJ set,
Video, Live input, Live video, each with a sentence in plain words (`shape.*` messages). "mix" read
as mixing a song, and "graph", "surface" and "rig" describe the app rather than the music. The ids
stay the archetypes', since the command bar (`project new <type>`) and the file service speak them.

Everything is a `.k7` folder opened by the same k7, so "what kind of project" has no answers to
tell apart — what differs is the surface the project DECLARES
(`packages/song/docs/surfaces.md`). There is no "the graph alone, no surface" archetype: an entry
whose whole description would be "none of the three" is not a choice made on purpose, and a
hand-written rig opens anyway. The `live` MODE is something else: it is what `mix` declares.

`createProjectIn` tells them apart in a `Record<ProjectShape, …>` and not in a chain of `if`s: a
fourth archetype added to `PROJECT_SHAPES` will not compile until somebody says what it writes.

**The picker draws them, all at once** (`ShapePicker.tsx`, `shapeSchematics.tsx`). Each archetype is
a card with a line drawing of the screen it opens on — lanes and a playhead, two platters and a
crossfader, a frame over lanes, an input through a fader to a speaker, a webcam into a frame — and
its description, every card's visible and not only the picked one's. The archetype decides what the
whole project BECOMES, and five text buttons with one line under the chosen one asked for that
decision by name alone. The cards are native radios under the drawing, so the arrows, the single
tab stop and what a screen reader announces are the browser's; the drawings are pictures of a
screen rather than icons, hence drawn here and not taken from the icon set. The dialog widens for
them (`wide` on `NameFormDialog`), and so does the first-project page.

> **The file service knows these names, and a machine behind says so.** `shape` travels to
> `POST /project/create`, whose `z.enum` is `PROJECT_SHAPES`. A machine whose service is older
> answers 400 — a failure that is visible and named, which beats a template guessed alongside.

### Copying a project

"Copier" takes a project into another workspace on the same machine: pick where it lands, name the
copy, and the original is not touched (`CopyProject.tsx` → `workspaceOps.ts`'s `copyProject`).

The destination list leaves out two workspaces. Its own, since a copy needs somewhere else to be
useful and the same-workspace duplicate is a different gesture; and any workspace that IS a single
project, where nothing under the root is listed and the copy would exist without ever showing up.

### Deleting a workspace asks for its name

A project deleted goes to a bin; a workspace deleted is gone, folder and all. So the row's ⋮ says
"Delete workspace…" rather than "Remove", the confirmation counts the projects it takes with it, and
it asks for the workspace's NAME typed in (`askText`, `WorkspaceMenu.tsx`): a click is what a habit
gives, and this is the one act on the page that cannot be undone.

### Demos

The `Examples` workspace holds the bundled demos, which the file service mirrors on every start —
an edit to one is overwritten, a deleted one comes back (`packages/file-service/src/demos.ts`).
Mirroring is what keeps them working across versions, so it stays; what changes is that it is SAID.
The listing marks a managed demo `demo: true`, and its row wears an amber "demo — resets" badge; the
workspace poll says `activeIsDemo` for the open project, and the editor draws a line under its
header with "Copy to my workspace" (`components/DemoBanner.tsx`), which opens the same dialog as
"Copier" and goes straight into the copy. Only a bundled folder at the top of `Examples` counts:
anything else put there is the person's own and is never touched.

`Examples` takes **no new project** — not created, imported, dropped or copied into: the file
service refuses all four by name (`refuseInExamples`, `packages/file-service/src/projectLifecycle.ts`),
and the home page offers none of them on its row. A demo is copied OUT to be worked on, and a
person's project sitting among folders the bundle rewrites on every start reads as one of them.
The row comes **last**, after the person's own workspaces, and **folded** behind a chevron: once
there is a workspace of one's own, the demos are the reference rather than the work. It is open
when it is the only workspace, since a new account's page would otherwise show nothing at all.

### Renaming a project

`project rename <project> <new name>`, and the ⋮'s "Rename". The folder moves on the machine, in
the workspace it is already in (`RenameProject.tsx` → `workspaceOps.ts`'s `renameProject`).

Three things it does not do, each for its own reason:

- **It does not change the SUFFIX.** The suffix is what says which app opens the folder
  (`projectApp`), so renaming a `.k7` into anything else would stop it being a project.
  `projectFolderName` puts the source's own back whatever is typed, and the file service refuses
  the mismatch by name rather than trusting the caller.
- **It STOPS the engine when that machine is playing the project**, exactly as a deletion does,
  rather than refusing with "stop it first". That is why it is not `renameEntry`, whose
  `guardMutable` refuses the active project outright: a rename needs the handles released for the
  same reason a delete does, and asking somebody to go and stop the transport in another tab
  before they may rename a folder is a refusal that teaches nothing. The dialog says it before the
  click. What the project's marker does after is the one place the two acts differ — below.
- **It does not chase the address.** A link to the old one stops answering, and the dialog says so
  before the click rather than after. That is the honest cost of a name being an address
  (`packages/project-shell/docs/launch.md`), and the alternative — a redirect table on the machine
  — would be a second place where a project's name lives.

**The active project FOLLOWS the rename.** A delete clears the marker, because the project has
ended; a rename leaves the same project under another folder, so the active-project marker is re-pointed at
it and reopening the workspace lands where it was. The engine is stopped either way, and starting
it again is opening the project — the gesture that starts one anywhere else.

## Shares, on the row of the project they came out of

A **"Shares"** button on each project row, beside the ⋮, opens a popin listing the shares **that
project** has made, each at a checkpoint of its history, and it is the only place one is withdrawn.
**Both ends are k7**: `project share link` builds the share from the checkpoint on the server and
sends it to the media library, which holds the only copy, and the server's engine plays it to people
with no account. How it is made is
[packages/file-service/docs/share.md](../../../../packages/file-service/docs/share.md); what the
library does with it, including why hosting that does not contradict "the library never makes a
working copy", is [apps/k7/backend/docs/media/shares.md](../../backend/docs/media/shares.md).

**On the row, and not in a card for the whole account.** A share COMES OUT of a project, and the
question you ask is "what have I published of that song", never "give me the account's twenty
links sorted by nothing". A single list would carry the project's name on every line, i.e. redraw
by hand the grouping the project list already does.

What the popin has to say, it says:

- **the total in bytes**, at the top — a share never expires, so seeing what they cost together is
  the only thing that can make you decide to withdraw one;
- **the line survives revocation, dated**, and the token is erased from the register: a share that
  vanished would leave its author wondering whether it ever existed, and a revoked line must not
  be copyable from the screen where it is still drawn;
- **the address is a link** and not a button: it is what was sent to other people, and the only way
  to check what they see is to open it;
- the confirmation names the two things that surprise — the bytes go immediately and for good, and
  **a link already sent cannot be un-sent**.

The **count is on the button** ("Partages (2)"): otherwise you would open ten popins to find out
which is not empty. The button is there even at zero, because a button that appears and disappears
with state is not looked for in the right place.

### Comments, behind the row rather than beside the link

Every row carries a **"Commentaires"** button opening `ShareComments.tsx`, a second popin over the
first: what the people you gave the link to wrote on **that** share. This is the only screen
that can move a comment between the three states — `Actifs`, `Résolus`, `Ignorés`, three tabs in
the order a comment travels, since every one lands in the first and leaves for one of the others.
The shared viewer draws the same comments with a chip and no tabs
([shared.md](shared.md)); the media library's half is [apps/k7/backend/docs/media/comments.md](../../backend/docs/media/comments.md).

**Nothing deletes**, and the popin says so: `Résolu` and `Ignoré` are two ways out of the active
list, not two spellings of gone. A `Réactiver` puts one back.

The count on the button is the **active** one alone, and comes down on the share's own row
(`ShareSummary.comments`) rather than from a second request per row: a resolved comment must stop
adding to a number that exists to say "there is something to read". It is counted server-side on
the way out and never stored, and it moves the shares' revision token, so the poll this page
already runs is what refreshes it.

The button is there on a **revoked** row too, where the link and the size are not. The bytes were
the cost of the share; what was written on it survives, and losing the feedback with the audio
would make withdrawing one a choice nobody should have to make.

### Attaching a share to a project is a join, and it is fallible

`origin` is written by the machine, as two basenames:

```ts
origin: { repo: basename(this.root), project: basename(dir) }   // file-service/src/workspace.ts
```

So `origin.repo` is the **workspace's** name — `AccountWorkspace.name` — and `origin.project` is
the **last segment with its suffix**, not the path.
`sharesForProject.ts` crosses that gap, alone and tested, because it is the kind of rule nobody
re-reads inside a JSX — named out in full rather than "projectShares", which would collide with
`ProjectShares.tsx` on a case-insensitive disk. Two consequences:

- a project that IS its workspace (`path: "."`) carries the workspace's name on both sides;
- **two projects of the same name in two folders of one workspace are indistinguishable** and see
  the same lines. Widening the comparison requires the machine to write the path; nothing here can
  guess it.

**An orphaned share has no screen.** The share of a project since deleted, or published from
another machine, has no row to hang on: its bytes stay on the media library's volume, with no button to take
them back, and a share never expires — so that is permanent until somebody calls
`DELETE /api/shares/:key` by hand. It is an accepted trade: covering the other case takes a second
list showing what the first does not, which brings back the whole-account card that row grouping
replaces. If it starts to bite, the answer is a "Partages sans projet" in the page header, empty
and therefore invisible most of the time.

A second, quieter price: **this popin is behind the project list, which needs a machine.** Shares
are not in the "settable with the engine off" column, where the libraries are.

## Two polls, because there are two services

The project list is asked of the **machine**, the shares of the **media library**: two services, two timers, and
they cannot share a token.

The machine's has no token in front of it — no `/revision` to ask first. The service answers the
list itself, behind a five-second window on its side (`LISTING_RESCAN_MS`, the same as the one
under `workspaceInfo`'s project scan: without a floor, every tab on the home page does a `readdir`
per folder every three seconds). Asking first whether anything moved would be one more round trip
to save an already-memoised scan.

A list five seconds behind is a row that has not appeared yet, i.e. a wait. The compiled document
cache refuses that trade and has to — a stale compile is confidently wrong about a song — and that
is the difference worth noting. A workspace made here empties the window immediately
(`forgetListing`), so the only possible lag comes from a hand outside the process.

`seen` remembers the revision of what was last loaded. It answers "has the service moved since?" —
and **not** "does the screen still hold this list?". Emptying the display while leaving the token
intact means the poll reloads nothing, so nothing replaces the emptiness: a spinner that never
stops. Here the two go together — `onChanged` resets both tokens to `""`, forcing a re-read at the
next tick rather than waiting for a revision to move after a write just made.

## What to check in a browser

The suites here run in node and mount nothing: `projectName`, `sharesForProject`
and the bar's verbs (`homeCommands.test.ts`) are covered, the screen is not.

- open `/` while logged out → the login screen, then the home page;
- **with no engine machine**: the project list is replaced by the sentence that says why, the add
  field and **New project** are greyed, and the libraries can still be set;
- **with a machine and NO library**: `Examples` is there, and one of its demos opens
  at `/@local/Examples/<démo>.k7` — the installation-day check. **New workspace** is greyed, and
  hovering it says to add a library first;
- **add a library named `k7-core`** (as an admin): the page lists `@k7-core`, **New workspace** comes back, and
  `<dataRoot>/libraries/k7` is on disk — the seed's copy when the server has one, else empty;
- **add a second one, named `drums`** → it is listed beside `@k7-core`; its ✕ unlists it, and
  `<dataRoot>/libraries/drums` is still on disk. Add `drums` again → it comes back with what it held;
- **delete a listed library's folder on the server**, reload the home page → the amber line says the
  server holds no folder for some libraries, and the row reads *not on the server yet* until the
  page is read again and the hub gives it one;
- **as a non-admin**: the page lists the libraries with no add and no ✕;
- **open a chain's bench, then go home** → `Banc` is not in the list of workspaces;
- **as an admin, in any project**: edit a module of `@k7-core` → the save lands in
  `<dataRoot>/libraries/k7` at once, and another account opening a project hears it. As a
  non-admin, the same save is refused;
- **drag a `.dawproject` onto a workspace row**: that row alone lights up, the popin opens on the
  file's name, and the folder under the field follows what you type. Import → the log, with its
  warnings in amber, then **L'ouvrir** opens the project in this tab, and Back shows the row's
  project count already gone up. Drop the same file twice under the same name → refused by name, and the
  first import is untouched. Drag a `.wav` onto a row → it lights up like any file drag (a
  dragover cannot read a name) and the drop is refused in a sentence saying what it takes;
- unfold a workspace, reload → the same one unfolded, `?ws=` in the address;
- create a project → the row appears **with no refresh**, in five seconds at worst. Longer means
  the list is not coming from the machine;
- open a project → it opens in THIS tab; the hamburger at the left of the project bar opens this
  sidebar over it, its Projects entry (and the project's name) comes back here, and ctrl-click still
  opens a new tab;
- leave a project from the editor, and lose its engine to somebody else → both come back here;
- delete a project → it leaves the list, and its folder is in the workspace's `_recycle_bin/`;
- **"Partages" on a project row that has some** → the count on the button, the popin listing its own
  and not the neighbour's; on one that has none → the popin says so;
- the button must **not** open the project: the whole row is a link, and `preventDefault` stops it;
- revoke a share, then open its link → "introuvable";
- **the bar**: hidden until Ctrl+Shift+P, double-Shift or the footer's Commands button summons it; `project new` opens a three-value field then asks
  for the name; `project delete init` then `confirm` deletes, and `confirm` alone refuses; an
  unknown line is refused without going anywhere.
