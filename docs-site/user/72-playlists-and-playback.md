# Playlists, the player and the queue

## Playlists

A playlist is a set list: a YAML file naming songs of the library in order. The media library's
**Playlists** section (`/media/playlists`) holds the ones kept on the library itself, under
`playlists/` on the volume.

A workspace has playlists of its own too, in its `_playlists/` folder, in the same format. Those
are the ones a DJ desk names; they are covered in the DJ & sets section. Everything below is about
the media library's.

### The screen

- **Left**: the playlists, as a tree (a playlist name may contain `/`, which makes folders, for
  example `live/rehearsal`). Each row shows the playlist's title and its number of songs. A file
  that does not read as a playlist has a warning icon.
- **Right**: the open playlist, one row per song.

The open playlist's address is `/media/playlists/<name>.yaml`.

### Creating a playlist

1. Click **New playlist** above the list.
2. Type a name, for example `summer-2026` or `live/rehearsal`, and press Enter (Escape cancels).

The new file starts as:

```yaml
# summer-2026
title: summer-2026
items: []
```

A name already taken is refused.

### Adding, moving and removing songs

- **Search for a song** opens a search field. Type words from the title, artist or path: every
  word must match. Click a result to append the song (its master). The pill buttons beside a
  result append one of its variants instead. Enter adds the first result; Escape closes the
  search.
- Each row has **Move up**, **Move down** and **Remove**.
- The play button on a row plays that song (or that variant) at once; it becomes a pause button
  while it plays.
- **Play all** puts the whole playlist in the play queue.

A row that names something the library does not have stays in the list with the reason under it
(song not found, variant not found, song without a master) and its play button disabled.

On a device paired with a server, a button offers to download the songs the playlist names that
only the server holds.

### The file

There is no Save button: every change is written as soon as the text reads as a playlist. The
file icon (**The file, as it is written**) shows the YAML beside the rows, and you can edit it
directly. While the text you are typing does not read as a playlist, the rows keep showing the
last readable version and say so.

```yaml
title: Saturday set
items:
  - Nirvana/Nevermind/Lithium          # a song by its path under songs/
  - Hells Bells                        # or just by its title
  - song: AC-DC/Back in Black/Shoot to Thrill
    variant: live                      # one of the song's variants
```

| Key | Meaning |
|---|---|
| `title` | What the list shows. Without one, the file name stands in. |
| `items` | The songs, in order. |
| `items[].song` | The song: its path under `songs/` (preferred, unambiguous) or its title. |
| `items[].variant` | One of the song's variants, by the name its sidecar gives it. Absent means the master. |

A line can be a bare string (the song) or a mapping with `song` and `variant`. The same song may
appear twice. A path is matched first, then a title.

If the list is written inline (`items: [a, b]`), the buttons cannot edit it and say "this playlist
is written inline: reordering needs the YAML".

## The player bar

When something starts playing, a bar appears at the bottom of every media library page:

- Play / pause, the title, the version badge when it is not the master, the artist and the album.
- A position slider you can drag (or move with the keyboard), with the time and the length.
- Where the sound is coming out.
- The queue button.
- A close button (top right). Closing is the only thing that removes the bar: a song that ends
  leaves it in place, marked **ended**.

The bar keeps playing while you move between sections.

The bar also feeds your system's media controls: a phone's lock screen, the notification shade
and a headset's buttons can play, pause, seek and skip to the next queued song.

## The play queue

The queue is what plays next, after the current song ends. It is not a playlist and is not
saved.

- Add a song from the Songs tree: right-click it, **Add to the play queue**. Only songs with a
  master can be queued.
- **Play all** on a playlist queues all of its songs.
- Adding a song already in the queue does nothing.

The queue button (with its count) opens the list, labelled **Up next**: each row has **Move up**,
**Move down** and **Remove**. When nothing is playing but the queue is not empty, the bar shows
"N songs waiting — the first starts as soon as a machine can play it." A queued song that cannot
be played is skipped.

## Playback destinations

The sidebar's playback button chooses where the media library plays: **This machine** (the
browser), **The media library** (the server's own outputs) or **The engine** (your k7 engine's
outputs). See [The media library](./70-media-library.md#where-the-sound-comes-out).

Errors are reported on the bar: "no engine is answering — playing here", "the engine: …" with the
engine's own message, or "cannot play: the master could not be loaded".
