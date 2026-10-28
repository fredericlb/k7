# The home page

The home page is the site's root address with no project in it, for example `https://app.k7.rocks/`.
It lists your workspaces and the projects in them. Every project is opened from here, and the back
arrow at the top left of the editor brings you back here.

The home page needs no engine. It reads your workspaces from the server, so it works even when no
engine is running.

## Layout

```text
+------------+-------------------------------------------------+
| k7         | (account bar: tray and phone apps only)         |
| Projects   +-------------------------------------------------+
|            | [library notice, when there is something to say]|
| Projects   | [New]                                           |
| Tasks      | workspace-a   (sync icon) [3 projects] [Nouveau projet] [⋮]
| Libraries  |   ↳ song-one  k7  [tag]          [Shares] [⋮]   |
|            |   ↳ song-two  k7                 [Shares] [⋮]   |
| Media      | workspace-b   [0 projects]  ...                 |
|  Songs     |   Create the first project                      |
|  Samples   |                                                 |
|  ...       |                                                 |
| Rehearsal  |                                                 |
|  ...       +-------------------------------------------------+
|     (user) | > command bar                                   |
+------------+-------------------------------------------------+
```

## The sidebar

The left sidebar is the same on the home page and on every page that hangs off it. Moving between
its entries does not reload the page. On a phone, or a tablet held upright, it is a rail of icons
alone.

The top shows **k7** and the name of the current page. Hover **k7** to see the build version.

| Entry | Address | What it shows |
|---|---|---|
| **Projects** | `/` | Your workspaces and projects (this page) |
| **Tasks** | `/tasks` | Every workspace's task list in one place |
| **Libraries** | `/libraries` | The site's shared libraries |
| **Media** group: **Songs**, **Samples**, **Recordings**, **Playlists**, **Find songs** | `/media/…` | The media library. The first four show a count once the media pages have loaded them. |
| **Rehearsal** group: **Recordings**, **Publications**, **Exercises** | `/rehearsal/…` | The rehearsal recorder |

The media library and the rehearsal recorder have their own sections in this guide.

### The user menu

The round button at the foot of the sidebar opens the user menu:

- your email, as the heading;
- **Settings**, which opens `/settings` (language, chains, AI key, paired devices, sync pairings and
  the rehearsal pages, described in [Settings](./16-settings.md));
- **Engine**, which opens `/settings/engine`: the engines your account may use, and on a computer
  running the [tray](./82-desktop-app.md) the settings of this computer's engine, or in the phone app
  the phone's engine;
- for the server's admins, **Server**, which opens `/settings/server`: who owns each engine, and the
  song hunt's Soulseek access;
- a link to each other app of the site, if there is one. On a computer running the tray these
  links point at the server you are paired with. If it is not paired with a server, the menu says
  "Other apps — pair a server in Settings to open them" instead;
- the logout entry.

## The workspace list

The main column lists your workspaces. Each workspace row shows:

