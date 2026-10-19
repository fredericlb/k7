# Preparing a gig

A desk plays files that sit on the **engine's machine**, measures each song before it can sync it, and can only take an instrument out of a song that has been separated. All three take time. This page is about doing them before you are on stage.

## 1. Get the songs onto the engine's machine

The engine opens files on its own disk, and a venue may have no network. While a project is open, k7 checks once a minute which songs the project's desk names (the songs of the playlist in `surfaces/desk.k7x`) and copies every file of those songs' folders to the machine of the engine your session is bound to. Only what is missing or changed is sent, and an unchanged list is not sent again.

What this means in practice:

- Open your set project, connected to the engine you will play on, a while before you leave. The first check runs a few seconds after the project opens.
- Only lines written as a **path** (`artist/album/title`) are copied ahead of time. A line that names a song by its title alone is not.
- In the desk's song browser, a song still on its way shows a cloud icon and cannot be loaded; a song on the machine shows a disc.
- After adding songs, press the circular-arrows button on the desk to re-read the list.

## 2. Let the desk analyse the set list

The tempo, the beat grid and the waveform come from an analysis the engine runs on the first read of each file; after that the result is cached beside the file. A song not yet analysed leaves its tempo fader at `—` and SYNC dark for several seconds after you put it on a deck.

As soon as a desk opens with a playlist, it analyses every song of the set list that the machine holds, one at a time, in the background. While it works, the bottom row shows a music note and a count such as `3/12`; its tooltip names unreadable songs. Once a song is analysed, loading it lays down its tempo at once.

So: open the desk with the right playlist and leave it until the counter disappears.

### Check the tempos

Load each song and look at its tempo. If the analysis found double or half the real tempo, use `÷2` or `×2`; the correction is stored with the song in the media library and is used by every project from then on. See [Tempo](./61-desk-decks.md#tempo).

## 3. Set your cues

Hot cues set during a rehearsal are kept in the project's `mix.k7x` and come back whenever the song is on a deck in this set. See [Hot cues](./61-desk-decks.md#hot-cues).

## Separating stems

The desk's four stem knobs (drums, bass, vocals, other) work only on a song that has been **separated** into stems. A separation runs a model over the whole song and takes several minutes per song, so it is a job for the night before. The stems are saved in a `stems/` folder beside the song in the media library and reused from then on.

### Once per machine: choose the separating chain

Which chain separates is a setting of the machine, asked once:

- In the settings, under **I/O**, the **stem separation** section: pick "the chain that splits a song into stems".
- Or from the command bar:

  ```
  system stems @k7-core/stems
  ```

  Run `system stems ""` to clear it. The chain is checked against the open project and refused if it does not separate.

Related machine settings:

| Command | Effect |
|---|---|
| `system stems <chain>` | The chain that separates a song into the four stems. |
| `system instrumental <chain>` | The chain that gives a song without its voice. Refused unless its offline step declares an `instrumental` output. |
| `system onnx <providers>` | What the separation runs on, in the order tried: `cpu`, `dml`, `cuda`, `coreml`, comma or space separated. Empty goes back to `cpu`, the default. Only set another provider after checking that it works on this machine. |

### Separate a whole set list

From the playlists panel:

1. Open the playlist and press **Separate the stems**.
2. The bar shows the chain this machine uses. If none is set, it says so and offers a button to the settings.
3. Press **Start (n)**, where *n* is the number of rows with audio.
4. The bar shows the song in hand and its percentage. Songs already separated are skipped and counted apart. A song that fails is noted, and the run goes on with the next one.
5. **Stop** ends the run after the song in hand. Closing the panel does the same. Starting again costs nothing: what is done is skipped, and an interrupted separation picks up where it was.

From the command bar:

```
playlist stems ete-2026
playlist stems ete-2026 @k7-core/stems
```

Without a chain it uses the one set with `system stems`. It needs a project open (to resolve the chain), skips songs that already have stems, reports one line per song, and goes on past a song it cannot do. With this command, a line's song is located by path in the media library, and the first audio file in its folder is separated.

### Let the desk separate on demand

Add `stems: true` to `surfaces/desk.k7x`. A song put on a deck that has no stems then starts separating; a percentage shows over its stem knobs, and they light up when it is done. The record plays normally in the meantime.

## Checklist

1. The playlist names every song by its path.
2. `surfaces/desk.k7x` names that playlist.
3. The project has been open, connected to the stage engine, long enough for the songs to be copied (the browser shows discs, not clouds).
4. The desk's analysis counter has finished.
5. Tempos checked, octave errors corrected.
6. Stems separated (`playlist stems`), if you plan to use the stem knobs.
7. The headphone pair is set on the stage machine: `system cue 3+4`.
