# DJ sets: the mix project

A **mix project** (also called a *set*) is a k7 project made for playing records rather than arranging them: two decks, a channel strip on each, a crossfader between them, and a set list to pick from. It has no timeline and no bars. It opens on the **DJ desk**.

This section covers:

| Page | What it is about |
|---|---|
| This page | What a mix project is, how to create one, what it contains |
| [The DJ desk: decks](./61-desk-decks.md) | Loading a record, playing it, the platter, tempo, sync, cues, loops |
| [The DJ desk: mixer and effects](./62-desk-mixer.md) | Trim, EQ, filter, echo, stems, channel faders, crossfader, headphones |
| [The desk's files](./63-desk-files.md) | `surfaces/desk.k7x`, its control ids, and the cue sheet `mix.k7x` |
| [Playlists](./64-playlists.md) | Set lists in a workspace, and how a desk names one |
| [Preparing a gig](./65-gig-prep.md) | Analysis, copying songs to the engine's machine, stem separation |
| [Reference tracks](./66-reference-tracks.md) | Finished mixes you listen against, played by the browser |
| [Transcription](./67-transcription.md) | `track transcribe`: speech in a video to subtitles |
| [Live rigs](./68-live-rigs.md) | The `live` project: an input, a fader, the output |

## What you need

- **An engine.** The decks play on the engine your session is connected to. Without one the desk is drawn but nothing plays.
- **Songs in the media library.** A deck plays songs from the media library (the médiathèque), never files from your project. The desk lists the songs a **playlist** names; see [Playlists](./64-playlists.md).
- **The songs on the engine's machine.** The engine opens files on its own disk. k7 copies the songs your open set list names to that machine in the background; see [Preparing a gig](./65-gig-prep.md).

## Creating a mix project

When you create a project (from the home page, or as the first project of a new workspace), choose the **mix** archetype. It is described as "two decks, a crossfade, and an empty set list".

Once the project is open:

1. Make a playlist, if you do not have one: open the playlists panel (the list icon in the footer, or `ui playlists` in the command bar) and press **New playlist**, or run `playlist new <name>`.
2. Add songs to it (see [Playlists](./64-playlists.md)).
3. Tell the desk which playlist to show: open `surfaces/desk.k7x` and uncomment the `playlist:` line, naming your playlist.

   ```k7x
   type("turntables")
   layout("split")
   playlist("ete-2026")
   ```

4. Press `4` (or run `ui turntables`) to bring the desk to full screen, click the middle of a record, and pick a song.

Until step 3 is done, the desk says so at its top: "This surface names no playlist. Add a `playlist: <name>` line to `surfaces/desk.k7x`".

## What a mix project contains

A new mix project is an ordinary k7 project folder. What makes it a set is that it declares a `turntables` surface and no `timeline` surface.

| File or folder | What it holds |
|---|---|
| `project.k7x` | The name and the sample rate (48000). No tempo and no time signature: a set has no bars. |
| `surfaces/desk.k7x` | The desk: its type, its layout, the playlist it lists, whether it separates stems, and which module each control drives. See [The desk's files](./63-desk-files.md). |
| `mix.k7x` | The cue sheet: the cue points this set has stored, song by song. The desk writes it when you set a cue. |
| `graph.k7x` | The signal graph: each deck through its strip, both meeting at `MIX`, then `OUT`. |
| `nodes/` | One file per node: the two decks, their platters, tempo, trim, EQ, filter, level, echo, fade and headphone send, and the stem lanes. |
| `assemblies/turntableA.k7x`, `turntableB.k7x` | Draws each deck's nodes as one box on the graph. Changes nothing about the sound. |

### The signal path of one deck

Each deck runs, in order:

```
platter -> tempo -> trim -> EQ -> filter -> level -> echo -> fade -> MIX -> OUT
                                     \-> cue (headphones) -> CUE
```

- The **platter** reads the record. A deck has five lanes: the record itself and one per separated stem (drums, bass, other, vocals). Only one side plays: a separated song plays its four stems, an unseparated one plays the record.
- The **trim** comes first so it reaches all five lanes.
- The **headphone send** is taken after the filter and before the channel fader, so pulling the fader down or moving the crossfader does not take the deck out of your headphones.
- The **echo** sits after the channel fader, which is what makes an echo-out possible: cut the channel and the repeats keep ringing.
- The two **fades** are the crossfader: one per deck, driven in mirror by a single control.
- `MIX -> OUT` is the master run. A module put on that line (a limiter, for example) processes the whole blend.

You can open the graph (`3`, or the `graph` panel at the bottom) to see and change any of it. The desk reads whatever the graph and `surfaces/desk.k7x` say; see the Chains section of this guide for editing the graph.

## Adding a desk to another project

Any project can carry a desk. Run:

```
project surface new turntables desk
```

This writes `surfaces/desk.k7x` with every control listed as `null`. The desk refuses to draw until the required controls name a module; see [The desk's files](./63-desk-files.md). A project can declare only one `turntables` surface.

## Where to find the desk

- The desk is a **pane**. Press `4` or run `ui turntables` to show it full screen. In a mix project it is also the page the project opens on.
- It stays mounted while you look at the graph or the editor: the records keep turning and the crossfader keeps its place.
- A desk can also be opened alone on a second device; see the section on external surfaces in the editor-shell part of this guide.

## When something is wrong

Messages appear as cards across the top of the desk:

| Message | Meaning and fix |
|---|---|
| A list of "Le composant … de cette vue n'est pas mappé à un module" (the whole desk is replaced) | A required control has no module under `mapping:` in `surfaces/desk.k7x`. Add one line per listed control. |
| "This surface names no playlist…" | Add a `playlist:` line to the surface file. |
| A card naming `_playlists/<name>.k7x` with "the playlist this surface names cannot be found" | The name in `playlist:` matches no file. Check the spelling, or create it with `playlist new`. |
| "this file does not read as a playlist" | The playlist file does not parse. Open it in the playlists panel and repair it. |
| A card listing controls with a message each | A binding names a module or parameter the project does not have. |
| "this machine's file service is not answering — the media library is unreachable" | The desk cannot list the songs on the engine's machine. |
| "the crossfade is bound to no loaded plugin" | The `crossfade` binding points at something the engine has not loaded. |
