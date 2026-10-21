# Songs and samples

This page covers the three sections of the media library that hold audio files: **Songs**,
**Samples** and **Recordings**. For the overall layout, see [The media library](./70-media-library.md).

## Songs

A song is a folder holding one audio file, the **master**, and a small text file beside it,
`song.yaml`, called the **sidecar**. Songs are filed three levels deep, by artist, album and title:

```text
songs/
  Nirvana/
    Nevermind/
      Lithium/
        original.flac    the master
        song.yaml        the sidecar
        live.mp3         a variant (optional)
        stems/           drums.wav, bass.wav, other.wav, vocals.wav (optional)
```

The master is always called `original` and keeps the extension of the file you uploaded. Any
audio format the library reads is accepted: `.wav`, `.flac`, `.aiff`, `.aif`, `.mp3`, `.ogg`,
`.opus`, `.m4a`, `.webm`.

### Adding a song

1. Open **Songs**.
2. At the foot of the tree, click **Add a song** and pick one audio file or several.
3. The dialog reads each file's tags (artist, album, title). When a file has no tags, the
   artist and title are guessed from its name: `03 - Nirvana - Lithium.mp3` gives artist
   `Nirvana`, title `Lithium` (a leading track number is dropped).
4. Check or correct the three fields. They decide where the song is filed; the exact path is
   shown under them. An empty field becomes `Artiste inconnu`, `Album inconnu` or `Sans titre`.
5. Click **Upload** (or **Upload N** for several).

Several files are sent one after another. A row disappears from the dialog once it is sent; what
stays is what needs a decision:

- "A song already occupies this folder": either **Replace** it, or change one of the three
  fields to file it elsewhere. Editing a field clears the pending Replace, so you never replace a
  song you did not see.
- A failed upload stays with its error.
- A file that is not audio is flagged and left out.
- The **x** on a row (**Leave this one out**) drops it before sending.

**Cancel** stops the upload in progress and the rest of the queue.

Characters that are not allowed in file names on some system are replaced by spaces in the
folder names; accents are dropped; each name is cut at 80 characters.

After a song is filed, the library measures it in the background: its waveform, its onsets and
its tempo. The server also measures every song nobody has opened yet, one at a time, so a song you
open usually has its waveform ready.

### The song screen

Click a song in the tree or in the list to open it. Its address is
`/media/songs/<artist>/<album>/<title>/song.yaml`, so you can bookmark or share it.

- **Left**: the sidecar as text, in the YAML editor (vim mode follows your k7 preference). There
  is no Save button: the file is written as soon as the text reads as YAML. The status in the
  header reads **saved**, **modified**, **saving…**, **not saved** or **saving failed**. A song with
  no sidecar opens on a stub ("no sidecar yet — the first edit will create it"); opening it does not
  create the file.
