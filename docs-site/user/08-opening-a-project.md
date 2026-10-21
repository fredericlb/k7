# Opening and playing a project

Opening a project means two things: showing it in the editor, and handing it to an **engine**, the
program that plays it on a machine with an audio interface. This page follows what happens between
the click on the home page and the first note, and how to choose which project the engine plays.

## What happens when you open a project

Click a project on the home page (or open its address). k7 then goes through these steps, showing a
screen for each one that takes time.

### 1. An engine is chosen

k7 lists the engines your account can use and measures each one. It picks one for you, in this
order:

1. the engine that has the plugins this project uses;
2. then the one with the best latency class;
3. then the best performance score.

Among equals, it prefers the engine your account chose last, then this machine's own engine.

If no engine is usable, the **Select an engine** screen appears. Each row shows an engine with its
latency (hover it to see network and audio-interface latency separately), or **unreachable**.
Click a usable engine to choose it; the choice is remembered on your account. **Refresh** measures
them again. While nothing is usable, the screen also offers to pair this device as an engine. Setting
up and pairing engines is covered in the engines section of this guide.

### 2. The libraries are checked

If the site has no library yet, the screen **No library** says so and shows the libraries card. An
admin can add one right there, and the project opens as soon as one exists.

### 3. The workspace finishes syncing

A project only opens once all its files have arrived, since half a project would play wrong. The
screen **Syncing &lt;workspace&gt;** says where it is: "Reaching the server…", "Bringing the latest
edits…", "N file(s) still downloading…". If the server is out of reach and files are still missing,
it says so and opens as soon as they arrive.

### 4. The project is loaded on the engine

| Screen | What is happening |
|---|---|
| **Copying the project to the engine** | The project's audio files are copied to the engine's machine before it opens, so nothing downloads while it plays. |
| **Loading the project on the engine** | The engine builds the song and loads its plugins. |
| **Warming up** | The engine plays the first half-second silently, so the first real play starts at once. |

Then the editor opens. It shows the project's timeline if it declares one, otherwise the first pane
it does declare (the DJ desk for a `mix` project, the chains graph for a `live` rig).

### When something goes wrong on the way

| Message | What to do |
|---|---|
| **That project isn't in the workspace** | It was renamed or removed since the link was made. Go back to Projects and open it again. |
| "This workspace holds no project yet…" | Add a project from the home page. Opening a workspace from its **Create the first project** link shows the first-project page instead. |
| **Can't reach this engine's files** | The engine's file service did not answer. Retry, or choose another engine. |
| **The project could not be loaded on the engine** | Some audio files did not reach the engine's machine, so the project was not sent (its clips would be silent). Click **Reload project**. |
| "The engine crashed and was restarted…" | The project is sent again automatically. Anything playing stopped. |
| A module needs a sampled instrument "…which is not on the engine's machine" | Download that instrument on the engine's machine (on a computer running the tray: the engine page's Downloads, from **Engine Settings…** in the tray menu). |

## The editor's header

At the top left of the editor:

- the **back arrow** and the project's name return to the home page;
- the **engine** button names the engine playing this project. Click it to move the project to
  another engine directly. An engine that lacks some of the project's plugins shows how compatible
  it is and what it is missing;
- the **link light** shows whether the engine is connected, and its latency.

## Choosing which project the engine plays

The editor shows the whole workspace in its file tree, not only the project you opened. Every
project folder in the tree has a **▶** at the end of its row:

- a filled, green ▶ marks the **active project**, the one the engine is playing ("active project");
- clicking the ▶ of another project ("open project — start the engine here") hands that project to
  the engine instead. The status line says "opened &lt;project&gt; — engine starting…", and the
  editor switches to that project's layout.

The breadcrumb above the text editor offers the same choice from its folder menus. When the
workspace is open with no active project, the header shows the amber badge
"workspace — pick a project ▶ in Editor".

## One project, one engine

An engine plays one project at a time, and a project plays on one engine at a time. Opening a
project elsewhere takes it over:

| Screen | Why |
|---|---|
| **This project was opened elsewhere** | Someone (or you, in another tab or device) opened the same project. This tab stopped driving it. |
| **Another project took this engine** | A different project was opened on the same engine. To keep both running, pick a different engine for one of them. |

Nothing you saved is lost. Click **Back to Projects** and open the project again to take it back.

## Sleep after twenty minutes

If nothing happens in a project's tab for 20 minutes, the session goes to sleep: the project is
unloaded from the engine, which becomes free for someone else, and the screen **Session asleep**
appears. Your files are untouched, since everything was already saved. Click **Resume session** to
reopen it where you left off.

## Leaving a project

| Way out | What it does |
|---|---|
| Back arrow, top left | Goes to the home page. |
| `ui workspace quit` | Unloads the project from the engine, unless another of your tabs is still using it, and goes to the home page. |
| `ui engine` | Goes back to the engine picker, to choose another engine. |
| `ui logout` | Signs out. |

## The bench

The **bench** (`@banc`) is a throwaway live rig built around one chain from the site's libraries:
an input, the chain, a fader and a recorder. It lets you play through a library chain without
creating a project.

- Its address is `/@banc/<chain>/live.k7`, where `<chain>` is the chain's reference, for example
  `/@banc/@k7-core/bass/di/live.k7`.
- It lives in a workspace of its own, **Banc**, and is erased and built again every time it is
  opened. The chain is copied in, so a change made on the bench never reaches the library.
- It has its own engine session, separate from your song's: opening the bench does not displace the
  project you are working on. It uses the engine your song is on when there is one.
- Only chains that can run on a live input can be played on the bench. A chain with a step that
  needs a whole file first (a cold or offline step) is refused.
- An address under `@banc` that names a whole library rather than a chain is refused: a library is
  edited from inside any project, by an admin.

The rehearsal recorder uses the bench to record through a library chain: choosing a chain as the
recording source opens the bench in a frame and records its output. That flow is described in the
rehearsal recorder section of this guide.
