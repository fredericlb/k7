# The home page — st0 opens a project, and this is where you choose it

`/` with nothing after it is a screen, not an address to correct: the account's workspaces, the
projects inside them, the libraries and the published shares. It is where you
start, and where you come back to on leaving a song.

The **deploy key is not here**: it is in the Sync tab of the settings (`/@settings`,
`settings.md`). It is pasted into the git host once and never looked
at again, and keeping it at the foot of a screen opened for every song is paying every day for an
installation gesture. The two sentences here that mention it point there, because the day it is
missing, this is where you notice.

## Who draws, who holds

**st0 draws; the machine and pl8 hold.** The workspaces and the deploy key are the account's file
service's, on the server; the libraries are pl8's file hub's, one list and one clone each for the
whole origin; the shares are pl8's (`/api/shares`), because a share's
bytes and its comments live on pl8's volume. pl8 keeps no register of repositories —
[apps/pl8/docs/projects.md](../../../pl8/docs/projects.md) says why.

**The SOURCE of the list is the file service.** What lists the projects is the account's file
service on the server, over its workspaces (`packages/file-hub/docs/fileHub.md`). A separate index
would be a second copy of what that service already holds, and a worse one: one `git fetch` behind, and blind to a project created and committed
whose push did not go through — the exact case `commitOutcome` treats as recoverable.

Two underlying reasons, in the order they weigh:

1. **The level above a project belongs to what opens a project.** "Which repositories does this
   person own, and what is in them" is not a catalogue question; it is the editor's first
   question, the one that has to be answered before there is anything to edit. Modules and chains
   follow the same rule: they are WRITTEN, and writing happens here.
2. **The file service is on this side.** Creating, deleting and LISTING a project all go through
   the account's file service, because a project is a folder in it. st0 is wired to that service
   for every project it opens; the médiathèque does nothing else with it.

The corollary is that the médiathèque has **Morceaux** as its landing section: exactly what you do
not write in a text editor. Projects are here, modules and chains too, playlists next
(`playlists.md`) — the last by a different argument, worth distinguishing: a playlist carries no
bytes, only names of songs that stay in the catalogue, so the file belongs to the repository it
was written for.

## The address follows

This screen is **the front door itself**. st0 answers at the origin root
(`priv.st0.app`, `st0.app`), and the médiathèque — **pl8** — on its own subdomain.
If the first thing you want at a front door is your own work, then the page listing that work IS
the front door, and putting it behind a prefix you have to know how to type would rank it second.

**The way out to pl8, k7 and z0 is in THIS page's header, and only here.** Opened on a project,
st0 draws the editor's header, where a link that leaves the session has no business. It is the
switch every app of the origin carries — `@studio/ui-app-switch`, the one pl8's header mounts
too, rather than a link this app spells its own way — so a row opens a NEW tab and the desktop
app can hand it to the system browser (`packages/ui-app-switch/docs/appSwitch.md`).

`/auth/*` follows the root: the IdP knows only one `redirect_uri`, on st0's origin, so those
routes can only be served by st0 (`packages/web-protocol/docs/addresses.md`).

## What the address says, and what it does not

```
/                     the home page — st0 answers the origin's root
/?ws=<workspace>      …with one workspace's tree unfolded
/@local/demos/x.st0   a project, by its workspace and its folder — see below
/@banc/@st0/live.st0  an admin's bench on a library
/external             the menu of surfaces a second device drives
```

**The path belongs to the launch.** `parseLaunch` reads it before anything is mounted, and the
FIRST segment is a sentinel — `@local`, `@banc`, `@shares` — so a plain word like `external` is
free for the app's own pages. The unfolded workspace travels in the **query**,
which is exactly what a SPA router owns — the argument of
[packages/project-shell/docs/launch.md](../../../../packages/project-shell/docs/launch.md) taken
the other way — and it bookmarks, copies, and answers the back button.

`?ws=` is set with `replace`: browsing three workspaces to see what is in them is not a navigation
you want three history entries for. What is unfolded is a folder on the machine, and its NAME
designates it, not a repository id: readable in the address bar, and true on the machine that
answers.

`main.tsx` reads the address once and picks a stack, rather than mounting one with pieces
switched off:

| the address | what is mounted |
|---|---|
| `/@shares/<token>.st0` | `SharedGate` — no account, no engine, no working copy |
| `/` | `AuthGate` → `Home` — the account, and nothing else |
| `/external` | `AuthGate` → `ExternalIndex` — probes for a machine without claiming one |
| `/@local/…`, `/@banc/…` | `AuthGate` → `EngineGate` → `ProjectGate` → the editor |

The `Profiler` stays on the editor's stack only: it bills every commit of the subtree to keep the rare long
ones, and this page has no bursts of commits to measure.