- **Right**: the player. The play button, the position and length, and where the sound is going
  (see [The media library](./70-media-library.md#where-the-sound-comes-out)). Click or drag on the
  waveform to move the cursor; pressing play starts from there. The footer shows the detected
  tempo and the number of onsets.
- When the song has variants, a tab per version sits above the waveform (**Original** first), and
  a **Variants** list sits under the player.
- **Back** returns to the list.

On a narrow screen the editor and the player are stacked.

If the waveform is not there yet, the screen says "analysing" while the file is decoded. If the
analysis fails, the reason is shown with an **Analyse** button to try again.

### The sidecar

The library reads these keys from `song.yaml`:

| Key | Meaning |
|---|---|
| `title` | The name shown in the list, the player and the queue. Defaults to the folder name. |
| `artist` | Shown beside the title. |
| `album` | Kept for reference. |
| `source` | Who filed the song: `upload`, `k7`, `slskd`, `youtube`, `mirror`. |
| `bpm` | The tempo. Filled in by the analysis when the key is absent; your own value is never overwritten. |
| `key` | The musical key, typed by you, for example `C# minor`. |
| `uuid` | A stable identifier. |
| `variants` | A mapping of version names to audio files in the same folder. |

```yaml
title: "Lithium"
artist: "Nirvana"
album: "Nevermind"
source: upload
bpm: 123
key: "D major"
variants:
  live: live.mp3
  "radio edit": radio-edit.wav
```

Renaming the title, artist or album here changes what is shown; it does **not** move the folder.

### Variants

A variant is another version of the same song: a live take, a radio edit, an instrumental. It is
an audio file in the song's folder, declared under `variants:`.

To add one:

- Right-click the song in the tree and choose **Add a variant…**, then pick one or more audio
  files; or
- Drag audio files from your computer onto the song's row in the tree.

The variant is named after the file (without its extension), and the sidecar gets a line for it.
Each variant then has its own tab in the player. A variant whose file is missing from the folder is
listed with **missing**. Hover a row of the **Variants** list and click the bin to delete it.

Dropping a file anywhere in Songs other than on a song is refused: "A file joins the songs only as
a variant of one of them: drop it on the song."

### The Songs right-click menu

| Entry | Shown on | Does |
|---|---|---|
| **Download the missing song(s)** | A folder or song only the paired server holds | Copies them to this machine |
| **Add a variant…** | A song | Opens the file picker for variants |
| **Add to the play queue** | A song with a master | Queues it in the bottom player |
| **Delete <name>** | A song | Deletes the song folder: master, sidecar, variants. No confirmation. |
| **Delete <name>…** | An artist or album folder | Asks "Delete “name” and everything in it?" first |

The foot of the tree also has a **Find songs** button, which opens the song search.

### Stems

A song can be cut into four stems (`drums`, `bass`, `other`, `vocals`), or into an instrumental
(the song without its voice). The result lands in a `stems/` folder inside the song folder. The cut
runs on an engine's machine, which lends its separation model; the song and the model travel there
and the stems come back to the library.

Cuts are started from the places that need them: the DJ desk and k7's playlist pane (see the DJ &
sets section), and the rehearsal songbook's **Make instrumental** (see
[The songbook](./77-songbook.md)). A song already cut is not cut again.

### FLAC files in the browser

When a browser plays a FLAC master, it is sent an MP3 made from it. The server makes these MP3s
in the background and keeps each beside its FLAC under the same name. They never appear in the
library; the engine and the copies on your computers and phones keep using the FLAC.

## Samples

Samples are single files, grouped by what plays them and then by pack:

```text
samples/
  audio/
    <pack>/…        any audio file
  video/
    <pack>/…        .mp4, .mov, .mkv, .webm, .avi
```

The first folder under `audio/` or `video/` is the entry's **pack**, shown in the list.

Samples is a writable section. Right-click a folder (or the section root) for:

| Entry | Does |
|---|---|
| **Upload a folder…** | Picks a folder on your computer and uploads it, structure included |
| **New folder…** | Creates an empty folder |
| **New file…** | Creates an empty file (the name is prompted, `name.yaml` by default) |
| **Rename…** | Renames a file or folder |
| **Delete <name>** | Deletes the file or folder |

You can also drag files or folders from your computer onto a folder of the tree, and drag rows
inside the tree to move them.

## Recordings

The Recordings section holds raw captures, filed by the day and second they were made:

```text
recordings/
  2026-10-15/
    20-31-07.webm                         a whole capture
    moment-20-45-12--93--chorus-idea.webm a moment cut out of a session
```

A moment's name carries the time it was played, its length in seconds and its name.

The rehearsal recorder writes here: every session's audio and every moment you extract from one.
Machines can also push captures through the API. The **Add recordings** button at the foot of the
tree sends a batch of audio files by hand, for example the files of a portable recorder; each is
filed under its file's last-modified time, so a batch uploaded the next morning still lands on the
day it was recorded. Click the button again while it is sending to cancel.

The contents list shows one heading per day with its files and their sizes. Recordings cannot be
renamed, moved or deleted from this screen.

## Related pages

- [Playlists, the player and the queue](./72-playlists-and-playback.md)
- [Finding songs](./73-find-songs.md)
- [Sessions and moments](./75-sessions-and-moments.md)
