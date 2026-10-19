# Desk timing: analysis, tempo, sync, loops, cues

Everything the desk knows about *when* comes from one analysis of the file, plus a correction the media library may hold. The arithmetic lives in small pure modules under `packages/k7-plugins/src/turntables/`, each with a test, so the parts that decide what you hear and see are testable without React or an engine.

## Analysis

A song's waveform, onsets and tempo come from a **sidecar** `{file}.cache` written next to the audio.

| Path | Role |
|---|---|
| `packages/audio-analysis/src/decode.ts` | Decodes through the engine binary's `--decode` when there is one, ffmpeg (`FFMPEG_BIN`) otherwise. |
| `packages/audio-analysis/src/envelope.ts` | Builds peak/RMS, three bands (split at 200 Hz and 4 kHz), onsets and tempo. The only producer of a sidecar: a constant changed here needs a `CACHE_VERSION` bump. |
| `packages/audio-analysis/src/sidecar.ts`, `fingerprint.ts` | The sidecar's JSON, and the content fingerprint (FNV-1a/64 over size, first and last 64 KB) checked on every read. |
| `packages/audio-analysis/src/analyse.ts` | Decode, measure, stamp, write. |
| `packages/audio-probe/src/waveform.ts` | Onset detection and the `FileEnvelope` shape; browser-safe. |
| `packages/file-service/src/waveformCache.ts` | `ensureFileEnvelope`: memo, matching sidecar, else decode; concurrent asks for one file share one decode. |
| `packages/file-service/src/routes/mediatek.ts` | `GET /mediatek/envelope?path=` for a cached media-library song: 404 when the file is absent, 503 without an engine binary. |

The desk's view of it is `Envelope` in `waveform.ts`: 8192 peak buckets per file whatever its length, `rms`, optional `low`/`mid`/`high`, `transients` in file seconds, and `bpm` (0 for none). The tempo is a starting point, not an authority.

### Prewarm

`prewarm.ts` walks the set list **one song at a time** through the same `service.envelope` call a load makes, so a warmed song costs a load nothing. Sequential on purpose: the analysis is the engine's, and a set list fired in parallel would compete with the record being loaded. A failure is counted, never thrown; an `alive()` check between songs stops the walk when the playlist changes or the desk closes. `MixView` starts it when the resolved set list changes and draws `done/total` while it runs.

## Beat grid

`beatPhase(transients, bpm)` (in `beats.ts`) finds where the grid starts as a **circular mean** of every onset modulo the beat period, not the first transient. `strength` is the mean resultant length; the phase is `confident` only if the Rayleigh statistic `n·R² > RAYLEIGH_Z` (4.6, p ≈ 0.01). A grid that is not confident is not used to align beats: `MixView` only sets `DeckTempo.phase` when `grid.confident`.

`BEATS_PER_BAR = 4` is assumed everywhere and measured nowhere. Bar lines (`barsIn` (in `waveform.ts`)) and the metronome's accent depend on it.

## Tempo

`DeckTempo` (`deckVocabulary.ts`) holds `natural` (what the record is), `target` (what it plays at), `seconds`, optional `phase`, and `keylock`.

- **Correction.** `corrected` (in `grid.ts`) lays the media library's stored BPM over the analysis: it replaces `natural`, and `target` follows only if the fader had not moved. The library value arrives with the load (`DeckLoad.bpm`, from the entry's `meta.bpm`), and `÷2`/`×2` write it via `POST /bpm` on the library with `force: true` before taking it locally (`MixView.correctTempo`). A correction belongs to the record, which is why it is not in `mix.k7x`.
- **Rate.** `platterRate` (in `deck.ts`) is `target / natural` (0 when stopped). The cold tempo module is never a plugin; its `Target BPM` is lent to the graph through `offlinePublish`.
- **Keylock.** `platterKey` sends `Key = 1` only while not scratching; a hand on the record is always varispeed.
- **Drag.** `nudge` updates the target on every pixel; a throttle (`LIVE_WARP_MS`) re-sends the document, and `release` sends the final value unconditionally.
- **Range.** `PITCH_RANGE = 0.16` only colours the readout; the fader goes the module's full 10..300.