### The list needs the server's files, and no engine

The list of projects, and importing a repository (which clones it), need the account's file service
on the server and nothing else: the workspaces are there whether or not an engine is running, so
the page does not wait on an engine probe to draw them (`settings/accountFiles.ts`'s `findAccountFiles`,
asked with `bindEngine` off). If that service does not answer, the list is replaced by the
sentence that says so, rather than by an empty screen that would look like a new account. The
header says whether the files answer, with the address in a tooltip and a button to ask again.

What can be read and set **without an engine** is what saves installation day: the libraries here,
and the deploy key in the settings, both asked of the server. A page an engine
picker would strike out entirely would be a page where nothing can be set until there is an
engine. On the hosted studio, where the settings' other three tabs have nothing to show, the Sync
tab draws alone.

Shares are behind a button on a project's row, so behind a list that needs the file service (§ Shares).
That does not touch the installation argument — a new account has published nothing — but it is
the price noted there.

## The rule that holds everything

**The folder's suffix names the application.** `mysong.st0` opens in st0, `partie.z0` in z0, and
`packages/web-protocol/projects.ts` is the whole rule. A folder with no suffix is not a project,
even if it contains a `project.yaml`.

Two suffixes, because two applications open a project — and that is why this page keeps
`launchUrl` on each row rather than building its own addresses: a `.z0` in the same repository
opens elsewhere, and the one line of the screen that would be entitled to guess does not.

Everything an st0 project can BE is in the **surfaces** it declares inside the `.st0`, rather than
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
— `/complete` and `/command` want an active project. Eight verbs, and they are the page's buttons:

| the line | what it does, and through what |
|---|---|
| `project new <type> <name>` | the three archetypes, then `projectFolderName` adds the `.st0` — scaffold on the machine, then commit and push |
| `project copy <name> <workspace> [new name]` | copies it there and commits in the DESTINATION — the name is optional, and is the source's without it |
| `project delete init <name>` | **names** the project and says what confirming will do. Writes nothing |
| `project delete confirm <name>` | deletes that one, if it is the one that was named |
| `system workspace new <name>` | an empty workspace here, no repository behind it |
| `system workspace publish <workspace> <repo_url>` | gives a local workspace its first repository, and pushes |
| `system repo add <repo_url>` | clones it into a new workspace on the server |
| `system repo sync <repo_name>` | `project pull`, then `project commit sync` in that workspace |

**Deleting is two verbs, and that is the confirmation.** A palette can fire a destructive line on
an Enter landing on a fuzzy match; the bar has no dialog to ask a second question with, so it asks
a second verb. Naming the project twice is what makes the second keystroke a decision, and `init`
is the only place you READ what deletion does — the folder recycled, the commit pushed, the
content that stays in git history. The confirm demands the same name, or the second line would be
a formality. The arming is **consumed by any command**, not only by its confirm — the rule the
graph's pending insertion already follows (`docs/shell.md`) — so a destructive verb cannot stay
armed behind three unrelated lines.

**Which repository a line lands in.** The `project …` verbs name no workspace: it is the one the
address unfolded (`?ws=`), or failing that the only one there is. Between several, the line is
**refused by naming them** rather than choosing one — creating a project in the wrong repository
is a commit pushed where nobody was looking.

**Buttons and bar go through the same functions** — `createProjectAndCommit`,
`copyProjectAndCommit`, `deleteProjectAndCommit`, `ensureWorkspace`, the clone: one implementation, two doors, as the
file tree's menu and the `fs …` verbs already have (`docs/shell.md`). What the bar adds is doing
it without the mouse, and saying so in a status line above it: refusals in amber, because a silent "that did nothing" is
avoided everywhere else. A line this
screen does not know is refused **here**: there is no service behind to pass it to, unlike the
editor's bar, whose lines end at `/command`.

## The LIBRARIES, behind the header and the admins'

The libraries are named repositories of the modules and chains every project inherits, and there
is **one list for the whole origin**, not one per account. It is drawn in a panel the header's
**Libraries** entry opens (`LibrariesCard.tsx`), not on the page: the list changes rarely, and only
an admin may change it. Without a library st0 refuses to open anything — not on principle, but
because no `@st0/…` reference would resolve, and a song opened with all its shared modules missing
reads as a broken song rather than as a server somebody has not finished setting up.

**Only an admin edits it.** An admin is a member of one of pl8's `AUTH_ADMIN_GROUPS` (the OIDC
`groups` claim), and the file hub says so in its hello, in the ticket and on every request it
forwards. The hub answers the libraries routes itself and refuses a change without that
([packages/file-hub/docs/fileHub.md](../../../../packages/file-hub/docs/fileHub.md)). Anyone else
sees the same panel read-only: no add, no remove, no **Update**, no key and no bench. Hiding them is
courtesy; the 403 is the gate.

