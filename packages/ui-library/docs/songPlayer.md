# Opening a song — one column of tabs

A song opens beside the tree as one column: a header, then tabs.

```
┌────────┬──────────────────────────────────────────────┐
│ tree   │ ← Back  ▶ 1:02   Song · title          ⋮    │
│        │ Waveform · Info · Lyrics · Chords · …        │
│        │ Original · instrumental · …   (versions)     │
│        │ waveform                                     │
│        │ variants (if the sidecar declares any)       │
└────────┴──────────────────────────────────────────────┘
```

**One column, and the waveform is a tab.** Two halves made a phone stack them, each half too short to
read lyrics in; with the waveform a tab like the rest, every screen draws one thing at its full
height. What kept the two side by side — correcting a song while hearing it — survives without them:
the play button is in the HEADER, above every tab, so the song plays on whatever tab is open, and the
lyrics follow it on theirs. The page opens on the waveform.

**The header holds what belongs to the whole song**: Back, the play button and its clock, the title,
and at the far right a ⋮ (`src/SongMenu.tsx`) holding, in this order, the date the song was added,
a metronome, the transposition, and the buttons that add lyrics, chords, a tab or a sheet. It is a
popover, not a menu: its controls are used in place, and a menu closes on the first press. The
metronome's click and the sheet picker live outside the popover, so closing it stops neither.

## A song's attachments are tabs beside its tags

A song carrying lyrics, a tablature or sheets (`packages/mediatek/docs/songbook.md`) shows a tab for
each after **Waveform** and **Info**, its tags (`src/SongInfoTabs.tsx`). The listing already says which it carries (`meta.lyrics`,
`meta.chords`, `meta.tabs`, `meta.sheets`), so the tabs are drawn at once and the texts are read with
`GET /api/mediatek/songbook/:id` behind them, again whenever the folder changes.

**They are drawn by the host, as the songbook draws them.** A song's lyrics in the médiathèque and
in the songbook are one file, and two renderings of it would be two places to fix every chord-sheet
rule. The songbook's renderer and its stylesheet are `@studio/ui-rehearsal`'s
(`SongAttachment`, exported for this), which this package does not import: the host passes it in
(`songAttachment`, [host.md](host.md)), and k7 loads it lazily the first time a song with
attachments is opened. A host that passes nothing gets the tags alone.

## The lyrics and the chords follow the track

While THIS song plays — any of its versions, since a variant is the same song sung at the same
times — the timed line being sung is highlighted and kept in view, and a tapped timed line plays the
song from there, starting the open version when another song is playing. The texts carry their times
as `{{MM:SS.cc}}` codes (`packages/lyrics/docs/timecodes.md`); the line is `lineAt` over them, the
songbook's own rule, computed in `src/FollowedText.tsx` — the one component reading the position,
which redraws the host's text only when the line changes, not on every frame. A tapped line starts
early by the songbook's lead, the reader's own setting (`packages/ui-rehearsal/docs/lyricsTiming.md`).

## Transposing is for what is read

The ⋮'s transposition moves the chords of the lyrics and the chords tabs, the chords the diagrams
draw, and where a score's own transposition starts; the score's toolbar still moves it from there.
**The audio keeps its pitch**: the médiathèque plays through the browser, the host's player or a
machine's engine, and a pitch shift would be one per destination — the songbook's shifts its own
`<audio>` element only. Another song opens untransposed.

## The chord diagrams

A **Diagrams** tab draws the fingering of every chord the song uses, as transposed, each once: the
chords' text first, then the chords written inline in the lyrics, since either may be all a song
has (`songChords`, `src/songExtras.ts`). It follows the chords tab, or the lyrics tab when the chords
are only inline, and is absent for a song with no chord at all. The drawing is the songbook's
(`ChordDiagram`), reached through the host like the rest, as the `diagrams` kind.

## The metronome and the date

The metronome clicks at the tempo the master's tags carry (`meta.bpm`), changed in place with − and
+ or typed; a song tagged with none starts at 120 and says so. It is the recorder's own click
(`@studio/recorder/metronome`), and another song stops it.

The date is the songbook's (`facts.createdAt`) when the song is one; otherwise the newest file time
of the song's folder, which the listing carries (`entry.mtime`), with a line saying that is what it is.

## Add lyrics, chords, a tab, a sheet

The ⋮'s last four entries add what the songbook's song page adds, the same way: **lyrics**,
**chords** and a **tab** are typed by hand in a text box with Save and Cancel (`src/SongTextEditor.tsx`), then shown
as drawn with an Edit over them; a **sheet** is a file picked — a PDF, an image or a score, the
songbook's own rule (`@studio/rehearsal-shared/sheetKind`) — sent one after another and removable
from its tab. Lyrics, chords and tab are offered while the song lacks them, a sheet always.

