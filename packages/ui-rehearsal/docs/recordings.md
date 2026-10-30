# Recordings — sessions and their moments, one timeline, and any capture's page

`src/views/RecordingsTimeline.tsx` is the whole of the **Sessions** entry (the sidebar's name for it,
which the media library's own Recordings would otherwise share), at
`/rehearsal/sessions`: a calendar to pick a day, and that day's sessions on a timeline with each
session's moments hanging under it, indented.

## One list, not a Sessions tab and a Moments tab

A moment is a stretch of a session, so the question a list has to answer is "what did I get out of
that take?" — two tabs would make you hold the session in your head while reading the other list.
Under its session, a moment is in the order it was played (by its offset into the take), and its
time column shows the wall-clock time it happened: the session's start plus that offset.

`/rehearsal/moments` lands on `/rehearsal/sessions`; a moment's own page is
`/rehearsal/moments/:id`.

## The moments no session holds stand with the sessions

A moment names a RECORDING, not a session (`packages/rehearsal-server/docs/moments.md`): it hangs
under the session that saved that recording. A moment with no such session has nothing to hang
under, so it takes the session level, placed at the time it was played (its recording's start plus
its offset). It is one of two kinds, and says which one. A moment cut from another capture of the
médiathèque reads "library recording". A moment whose recording is gone (its session deleted, or
shared here from a machine) reads "recording deleted".

## The tag filter keeps sessions, not only moments

A tag narrows the list to what carries it: a session stays when **any** of its moments has the
tag, and only those moments show under it; a moment standing alone stays when it has the tag itself. The
calendar then marks only the days with a match, and choosing a tag jumps to the newest one — a
filter that leaves you on an emptied day looks like it found nothing.

## Any capture opens as a session's page

The médiathèque lists every capture of its zone, and a moment can be cut from any of them
(`packages/ui-library/docs/recordings.md`). A capture opens at `/rehearsal/recording?path=…`
(`src/containers/RecordingDetailContainer.tsx`). It is the session's page drawn over the capture:
the same waveform, detection, selection and moment editor, with no markers and no **Continue**,
which belong to a session's take and to nothing else. One page and not a second editor: cutting a
moment is the same act whatever filed the recording. The path is a query and not a segment of
the address because it holds slashes. A capture a session of yours saved redirects to that
session's page, so its markers stay in view. Back returns where the page was opened from, the
médiathèque as often as here.

Its waveform and audio are the médiathèque's own (`/api/mediatek/envelope`, `/api/mediatek/stream`):
the library has measured every file it holds, and a capture has no session row to keep an envelope
in.

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

## Every upload says how far it is

A take, a release and a release's version are each one request carrying a file, and a long take
on a slow link is minutes of a request that `fetch` reports nothing about: a spinner that never
moves reads as a hang, and a hang is what makes a musician reload the tab. So every upload goes
through `@studio/http-client`'s `upload`, XMLHttpRequest's `upload.onprogress` being the one browser
API that says how many bytes have left (`packages/http-client/docs/httpClient.md`). It answers a `Response`, so `api.ts` reads it like any fetch and keeps
`ApiError`'s sentence. `uploadLabel.ts` turns the share into what the button or the line says:
a percentage, then **Analyzing…** once every byte is sent and the server is decoding and measuring
the file. The media library uploads its songs through the same helper (`packages/ui-library/docs/api.md`).

## The pop-in and the chain panel keep the keyboard inside

The recorder's pop-in and the chain panel are modal, and are not the shared `Dialog` primitive:
the pop-in becomes the bottom bar by a class swap rather than unmounting
([audio.md](audio.md)), and the chain panel is hidden rather than unmounted during a take, since
its frame is k7's open bench. A primitive that mounts its content in a portal on open would
re-parent both. `src/hooks/useFocusTrap.ts` gives them what the primitive would: focus moves in
when they show, Tab cycles inside, and focus returns where it was when they hide. Clicking outside
the pop-in hides it to the bar; nothing about the trap ends a take.

## Playing a session re-renders the playhead, not the page

A session's page follows playback every frame, so the position is a store
(`createLiveValue`, `packages/recorder`) rather than the page's state: the waveform and the
`0:42 / 3:10` clock subscribe to it (`src/components/Playhead.tsx`), the clock only when the
second changes. The page itself — the moments, their editors, the threshold controls — renders on
what the user does, never on the frame clock.