**The page itself says something only when something is wrong** (`LibrariesNotice.tsx`): no library
yet, or one the server could not clone. In that case it shows one amber line at the top, with a
button that opens the panel. A healthy list costs the page nothing.

**A list, each one named.** The name is the level its refs use — `@drums/audio/kick` — and it is
optional in the form: the first library is called `st0`, which is what every `@st0/…` written before
libraries had names means, and any other takes its repository's name. **The server clones each one
once**, with a key of its own, and every account reads that clone
([packages/song/docs/sharedFolders.md](../../../../packages/song/docs/sharedFolders.md)). So the
panel shows admins the SERVER's public key, which each library repository must accept as a
read-only deploy key: no account's key is involved in reading a library. A clone that fails later
is shown on its row with git's words. A row's ✕ removes a library and its clone.

**A library is edited on its bench, and nowhere else.** Each row has a **Bench** button for admins,
which opens `/@banc/@<name>/live.st0` (§ The BENCH). The server's clone is everyone's and is reset to
its remote at every sync, so nothing is written into it; an edit lives in the admin's own clone
until it is pushed ([sharedModules.md](sharedModules.md)).

**An empty repository gets one empty commit, once**, when its bench is first opened
(`initIfEmpty`): a repository just created in a web interface has no branch for the server to fetch.

> **Nothing SEEDS modules into it, deliberately.** `initIfEmpty` lays the commit and nothing else:
> the libraries repository is the reference, so a new library is **empty** and a scaffolded set's
> `@st0/…` refs resolve to nothing until something is put there
> (`packages/song/docs/sharedFolders.md`). Copying a catalogue in from elsewhere — pl8's volume, or
> the build — would make that elsewhere a second source of truth about somebody else's modules.

### The debt is said at creation, not discovered at opening

The card checks the DECLARATION of the repository, never its contents, so a `mix` scaffolded on a
new account would otherwise open with **all** its shared modules missing — exactly the "broken
song rather than unfinished account" reading the card exists to prevent.

`createProjectIn` therefore answers a `missing[]` beside the `project`: the `@st0/…` refs the
scaffold has just written and the workspace does not resolve
(`packages/song/src/scaffoldNeeds.ts`). Three things worth noting:

- **The list is read out of the text the scaffold writes**, not kept beside it. An archetype whose
  nodes change module cannot make the list lie.
- **Only `@st0/` counts.** `@workspace/` is the workspace's `_modules`, `@engine/` the plugin scan
  and `@meta/` the built-in modules: none of those three waits on a repository. That is why
  `arrangement` and `video` owe nothing and `mix` is the only one of the three that opens broken
  on a new account. The asymmetry is pinned by a test.
- **The sentence promises no catalogue.** It names the modules owed and says you write them
  yourself, so as not to suggest something is going to fetch them.

**Changing the list changes every workspace of every account at once**, since none holds a copy:
that is the point. A library pointed at another repository is re-cloned.

### Adding one CLONES it, and nothing is made before it is there

The card's button waits, and says *Cloning…* while it does: a paste that looks like an SSH URI is
not yet a repository the server's key can read, and a clone is the only thing that answers that
question. A refusal names what git said and stores nothing. Where the clone lands and how it is
kept current is
[packages/file-hub/docs/fileHub.md](../../../../packages/file-hub/docs/fileHub.md).

**Nouveau** and **Importer** are greyed until the origin lists a library, saying so on the button rather
than on the click, and the file service refuses the same two calls on its own side. A workspace
made before the library exists is a folder whose every `@st0/…` resolves to nothing — the same
half-set-up account the libraries notice exists to prevent, one level down and harder to read, since by then
there is a workspace and a project in it to blame instead.

## Dropping a foreign project on a workspace

A `.dawproject` dragged onto a workspace's row is imported into it. The row lights up while the
drag is over it — one row at a time, so what is about to happen is never ambiguous — and the drop
opens a popin that asks **what to call it** before anything is uploaded. It defaults to the file's
own name, shows the folder that will be created under it (the same `projectFolderName` rule
`Nouveau projet` uses, suffix included), and refuses the names that dialog refuses.

The bytes are POSTed to `/import-upload`, which translates them and writes the project. **The
dropped file is not kept**: a `.dawproject` is a zip carrying its own audio, and keeping it beside
the project it produced would put every sample in the repository twice.

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

## The BENCH, opened from the library it edits

A module is something you HEAR: what it does cannot be read in its file, and its parameters only
exist inside a project with the plugin loaded. The bench is that project — a live rig written again
on every open and saved nowhere ([apps/pl8/docs/banc.md](../../../pl8/docs/banc.md)).