## Sync

Two buttons, one choice: `master` is the leading deck or null.

1. `syncedTempos` gives every other deck with a `natural` the leader's `target`.
2. Platters share no start, so beats are aligned by **seeking** the follower: `alignSeek` (in `beats.ts`) compares both decks' positions in beats since their own first downbeat and moves the follower the shorter way round, never before 0. It returns null when either grid is unknown; the tempo still matches ("tempo only").
3. Moving the follower's fader clears `master`.

## Needle, seek, scratch, shuttle

- The **needle** is the first platter's own clock (`deck.platters`), in seconds of the record; four stem platters share one position.
- `place(deck, seconds)` sends `Seek` as a fraction of `seconds` to every platter of the deck, with a 1e-9 wobble so the same cue twice is two distinct values.
- **Scratch** writes `Rate` straight to the platters, throttled to `SCRATCH_MS = 16`, keeping the newest rate; a release is never delayed and restores the document's rate. **Censor** is a scratch at `CENSOR_RATE = -1`.
- **Shuttle** (`shuttle.ts`): `shuttleRate(dx, width)` is squared, signed (left is forward), capped at `SHUTTLE_MAX = 16`, with a `SHUTTLE_DEAD = 4` px dead zone. The waveform integrates it per frame and seeks once on release, holding the drawn position until the needle arrives.

## Loops

`loop.ts` is the arithmetic, `useDeckLoops.ts` the state; both read the platter's `LoopStart`, `LoopEnd` (fractions of the record) and `Roll`.

- A length in beats becomes seconds at the record's **natural** tempo, never the fader's: the grid is a fact about the file.
- `LOOP_BEATS = [4, 8, 16]`; `resized` bounds ÷2/×2 to `LOOP_MIN_BEATS` 1/8 .. `LOOP_MAX_BEATS` 32; `beatsBetween` rounds a manual IN→OUT to whole beats above one and to the halving ladder below.
- `snapToBeat` takes the **nearest** beat, not the next. Quantise (one switch, default on) applies it to loop starts and beat jumps.
- `loopParams` returns writes **in order**, which is the contract: opening sends `Roll` first (the platter latches it on engage), then `LoopStart`, `LoopEnd`; closing moves `LoopEnd` alone to 0, since dropping the start first would open a loop from zero for a block.
- A load, and a cue jump, turn the deck's loop off.

## Cues

Cues live in the project's `mix.k7x` (schema `packages/song-schema/src/yaml/mixSchema.ts`, reader/editor `packages/song-schema/src/yaml/mixFile.ts`): `cues:` entries keyed by `@k7-core/<media-library id>`, `markers` positional (`MARKER_SLOTS = 8`) in **source seconds**.

- `CueButtons.tsx`: a press captures the needle on `pointerdown`; after `HOLD_MS = 1000` it sets the cue at that captured position, otherwise a release jumps.
- `useDeckSet.setCue` edits the **text** with `withMarkers` and writes it back, so the file's comments survive. It refuses to write a sheet it has not read for this project (`mixReadFor`), so a failed read cannot erase it.

## Metronome

`metronome.ts`: the click is a track appended to the document (a `4osc` synth at `METRONOME_DB = -6`), not the engine's metronome, because the engine clicks on the document grid while the music's beat is on a platter. `metronomeDeck` picks one beat to follow: the only loaded deck, or the sync leader, and only with a measured `phase`. The clip is one looping bar of four notes (the first at a different key), spaced at the deck's target tempo, from transport zero; the document tempo is fixed at `DOC_TEMPO = 120`.

## Layout

`deskLayout.ts` decides from the measured height (`useContentHeight.ts`) whether the record is drawn (`VINYL_MIN` 176 .. `VINYL_MAX` 352 px), the waveform's height (44..180, 80 beside a record), and the knob ladder of the strip. `underWave` is the height under the waveform; the mixer column pads by it so the crossfader lines up with the waveforms. `CROSSFADE_BLEED` (in `MixerColumn.tsx`) makes the crossfader reach the cue rows' edges (`crossfadeReach.test.ts`).
