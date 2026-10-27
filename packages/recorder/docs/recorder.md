# The recorder

`@studio/recorder` takes a take in the browser: `useRecorder` records the audio and builds its level
envelope (RMS) at the same time, through the Web Audio API, and `RecorderView` draws it live. It
can pause and resume, so you can stop listening for a moment and carry on with the same take; the
live `samples` array feeds moment detection as it goes. The rehearsal pages mount it
(`packages/ui-rehearsal/docs/audio.md`); where its bytes go is the server's page
(`packages/rehearsal-server/docs/audio.md`).

## Five precautions

- **The audio context is resumed by hand.** Recording can start right after a navigation, so the
  context may be created outside a direct user gesture, and it is then born `suspended`: the
  analyser would read nothing but silence — dead meter, no moment detected.
- **It is the RAW input track that is recorded**, not the audio graph's output. The `MediaRecorder`
  is then independent of the context's state, and a suspended context cannot produce an empty
  recording. Input level is left to `getUserMedia`'s `autoGainControl`.
- **The gain is derived from the observed peak** and applied uniformly on stop, not during: that
  is what keeps the stored envelope coherent end to end. `TARGET_PEAK = 0.9` aims the loudest
  moment just under full scale, ~ −1 dBFS.
- **The duration is written into the WebM header, and only the header is read to do it.**
  `MediaRecorder` omits it, which makes the file unseekable: `duration` is `Infinity` and
  assignments to `currentTime` are ignored. `src/webmDuration.ts` reads the first 64 kB, adds a
  `Duration` to the Segment's `Info` (moving a sized Segment's size and any `SeekHead` position past
  `Info` with it), and hands back a Blob of the patched head and a SLICE of the rest — the take's
  bytes are never copied into the JS heap. The server stores the bytes as sent and keeps the
  duration in its row from the form, so a file without the header would still be listed right but
  play unseekable: the fix stays in the browser. A layout the patch does not know falls back to
  `fix-webm-duration`, which reads the whole file and rebuilds it — two to three times the take in
  memory — so only under 32 MB; past that the take is uploaded unfixed rather than risk the tab on
  a three-hour phone take.
- **The screen lock is re-requested on return to the foreground.** The OS revokes it as soon as
  the tab goes to the background and never gives it back; without this catch-up a long take is
  cut off by the device locking.

`getUserMedia` constraints are tried unprocessed first, then in fallback: Safari in particular
refuses some combinations with a `NotFoundError` ("The object can not be found here.") even
though a microphone exists.

## One bar, never a dialog

`RecorderView` is a bar at the foot of the page, whatever the take is doing, so the page above stays
usable: the songbook is read while the band plays. The bar holds the take's status and time, two
waveforms with the highlights drawn on them, **Pause** or **Resume** and **Stop & save** as bare
icons, and a ⋮ that holds the metronome: a tool a take rarely touches does not take room from the
ones it does. The waveform over nine tenths of the width frames the take from its start in a window
of a minute that grows by half a minute each time the take reaches its end: a window that tracked
"now" would rescale under the eye every second, and steps keep the drawn highlights still long
enough to aim at. The last tenth scrolls the last twelve seconds, where a level is checked. The
framed view reads every sample, so it is redrawn twice a second, not every frame; only its playhead
follows the frame. The ⋮ opens outside the bar, so the host hands it its scope class
(`menuClassName`) for its palette to reach it. A highlight clicked on either waveform pauses the
take and plays it back from its start and no further, tinted on the framed view, with a row over the bar to play it again and to
note what happened; **Resume** carries the take on from where it paused. Errors, the upload's
progress and a failed upload's Retry and Download are said in the bar too. It publishes its own
height as `--rec-bar-h`, which the host pads its pages and stacks its own bars by, the bar growing
while a highlight is heard.

Stopping requires a **two-second hold** on the Stop button, so a brushed tap does not end an
hour-long take. No key does it: the pages stay usable during a take, and a key held anywhere, a
space in a field or on a focused button, would otherwise end it.

## A take of hours renders like a take of seconds

The recorder runs for hours, so nothing per frame may re-render its view, and nothing per sample
may cost the length of the take:

- **The input is read every frame, and state moves once a second.** `useRecorder` reads the input's
  level every frame for the peak the gain is drawn from; the view's own state — the elapsed seconds,
  the gain — changes once a second at most.
- **The waveform scrolls itself.** `LiveWaveform` takes a `LiveFeed` — a clock and a pull — and
  redraws from its own animation frame; its cost per frame is the canvas's width, whatever the
  take's length. The preview's playhead is a function it reads each frame, not a prop re-rendered.
- **The envelope grows in place.** Samples are pushed into one array; the drawn envelope (a resumed
  session's saved samples, then the new ones at the live gain, `src/liveEnvelope.ts`) is appended
  to as frames pull it and rebuilt only when the gain moves.
- **Moments are detected once a recorded second**, over the raw samples: the floor is a share of
  the peak, so the gain does not change what is found.

## A take survives the tab, the source and the timer

- **A crash leaves the take behind.** Every one-second chunk is ALSO written to IndexedDB as it is
  recorded (`src/takeBackup.ts`), and a take's backup is deleted only once its save succeeds. The
  next visit lists what a closed or crashed tab left, with **Download** and **Discard**. It is
  best-effort: a full quota or a browser without IndexedDB means no backup, never a broken take.
  Download is the way back rather than an upload, because re-uploading would need an envelope the
  backup does not hold.
- **A source that dies is said, and the take pauses.** An input that ends mid-take — a microphone
  unplugged, a chain that failed — shows why and pauses the recorder, keeping
  what came before instead of recording silence. Every source reaches the recorder as a
  `MediaStream`, so a failure after the connection was made arrives as an `ended` on the stream's
  tracks, the one event it listens for.
- **The envelope keeps time in a hidden tab.** Samples are owed by RECORDED time: a backgrounded tab
  that runs the sampler once a second fills the missing slots, so the waveform and the detected
  moments stay aligned with the audio.

What happens to a take once it is stopped — Retry, Download, the confirmation before leaving — is
the host's (`packages/ui-rehearsal/docs/recordings.md`).

## Detecting moments

`src/detect.ts` surfaces moments live during a take, and the session page runs it again over the
stored envelope (`packages/ui-rehearsal/docs/recordings.md`). The model is three sentences, and the first is the one that gets misread:

- `threshold` is the **minimum** volume the algorithm cares about: a silence floor, not a
  "loud" bar.
- A **non**-moment is any stretch of at least `minSilenceSec` seconds spent continuously under
  that floor.
- Everything else is a moment. A dip shorter than `minSilenceSec` therefore does not cut the
  moment around it.

## The package carries no catalogue

`RecorderView`, `MomentPlayer`, `TagInput` and `describeMicError` take their words as a `labels`
argument with English defaults, and the host fills it from its own messages
(`packages/ui-rehearsal/src/recorderLabels.ts`). One catalogue per app, not one per package, is what
keeps a translator in a single file.

## The click is shared

`useMetronome` is exported alone as `@studio/recorder/metronome`, for a page that wants the click
and none of the recorder: the médiathèque's song page clicks at a song's tempo with it
(`packages/ui-library/docs/songPlayer.md`). The package root imports the stylesheets, the subpath none.