**This page has no bench card.** A bench is always ON something: `/@banc/@<library>/live.st0` is an
admin's bench on a library, opened from that library's row in the Libraries panel, and
`/@banc/<chain>/live.st0` is a chain's, which k7 opens to record through. A bench that names
nothing would edit nothing and play nothing in particular, so the bare `/@banc/live.st0` is refused.
The panel is where the library is, so it is where its bench opens: an admin who wants to change a
module is already looking at the list it is in.

## A project opens in THIS tab, and a back arrow returns

Every departure — the indented row under the workspace, the tree's button, the empty workspace's
link, the import's **Open** — opens in the same tab. Opening a project is the main reason to be on
this page, and a new tab for each one stacks tabs nobody closes, each one an editor holding a
session. The way back is the **back arrow** at the left of the editor's header, ahead of the
project's name, which links here too (`projectsUrl`, the same address both gates use when they send
you back). The browser's own Back works as well, since this was an ordinary navigation. On a
**share** there is neither: the visitor has no account, so no home page to go to (`shared.md`).
Leaving with an edit the autosave is still holding back is caught by the editor's `beforeunload`
prompt (`packages/ui-editor/src/unsaved.ts`), and the arrow goes through that prompt like any other
departure.

It is a whole-page navigation and not a `<Link>`: the project is the router's `basename`, so
nothing under it can route outside (`packages/project-shell/docs/launch.md`).

`RepoList` and `RepoTree` receive a `projectHref`, not an `onOpenProject`. **An address and not an
action** — the page computes where the row leads, the view makes it a link. That is what keeps
ctrl-click (a new tab, for whoever wants one), shift-click and "copy link address" working: the
browser decides where a click lands, and a plain click lands here. A navigation in an `onClick`
would answer the same thing to all of them.

## The tree is not the normal path

What you come here for is a project, not a repository. `GET /workspaces/projects` returns, per
workspace, the list of its projects, and the screen draws them **indented under their own**, each
leading straight to its application. There is no `projectCount` field beside it: it is
`projects.length`, and two sources for one number always diverge.

There is no `null` in that response, and that is the clearest gain: "not known yet" would be a
third state to tell apart from "no projects", and a repository shown without projects when it has
not been read yet is a lie that corrects itself ten seconds later, so one nobody reports.

Projects are found **at any depth**, `songs/hiver.st0` included, and a project inside a project is
descended into and reported — a `.z0` filed inside a `.st0` folder is a real arrangement. That is
`projectDirsUnder` in the file service, the same walker as the list the editor already polls. The
tree keeps its button: it is for looking at what is inside, including folders that are not
projects.

### One row per WORKSPACE, not per repository

The list shows the account's folders under its `workspace/` on the server. Two consequences, and
both are needed:

**A repository that is not cloned has no row**: the list is what the machine holds, and
**Importer** is how to bring one in.

**A workspace with NO repository has one too.** `Examples`, seeded with the demos on first
contact, is a clone of nothing — and it is what a new account has on the day it has nothing else.
Every row is addressed the same way, `@local`, whether its workspace has an `origin` or not.

## `@local` — every project's address

```
/@local/Examples/synth-demo.st0     a project in the Examples workspace
/@local/hiver.st0                   a workspace that IS the project
```

`@` cannot start a folder name git gives a clone, so the sentinel can never collide with a
workspace, and the gate opens the folder that is already there: nothing to look up, nothing to
clone.

**`parseLaunch` has nothing special to do.** `/@local/Examples/synth-demo.st0` reads as repository
`@local`, project `Examples/synth-demo.st0` — the project part stops at the last segment claiming
the app's suffix, the ordinary rule. `localTarget` detaches the workspace from the front, and that
is the only rule specific to `@local`. A workspace that IS a project has nothing after its name
and the project is `"."`, so nothing downstream changes.

**It is the ONLY address.** No register maps a short name to a repository URI, so `projectHref`,
`workspaceHref` and `externalHref` take no set of registered names and choose nothing: a project
is a folder in the account's workspaces, and its folder name is what addresses it.

What that gives up is portability between accounts: a link pasted to somebody names a folder in
yours. What it buys is one answer instead of two, and no service to ask. It also makes the
second-device case free rather than delicate — `projectClaimKey` is computed from the address, and
where there is one address both ends compute it alike, which is the failure
[external.md](external.md) spends a section warning about.

**It is also the starting point.** A workspace is created HERE — `git init`, no remote — and
everything works in it except pushing until the day it is published
(`packages/file-service/docs/workspaces.md`). Publishing gives it an `origin`; its address does not
change.

