# Playlists

A **playlist** (a set list) is an ordered list of songs from the media library. k7 keeps playlists in two places, with the same fields:

| | Workspace playlists | Media-library playlists |
|---|---|---|
| Where | `_playlists/` at the root of a workspace | `playlists/` on the media library's volume |
| Edited in | k7, in the playlists panel or with `playlist …` commands | The media library's Playlists section |
| Written as | `.k7x`, like every workspace file | `.yaml`, like the rest of the media library's volume |
| Who reads them | A desk (`surfaces/desk.k7x` names one); the machine pre-fetches their songs | The media library's screens |
| Kept with | Your projects: the same whichever project of the workspace is open | The library's songs |

A desk can only name a **workspace** playlist. This page is about those; the media library's own playlists are covered in the media library section of this guide.

## The file format

A playlist is a `.k7x` file under `_playlists/`. Its name is its path without the extension: `_playlists/ete-2026.k7x` is the playlist `ete-2026`, `_playlists/live/repet.k7x` is `live/repet`.

```k7x
// ete-2026
title("Été 2026")
items([
  "AC-DC/Back in Black/Hells Bells",
  song("Daft Punk/Discovery/One More Time").variant("instrumental"),
  "Hells Bells",
])
```

| Field | Meaning |
|---|---|
| `title` | Optional. What lists show; without it, the file name. |
| `items` | The songs, in order. |
| `items[]` as a string | A song: its path under the media library's `songs/` (`artist/album/title`), or just its title. |
| `items[].song` | The same, in the long form. |
| `items[].variant` | One of the song's other versions, by the name the media library files it under (an instrumental, a live take). Absent means the master. |

- The **path** form is unambiguous and is what k7 writes. A bare title is looked up by name; if two songs share it, the path form is the way to pick one.
- The same song may appear twice (an encore, a segue played again). The desk's browser lists it once per version.
- A playlist that does not parse is not treated as empty: it is reported as broken.

## The playlists panel

Open it with the list icon in the footer (shown in projects that have a desk) or with `ui playlists` from the command bar, in any project. It docks on the right.

| Part | What it does |
|---|---|
| Dropdown at the top | Picks which playlist the panel shows. Click it to search the workspace's playlists by name or path. |
| `+` | New playlist: type a name (the extension is added) and press Enter or **Create**. It runs `playlist new <name>`. |
| Expand icon | **Edit the file (text + songs)**: opens the full editor, the text on the left and the songs on the right. |
| `×` | Closes the panel. |
| The list | The songs, resolved against the media library. |

A warning "this file does not parse — open the text to repair it" means the file needs fixing in the full editor.

### The song list

Each row is one line of the playlist, numbered from 1.

| Action | How |
|---|---|
| Listen to a row | Click its play button. Playback is in the **browser**, not on the engine; the rows play one after another. Click again to pause. |
| Add songs | **Chercher un morceau** (search icon) opens a search over the media library's songs (title, artist, album). Click a song to append its master, or a version chip beside it to append that version. Enter adds the first hit. Escape closes. At most 40 hits are drawn; narrow the search for more. |
| Reorder | The up/down arrows on a row. |
| Remove | The cross on a row. |
| Put on a deck | Drag the row onto a deck of the desk. |
| Separate the stems | The **Separate the stems** button opens a bar that prepares every song; see [Preparing a gig](./65-gig-prep.md#separating-stems). |

At the foot of the list, **Add new songs** opens the media library's songs page, which is where a song is uploaded. On a computer running the tray with no server paired, it says to pair one in Settings instead.

A row that cannot play says why: not found in the media library, the variant does not exist, or the variant's file is missing from the song's folder. A row already separated says so too.

### The full editor

The expand button opens the playlist as text on the left and the resolved list on the right. There is no Save button: the text is written as soon as it reads as a playlist. Completion offers `title`, `items`, `song`, `variant`, the songs of the media library and the names of the versions it holds. If the text stops parsing, the list keeps showing the last readable version.

When `items` is written in a shape the panel cannot extend, adding, removing and reordering are refused with a message asking you to change the line by hand.

## Commands

These work from the command bar with no project open, except `playlist stems`.

| Command | Effect |
|---|---|
| `playlist new <name>` | Creates `_playlists/<name>.k7x` with an empty list. Sub-folders are allowed (`live/repet`). Refused if it exists. |
| `playlist song add <playlist> <song> [variant]` | Appends a line. The song is the rest of the line; quote it to name a variant after it. |
| `playlist song remove <playlist> <n>` | Removes line `n`, counting from 1. |
| `playlist song move <playlist> <from> <to>` | Moves a line; both positions count from 1. |
| `playlist stems <playlist> [chain]` | Separates every song of the playlist into stems. See [Preparing a gig](./65-gig-prep.md#separating-stems). |

Examples:

```
playlist new ete-2026
playlist song add ete-2026 AC-DC/Back in Black/Hells Bells
playlist song add ete-2026 "AC-DC/Back in Black/Hells Bells" live
playlist song move ete-2026 5 1
playlist song remove ete-2026 3
```

Positions are used rather than song names because a playlist may name the same song twice.

## Naming a playlist on a desk

In `surfaces/desk.k7x`:

```k7x
type("turntables")
layout("split")
playlist("ete-2026")
```

The desk's song browser then lists exactly that playlist's songs, the playlists panel's rows can be dropped on its decks, and the machine running your engine receives copies of those songs ahead of time (see [Preparing a gig](./65-gig-prep.md)). Only a `turntables` surface accepts `playlist`.
