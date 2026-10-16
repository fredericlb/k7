# Recordings — sessions and their moments, one timeline

`src/views/RecordingsTimeline.tsx` is the whole of the **Recordings** entry, at
`/rehearsal/sessions`: a calendar to pick a day, and that day's sessions on a timeline with each
session's moments hanging under it, indented.

## One list, not a Sessions tab and a Moments tab

A moment is a stretch of a session, so the question a list has to answer is "what did I get out of
that take?" — two tabs would make you hold the session in your head while reading the other list.
Under its session, a moment is in the order it was played (by its offset into the take), and its
time column shows the wall-clock time it happened: the session's start plus that offset.

`/rehearsal/moments` lands on `/rehearsal/sessions`; a moment's own page is
`/rehearsal/moments/:id`.

## Orphans stand with the sessions

A moment outlives the session it was captured in (`Moment.sessionUid` still names a session that
no longer exists). It then has nothing to hang under, so it takes the session level, placed on the
day and at the time it was made, and says "session deleted".

## The tag filter keeps sessions, not only moments

A tag narrows the list to what carries it: a session stays when **any** of its moments has the
tag, and only those moments show under it; an orphan stays when it has the tag itself. The
calendar then marks only the days with a match, and choosing a tag jumps to the newest one — a
filter that leaves you on an emptied day looks like it found nothing.

## Moments are found in the browser

A session's page detects its moments itself, with `@studio/recorder`'s `detectEvents` over the
envelope it fetches anyway to draw the waveform; the server has no detector and stores no detected
span. The floor and the silence length are sliders, and each move re-runs the detection: in the
browser that is arithmetic over an array already in memory, where a server round trip per move
needed a debounce and still lagged. Over the stored envelope means the whole timeline, an appended
take included, never the segment just uploaded.

## A take exists nowhere but the tab until it is saved

The recorder keeps its chunks in memory and uploads the whole take in one request when it stops, so
every failure mode of that request is a way to lose a performance. The recorder's own safeguards —
the IndexedDB backup, a source that ends, a hidden tab — are its page
(`packages/recorder/docs/recorder.md`). The host adds three:

- **A failed upload leaves the take in hand.** The stopped take is kept until it is saved, and the
  error comes with **Retry** — the same take, sent again — and **Download**, which saves it to the
  device under the recorder's own MIME type. Nothing about a refused upload discards the audio.
- **Once the upload has answered, the save cannot fail.** `RehearsalRecording`'s save throws only
  for the upload itself; the annotations, the seam marker and the list refresh after it are
  best-effort. The reason is Retry: a save that failed AFTER the take was stored would offer to
  send it again, and an appended take sent twice is a session with the same audio in it twice.
- **Leaving asks first.** While a take is recording, paused, uploading or refused, closing or
  reloading the tab raises the browser's confirmation. Moving between k7's home pages is not
  leaving: the take is held above their routes ([audio.md](audio.md)).

The server gives a single request 30 minutes rather than Node's 5, and never holds a take whole in
memory (`packages/rehearsal-server/docs/audit.md`).

## Playing a session re-renders the playhead, not the page

A session's page follows playback every frame, so the position is a store
(`createLiveValue`, `packages/recorder`) rather than the page's state: the waveform and the
`0:42 / 3:10` clock subscribe to it (`src/components/Playhead.tsx`), the clock only when the
second changes. The page itself — the moments, their editors, the threshold controls — renders on
what the user does, never on the frame clock.