**`@local` does NOT require a libraries repository.** The bench raises `no-libraries` first,
because an unresolved `@st0/…` reference makes a rig read as broken rather than as an unfinished
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

## Getting a workspace: three gestures, and only one talks to a server

**Nouveau** talks to nobody: `POST /workspaces` creates the folder and initialises it with git,
with no remote. No server, no key, no account — the one thing on this screen that works entirely
offline, and the one you start with.

**And it is EMPTY.** No default project: the archetype decides what the screen shows — a timeline,
two decks, a rig with no surface — and that is a question badly answered from a popin on a list,
before having seen anything. The row of an empty workspace has one link, "Créer le premier
projet", which opens the workspace; the editor puts the assistant there (`FirstProject.tsx`). It
is also the only way in while the workspace is empty, since rows link PROJECTS and there are none:
`workspaceHref` builds the workspace's own address — `/@local/hiver` — and the project there is
`.`, which the machine resolves
(`packages/file-service/docs/workspaces.md`).

**Importer** takes a URI and asks the file service for `POST /workspaces/clone`, with the deploy key
the machine made for itself (`packages/file-service/src/sshKeys.ts`), then follows the job.
The clone is not an extra: this list shows only what the machine holds, so without it adding would
be a form that changes nothing on screen.

**The dialog says which STEP the import is on.** An import is three waits, not one — the clone,
the account's libraries brought up to date, the media fetched through LFS — and the last can take
far longer than the first. A single bar that reached 100% at the end of the clone and then sat
there for ten minutes reads as a hang. So `ImportBar` draws one segment per step (`CLONE_STEPS`,
reported by the job as `step`), "Step 3 of 3 · Fetching the media", the current segment filled by
its percentage, pulsing when the step cannot be measured.

**A percentage is on screen; git's own words are in the console.** Every line git writes, as the
dialog's one status line, would be a log flickering past too fast to read and gone the moment it
works. So the screen keeps only what is progress — the step, git's phase (`Receiving objects`) and
its percentage — and each line goes to `console.debug` as `git: …`, where it can be scrolled after
the fact. A FAILURE is the exception: git's last words
are the error, on screen, because that is the one time they are the answer.

The machine keeps the last 50 lines (`cloneJobs.ts`) and counts them all in `emitted`, so the page
logs each line exactly once and says `…(N lines the machine no longer holds)` when a clone outran
the 800 ms poll. Matching on the text instead would have skipped whole runs — git repeats its
counter lines verbatim.

**A FAILED clone is where this matters most.** `gitClone` rejects with `stderr.join("\n")` —
everything git said, up to two hundred lines — and drawn in one block the answer would be buried:
it is at the END of that, `Permission denied (publickey).` and then the
`fatal:` that followed from it, and either alone is half the story. `gitReason` keeps the last two
non-empty lines for the screen and puts the whole of it in the console, saying so when there was
more.

And the workspace really does go: a clone that failed leaves no workspace, by design — see
`cloneWorkspace`. Under a wall of log, with the reason somewhere in the middle, that removal would
read as a bug.

**A workspace's row carries a ⋮** (`WorkspaceMenu.tsx`) holding the three acts on the whole
workspace: **Publish**, **Compact** and **Delete**. They sit behind one button for the reason a
project's do: they are rare, and three buttons beside the row's own link would compete with it.
Delete comes last, in red, after a separator. Compact and Delete each go through `askConfirm`, and
each confirmation says what is lost. For Compact, that is the bin, every past version, every
other branch and alternative, and, when there is an `origin`, the history at the host too, through
a force-push (`packages/file-service/docs/workspaces.md` § Compacting). Compacting rewrites history
and touches no file in use, so its result is a toast with the bytes freed, which also says when
the force-push was refused.

**A row says when its workspace and its repository differ** (`WorkspaceSyncLine.tsx`), under the
origin and in two colours:

- **amber, cloud-up**, *Needs syncing*: work here that the host does not have, i.e. uncommitted
  files and commits not pushed;
- **blue, cloud-down**, *Can be updated*: commits on the host that this copy lacks.

Both lines can show at once, on a diverged workspace, and a level workspace shows neither. Silence
is the normal state, so a line is something to act on rather than noise read past every day. The
tooltip names the bar's `system repo sync`, the one gesture that settles both. The counts come from
their own route and timer (`useWorkspaceSync.ts`), since answering "behind" costs a fetch, and the
reason is in `packages/file-service/docs/workspaces.md` § Sync state.

**Publier** is in that menu and not at the top, because it acts on ONE workspace, and it is
offered only when `origin` is null. It asks for a repository URI — which must exist and be empty —,
sets it as `origin` and pushes (`POST /workspaces/remote`). The push is the half that can fail
loudly, and git speaks for itself ("Permission denied (publickey)").