**Chords are their own text**, `chords.txt`, apart from the lyrics: the LYRICS are what was found on
LRCLIB or typed here, the CHORDS what a person wrote, and two files keep either from overwriting the
other. The chords take the lyrics' TIMES: whenever either is saved, each sung line of the chords gets
the time of the lyrics line it matches, the matching rehearsal uses to time lyrics from an LRC
(mediatek's [songbook.md](../../mediatek/docs/songbook.md)). Chords saved on a song with a master and
no lyrics ask for them at once (`POST …/songbook/:id/lyrics/lookup`); lyrics typed by hand time the
chords the same way when they carry codes. Both are drawn by the chord-sheet renderer, timed lines
shown as timed.

**A library song becomes a songbook song at its first one.** Texts and sheets live under a song's
songbook id, which a song uploaded or downloaded does not have: the first chords, tab or sheet
asks `POST /api/mediatek/songbook {folder}` to ADOPT the song's own folder, rather than making a
second song beside it (mediatek's [songbook.md](../../mediatek/docs/songbook.md)).

## The Info tab is the master's tags, read-only until Edit

Title, artist, album, tempo and key are the master's own tags (`packages/mediatek/docs/songs.md`),
so the Info tab shows those fields — and the track number — through `GET`/`PUT /api/mediatek/tags` and no file at all.

**Read-only by default, with an Edit button.** Opening a song is to look at it and play it; an
input under the cursor turns a stray keystroke into a write into the audio file itself. Edit swaps
the values for inputs, and Done leaves only once the buffer is on disk. An edit held back
from an earlier visit opens the panel in edit mode, since a held buffer hidden behind a read-only
view would look saved.

**The file's other tags are listed under them, and never written here.** A downloaded file
carries a genre, a date, a label, an encoder, MusicBrainz ids — they say what the file is, so they
are shown, by TagLib's name for each. They are not k7's: nothing reads them, and a form for an
open-ended list of frames would be an ID3 editor, which other tools already are. Cover art is a
picture, not a tag, and is not listed.

In edit mode they autosave as every editor here does (`@studio/ui-editor/autosave`), the buffer being the
form as JSON: a tempo that is not a number is held back with the reason, the one shape the inputs
cannot rule out. The key is a list of the 24 names the library stores, sharps only, so no spelling
reaches the file that the scan would not read back. Changing a title moves no folder.

`song.yaml` — provenance and variants — has no editor on this screen: a variant is added and
removed from the tree and the list, and renamed on the volume (`packages/mediatek/docs/variants.md`).

## The browser does not decode audio

The waveform does not come from a `decodeAudioData`: it comes from the `.cache` sidecar the engine
writes **beside** the master (`packages/file-service/src/routes/mediatek.ts`, and
`packages/file-service/docs/waveformCache.md` for what it holds). `songWaveform.ts` reads it through
the ordinary file route — to that service a `.cache` is a file like any other — and keeps these
fields:

| field | what it becomes |
|---|---|
| `rms[]` | `Envelope`'s samples, already linear 0..1 |
| `peak[]`, `low[]`, `mid[]`, `high[]` | the height and colour of k7's one waveform (`packages/ui-waveform/docs/spectrum.md`); one of another length than `rms` is dropped |
| `seconds` | the duration, hence `intervalMs = seconds × 1000 / rms.length` |
| `transients`, `bpm` | two numbers at the foot of the panel |

Three reasons not to decode here:

1. **The master weighs what it weighs.** A four-minute flac is some thirty MB to download *entirely*
   before drawing the first pixel, off a library hosted elsewhere. The `.cache` is a few kB.
2. **The engine has already decoded.** It does so on upload, and it detects onsets and tempo while
   downsampling. Redoing half the work in the browser would produce a second, worse truth.
3. **It is this repository's rule.** "The hosted service does not decode audio" is not a limit of
   this panel: it is why `/mediatek/analyse` exists.

## Most songs are measured before anyone opens them

The backlog is swept in the background — `analysisSweep.ts`, [analysis.md](../../../apps/k7/backend/docs/media/analysis.md) — so the
path below is the exception rather than the rule: a song uploaded a moment ago, one the sweep has
not reached yet, or one whose sidecar no longer matches its bytes, which the sweep deliberately
leaves alone.

## The analysis is asked for, not waited for

A song may have no `.cache` — dropped when no machine was reachable, or published from the rehearsal recorder. `AddSong`
says it outright: with no machine reachable nothing happens there, and the first surface that needs
the cache computes it. This panel **is** that surface. So it calls `library.analyse` itself
and re-reads the sidecar, once, on open.

With no engine chosen it says so and stops. The song plays anyway: an `<audio>` on
`library.streamUrl(master)` needs nobody, and the route serves Range, so seeking works too. What is
missing is the drawing, not the sound — exactly the right order of importance.

It is also why the engine stays held whatever the playback destination: it is what **analyses** the
master, and the waveform needs that even when this browser is playing.

## This panel does not own the transport

Playback lives **above the screens** (`PlaybackProvider`), and what is here is a *view* of it: a bar
at the bottom cannot live with a panel holding the `<audio>` element, since leaving the screen would
cut the sound. The song open is not necessarily the one playing. See [miniPlayer.md](miniPlayer.md).

Where the sound comes out is not decided here either. The destination is an account choice — this
browser, or the chosen machine's engine — behind **one transport**: everything below the header
reads `playing`/`current` and never asks which side of the wire is playing. See
[playbackTarget.md](playbackTarget.md) for the menu, the fallback when the machine does not answer,
and why a cache root is not a copy.

### Once, and cancellable

An analysis is minutes of someone else's machine: it downloads the master and runs the engine over
it. Two guards, and they are not decorative:

- **`attempted`** remembers the file already asked for — the master, or the version open in the tab
  strip. The engine choice arrives asynchronously, so `fileBase` and `engineToken` legitimately move
  under the panel; without this lock every move restarts the work.
- **an `AbortController`** cuts the request on changing version, changing song, or closing the
  editor. It does not stop the work on the far machine — nothing propagates cancellation that far —
  but it stops holding a request open for minutes for an answer nobody wants.

A failure therefore does **not** retry on its own: it shows an "Analyse" button. An analysis that
restarts itself is a loop nobody asked for.

The trap is not here but in the relay: a ceiling on the upstream's thinking time kills every
analysis, which takes minutes — see `packages/engine-registry/docs/proxy.md`, "1500 ms is not a
connection timeout".

### Reading a failure

The message shown here is **verbatim** the one the file service returned, itself the one from its
own failure. The next link is therefore the master's download from the hosted library, and it names
the address tried and the real cause — see `packages/mediatek/docs/sync.md`, "`terminated` says
nothing". The same line is written in the log of the machine that tried, which is where you look
when a browser three hops away says the analysis failed.

## The transport is ours, but it is not here

No `controls`: the waveform **is** the scrub bar, and two scrub bars contradict each other the
moment one is dragged. The page header's button and clock are the only other controls.

Which version is open, and where its cursor rests, is the PAGE's (`src/useSongTransport.ts`): the
header's button, this tab and the followed lyrics read it, so the three agree on one version. The
button speaks for the song: while any version of it sounds, it pauses that one rather than
replacing it with the open tab's.

What they drive, though, does not belong to the page. `playback.toggle()` and `playback.seek()` when the
open version is the one playing; `playback.start()` otherwise, the only way to load one. The
`<audio>` element, the `requestAnimationFrame` loop tracking the playhead — `timeupdate` fires four
times a second and reads as a stutter — and the sharing between the two destinations live in
`PlaybackProvider`: see [miniPlayer.md](miniPlayer.md).

The page keeps what only it knows: where the cursor is **before** this version is the one playing.
You click in a stopped song's waveform, then press play, and it starts there — `cursor` is that
point, and it is passed to `start`.

### The version travels with it

The engine holds one session, shared with everything else the library auditions. Three versions of a song
sent under the song's name would be three indistinguishable lines. `NowPlaying.version` therefore
carries the tab's name — absent for the master, whose document is the song — and the provider
composes `"song · version"` from it. The bottom bar shows it for the same reason: it sits under a
screen whose tab strip may point at something else entirely.

## One tab per version

At the top of the Waveform tab, a strip: **Original**, then each variant the sidecar declares, in the
sidecar's order. The open tab decides *everything* below it — the file played, the waveform drawn,
the analysis requested, the path sent to the engine — because it is one question asked one way:
what does this version sound like.

`@studio/mediatek/takes` holds the shape, outside the component and therefore testable: a version is
a name, a kind and the file it is.

| kind | its audio |
|---|---|
| `master` | `meta.master`, the recording of the song itself |
| `file` | `ref`, a file from the folder — which is what makes it a *file* variant |
| `missing` | nothing: the sidecar declares a file the folder does not have |

`missing` is a kind in its own right rather than an absence, because the tab has to say so. A
sidecar is hand-written and readily names a file that never arrived; the tab then opens on the
sentence naming it, not on an empty panel.

Two consequences worth stating:

- **Analysis is per file**, not per song: `attempted` remembers a path, so each version is analysed
  at most once and returning to an already-drawn version costs nothing.
- **Changing tab does not stop the sound**, deliberately. The panel does not own the transport: what
  is playing carries on, and the open tab simply becomes a tab you are looking at. `isCurrent`
  compares `path` against what the provider holds, so the strip goes to rest and the clock restarts
  from the cursor — while the bottom bar goes on naming the version that is playing.

A song with no variant has no strip at all: a single tab is a control that does nothing.

## The variants are under the waveform

In the same tab, not in one of their own: the master and its other versions are
one question, and a column that only showed when *nothing* is open would be unreachable, since
clicking a song opens something.

## An address for a song

`/songs/<artist>/<album>/<title>/song.yaml` is an address, like `/modules/audio/reverb/ui.k7x`. See
[routing.md](routing.md): `CARRIES` says which sections carry a file path after their first segment.

## The sidecar may not exist, the master may not either

A folder found on disk with no `song.yaml` is listed anyway — `catalogued: false`, a song nobody
filed — and its form edits its master like any other: the tags need no sidecar. A folder holding a
sidecar and no audio has nothing to tag, and the Info tab says so instead of offering a form that
could not save.
