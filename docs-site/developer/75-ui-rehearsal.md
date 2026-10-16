# The rehearsal screens

`packages/ui-rehearsal` (`@studio/ui-rehearsal`) draws the rehearsal recorder: sessions and
moments, publications, the songbook, exercises, the recorder's pop-in, the phone microphone page
and the public page. k7 mounts it under `/rehearsal`.

## Entry points

| Export | File | For |
|---|---|---|
| `.` | `src/index.ts` | What a host's entry imports: `configureRehearsal`, `RehearsalHostProvider`, `followLocale`, `RehearsalRecording`, `NewSessionButton`, `REHEARSAL_SECTIONS`, `rehearsalSectionAt`, `isSongPage`, `publicPageAt`, `isRemoteMic` |
| `./pages` | `src/pages.ts` | `RehearsalRoutes`, `RehearsalPublicPage`, `RehearsalRemote`, loaded as a lazy chunk |
| `./settings` | `src/settings.ts` | `RehearsalSettings`, the host settings page's section |

The split keeps the heavy screens (alphaTab, pdf-lib, the EPUB generator) out of k7's first load.

## The host contract

As in the media library, two channels:

- `configureRehearsal({ apiBase, pagesPrefix })` (`src/config.ts`), module-level, for `src/api.ts`,
  `src/rtc.ts` and `src/fetchSong/pl8.ts`.
- `RehearsalHostProvider` (`src/host.tsx`): `{ prefix, user, onLogout?, settingsHref? }`.

Every navigation goes through `useRehearsalNav()` (`path()` and `go()` under the prefix): a bare
`/sessions` would leave it. k7's side is `apps/k7/frontend/src/projects/RehearsalHost.tsx` and
`RehearsalPage.tsx`.

## Routing

`src/routes/RehearsalRoutes.tsx` declares relative routes:

| Path | Screen |
|---|---|
| `sessions`, `releases`, `songs` | `HomeView` on the matching tab |
| `sessions/:id`, `moments/:id` | Session and moment pages (`src/containers/`, `src/views/`) |
| `releases/new`, `releases/:id`, `pages/new`, `pages/:id` | Wrapped in `ServerOnly` |
| `songs/new`, `songs/:id` | Song form and page |
| `exercices`, `exercices/singing`, `exercices/random-chords`, `exercices/tuner` | Exercises |
| `settings` | Redirects to the host's settings page |
| `pages`, `moments`, `*`, index | Redirect to `releases` or `sessions` |

`src/sections.ts` maps an address to its sidebar entry: `releases` and `pages` are one entry
(Publications), `sessions` and `moments` another (Recordings). `src/addresses.ts` recognises the
two addresses a host must handle before its gate and frame: `/@<nametag>` and `/remote`.
`src/routes/useRehearsalData.ts` loads and refreshes the lists the home tabs share.

`ServerOnly` (`src/components/ServerOnly.tsx`) asks `/api/publications` and draws its children only
when releases and pages are reachable, otherwise the reason.

## The catalogue

The pages have their own paraglide catalogue: `messages/en.json` and `messages/fr.json`,
configured by `project.inlang/settings.json` (base locale `en`). `npm run i18n` compiles them into
`src/paraglide/` (generated, not edited); `pretypecheck` and `pretest` run it. The host owns the
language: `followLocale(locale)` in `src/i18n.ts` switches this runtime, called in render so the
first message already reads it; both runtimes share the localStorage key. A new sentence is a key in
both JSON files, used as `m["key"]()`.

## The running take

`RehearsalRecording` (`src/recording/RehearsalRecording.tsx`) wraps the host's routes and holds the
take ABOVE them, so it survives page changes. It renders nothing until a take starts; then it lazy
loads `src/recording/RecordingOverlay.tsx`: the source dialog (`SessionSourceDialog`), the chain
panel (`ChainSourcePanel`), and the recorder as a pop-in or a bottom bar (two class swaps, never an
unmount). Its context (`src/recording/context.ts`) exposes `start`, `resume` (continue a session:
the new take is appended and its annotations shifted by the previous duration, with a marker at
the seam) and `minimized`.

On save: upload or append the take, then post the annotations (tagged highlights). Nothing after
the upload may fail the save, or a retry would upload the take twice.

Sources:

- Local microphone: `acquireMicrophone` from `@studio/recorder`.
- Remote device: `src/rtc.ts` opens the signaling socket with a ticket and receives a peer-to-peer
  MediaStream; `src/views/RemoteMicView.tsx` and `src/hooks/useRemoteInput.ts` are the phone's side
  (device, channel or mono mix).
- k7 chain: `src/chainSource.ts` and `src/components/ChainSourcePanel.tsx`. k7's bench opens the
  chain in an iframe; the recorder finds the engine holding it, subscribes to its master broadcast,
  and turns that into a MediaStream. It sends the engine no project. The panel is hidden during a
  take, never unmounted, or k7 would reload and drop its claim on the engine.

## The songbook's track pipeline

`src/fetchSong/` runs in the browser, as the user, because the hunt refuses service tokens on
purpose:

- `pl8.ts`: the calls to the media library (library search, hunt, engines, stems).
- `match.ts`: which library song a songbook song is (normalised artist and title, then every word,
  then a title by an artist one typo away). Pure.
- `run.ts`: `fetchSong`, `makeInstrumental`, `syncLyrics` and `runPipeline` (search, download,
  lyrics, stems), as resumable steps. Progress is persisted on the song (`FetchPhase`,
  `FetchProgress`, `FetchHuntId`, `FetchJobId`…) so a reload resumes. Lyrics run before stems: a song
  LRCLIB lists as instrumental has no voice to take out.

## Other notable modules

| File | Role |
|---|---|
| `src/hooks/usePitchShift.ts` | Transposes the reference track through Signalsmith Stretch in live-input mode (pitch moves, tempo does not); built on demand, bypassed at zero |
| `src/hooks/useLyricsLead.ts` | Seconds a clicked lyric line starts early, per browser |
| `src/songTabs.ts` | Which content tabs a song shows |
| `src/export/` | `songPdf.ts` (pdf-lib, WinAnsi transliteration, A4), `songEpub.ts` (epub-gen-memory around `@studio/rehearsal-shared/epub`), `sheets.ts` (re-encodes non JPEG/PNG images for pdf-lib), `songbookZip.ts` (fflate, one song at a time) |
| `src/utils/pitch.ts`, `src/views/GuitarTuner.tsx` | Frequency to note and cents, nearest string; detection by `pitchy` |
| `src/utils/exercises.ts`, `src/utils/chordDiagram.ts` | Random chords over `@tombatossals/chords-db`, diagrams via `@tombatossals/react-chords` |
| `src/components/SongbookServerCopy.tsx`, `src/components/MomentServerShare.tsx` | A paired device's songbook and moment placement |
| `src/components/RecoveredTakes.tsx` | Offers back takes left in IndexedDB |

Styles are plain CSS under `src/styles/`, scoped by the `.rehearsal-root` wrapper class.

## Tests

`npm test -w @studio/ui-rehearsal` (compiles the catalogue first) runs vitest over the pure modules:
`chainSource`, `songTabs`, `export/*` (naming, zip, EPUB input, PDF), `fetchSong/match`,
`fetchSong/run` (the pipeline against fakes), `hooks/useLyricsLead`, `utils/*`,
`views/PublicationsList`, `views/RecordingsTimeline`. Components are not mounted; a few have
Storybook stories (`*.stories.tsx`).