Clicking a project goes straight into its application, in this tab, at
`/@local/<workspace>/<dossier>` — an ADDRESS, naming the folder on the machine, which the gate
opens without asking anybody ([launch.md](../../../../packages/project-shell/docs/launch.md)). That
gate is `@studio/project-shell`, mounted identically by st0 and by z0's editor, and z0 comes back
here too on leaving a project: this list holds `.z0` folders as much as `.st0`, and a second picker
on its side would be the second thing to keep in step that this package exists to avoid.

## Creating, copying and deleting a project — on the machine, not here

Each repository's block carries a **"New project"** (the archetype, and a name), and each project
a **⋮** holding the three acts on one: copy, rename, delete. Neither is done by pl8: what this page
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
project a tab has opened; this page touches a different repository on every row.

| piece | where |
|---|---|
| scaffold at default settings | `POST <fileBase>/project/create` → `createProjectIn` |
| deletion (the folder is recycled) | `POST <fileBase>/project/delete` |
| a copy into another workspace | `POST <fileBase>/workspaces/copy-project` |
| a rename in place | `POST <fileBase>/project/rename` |
| index, commit, push | the `commit` command → `packages/commands/src/git.ts` |
| clone the repository if it is not there | `POST /workspaces/clone` + the jobs to poll |

`ensureWorkspace` clones if the machine does not know the repository yet. Without it you would
have to have a project already in order to open one, and therefore to create one — a chicken and
egg that would make the function useless on precisely the new repositories. The progress shown is
git's, in its own words ("Receiving objects"), because a thirty-second wait that says nothing
looks like a frozen screen.

### The suffix decides, and the name is shown first

`projectName.ts` is pure and tested: it adds the suffix, removes an already-typed suffix —
"hiver.z0" in a menu that writes st0 would give "hiver.z0.st0", which is neither — and refuses
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

Everything is a `.st0` folder opened by the same st0, so "what kind of project" has no answers to
tell apart — what differs is the surface the project DECLARES
(`packages/song/docs/surfaces.md`). There is no "the graph alone, no surface" archetype: an entry
whose whole description would be "none of the three" is not a choice made on purpose, and a
hand-written rig opens anyway. The `live` MODE is something else: it is what `mix` declares.

`createProjectIn` tells them apart in a `Record<ProjectShape, …>` and not in a chain of `if`s: a
fourth archetype added to `PROJECT_SHAPES` will not compile until somebody says what it writes.
Same reason as `HAS_SCAFFOLD`.

> **The file service knows these names, and a machine behind says so.** `shape` travels to
> `POST /project/create`, whose `z.enum` is `PROJECT_SHAPES`. A machine whose service is older
> answers 400 — a failure that is visible and named, which beats a template guessed alongside.

### Owning a suffix and being creatable are two questions

