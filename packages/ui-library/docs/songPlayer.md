# Opening a song — the split screen

A song opens like a module and like a chain: the tree stays on the left, and the rest of the width
splits in two.

```
┌────────┬─────────────────────┬─────────────────────┐
│ tree   │ song.yaml           │ transport           │
│        │ (YamlPane)          │ Original · inst · … │
│        │                     │ waveform            │
│        │                     ├─────────────────────┤
│        │                     │ variants (if the    │
│        │                     │ sidecar declares    │
│        │                     │ any)                │
└────────┴─────────────────────┴─────────────────────┘
```

That is `ChainEditor`'s shape — text on the left, what the text describes on the right — and
deliberately so: the two families ask the same question, and a third layout would only add one more
thing to learn.

## The browser does not decode audio

The waveform does not come from a `decodeAudioData`: it comes from the `.cache` sidecar the engine
writes **beside** the master (`packages/file-service/src/routes/mediatek.ts`, and
`packages/file-service/docs/waveformCache.md` for what it holds). `songWaveform.ts` reads it through
the ordinary file route — to that service a `.cache` is a file like any other — and keeps three
fields:

| field | what it becomes |
|---|---|
| `rms[]` | `Envelope`'s samples, already linear 0..1 |
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
moment one is dragged. The header's button and clock stay this panel's only controls.

What they drive, though, does not belong to it. `playback.toggle()` and `playback.seek()` when the
open version is the one playing; `playback.start()` otherwise, the only way to load one. The
`<audio>` element, the `requestAnimationFrame` loop tracking the playhead — `timeupdate` fires four
times a second and reads as a stutter — and the sharing between the two destinations live in
`PlaybackProvider`: see [miniPlayer.md](miniPlayer.md).

This panel keeps what only it knows: where the cursor is **before** this version is the one playing.
You click in a stopped song's waveform, then press play, and it starts there — `cursor` is that
point, and it is passed to `start`.

### The version travels with it

The engine holds one session, shared with everything else the library auditions. Three versions of a song
sent under the song's name would be three indistinguishable lines. `NowPlaying.version` therefore
carries the tab's name — absent for the master, whose document is the song — and the provider
composes `"song · version"` from it. The bottom bar shows it for the same reason: it sits under a
screen whose tab strip may point at something else entirely.

## One tab per version

Under the transport, a tab strip: **Original**, then each variant the sidecar declares, in the
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

## The variants are under the player

In the same half of the screen, not in a column of their own: the master and its other versions are
one question, and a column that only showed when *nothing* is open would be unreachable, since
clicking a song opens something.

## An address for a song

`/songs/<artist>/<album>/<title>/song.yaml` is an address, like `/modules/audio/reverb/ui.k7x`. See
[routing.md](routing.md): `CARRIES` says which sections carry a file path after their first segment.

## The sidecar may not exist

A folder found on disk with no `song.yaml` is listed anyway — `catalogued: false`, a song nobody
filed. The editor then opens on a template (`# <path>` and `title:`) rather than an error, and the
first save creates the file through the ordinary write route. That is what `library.moduleUi`
already does for a missing panel, and for the same reason: refusing to open leaves the person in
front of a screen that offers nothing.
