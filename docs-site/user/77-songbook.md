# The songbook

The songbook (`/rehearsal/songs`) is the band's shared book of songs. A song holds up to three kinds
of content, each on its own tab, plus a reference track to play along with:

| Tab | What it is |
|---|---|
| **Lyrics** | Lyrics with chords, optionally timed to the track |
| **Tab** | Guitar tablature in ASCII |
| **Sheet** | Uploaded files: images, PDFs, and scores (MusicXML, Guitar Pro) |

## The songbook list

The list is a table. Each row has:

- a star to add the song to your **favourites** (or remove it),
- whether it is public or private,
- the artist and title,
- a link per content kind (**Open the lyrics**, **Open the tab**, **Open the sheet**), greyed when
  the song has none yet.

Click anywhere else on a row to open the song. The **+** button offers **New song**.

## Who sees and changes a song

When you create a song you must choose:

- **Public**: everyone sees it in the songbook and can edit it. Only an administrator of the
  instance can delete it.
- **Private**: only you see it, edit it and delete it.

## Creating a song

**New song** asks for **Artist**, **Title** and the visibility, all required. **Create song** opens
it.

## A song's page

`/rehearsal/songs/<id>` shows the artist and title, the **⋮** menu, the content tabs (drawn only
when the song has more than one kind), the content itself, and a rail of panels down the margin.
`?tab=lyrics`, `?tab=tablature` or `?tab=sheet` in the address opens a given tab.

### Getting a reference track

A song with no track yet shows "No song file yet — what should we do?" under its title:

- **Download the song** looks for it in the media library first ("Getting the song from the
  library…") and, when it is not there, searches Soulseek for it the same way
  [Finding songs](./73-find-songs.md) does. The track is linked from the media library: nothing is
  copied.
- **Upload a file…** uploads your own audio. A dialog then asks whether to **Download the lyrics
  automatically** (off by default) and **Create the instrumental version** (on by default).
- **Ignore** hides the question for good on this song. **Add a track…** in the ⋮ menu brings it
  back.

After the track, the pipeline goes on by itself. A progress bar shows its four steps:
**Search**, **Download**, **Lyrics**, **Stems**.

- **Lyrics**: timed lyrics are looked up on LRCLIB. When the song has no lyrics yet, they are
  filled in; when it has some, their lines are timed against what was found. Lyrics already timed
  are left alone.
- **Stems**: the instrumental (the song without its voice) is made on any engine that is online.
  With no engine online, the step is reported and can be retried later. A song LRCLIB lists as
  instrumental skips it.

The state is kept on the server, so a reload finds the pipeline where it was. A failure shows its
reason with **Retry** and **Dismiss**. If the identified song is not the one you meant ("MusicBrainz
knows … under this name, not this song"), fix the artist and title and run it again.

### The ⋮ menu

| Entry | Shown when | Does |
|---|---|---|
| **Edit artist and title…** | Always | Renames the song (neither may be empty) |
| **Add lyrics** | No lyrics yet | Opens the lyrics editor |
| **Add tablature** | No tablature yet | Opens the tablature editor |
| **Add images, PDF or a score…** | Always | Uploads sheet files |
| **Add a track…** | No track, and the question was ignored | Uploads a track |
| **Make instrumental** | A track and no instrumental | Makes the instrumental on an engine |
| **Run the pipeline again** | Not while it runs | Starts search, download, lyrics and stems again |
| **Resync lyrics** | The song has a track | Removes the timecodes from the lyrics and times them again |
| **Delete song** | You may delete it | After a confirmation |

### Writing lyrics and chords

An empty tab opens in its editor. A filled one is read-only until you click **Edit lyrics** (or
**Edit tablature**). **Save** writes it; **Cancel** drops your changes.

The lyrics are plain text, with chords written in either of two styles, freely mixed:

```text
[Verse 1]
C            G           Am
Here are the words under their chords
I can also put a [F]chord inline, or an (Em) one

Chorus:
{{01:12}} This line starts at one minute twelve
```

- **Chords above lyrics**: a line holding only chords, aligned over the words.
- **Inline chords**: `[C]` or `(Am)` inside a line.
- **Section labels**: a whole line `[Verse 1]`, `(Chorus)`, `{Bridge}` or `Chorus:`.
- Recognised chords include sharps and flats, qualities (`m`, `maj`, `min`, `dim`, `aug`, `sus`,
  `add`, `7`, `9`…), slash basses (`G/B`) and `N.C.`. Bar marks (`|`, `||`, `|:`, `:|`) and repeats
  (`x2`) may sit on a chord line.
- **Timecodes**: `{{MM:SS}}` (or `{{MM:SS.cc}}`) at the start of a line times it. While the track
  plays, the line being sung lights up; clicking a timed line plays the track from there.

Clicking a chord shows its fingering diagrams (in the **Chords** panel on a wide screen, in a
pop-in on a phone), with **Previous fingering** and **Next fingering**.

### Tablature

The **Tab** tab takes ordinary ASCII guitar tablature and draws it:

```text
[Intro]
e|-----0-----|
B|---1---1---|
G|-2-------2-|
D|-----------|
A|-3---------|
E|-----------|
```

String names are optional; technique letters (`h`, `p`, `b`, `r`, `s`, `/`, `\`, `~`…) are kept.
Section labels work as in lyrics; other lines are shown as text. A **Hide header** / **Show header**
toggle folds the text above the first staff.

### Sheets

**Add images, PDF or a score…** accepts PDFs, images (PNG, JPEG, GIF, WebP, SVG), MusicXML
(`.musicxml`, `.xml`, `.mxl`) and Guitar Pro (`.gp`, `.gpx`, `.gp3`, `.gp4`, `.gp5`). The **Sheet**
tab shows them in order; each can be removed.

A score is drawn and played in the page, with a toolbar: **Play** / **Pause**, **Stop**,
**Transpose** (down a semitone, up a semitone, reset; one octave either way), **Zoom out**,
**Zoom in**, **Fit width**, and **Full screen**.

### The rail panels

Down the margin (along the bottom on a phone), folded until you open them:

| Panel | What it does |
|---|---|
| **Options** | **Transpose** the chords of the lyrics up or down by semitones (and the track with them, see below); **Lyrics lead**: how many seconds before its timecode a clicked line starts, remembered by this browser |
| **Player** | The reference track's waveform, play and pause, and the **Original** / **Instrumental** switch when there is an instrumental. Click the waveform to seek. Transposing shifts the track's pitch without changing its tempo. |
| **Chords** | Every chord of the lyrics, in the transposed spelling, with its diagrams |
| **Metronome** | A click track with **Tempo**, **Slower** and **Faster** |

Folding the player does not stop the music.

## Exporting your favourites

The **⋮** at the right of the table header exports the songs you starred, one file per song, in a
zip named `songbook-<format>-<date>.zip`:

- **Export PDF**: each song's lyrics and tablature in a monospace font, followed by its images and
  PDFs.
- **Export EPUB**: an e-book per song, with a chapter for the lyrics, one for the tablature and
  one for the images. PDFs and scores cannot be pages of an EPUB and are left out.

Each file is named `Artist - Title`. The menu reports sheets that were left out and songs that
failed.

## On your computer or phone, paired with a server

The songbook in k7 on your computer (the tray) or on a phone is the device's own. When it is paired with a server, each song
shows "Synced with <server>" or "On this machine only", and the server's songs this device does not
have are listed with a **Download** button, which copies the song with its sheets and track.

A downloaded song is a copy: "A copy of <server>'s song: it is edited there." Its ⋮ menu only offers
**Remove from this machine**; the song stays on the server.