`ProjectApp` is `"st0" | "z0"` — k7 has no projects. But the menu reflects `SCAFFOLDED_APPS`, not
that type. Creating needs a **template** — a map of files the file service knows how to write
(`createProjectIn`, and `@studio/song`'s `scaffold*` modules). z0 owns `.z0` folders and has none,
so offering it would make a `.z0` folder containing an st0 song: the suffix saying one thing, the
contents another, and nothing complaining until z0 tried to open it. `HAS_SCAFFOLD` answers app by
app, in a `Record` and not a list — which is why the menu offers an st0 project's archetypes
rather than a list of applications.

### The verb is `project commit`, and a success has to be proven

Two traps hide each other here. **The verb**: `commands.yaml` declares `project commit`, not
`commit`, and a line matching no command does not throw — `runCommand` answers "unknown command",
so nothing is committed and nothing says so. **Reading the answer**: looking for known failure
words and concluding success for everything else announces that all is well for a command that
does not exist. `commitOutcome` demands **positive proof** — a `committed …` line — and returns
the raw output for everything else, including what it does not recognise. That output is what will
name the next drift between this code and `commands.yaml`. It is pure and in its own module, with
not one import: that is what makes it loadable by a test, `workspaceOps.ts` touching `./api` — hence
`window` — as soon as it loads.

**A failed push does not cancel the creation.** The folder is there and only the push failed; the
dialog closes and the page shows "créé, mais : …". Deleting the project to be tidy would be
throwing away somebody's work over a network fault, and throwing would invite starting over a
creation that has happened. There is nothing to ask for afterwards: the machine answers the list,
so the project appears at the next tick.

### Copying a project — the DESTINATION is what commits

"Copier" takes a project into another workspace on the same machine: pick where it lands, name the
copy, and the original is not touched. One call does the copy (`CopyProject.tsx` → `workspaceOps.ts`'s
`copyProjectAndCommit`), and the commit that follows is run **in the workspace that received it**,
because that is the repository whose history gained a project. Which also settles the push: it
happens when the destination has an `origin` and does not when it has none, exactly as creating a
project does — so the picker says which of the two each row is, before the click rather than in
the error afterwards.

The destination list leaves out two workspaces. Its own, since a copy needs somewhere else to be
useful and the same-workspace duplicate is a different gesture; and any workspace that IS a single
project, where nothing under the root is listed and the copy would exist without ever showing up.

**A failed push does not undo the copy**, for the reason the creation states above — with one more
edge: retrying would hit a name that is now taken, so the page says "copié dans …, mais : …" and
leaves the fix to be a push rather than a second copy.

### Renaming a project — the SAME workspace commits

`project rename <project> <new name>`, and the ⋮'s "Rename". The folder moves on the machine
(`RenameProject.tsx` → `workspaceOps.ts`'s `renameProjectAndCommit`), and the commit runs in the
workspace it is already in — a rename is a delete and an add to git, so it is that repository's
history that gains it, and the push follows the same `origin`-or-not rule creating and copying do.

Three things it does not do, each for its own reason:

- **It does not change the SUFFIX.** The suffix is what says which app opens the folder
  (`projectApp`), so renaming a `.st0` into a `.z0` would hand the project to another editor.
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
ended; a rename leaves the same project under another folder, so `.studio-active` is re-pointed at
it and reopening the workspace lands where it was. The engine is stopped either way, and starting
it again is opening the project — the gesture that starts one anywhere else.

**A failed push does not undo the rename**, as with the other three: the folder IS renamed, and
the page says so rather than throwing, since a retry would find the old name gone.

## Shares, on the row of the project they came out of

A **"Shares"** button on each project row, beside the ⋮, opens a popin listing the frozen
snapshots **that project** has published, and it is the only place one is withdrawn. **Both ends
are st0**: `project share link` makes the bundle here, on the machine that has an engine and can
therefore render sound, and sends it to pl8 — which holds the only copy and serves it to people
with no account. What the bundle contains is
[packages/commands/docs/shareBundle.md](../../../../packages/commands/docs/shareBundle.md); what
pl8 does with it, including why hosting that does not contradict "pl8 never makes a working copy",
is [apps/pl8/docs/shares.md](../../../pl8/docs/shares.md).

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
first: what the people you gave the link to wrote on **that** snapshot. This is the only screen
that can move a comment between the three states — `Actifs`, `Résolus`, `Ignorés`, three tabs in
the order a comment travels, since every one lands in the first and leaves for one of the others.
The frozen viewer draws the same comments with a chip and no tabs
([shared.md](shared.md)); pl8's half is [apps/pl8/docs/comments.md](../../../pl8/docs/comments.md).

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

So `origin.repo` is the **workspace's** name — `AccountWorkspace.name`, not the repository's short
name at pl8 — and `origin.project` is the **last segment with its suffix**, not the path.
`sharesForProject.ts` crosses that gap, alone and tested, because it is the kind of rule nobody
re-reads inside a JSX — named out in full rather than "projectShares", which would collide with
`ProjectShares.tsx` on a case-insensitive disk. Two consequences:

- a project that IS its workspace (`path: "."`) carries the workspace's name on both sides;
- **two projects of the same name in two folders of one workspace are indistinguishable** and see
  the same lines. Widening the comparison requires the machine to write the path; nothing here can
  guess it.

**An orphaned share has no screen.** The share of a project since deleted, or published from
another machine, has no row to hang on: its bytes stay on pl8's volume, with no button to take
them back, and a share never expires — so that is permanent until somebody calls
`DELETE /api/shares/:key` by hand. It is an accepted trade: covering the other case takes a second
list showing what the first does not, which brings back the whole-account card that row grouping
replaces. If it starts to bite, the answer is a "Partages sans projet" in the page header, empty
and therefore invisible most of the time.

A second, quieter price: **this popin is behind the project list, which needs a machine.** Shares
are not in the "settable with the engine off" column, where the libraries are.

## Git is blocking

Every git operation this app STARTS locks the page until it is done: one overlay in the centre of
the screen, saying in words what git is doing, over a bar that is measured when git reports a
percentage (a clone) and slides otherwise. Keys are swallowed while it is up. That covers the home
page's clone, publish, compact, and the project create / copy / rename / delete that commit, the
libraries panel's add / remove / update, and the editor's `project commit`, `project pull` and
`project alternative` — all through `runGit` in `src/components/GitBusy.tsx`, and
`<GitBusyOverlay/>` mounted once in `Home.tsx` and once in `App.tsx`.

What forced it: a write that rewrites a repository (a compaction force-pushes, a pull moves the
working tree, an alternative switches branch) races any edit made under it, and a second git
command on the same repository fails on git's index lock with a message nobody can act on.
Locking the page is cheaper than explaining either.

What is NOT behind it: the background polls (`useWorkspaceSync`, the share badge's status). They
read and fetch on a timer, and a lock every twenty seconds would make the page unusable.

## Two polls, because there are two services

The project list is asked of the **machine**, the shares of **pl8**: two services, two timers, and
they cannot share a token.

The machine's has no token in front of it — no `/revision` to ask first. The service answers the
list itself, behind a five-second window on its side (`LISTING_RESCAN_MS`, the same as the one
under `workspaceInfo`'s project scan: without a floor, every tab on the home page does a `readdir`
per folder every three seconds). Asking first whether anything moved would be one more round trip
to save an already-memoised scan.

A list five seconds behind is a row that has not appeared yet, i.e. a wait. The compiled document
cache refuses that trade and has to — a stale compile is confidently wrong about a song — and that
is the difference worth noting. A clone or a workspace made here empties the window immediately
(`forgetListing`), so the only possible lag comes from a hand outside the process.

`seen` remembers the revision of what was last loaded. It answers "has the service moved since?" —
and **not** "does the screen still hold this list?". Emptying the display while leaving the token
intact means the poll reloads nothing, so nothing replaces the emptiness: a spinner that never
stops. Here the two go together — `onChanged` resets both tokens to `""`, forcing a re-read at the
next tick rather than waiting for a revision to move after a write just made.

## What to check in a browser

The suites here run in node and mount nothing: `commitOutcome`, `projectName`, `sharesForProject`
and the bar's verbs (`homeCommands.test.ts`) are covered, the screen is not.

- open `/` while logged out → the login screen, then the home page;
- **with no engine machine**: the project list is replaced by the sentence that says why, the add
  field and "Nouveau projet" are greyed, and the libraries can still be set. The "réglages" link in
  that sentence leads to the key, which also generates with no engine;
- **with a machine and NO libraries repository**: `Examples` is there, and one of its demos opens
  at `/@local/Examples/<démo>.st0` — the installation-day check. **Nouveau** and **Importer** are
  greyed, and hovering one says to add the repository first;
- **add a libraries repository** (as an admin, the server's key added to it as a read-only deploy
  key): the button says *Clonage…* and waits — a clone, not a spelling check. Give it a URI whose
  host is wrong → the refusal carries git's own words, the panel still reads as empty, and the two
  workspace buttons are still greyed. Give it a real one → the panel lists `@st0`, both buttons come
  back, and `<dataRoot>/libraries/st0` is on disk;
- **add a second one, named `drums`** → it is listed beside `@st0`; its ✕ removes it and its clone;
- **as a non-admin**: the panel lists the libraries with no add, ✕, Update, key or Bench;
- **a row's Bench**, as an admin: opens `/@banc/@st0/live.st0` on a rig you can play. Edit a module
  of `@st0` → the bottom row says what changed; **Discard** puts it back, **Commit & push** publishes
  it and the row goes away. Wire something into the rig, reopen it → the rig is the scaffold again;
- **drag a `.dawproject` onto a workspace row**: that row alone lights up, the popin opens on the
  file's name, and the folder under the field follows what you type. Import → the log, with its
  warnings in amber, then **L'ouvrir** opens the project in this tab, and Back shows the row's
  project count already gone up. Drop the same file twice under the same name → refused by name, and the
  first import is untouched. Drag a `.wav` onto a row → it lights up like any file drag (a
  dragover cannot read a name) and the drop is refused in a sentence saying what it takes;
- unfold a workspace, reload → the same one unfolded, `?ws=` in the address;
- create a project → the row appears **with no refresh**, in five seconds at worst. Longer means
  the list is not coming from the machine;
- open a project → it opens in THIS tab; the back arrow at the left of the header (and the
  project's name beside it) comes back here, and ctrl-click still opens a new tab;
- leave a project from the editor, and lose its engine to somebody else → both come back here;
- create a project in an **empty** repository this machine has never seen → the clone with git's
  progress, then the folder, then the commit;
- **"Partages" on a project row that has some** → the count on the button, the popin listing its own
  and not the neighbour's; on one that has none → the popin says so;
- the button must **not** open the project: the whole row is a link, and `preventDefault` stops it;
- revoke a share, then open its link → "introuvable";
- **the bar**: double-Shift gives it the keyboard; `project new` opens a three-value field then asks
  for the name; `project delete init` then `confirm` deletes, and `confirm` alone refuses; an
  unknown line is refused without going anywhere.