| Item | Meaning |
|---|---|
| Folder icon and name | Click it to open the workspace's file tree (see [Browsing a workspace's files](#browsing-a-workspaces-files)). |
| Sync icon | On a computer running the tray and in the phone apps: whether the workspace is synced with a server, on this machine only, or on the server only. See [Workspaces](./04-workspaces.md#where-a-workspace-lives). |
| Server name | Shown when your account syncs with several servers. |
| **N projects** badge | How many projects the workspace holds. |
| **Nouveau projet** button | Creates a project in this workspace. See [Projects](./05-projects.md#creating-a-project). |
| **⋮** menu | Copy or move the workspace to another server, or remove it. See [Workspaces](./04-workspaces.md). |

Under each workspace, its projects are listed, indented. A project row shows:

| Item | Meaning |
|---|---|
| Name | The folder name without `.k7`. Click it to open the project in this tab. |
| **k7** badge | The app that opens the project. |
| Tag badges | The project's tags, set with `project tag` inside the project (see [Projects](./05-projects.md#tags)). |
| Parent folder | Shown in grey when the project sits in a subfolder of the workspace. |
| **Shares** button | The links published from this project. The number of live links is shown in brackets. See [Sharing a project](./09-sharing.md#managing-shares-from-the-home-page). |
| **⋮** menu | **Copy**, **Rename**, **Delete**. See [Projects](./05-projects.md). |

A workspace with no project shows **Create the first project** instead. It opens the workspace
itself, where k7 asks for the first project (see [Workspaces](./04-workspaces.md#the-first-project)).

The list refreshes on its own every few seconds while the page is visible, so a project created on
another device appears without reloading.

### When the list cannot be read

If the server's file service does not answer, the page says "The server's file service is not
answering, so the list of your projects cannot be read." The **New**, **Nouveau projet** and **⋮**
buttons are greyed out, and hovering them says why. Libraries and shares are still reachable, and
the line under the message links to the settings.

### The Examples workspace

Every account has a workspace named **Examples**, stocked with demo projects that ship with k7
(`crossfade-demo`, `node-demo`, `rack-demo`, `synth-demo`, `video-demo`). They are put back as
shipped every time the server starts: an edit to a demo is overwritten, and a deleted demo comes
back. To experiment with one, copy it into a workspace of your own first (see
[Projects](./05-projects.md#copying-a-project)). Projects you add to Examples yourself are left alone.

## Browsing a workspace's files

Click a workspace's name to see its whole file tree. The address gains `?ws=<name>`, so the view can
be bookmarked and the browser's Back button returns to the list.

- The tree lists folders first, then files, each level sorted by name. The first level is unfolded.
- A folder that is a project is drawn with an open-folder icon, in bold, with an **Ouvrir dans k7**
  button that opens it.
- Click a file to read it on the right. This view is read-only: you edit a project's files once it
  is open in the editor. A binary file (audio, video) shows "A binary file: nothing to show here."
- Click **Projets** at the top left to go back to the list.

## Libraries

A library is a named folder of modules and chains that every project can use. k7 refuses to open a
project until at least one library exists. When there is a problem, a notice sits at the top of the
home page with a link to the **Libraries** page:

- "No library yet — k7 opens no project without one."
- "The server holds no folder for some libraries."

The **New** workspace button is also greyed out while there is no library, with the hint "Add a
library first".

The **Libraries** page (`/libraries`) lists each library with its published versions. Only the
site's admins can add or remove a library or publish a new version of one; everyone else sees
"Only the server's admins edit the libraries." If there is no library and you are not an admin,
ask one to add it. Libraries, their versions and upgrades are described in the chains and modules
section of this guide.

## Tasks

The **Tasks** page (`/tasks`) gathers the open tasks of every workspace (each workspace's
`TODOS.md`), grouped by workspace:

- Each group shows how many tasks are open, and an **Open** link to the workspace.
- A task that names a project links to it (**Open &lt;path&gt;**).
- **Show done** also lists the ticked tasks.
- The refresh button reads the tasks again.

The page is read-only. Tasks are added and ticked inside a workspace, in the editor's task panel.

## The home command bar

The bar along the bottom of the home page takes typed commands, like the editor's. Press **Shift**
twice quickly to put the cursor in it. The line above the bar shows the answer to the last command,
in amber when it was refused.

The home page has its own short list of commands:

| Command | What it does |
|---|---|
| `project new <type> <name>` | Create a project. `<type>` is an archetype: `arrangement`, `mix`, `video`, `live` or `live-video`. |
| `project copy <project> <workspace> [new name]` | Copy a project into another workspace. Without a new name, the copy keeps the original's. |
| `project rename <project> <new name>` | Rename a project. The `.k7` suffix is kept. |
| `project delete init <project>` | Name the project to delete, and say what deleting does. |
| `project delete confirm <project>` | Delete the project just named. It must be the same project. |
| `system workspace new <name>` | Create an empty workspace. |

The `project …` commands act in the workspace currently opened with `?ws=`, or, when you have only
one workspace, in that one. Otherwise they answer "which workspace? open one first" and list the
names. A project can be named by its path or by its folder name with or without `.k7`.

Examples:

```text
system workspace new band
project new arrangement winter
project copy winter gigs winter-live
project rename winter winter-2
project delete init winter-2
project delete confirm winter-2
```

Deleting takes two commands on purpose. The first one only says what will happen
("… the folder will be moved to the workspace's recycle bin. To do it: project delete confirm
…"). Any other command typed in between cancels it.
