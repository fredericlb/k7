# Projects

A project is one song, set or rig: a folder whose name ends in `.k7`, inside a workspace. Everything
about it is in that folder as text files, plus its audio and video. The `.k7` suffix is what makes a
folder a project; on screen it is left off.

Creating, copying, renaming and deleting projects happens on the home page. The editor does not
create or delete projects.

## Creating a project

1. On the home page, find the workspace and click **Nouveau projet** on its row.
2. The **New project** dialog opens. Pick an archetype:

   | Button | What the project opens on |
   |---|---|
   | **arrangement** | the timeline over the graph — one track, a synth, a pattern |
   | **mix** | two decks, a crossfade, and an empty set list |
   | **video** | the timeline and the viewport — the arrangement, plus a picture lane |
   | **live** | no surface — an input, a fader, the output |
   | **live video** | the same rig, plus a webcam and the viewport it fills |

   [Project archetypes](./06-archetypes.md) describes each one in full.
3. Type a name, for example `winter`. The line under the field shows the folder that will be
   created: `winter.k7`.
4. Click **Create**, or press Enter.

The project appears in the workspace's list. Click it to open it.

From the home command bar, the same thing is:

```text
project new arrangement winter
```

### Names

The name you type becomes the folder name, with `.k7` added:

- it cannot be empty;
- it cannot contain `/` or `\`;
- it cannot start with a dot;
- if you type the suffix yourself (`winter.k7`), it is not doubled;
- a folder of that name that already exists and is not empty is refused.

The folder is shown before you confirm, so a refused name is reported in the dialog.

## Opening a project

Click the project's name on the home page. It opens in the same tab. See
[Opening and playing a project](./08-opening-a-project.md) for what happens next.

## Copying a project

A project is copied into another workspace of your account.

1. Open the **⋮** menu at the end of the project's row and choose **Copy**.
2. The dialog **Copy "&lt;name&gt;"** shows the project's path. Pick the workspace the copy goes to.
3. Keep the name, or type a new one. The line under the field shows `<workspace> / <folder>`.
4. Click **Copy**. The original is untouched.

The list of target workspaces leaves out the project's own workspace, and workspaces that are
themselves a single project. When no workspace qualifies, **Copy** is greyed out with the hint "no
other workspace to copy into".

```text
project copy winter gigs
project copy winter gigs winter-live
```

## Renaming a project

1. Open the **⋮** menu and choose **Rename**.
2. Type the new name. The `.k7` suffix is kept whatever you type.
3. Click **Rename**.

Everything inside the project follows the rename. Only its address changes, and the dialog warns
about what that costs: a link to the old address stops working, an editor already open on it stops,
and if this machine is playing the project, the engine stops.

```text
project rename winter winter-2
```

## Deleting a project

1. Open the **⋮** menu and choose **Delete**.
2. The dialog **Delete "&lt;name&gt;"?** shows the project's path and says the folder is moved
   into the workspace's recycle bin.
3. Confirm.

The project's folder goes to the workspace's `_recycle_bin/` folder (a second deletion of the same
name gets a `-2`, `-3`… suffix there). It is not erased, but k7 hides `_recycle_bin/` from every view
and has no undo for a deletion: getting a project back means moving its folder out of the bin on the
server's disk.

From the home command bar, deleting takes two lines, naming the same project twice:

```text
project delete init winter-2
project delete confirm winter-2
```

## Tags

Tags are short words the home page shows as badges beside a project's name, for example "to mix" or
"live set". They are set from inside the project:

| Command | What it does |
|---|---|
| `project tag <tag>` | Add a tag. The tag is the rest of the line, so it may contain spaces. Letter case does not make a second tag. |
| `project tag` | List the project's tags. |
| `project untag <tag>` | Remove a tag. |

The editor's task panel also has an "Add a tag…" field for the open project. Tags are stored in the
project's `project.yaml`, under `project: tags:`.

## Importing a project from another DAW

There are two ways in:

- From the home page, drop a `.dawproject` or a zipped Ableton project onto a workspace's row. See
  [Workspaces](./04-workspaces.md#importing-another-daws-project-into-a-workspace).
- From inside a project, run `project import` in the command bar, which also accepts an `.als`
  file that sits in the workspace next to its samples.

Either way, the import makes a new project and shows a log of what did not translate.
