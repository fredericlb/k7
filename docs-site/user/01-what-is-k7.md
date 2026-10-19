# What k7 is

k7 is a text-first DAW. A song is a folder of plain text files (k7x), and every view on screen
(the timeline, the graph of chains, the DJ desk, the picture) is a way of reading and editing
those files. You can type a change into the editor, drag a clip on the timeline, or run a command
in the command bar. Each one writes the same files, and the engine plays what the files say.

## What k7 holds

One k7 site holds several tools, all behind one sign-in and one sidebar:

| Part | What it is for | Where it is |
|---|---|---|
| The editor | Arranging, mixing and sound design for one project at a time: timeline, chains graph, mixer, text editor, command bar | Opens when you open a project |
| The media library (médiathèque) | Songs, samples, recordings and playlists stored on the server | The **Media** group of the home sidebar |
| The rehearsal recorder | Rehearsal sessions and their takes, releases, a shared songbook, singing exercises and a tuner | The **Rehearsal** group of the home sidebar |
| The DJ desk | Two decks, a crossfade and a set list, in a `mix` project | The `turntables` pane of a mix project |
| Picture | Video lanes on the same timeline as the sound, composited in a viewport window | `video` and `live-video` projects |

The pages in this range cover what happens before the editor: signing in, the home page, workspaces,
projects, their addresses, opening one, and sharing one. The other tools have their own sections
(see the [index](./00-index.md)).

## The words k7 uses

**Account.** You sign in once, and everything below belongs to your account.

**Workspace.** A folder on the server that holds one or more projects, plus what they share: the
workspace's own modules, its set lists (`_playlists/`), its reference tracks (`_references/`) and
its task list (`TODOS.md`). k7 keeps each workspace in step across your devices, so an edit made on
a laptop shows up on a desktop or a phone. A workspace is not a git repository.

**Project.** One folder inside a workspace whose name ends in `.k7`, such as `winter.k7`. The
`.k7` suffix is what makes a folder a project. On screen the suffix is left off, so `winter.k7` is
listed as "winter".

**Archetype.** The template a new project starts from: `arrangement`, `mix`, `video`, `live` or
`live-video`. The archetype decides which views the project opens on. See
[Project archetypes](./06-archetypes.md).

**Surface.** A view that a project asks for. It is declared as a file in the project's
`surfaces/` folder: `timeline` (the arrangement), `turntables` (the DJ desk), `viewport` (the
picture window), `mastering` (the master strip). k7 draws only the surfaces a project declares.
The chains graph and the text editor are always there.

**Library.** A named folder of shared modules and chains, kept on the server and read by every
account. A module from a library is written `@<library>/…`, for example `@k7-core/…`. k7 will not
open a project until at least one library exists. See [The home page](./03-home-page.md#libraries).

**Engine.** The program that makes the sound. It runs on a machine with an audio interface: your
desktop with the k7 desktop app, the command-line engine, a phone, or the server's own engine. The
browser never plays a project's audio itself. When you open a project, k7 picks an engine and sends
the project to it. One engine plays one project at a time, and one project plays on one engine at a
time. The engines section of this guide explains how to set one up.

## How a session goes

1. Sign in ([Signing in](./02-signing-in.md)).
2. On the home page, pick a workspace and a project, or create them
   ([The home page](./03-home-page.md), [Workspaces](./04-workspaces.md),
   [Projects](./05-projects.md)).
3. Click the project. k7 finds an engine, brings the project's files onto that engine's machine,
   and opens the editor ([Opening and playing a project](./08-opening-a-project.md)).
4. Edit and play. Every change is saved to the files as you make it.
5. To let someone hear it without an account, publish a share link ([Sharing a project](./09-sharing.md)).
